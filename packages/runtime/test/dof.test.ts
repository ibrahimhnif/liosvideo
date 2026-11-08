import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { depthOfFieldPasses, dofOffsets, pixelAverage } from "../src/three/dof";
import { three } from "../src/graph/three";
import { renderThreeNode, resetThreeSoftware } from "../src/gpu/three_soft";

function camera() {
  const c = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  c.position.set(1, 2, 8);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

/** Pixel position of a world point through `cam` (height 360, width 640). */
function project(cam: THREE.PerspectiveCamera, p: THREE.Vector3): [number, number] {
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const v = p.clone().project(cam);
  return [((v.x + 1) / 2) * 640, ((1 - v.y) / 2) * 360];
}

describe("dofOffsets", () => {
  it("spreads the samples evenly over the unit disc, the same every time", () => {
    const a = dofOffsets(16);
    expect(a).toHaveLength(16);
    expect(dofOffsets(16)).toEqual(a);
    for (const [x, y] of a) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
    const mean = a.reduce((m, [x, y]) => [m[0] + x / 16, m[1] + y / 16], [0, 0]);
    expect(Math.hypot(mean[0], mean[1])).toBeLessThan(0.1);
  });
});

describe("depthOfFieldPasses", () => {
  it("keeps the focal plane still and moves what is nearer", () => {
    const cam = camera();
    const forward = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    // off-centre, but on the plane 6 units in front of the camera
    const focal = cam.position.clone().addScaledVector(forward, 6).addScaledVector(right, 0.4).addScaledVector(up, 0.3);
    const near = cam.position.clone().addScaledVector(forward, 2);
    const passes = depthOfFieldPasses({ focus: 6, aperture: 0.2, samples: 8 }, cam, 0, 360);
    expect(passes).toHaveLength(8);
    const focalAt: [number, number][] = [];
    const nearAt: [number, number][] = [];
    for (const pass of passes) {
      const restore = pass();
      focalAt.push(project(cam, focal));
      nearAt.push(project(cam, near));
      restore();
    }
    for (const p of focalAt) {
      expect(p[0]).toBeCloseTo(focalAt[0][0], 3);
      expect(p[1]).toBeCloseTo(focalAt[0][1], 3);
    }
    const spread = Math.max(...nearAt.map((p) => Math.hypot(p[0] - nearAt[0][0], p[1] - nearAt[0][1])));
    expect(spread).toBeGreaterThan(5);
  });

  it("puts the camera back as it was", () => {
    const cam = camera();
    const before = cam.matrixWorld.clone();
    const projection = cam.projectionMatrix.clone();
    for (const pass of depthOfFieldPasses({ focus: 5, aperture: 0.3 }, cam, 0, 360)) pass()();
    expect(cam.matrixWorld.equals(before)).toBe(true);
    expect(cam.projectionMatrix.equals(projection)).toBe(true);
    expect(cam.view === null || cam.view.enabled === false).toBe(true);
  });

  it("focuses on a world point, or on what a function of time gives", () => {
    const cam = camera();
    const point = new THREE.Vector3(0.5, 0, -1);
    const check = (focus: any, time: number) => {
      const at: [number, number][] = [];
      for (const pass of depthOfFieldPasses({ focus, aperture: 0.2, samples: 6 }, cam, time, 360)) {
        const restore = pass();
        at.push(project(cam, point));
        restore();
      }
      for (const p of at) expect(Math.hypot(p[0] - at[0][0], p[1] - at[0][1])).toBeLessThan(1e-3);
    };
    check([0.5, 0, -1], 0);
    check((t: number) => (t > 1 ? [0.5, 0, -1] : 3), 2);
  });

  it("is a single plain pass without depth of field or for an orthographic camera", () => {
    expect(depthOfFieldPasses(undefined, camera(), 0, 360)).toHaveLength(1);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    expect(depthOfFieldPasses({ focus: 2, aperture: 0.5 }, ortho, 0, 360)).toHaveLength(1);
  });

  it("rejects a bad aperture or sample count", () => {
    expect(() => depthOfFieldPasses({ focus: 2, aperture: -1 }, camera(), 0, 360)).toThrow(/aperture/);
    expect(() => depthOfFieldPasses({ focus: 2, aperture: 0.1, samples: 0 }, camera(), 0, 360)).toThrow(/samples/);
  });
});

describe("pixelAverage", () => {
  it("averages frames channel by channel, rounding", () => {
    const avg = pixelAverage(4);
    avg.add([0, 100, 255, 255]);
    avg.add([3, 101, 0, 255]);
    expect(Array.from(avg.result())).toEqual([2, 101, 128, 255]);
  });
});

describe("three({ depthOfField }) in the software renderer", () => {
  afterEach(() => resetThreeSoftware());

  /** A white square at distance 3 in front of a black background, seen at 64×64. */
  const square = (focus: number) =>
    three({
      name: `dof-${focus}`,
      width: 64,
      height: 64,
      fov: 40,
      depthOfField: { focus, aperture: 0.15, samples: 12 },
      setup({ scene, camera }) {
        scene.background = new THREE.Color("#000000");
        camera.position.set(0, 0, 3);
        camera.lookAt(0, 0, 0);
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color: "#ffffff" })));
      },
    });
  /** How many pixels along the middle row are between black and white (a soft edge). */
  const soft = (focus: number) => {
    const { pixels } = renderThreeNode(square(focus), 0, 1)!;
    let n = 0;
    for (let x = 0; x < 64; x++) {
      const v = pixels![(32 * 64 + x) * 4];
      if (v > 20 && v < 235) n++;
    }
    return n;
  };

  it("keeps the subject sharp in focus and blurs it out of focus", () => {
    expect(soft(3)).toBeLessThanOrEqual(4);
    expect(soft(12)).toBeGreaterThan(6);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { three } from "../src/graph/three";
import { cameraPath } from "../src/three/camera_path";
import { createParticles } from "../src/three/particles";
import { prepareThreeNode, renderThreeNode, resetThreeSoftware } from "../src/gpu/three_soft";

function coverage(pixels: Uint8Array): number {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) n++;
  return n;
}

function brightCentroid(at: (x: number, y: number) => number, size: number) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (at(x, y) > 60) { sx += x; sy += y; n++; }
  return { x: sx / n, y: sy / n, n };
}
// The seeded field in "draws the same seeded particles" (software, WebGL) and
// draws_the_same_seeded_particles (CLI) lands here in every renderer.
function expectSameField(c: { x: number; y: number; n: number }) {
  expect(c.x).toBeCloseTo(39.2, 0);
  expect(c.y).toBeCloseTo(42.9, 0);
  expect(c.n).toBeGreaterThan(426 * 0.7);
  expect(c.n).toBeLessThan(426 * 1.3);
}

describe("software three renderer", () => {
  afterEach(() => resetThreeSoftware());

  it("skips meshes inside a hidden group", () => {
    const node = three({
      name: "hidden-group",
      width: 32,
      height: 32,
      setup({ scene }) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: "#ff0000" })));
        scene.add(g);
        return { g };
      },
      update({ g }, progress) {
        g.visible = progress < 0.5;
      },
    });
    expect(coverage(renderThreeNode(node, 0, 1)!.pixels)).toBeGreaterThan(0);
    expect(coverage(renderThreeNode(node, 0.9, 1)!.pixels)).toBe(0);
  });

  it("waits for an async setup before drawing", async () => {
    const node = three({
      name: "async-setup",
      width: 32,
      height: 32,
      async setup({ scene }) {
        await Promise.resolve();
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: "#ff0000" }));
        scene.add(mesh);
        return { mesh };
      },
      update({ mesh }) {
        mesh.rotation.y = 0.3; // gets the state, not a promise
      },
    });
    await prepareThreeNode(node);
    expect(coverage(renderThreeNode(node, 0, 1)!.pixels)).toBeGreaterThan(0);
  });

  // Same scene and path as follows_a_three_key_camera_path in apps/cli/tests/creative_nodes_test.rs.
  it("follows a 3-key camera path", () => {
    const node = three({
      name: "cubes",
      width: 64,
      height: 64,
      fov: 40,
      cameraPath: cameraPath([
        { at: 0, position: [-3, 0, 4], target: [-3, 0, 0] },
        { at: 0.5, position: [0, 0, 1], target: [0, 0, -3] },
        { at: 1, position: [3, 0, 4], target: [3, 0, 0], fov: 30 },
      ]),
      setup({ scene }) {
        for (const [x, z, color] of [[-3, 0, "#ff0000"], [0, -3, "#00ff00"], [3, 0, "#0000ff"]] as const) {
          const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color }));
          cube.position.set(x, 0, z);
          scene.add(cube);
        }
      },
    });
    for (const [time, channel] of [[0, 0], [0.5, 1], [1, 2]]) {
      const { pixels, width } = renderThreeNode(node, time, 1.2)!;
      const i = (32 * width + 32) * 4;
      const px = [pixels[i], pixels[i + 1], pixels[i + 2]];
      expect(px[channel], `t=${time}: ${px}`).toBeGreaterThan(200);
      expect(Math.max(...px.filter((_, c) => c !== channel)), `t=${time}: ${px}`).toBeLessThan(60);
    }
  });

  // Same cutaway as clips_a_cutaway_with_an_animated_plane in apps/cli/tests/creative_nodes_test.rs.
  it("cuts meshes with material.clippingPlanes animated in update", () => {
    const node = three({
      name: "cutaway",
      width: 64,
      height: 64,
      fov: 40,
      setup({ scene, camera }) {
        camera.position.set(0, 0, 5);
        const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 5); // keeps x < 5: nothing cut yet
        const cube = new THREE.Mesh(
          new THREE.BoxGeometry(2, 2, 2),
          new THREE.MeshBasicMaterial({ color: "#ff0000", clippingPlanes: [plane] }),
        );
        scene.add(cube);
        return { plane };
      },
      update({ plane }, progress) {
        plane.constant = 5 - 5 * progress; // at the end only x < 0 is left
      },
    });
    const alphaAt = (pixels: Uint8Array, width: number, x: number) => pixels[(32 * width + x) * 4 + 3];
    const start = renderThreeNode(node, 0, 1)!;
    expect(alphaAt(start.pixels, start.width, 22)).toBeGreaterThan(0);
    expect(alphaAt(start.pixels, start.width, 42)).toBeGreaterThan(0);
    const end = renderThreeNode(node, 1, 1)!;
    expect(alphaAt(end.pixels, end.width, 22)).toBeGreaterThan(0);
    expect(alphaAt(end.pixels, end.width, 42)).toBe(0);
  });

  it("keeps a fragment unless every plane cuts it when clipIntersection is set", () => {
    const make = (clipIntersection: boolean) =>
      three({
        name: `cut-${clipIntersection}`,
        width: 64,
        height: 64,
        fov: 40,
        setup({ scene, camera }) {
          camera.position.set(0, 0, 5);
          const planes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
          const material = new THREE.MeshBasicMaterial({ color: "#ff0000", clippingPlanes: planes, clipIntersection });
          scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material));
        },
      });
    // pixel (42, 42): x > 0, y < 0 → outside the first plane only
    const at = (n: ReturnType<typeof make>) => { const f = renderThreeNode(n, 0, 1)!; return f.pixels[(42 * f.width + 42) * 4 + 3]; };
    expect(at(make(false))).toBe(0);
    expect(at(make(true))).toBeGreaterThan(0);
  });

  it("draws the same seeded particles", () => {
    const node = three({
      name: "dust",
      width: 96,
      height: 96,
      fov: 40,
      setup({ scene, camera }) {
        scene.background = new THREE.Color("#000000");
        const dust = createParticles({ count: 6, seed: 11, area: [3, 2, 0.5], velocity: [0, 0, 0], spread: 0, turbulence: 0, size: 0.4, lifetime: 10, fade: 0.1, color: "#ffffff" });
        scene.add(dust.object);
        return { dust, camera };
      },
      update({ dust, camera }: any, _progress: number, time: number) {
        dust.update(time, camera);
      },
    });
    const frame = renderThreeNode(node, 2, 4)!;
    expectSameField(brightCentroid((x, y) => frame.pixels[(y * 96 + x) * 4], 96));
  });
});

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cameraPath, dolly, orbit, pushIn } from "../src/three/camera_path";
import { three } from "../src/graph/three";

const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe("cameraPath", () => {
  const keys = [
    { at: 0, position: [0, 1, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 40 },
    { at: 2, position: [6, 2, 6] as [number, number, number], target: [0, 0.5, 0] as [number, number, number], fov: 30 },
    { at: 4, position: [8, 1, -2] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 25 },
  ];

  it("passes through every key at its time", () => {
    const path = cameraPath(keys);
    for (const k of keys) {
      const pose = path.sample(k.at);
      close(pose.position, k.position);
      close(pose.target, k.target);
      expect(pose.fov).toBeCloseTo(k.fov!);
    }
  });

  it("holds the first and last key outside the path", () => {
    const path = cameraPath(keys);
    close(path.sample(-1).position, keys[0].position);
    close(path.sample(9).position, keys[2].position);
  });

  it("curves through the middle key with catmull and goes straight with linear", () => {
    const linear = cameraPath(keys, { spline: "linear", ease: "linear" });
    const curved = cameraPath(keys, { spline: "catmull", ease: "linear" });
    // halfway along the first segment: linear sits on the chord, catmull bows out from it
    close(linear.sample(1).position, [3, 1.5, 8]);
    const p = curved.sample(1).position;
    expect(Math.hypot(p[0] - 3, p[1] - 1.5, p[2] - 8)).toBeGreaterThan(0.2);
  });

  it("eases each segment (inOutCubic by default)", () => {
    const eased = cameraPath(keys, { spline: "linear" });
    // inOutCubic(0.25) = 0.0625 of the way from key 0 to key 1
    close(eased.sample(0.5).position, [0.375, 1.0625, 9.75]);
  });

  it("is deterministic and sorts keys by time", () => {
    const a = cameraPath([...keys].reverse());
    const b = cameraPath(keys);
    for (const t of [0, 0.7, 1.9, 3.3]) expect(a.sample(t)).toEqual(b.sample(t));
  });

  it("keeps fov when keys leave it out", () => {
    const path = cameraPath([{ at: 0, position: [0, 0, 5] }, { at: 1, position: [0, 0, 3] }]);
    expect(path.sample(0.5).fov).toBeUndefined();
  });

  it("rejects an empty path and an unknown spline", () => {
    expect(() => cameraPath([])).toThrow(/at least one key/);
    expect(() => cameraPath(keys, { spline: "bezier" as any })).toThrow(/Unknown spline "bezier".*catmull, linear/);
  });

  it("applies a pose to a three.js camera", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cameraPath(keys).apply(camera, 2);
    close(camera.position.toArray(), [6, 2, 6]);
    expect(camera.fov).toBeCloseTo(30);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const toTarget = new THREE.Vector3(0, 0.5, 0).sub(camera.position).normalize();
    expect(forward.dot(toTarget)).toBeCloseTo(1, 5);
  });
});

describe("presets", () => {
  it("orbit stays on its circle and turns from → to", () => {
    const path = orbit({ target: [0, 1, 0], radius: 5, height: 2, from: 0, to: Math.PI / 2, start: 1, end: 3 });
    const start = path.sample(1).position;
    const end = path.sample(3).position;
    close(start, [0, 2, 5]);
    close(end, [5, 2, 0]);
    for (const t of [1.4, 2, 2.6]) {
      const [x, y, z] = path.sample(t).position;
      expect(Math.hypot(x, z)).toBeCloseTo(5);
      expect(y).toBeCloseTo(2);
    }
    close(path.sample(2).target, [0, 1, 0]);
  });

  it("orbit can rise or sink with height: [from, to] and takes a custom ease", () => {
    const path = orbit({ target: [0, 0, 0], radius: 4, height: [3, 1], from: 0, to: 1, start: 0, end: 2, ease: (t) => t });
    expect(path.sample(0).position[1]).toBeCloseTo(3);
    expect(path.sample(1).position[1]).toBeCloseTo(2);
    expect(path.sample(2).position[1]).toBeCloseTo(1);
  });

  it("dolly moves in a straight line and keeps looking at the target", () => {
    const path = dolly({ from: [-4, 1, 6], to: [4, 1, 6], target: [0, 0, 0], start: 0, end: 2, ease: "linear" });
    close(path.sample(1).position, [0, 1, 6]);
    close(path.sample(1).target, [0, 0, 0]);
  });

  it("pushIn closes in on the target and can narrow the lens", () => {
    const path = pushIn({ from: [0, 0, 10], target: [0, 0, 0], amount: 0.4, start: 0, end: 1, fov: [40, 30] });
    close(path.sample(1).position, [0, 0, 6]);
    expect(path.sample(0).fov).toBeCloseTo(40);
    expect(path.sample(1).fov).toBeCloseTo(30);
  });
});

describe("three({ cameraPath })", () => {
  it("moves the camera before update runs, with or without setup state", async () => {
    const seen: number[][] = [];
    for (const setup of [() => {}, () => ({ mine: 1 }), async () => ({ mine: 2 })]) {
      const node = three({
        setup,
        cameraPath: dolly({ from: [-2, 0, 5], to: [2, 0, 5], target: [0, 0, 0], start: 0, end: 1, ease: "linear" }),
        update(state, _p, time) {
          seen.push([time, state.camera.position.x]);
          if (setup.length === 0 && state.mine !== undefined) expect([1, 2]).toContain(state.mine);
        },
      });
      const camera = new THREE.PerspectiveCamera();
      const state = await node.setupFn({ scene: new THREE.Scene(), camera, width: 100, height: 100 });
      node.updateFn!(state, 0.5, 0.5);
      expect(camera.position.x).toBeCloseTo(0);
    }
    expect(seen.map((s) => s[1])).toEqual([0, 0, 0].map(() => expect.closeTo(0)));
  });

  it("drives the camera even without an update function", () => {
    const node = three({ setup: () => {}, cameraPath: dolly({ from: [0, 0, 8], to: [0, 0, 4], target: [0, 0, 0], start: 0, end: 1, ease: "linear" }) });
    const camera = new THREE.PerspectiveCamera();
    const state = node.setupFn({ scene: new THREE.Scene(), camera, width: 10, height: 10 });
    node.updateFn!(state, 1, 1);
    expect(camera.position.z).toBeCloseTo(4);
  });
});

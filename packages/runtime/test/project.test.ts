import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { callout } from "../src/components/callout";
import { group, rect } from "../src/graph/kinds";
import { three } from "../src/graph/three";
import { cameraPath, orbit } from "../src/three/camera_path";

/** Where three.js itself draws `point` at `time`: the camera moved by the same path, then Vector3.project. */
function threeScreen(node: ReturnType<typeof three>, point: [number, number, number], time: number) {
  const { width, height } = node;
  const camera =
    node.cameraType === "orthographic"
      ? new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 2000)
      : new THREE.PerspectiveCamera(node.fov, width / height, 0.1, 1000);
  node.propsAt(0).cameraPath!.apply(camera, time);
  const v = new THREE.Vector3(...point).project(camera);
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
}

describe("three().project", () => {
  const path = orbit({ target: [0, 0.5, 0], radius: 6, height: 2, from: -0.6, to: 1.4, start: 0, end: 3, fov: [45, 32] });

  it("lands where three.js draws the point, all along an orbit", () => {
    const node = three({ width: 640, height: 360, fov: 45, cameraPath: path, setup() {} });
    for (const point of [[0, 0.5, 0], [1, 1.2, -0.5], [-0.8, 0, 0.9]] as [number, number, number][]) {
      for (const t of [0, 0.4, 1.5, 2.2, 3]) {
        const got = node.project(point, t);
        const want = threeScreen(node, point, t);
        expect(got.x).toBeCloseTo(want.x, 4);
        expect(got.y).toBeCloseTo(want.y, 4);
        expect(got.visible).toBe(true);
      }
    }
  });

  it("works for orthographic cameras and points that move over time", () => {
    const node = three({ width: 400, height: 400, camera: "orthographic", cameraPath: cameraPath([{ at: 0, position: [0, 0, 500], target: [0, 0, 0] }]), setup() {} });
    const moving = (t: number): [number, number, number] => [50 * t, -20, 0];
    const p = node.project(moving, 2);
    expect(p.x).toBeCloseTo(300, 6);
    expect(p.y).toBeCloseTo(220, 6);
    expect(p.visible).toBe(true);
    const want = threeScreen(node, moving(2), 2);
    expect(node.project(moving, 2).x).toBeCloseTo(want.x, 4);
  });

  it("returns frame coordinates of the three node's parent, after its position and anchor", () => {
    const node = three({ x: 1000, y: 500, width: 640, height: 360, anchorX: 0.5, anchorY: 0.5, fov: 45, cameraPath: path, setup() {} });
    const inside = threeScreen(node, [0, 0.5, 0], 1);
    const got = node.project([0, 0.5, 0], 1);
    expect(got.x).toBeCloseTo(1000 - 320 + inside.x, 4);
    expect(got.y).toBeCloseTo(500 - 180 + inside.y, 4);
  });

  it("marks points behind the camera or outside the frame as not visible", () => {
    const node = three({ width: 100, height: 100, fov: 40, cameraPath: cameraPath([{ at: 0, position: [0, 0, 5], target: [0, 0, 0] }]), setup() {} });
    expect(node.project([0, 0, 10], 0).visible).toBe(false);
    expect(node.project([50, 0, 0], 0).visible).toBe(false);
    expect(node.project([0, 0, 0], 0)).toMatchObject({ x: 50, y: 50, visible: true });
  });

  it("asks for a cameraPath when the camera is only known inside setup", () => {
    const node = three({ setup() {} });
    expect(() => node.project([0, 0, 0], 0)).toThrow(/cameraPath/);
  });
});

describe("Node.drive", () => {
  it("sets props from a function of scene time, over keyframes", () => {
    const r = rect({ width: 10, height: 10 });
    r.to({ x: 100 }, { at: 0, duration: 1 });
    r.drive((t) => ({ y: t * 10 }));
    expect(r.propsAt(0.5).y).toBe(5);
    expect(r.propsAt(1).x).toBe(100);
    r.drive((t) => ({ x: -t }));
    expect(r.propsAt(1).x).toBe(-1); // a later driver wins over keyframes
  });
});

describe("callout", () => {
  it("keeps its anchor on the projected point while the camera orbits", () => {
    const root = group({ width: 1280, height: 720 });
    const stage = root.add(three({ name: "stage", width: 1280, height: 720, fov: 45, cameraPath: orbit({ target: [0, 0, 0], radius: 5, height: 1, from: 0, to: 1.2, start: 0, end: 2 }), setup() {} }));
    const c = callout(stage, { target: [0.6, 0.4, 0], label: "Metal grill", at: 0.2 });
    expect(c.parent).toBe(root);
    for (const t of [0, 0.7, 1.3, 2]) {
      const p = stage.project([0.6, 0.4, 0], t);
      const props = c.propsAt(t);
      expect(props.x).toBeCloseTo(p.x, 6);
      expect(props.y).toBeCloseTo(p.y, 6);
    }
    expect(c.children.map((n) => n.name)).toEqual(["dot", "leader", "label"]);
  });

  it("hides while the point is behind the camera", () => {
    const root = group({ width: 200, height: 200 });
    const stage = root.add(three({ width: 200, height: 200, cameraPath: cameraPath([{ at: 0, position: [0, 0, 5], target: [0, 0, 0] }, { at: 1, position: [0, 0, -5], target: [0, 0, -10] }], { spline: "linear" }), setup() {} }));
    const c = callout(stage, { target: [0, 0, 0], label: "Core" });
    expect(c.propsAt(0).opacity).toBe(1);
    expect(c.propsAt(1).opacity).toBe(0);
  });

  it("needs a three node that is already on the stage", () => {
    const stage = three({ cameraPath: cameraPath([{ at: 0, position: [0, 0, 5] }]), setup() {} });
    expect(() => callout(stage, { target: [0, 0, 0], label: "x" })).toThrow(/add the three\(\) node/);
  });
});

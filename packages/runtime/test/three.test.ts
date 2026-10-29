import { describe, expect, it } from "vitest";
import { three, ThreeNode } from "../src/graph/three";

describe("ThreeNode", () => {
  it("creates a ThreeNode with default dimensions and camera settings", () => {
    const node = three({
      name: "cube",
      width: 400,
      height: 300,
      setup: () => {},
    });

    expect(node).toBeInstanceOf(ThreeNode);
    expect(node.name).toBe("cube");
    const p = node.propsAt(0);
    expect(p.width).toBe(400);
    expect(p.height).toBe(300);
    expect(p.camera).toBe("perspective");
    expect(p.fov).toBe(50);
  });

  it("supports keyframed properties via node.to()", () => {
    const node = three({
      width: 500,
      height: 500,
      setup: () => {},
    });
    node.to({ opacity: 0 }, { at: 1, duration: 1 });
    expect(node.propsAt(0).opacity).toBe(1);
    expect(node.propsAt(2).opacity).toBe(0);
    expect(node.spans()).toEqual([{ start: 1, end: 2 }]);
  });
});

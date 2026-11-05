import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { three } from "../src/graph/three";
import { renderThreeNode, resetThreeSoftware } from "../src/gpu/three_soft";

function coverage(pixels: Uint8Array): number {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) n++;
  return n;
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
});

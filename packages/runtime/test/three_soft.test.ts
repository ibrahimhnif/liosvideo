import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { three } from "../src/graph/three";
import { cameraPath } from "../src/three/camera_path";
import { prepareThreeNode, renderThreeNode, resetThreeSoftware } from "../src/gpu/three_soft";

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
});

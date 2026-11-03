import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ThreeNode } from "../../src/graph/three";
import { ThreeRunner } from "../../src/gpu/three_runner";
import { renderThreeNode, resetThreeSoftware } from "../../src/gpu/three_soft";

let runner: ThreeRunner | undefined;
afterEach(() => runner?.dispose());

describe("three runner", () => {
  it("renders a mesh with the real three.js WebGL renderer", async () => {
    runner = new ThreeRunner();
    const node = new ThreeNode({
      width: 64,
      height: 64,
      setup({ scene, camera }) {
        camera.position.z = 4;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 1.5, 1.5),
          new THREE.MeshBasicMaterial({ color: 0xff0000 }),
        );
        scene.add(mesh);
        return { mesh };
      },
      update({ mesh }: { mesh: THREE.Mesh }, _progress, time) {
        mesh.rotation.y = time;
      },
    });

    const bitmap = await runner.renderBitmap(node, 0, 1);
    expect(bitmap).not.toBeNull();

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap!, 0, 0);
    const pixel = context.getImageData(32, 32, 1, 1).data;
    expect(pixel[0]).toBeGreaterThan(200);
    expect(pixel[1]).toBeLessThan(20);
    expect(pixel[3]).toBeGreaterThan(200);
  });
});

describe("three software fallback", () => {
  it("rasterises a lit cube without WebGL", () => {
    resetThreeSoftware();
    const node = new ThreeNode({
      width: 64,
      height: 64,
      setup({ scene, camera }) {
        camera.position.z = 4;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 1.5, 1.5),
          new THREE.MeshStandardMaterial({ color: 0x3366ff, roughness: 0.4 }),
        );
        scene.add(mesh);
        const light = new THREE.DirectionalLight(0xffffff, 2.5);
        light.position.set(2, 3, 5);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        return { mesh };
      },
      update({ mesh }: { mesh: THREE.Mesh }, _progress, time) {
        mesh.rotation.y = time;
      },
    });

    const frame = renderThreeNode(node, 0, 1);
    expect(frame).not.toBeNull();
    const index = (32 * 64 + 32) * 4;
    expect(frame!.pixels[index + 2]).toBeGreaterThan(20);
    expect(frame!.pixels[index + 3]).toBe(255);
    resetThreeSoftware();
  });
});

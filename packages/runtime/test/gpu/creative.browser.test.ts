import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ThreeNode } from "../../src/graph/three";
import { ThreeRunner } from "../../src/gpu/three_runner";
import { renderThreeNode, resetThreeSoftware } from "../../src/gpu/three_soft";
import { cameraPath } from "../../src/three/camera_path";

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

async function pixelAt(node: ThreeNode, time: number, duration: number, x: number, y: number) {
  const bitmap = await runner!.renderBitmap(node, time, duration);
  expect(bitmap).not.toBeNull();
  const canvas = document.createElement("canvas");
  canvas.width = bitmap!.width;
  canvas.height = bitmap!.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap!, 0, 0);
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

// The scenes below match the CLI tests in apps/cli/tests/creative_nodes_test.rs and the
// software-renderer tests in test/three_soft.test.ts, so all three renderers take the same shot.
describe("three in the desktop preview (WebGL)", () => {
  it("follows a 3-key camera path", async () => {
    runner = new ThreeRunner();
    const node = new ThreeNode({
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
      const px = await pixelAt(node, time, 1.2, 32, 32);
      expect(px[channel], `t=${time}: ${px}`).toBeGreaterThan(200);
      expect(Math.max(...px.slice(0, 3).filter((_, c) => c !== channel)), `t=${time}: ${px}`).toBeLessThan(60);
    }
  });

  it("cuts a cutaway with an animated clipping plane", async () => {
    runner = new ThreeRunner();
    const node = new ThreeNode({
      name: "cutaway",
      width: 64,
      height: 64,
      fov: 40,
      setup({ scene, camera }) {
        camera.position.set(0, 0, 5);
        const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 5);
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: "#ff0000", clippingPlanes: [plane] })));
        return { plane };
      },
      update({ plane }: { plane: THREE.Plane }, progress) {
        plane.constant = 5 - 5 * progress;
      },
    });
    expect((await pixelAt(node, 0, 1, 42, 32))[0]).toBeGreaterThan(200);
    expect((await pixelAt(node, 0.99, 1, 22, 32))[0]).toBeGreaterThan(200);
    expect((await pixelAt(node, 0.99, 1, 42, 32))[3]).toBe(0);
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

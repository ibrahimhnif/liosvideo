import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { three } from "../src/graph/three";
import { ThreeRunner } from "../src/gpu/three_runner";

describe("ThreeRunner", () => {
  it("initializes scene and invokes update at timestamp t", () => {
    let rotation = 0;
    const node = three({
      width: 200,
      height: 200,
      setup({ scene }) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        scene.add(mesh);
        return { mesh };
      },
      update({ mesh }, progress, t) {
        mesh.rotation.y = t * 2;
        rotation = mesh.rotation.y;
      },
    });

    const runner = new ThreeRunner();
    runner.step(node, 1.5, 3.0);
    expect(rotation).toBe(3.0);
    runner.dispose();
  });

  it("handles perspective and orthographic cameras", () => {
    const pNode = three({
      camera: "perspective",
      fov: 60,
      setup({ camera }) {
        expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
        expect((camera as THREE.PerspectiveCamera).fov).toBe(60);
      },
    });

    const oNode = three({
      camera: "orthographic",
      setup({ camera }) {
        expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
      },
    });

    const runner = new ThreeRunner();
    runner.step(pNode, 0, 1);
    runner.step(oNode, 0, 1);
    runner.dispose();
  });
});

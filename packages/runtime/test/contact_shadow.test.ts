import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { contactShadow, registerThreeLoaders } from "../src/three/assets";
import { createContactShadow } from "../src/three/contact_shadow";
import { createThreeLoaders } from "../src/three/loaders";
import { three } from "../src/graph/three";
import { renderThreeNode, resetThreeSoftware } from "../src/gpu/three_soft";

/** A 1×1×1 box whose bottom is `lift` above y = 0, centred at (x, z). */
function box(lift = 0, x = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.position.set(x, 0.5 + lift, z);
  const group = new THREE.Group();
  group.add(mesh);
  group.updateMatrixWorld(true);
  return group;
}

/** The shadow's opacity at the grid point nearest to world (x, z). */
function alphaAt(shadow: ReturnType<typeof createContactShadow>, x: number, z: number) {
  const mesh = shadow.mesh;
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute("position");
  const col = mesh.geometry.getAttribute("color");
  const v = new THREE.Vector3();
  let best = Infinity;
  let alpha = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < best) {
      best = d;
      alpha = col.getW(i);
    }
  }
  return alpha;
}

describe("createContactShadow", () => {
  it("is darkest under the object and fades out around it", () => {
    const shadow = createContactShadow(box(), { opacity: 0.7, blur: 0.1 });
    const under = alphaAt(shadow, 0, 0);
    expect(under).toBeGreaterThan(0.6);
    expect(under).toBeLessThanOrEqual(0.7 + 1e-6);
    expect(alphaAt(shadow, 0.5, 0)).toBeLessThan(under);
    expect(alphaAt(shadow, 0.5, 0)).toBeGreaterThan(0.1); // soft edge
    expect(alphaAt(shadow, 1.0, 1.0)).toBeLessThan(0.01);
  });

  it("lies on the floor under the object, with a margin for the blur, colour from options", () => {
    const shadow = createContactShadow(box(0, 2, -1), { blur: 0.1, color: "#102030" });
    const bounds = new THREE.Box3().setFromObject(shadow.mesh);
    expect(bounds.min.y).toBeCloseTo(bounds.max.y, 6);
    expect(bounds.min.y).toBeGreaterThan(0);
    expect(bounds.min.y).toBeLessThan(0.01);
    expect(bounds.min.x).toBeLessThan(1.5 - 0.2);
    expect(bounds.max.x).toBeGreaterThan(2.5 + 0.2);
    expect(bounds.min.z).toBeLessThan(-1.5 - 0.2);
    const material = shadow.mesh.material as THREE.MeshBasicMaterial;
    expect(material).toMatchObject({ transparent: true, depthWrite: false, vertexColors: true });
    expect(material.color.getHexString()).toBe(new THREE.Color("#102030").getHexString());
  });

  it("gets fainter as the object lifts off the floor", () => {
    const touching = alphaAt(createContactShadow(box(0), { y: 0, falloff: 1 }), 0, 0);
    const lifted = alphaAt(createContactShadow(box(0.5), { y: 0, falloff: 1 }), 0, 0);
    const gone = alphaAt(createContactShadow(box(1.5), { y: 0, falloff: 1 }), 0, 0);
    expect(lifted).toBeLessThan(touching * 0.7);
    expect(lifted).toBeGreaterThan(0.05);
    expect(gone).toBeLessThan(0.01);
  });

  it("follows the object when update() is called", () => {
    const object = box();
    const shadow = createContactShadow(object, { blur: 0.05 });
    object.position.x = 3;
    object.updateMatrixWorld(true);
    expect(alphaAt(shadow, 3, 0)).toBeLessThan(0.01);
    shadow.update();
    expect(alphaAt(shadow, 3, 0)).toBeGreaterThan(0.4);
    expect(alphaAt(shadow, 0, 0)).toBeLessThan(0.01);
  });

  it("is the same every time", () => {
    const a = createContactShadow(box(), {});
    const b = createContactShadow(box(), {});
    expect(Array.from(a.mesh.geometry.getAttribute("color").array)).toEqual(Array.from(b.mesh.geometry.getAttribute("color").array));
  });
});

describe("contactShadow() in a scene", () => {
  afterEach(() => {
    registerThreeLoaders(undefined);
    resetThreeSoftware();
  });

  it("asks to be called inside three({ setup })", () => {
    expect(() => contactShadow(new THREE.Group())).toThrow(/inside three\(\{ setup \}\)/);
  });

  it("darkens the floor under the object in the software renderer", () => {
    registerThreeLoaders(createThreeLoaders({ read: async () => new Uint8Array(), decodeImage: async () => ({ width: 1, height: 1, data: new Uint8Array(4) }) }));
    const node = three({
      name: "floor",
      width: 64,
      height: 64,
      fov: 40,
      setup({ scene, camera }) {
        scene.background = new THREE.Color("#ffffff");
        camera.position.set(0, 6, 0.001);
        camera.lookAt(0, 0, 0);
        // a thin slab hovering just above the floor: it hides little, its shadow shows around it
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
        slab.position.y = 0.05;
        scene.add(slab);
        scene.updateMatrixWorld(true);
        scene.add(contactShadow(slab, { y: 0, opacity: 0.8, blur: 0.3, falloff: 0.5 }).mesh);
      },
    });
    const { pixels } = renderThreeNode(node, 0, 1)!;
    const lum = (x: number, y: number) => pixels[(y * 64 + x) * 4];
    // just outside the slab's edge (it spans about ±5 px from the centre at this distance)
    expect(lum(2, 2)).toBeGreaterThan(250);
    expect(lum(32 + 6, 32)).toBeLessThan(lum(2, 2) - 15);
    // still on the shadow's grid, but well past the blur: the floor shows through untouched
    expect(lum(32 + 12, 32)).toBeGreaterThan(245);
  });
});

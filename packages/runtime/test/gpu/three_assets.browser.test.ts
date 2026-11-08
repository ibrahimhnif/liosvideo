// The desktop preview path for gltf() / hdr(): the shared loader, the browser image decoder and
// ThreeRunner (WebGL). The scenes and pixel checks match the CLI tests in apps/cli/src/runtime/mod.rs,
// so both renderers are held to the same picture.
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { ThreeNode } from "../../src/graph/three";
import { ThreeRunner } from "../../src/gpu/three_runner";
import { contactShadow, gltf, hdr, registerThreeLoaders } from "../../src/three/assets";
import { createThreeLoaders, decodeImageInBrowser } from "../../src/three/loaders";

async function png(width: number, height: number, rgba: number[]): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** Same GLB as the CLI test: a 2x2 unlit quad "panel" textured red | green, and a blue "lid" quad. */
async function testGlb(): Promise<Uint8Array> {
  const image = await png(2, 1, [255, 0, 0, 255, 0, 255, 0, 255]);
  const chunks: Uint8Array[] = [];
  const views: object[] = [];
  let length = 0;
  const push = (bytes: Uint8Array) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) chunks.push(new Uint8Array(pad));
    length += pad;
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes);
    length += bytes.length;
  };
  const f32 = (v: number[]) => new Uint8Array(new Float32Array(v).buffer);
  push(f32([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]));
  push(f32([0, 1, 1, 1, 1, 0, 0, 0]));
  push(new Uint8Array(new Uint16Array([0, 1, 2, 0, 2, 3]).buffer));
  push(f32([-0.2, -0.2, 0, 0.2, -0.2, 0, 0.2, 0.2, 0, -0.2, 0.2, 0]));
  push(image);
  const pad = (4 - (length % 4)) % 4;
  if (pad) chunks.push(new Uint8Array(pad));
  length += pad;
  const bin = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.length;
  }
  const json = {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "panel", mesh: 0 }, { name: "lid", mesh: 1, translation: [0.5, 0.5, 0.1] }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 3 }, indices: 2, material: 1 }] },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, extensions: { KHR_materials_unlit: {} } },
      { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] }, extensions: { KHR_materials_unlit: {} } },
    ],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: 4, mimeType: "image/png" }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
      { bufferView: 3, componentType: 5126, count: 4, type: "VEC3", min: [-0.2, -0.2, 0], max: [0.2, 0.2, 0] },
    ],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  dv.setUint32(20 + jsonBytes.length, bin.length, true);
  dv.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(bin, 28 + jsonBytes.length);
  return out;
}

/** 256x128 equirect sky: top half red, bottom half blue. */
function skyHdr(): Uint8Array {
  const head = new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 128 +X 256\n");
  const out = new Uint8Array(head.length + 256 * 128 * 4);
  out.set(head);
  for (let i = 0; i < 256 * 128; i++) out.set(i < 256 * 64 ? [128, 0, 0, 129] : [0, 0, 128, 129], head.length + i * 4);
  return out;
}

async function pixels(bitmap: ImageBitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return (x: number, y: number) => {
    const i = (y * bitmap.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
}

let runner: ThreeRunner | undefined;
afterEach(() => {
  runner?.dispose();
  registerThreeLoaders(undefined);
});

describe("three assets in the desktop preview", () => {
  it("renders a glTF with its texture and animates a named part", async () => {
    const files: Record<string, Uint8Array> = { "assets/models/box.glb": await testGlb() };
    registerThreeLoaders(createThreeLoaders({ read: async (src) => files[src], decodeImage: decodeImageInBrowser }));
    runner = new ThreeRunner();
    const node = new ThreeNode({
      width: 160,
      height: 160,
      async setup({ scene, camera }) {
        scene.background = new THREE.Color("#000000");
        camera.position.z = 2.2;
        const model = await gltf("assets/models/box.glb");
        scene.add(model.scene);
        return { lid: model.part("lid") };
      },
      update({ lid }: { lid: THREE.Object3D }, progress) {
        lid.position.x = 0.5 - progress;
      },
    });
    const px = await pixels((await runner.renderBitmap(node, 0, 1))!);
    const [left, right, lid] = [px(40, 120), px(120, 120), px(122, 38)];
    expect(left[0], `left ${left}`).toBeGreaterThan(200);
    expect(left[1]).toBeLessThan(40);
    expect(right[1], `right ${right}`).toBeGreaterThan(200);
    expect(right[0]).toBeLessThan(40);
    expect(lid[2], `lid ${lid}`).toBeGreaterThan(200);
    expect(lid[0]).toBeLessThan(40);
  });

  it("reflects an HDR environment the same way up as the CLI", async () => {
    registerThreeLoaders(createThreeLoaders({ read: async () => skyHdr(), decodeImage: decodeImageInBrowser }));
    runner = new ThreeRunner();
    const node = new ThreeNode({
      width: 200,
      height: 200,
      fov: 90,
      async setup({ scene, camera }) {
        scene.environment = await hdr("assets/hdri/sky.hdr");
        camera.position.set(0, 0, 3);
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24), new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0 })));
        return {};
      },
    });
    const px = await pixels((await runner.renderBitmap(node, 0, 1))!);
    const [top, bottom] = [px(100, 82), px(100, 118)];
    expect(top[0], `top ${top}`).toBeGreaterThan(150);
    expect(top[2]).toBeLessThan(60);
    expect(bottom[2], `bottom ${bottom}`).toBeGreaterThan(150);
    expect(bottom[0]).toBeLessThan(60);
  });
});

describe("depth of field in the desktop preview", () => {
  /** A white square at distance 3, raised into the top half, seen at 64×64 (as in test/dof.test.ts). */
  const square = (focus: number) =>
    new ThreeNode({
      name: `dof-${focus}`,
      width: 64,
      height: 64,
      fov: 40,
      depthOfField: { focus, aperture: 0.15, samples: 12 },
      setup({ scene, camera }) {
        scene.background = new THREE.Color("#000000");
        camera.position.set(0, 0, 3);
        camera.lookAt(0, 0, 0);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
        plane.position.y = 0.3;
        scene.add(plane);
      },
    });
  const soft = async (focus: number) => {
    runner?.dispose();
    runner = new ThreeRunner();
    const px = await pixels((await runner.renderBitmap(square(focus), 0, 1))!);
    let n = 0;
    for (let x = 0; x < 64; x++) {
      const v = px(x, 20)[0];
      if (v > 20 && v < 235) n++;
    }
    return { n, top: px(32, 20)[0], bottom: px(32, 52)[0] };
  };

  it("keeps the subject sharp in focus, blurs it out of focus, the right way up", async () => {
    const sharp = await soft(3);
    expect(sharp.n, "soft pixels in focus").toBeLessThanOrEqual(4);
    expect(sharp.top).toBeGreaterThan(200);
    expect(sharp.bottom).toBeLessThan(20);
    const blurred = await soft(12);
    expect(blurred.n, "soft pixels out of focus").toBeGreaterThan(6);
    expect(blurred.top).toBeGreaterThan(150);
    expect(blurred.bottom).toBeLessThan(20);
  });
});

describe("contact shadows in the desktop preview", () => {
  it("darkens the floor around the object and fades out (as in test/contact_shadow.test.ts)", async () => {
    registerThreeLoaders(createThreeLoaders({ read: async () => new Uint8Array(), decodeImage: decodeImageInBrowser }));
    runner = new ThreeRunner();
    const node = new ThreeNode({
      name: "floor",
      width: 64,
      height: 64,
      fov: 40,
      setup({ scene, camera }) {
        scene.background = new THREE.Color("#ffffff");
        camera.position.set(0, 6, 0.001);
        camera.lookAt(0, 0, 0);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
        slab.position.y = 0.05;
        scene.add(slab);
        scene.updateMatrixWorld(true);
        scene.add(contactShadow(slab, { y: 0, opacity: 0.8, blur: 0.3, falloff: 0.5 }).mesh);
      },
    });
    const px = await pixels((await runner.renderBitmap(node, 0, 1))!);
    const corner = px(2, 2)[0];
    expect(corner).toBeGreaterThan(250);
    expect(px(38, 32)[0]).toBeLessThan(corner - 15);
    expect(px(44, 32)[0]).toBeGreaterThan(245);
  });
});

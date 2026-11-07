import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { gltf, hdr, registerThreeLoaders, texture } from "../src/three/assets";
import { createThreeLoaders, type AssetHost } from "../src/three/loaders";

/** A GLB with two named meshes ("body" under "mic", "grill") and one embedded 2x1 image used as baseColorTexture. */
function makeGlb(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const image = new Uint8Array([1, 2, 3, 4]); // opaque bytes; the fake decoder below turns them into pixels
  const bin = new Uint8Array(36 + 24 + 4);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(uvs.buffer), 36);
  bin.set(image, 60);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "mic", children: [1, 2] }, { name: "body", mesh: 0 }, { name: "grill", mesh: 1, translation: [0, 2, 0] }],
    meshes: [
      { name: "body", primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] },
      { name: "grill", primitives: [{ attributes: { POSITION: 0 }, material: 1 }] },
    ],
    materials: [
      { name: "paint", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.2, roughnessFactor: 0.6 } },
      { name: "mesh", pbrMetallicRoughness: { baseColorFactor: [0.1, 0.1, 0.1, 1], metallicFactor: 1, roughnessFactor: 0.3 } },
    ],
    textures: [{ source: 0 }],
    images: [{ bufferView: 2, mimeType: "image/png" }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 4 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
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
  const o = 20 + jsonBytes.length;
  dv.setUint32(o, bin.length, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(bin, o + 8);
  return out;
}

/** A 2x2 Radiance .hdr (RGBE, flat): top row bright, bottom row dark. */
function makeHdr(): Uint8Array {
  const header = "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n";
  const head = new TextEncoder().encode(header);
  const px = new Uint8Array([128, 128, 128, 129, 128, 128, 128, 129, 128, 128, 128, 120, 128, 128, 128, 120]);
  const out = new Uint8Array(head.length + px.length);
  out.set(head);
  out.set(px, head.length);
  return out;
}

function fakeHost(files: Record<string, Uint8Array>): AssetHost & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async read(src) {
      reads.push(src);
      const f = files[src];
      if (!f) throw new Error(`missing ${src}`);
      return f;
    },
    async decodeImage() {
      // 2x2 image, rows top-first: a red row, then a green row
      return { width: 2, height: 2, data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]) };
    },
  };
}

afterEach(() => registerThreeLoaders(undefined));

describe("three asset helpers", () => {
  it("explain where they work before a host registers loaders", async () => {
    await expect(gltf("assets/models/mic.glb")).rejects.toThrow(/gltf\(\) works inside three\(\{ setup \}\)/);
  });

  it("load a GLB with its materials and embedded texture, and find parts by name", async () => {
    registerThreeLoaders(createThreeLoaders(fakeHost({ "assets/models/mic.glb": makeGlb() })));
    const model = await gltf("assets/models/mic.glb");
    expect(model.scene).toBeInstanceOf(THREE.Object3D);
    const grill = model.part("grill");
    expect(grill.position.y).toBe(2);
    expect(model.part("GRILL")).toBe(grill);
    const body = model.part("body") as THREE.Mesh;
    const paint = body.material as THREE.MeshStandardMaterial;
    expect(paint.roughness).toBeCloseTo(0.6);
    expect(paint.map).toBeInstanceOf(THREE.Texture);
    expect((paint.map!.image as { width: number }).width).toBe(2);
    expect(paint.map!.flipY).toBe(false);
    expect(paint.map!.generateMipmaps).toBe(true);
    expect(() => model.part("knob")).toThrow(/no part "knob" in assets\/models\/mic\.glb.*mic, body, grill/);
  });

  it("load an image texture right side up, in sRGB", async () => {
    registerThreeLoaders(createThreeLoaders(fakeHost({ "assets/images/wood.jpg": new Uint8Array([9]) })));
    const tex = await texture("assets/images/wood.jpg");
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    // rows go bottom-first into the texture so v = 1 is the top of the image: first row now green
    expect([...((tex.image as { data: Uint8Array }).data).slice(0, 4)]).toEqual([0, 255, 0, 255]);
    expect(tex.generateMipmaps).toBe(true);
  });

  it("load an HDR as an equirectangular environment", async () => {
    registerThreeLoaders(createThreeLoaders(fakeHost({ "assets/hdri/studio.hdr": makeHdr() })));
    const env = await hdr("assets/hdri/studio.hdr");
    expect(env.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(env.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(env.image.width).toBe(2);
    expect(env.image.height).toBe(2);
  });

  it("reads each file once per path", async () => {
    const host = fakeHost({ "assets/models/mic.glb": makeGlb() });
    registerThreeLoaders(createThreeLoaders(host));
    const a = await gltf("assets/models/mic.glb");
    const b = await gltf("./assets/models/mic.glb");
    expect(host.reads).toEqual(["assets/models/mic.glb"]);
    expect(b.scene).not.toBe(a.scene); // each call gets its own copy to animate
  });
});

// The loaders behind gltf() / hdr() / texture(), shared by the desktop worker and the CLI (bundled
// into apps/cli/src/runtime/three_loaders.js). They only need two things from the host: read a
// project file, and decode an image to RGBA. Images become DataTextures in both renderers, so the
// desktop (WebGL) and the CLI (WebGPU) upload the same pixels.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import type { Model, TextureOptions, ThreeLoaders } from "./assets";

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA8, rows top-first, straight alpha. */
  data: Uint8Array;
}

export interface AssetHost {
  /** Bytes of a project-relative file. */
  read(src: string): Promise<ArrayBuffer | Uint8Array>;
  /** PNG / JPEG / WebP bytes to pixels. */
  decodeImage(bytes: Uint8Array, mimeType?: string): Promise<DecodedImage>;
}

/** decodeImage for browsers and workers (the desktop preview): createImageBitmap, then read the pixels back. */
export async function decodeImageInBrowser(bytes: Uint8Array, mimeType?: string): Promise<DecodedImage> {
  const blob = new Blob([bytes as BlobPart], mimeType ? { type: mimeType } : undefined);
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(data.buffer) };
}

const clean = (src: string) => src.replace(/^\.\//, "");
const bytesOf = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));

function flipRows(img: DecodedImage): Uint8Array {
  const row = img.width * 4;
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) out.set(img.data.subarray(y * row, (y + 1) * row), (img.height - 1 - y) * row);
  return out;
}

function dataTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function modelOf(src: string, gltf: GLTF): Model {
  const scene = gltf.scene;
  const parts: Record<string, THREE.Object3D> = {};
  const names: string[] = [];
  scene.traverse((o) => {
    if (o !== scene && o.name && !(o.name in parts)) {
      parts[o.name] = o;
      names.push(o.name);
    }
  });
  return {
    scene,
    parts,
    animations: gltf.animations,
    part(name: string) {
      const found = parts[name] ?? Object.values(parts).find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (!found) {
        const list = names.slice(0, 40).join(", ") + (names.length > 40 ? ", …" : "");
        throw new Error(`gltf(): no part "${name}" in ${src} (parts: ${list || "none have names"})`);
      }
      return found;
    },
  };
}

export function createThreeLoaders(host: AssetHost): ThreeLoaders {
  const files = new Map<string, Promise<Uint8Array>>();
  const read = (src: string) => {
    const key = clean(src);
    let p = files.get(key);
    if (!p) {
      p = host.read(key).then(bytesOf);
      files.set(key, p);
    }
    return p;
  };
  const parsed = new Map<string, Promise<GLTF>>();

  /** glTF images, decoded by the host instead of <img> / ImageBitmap (absent in the CLI). */
  const imagePlugin = (base: string) => (parser: any) => {
    parser.loadImageSource = function (sourceIndex: number) {
      if (this.sourceCache[sourceIndex] !== undefined) return this.sourceCache[sourceIndex].then((t: THREE.Texture) => t.clone());
      const def = this.json.images[sourceIndex];
      const bytes: Promise<Uint8Array> =
        def.bufferView !== undefined
          ? this.getDependency("bufferView", def.bufferView).then((b: ArrayBuffer) => new Uint8Array(b))
          : def.uri?.startsWith("data:")
            ? Promise.resolve(Uint8Array.from(atob(def.uri.split(",")[1] ?? ""), (c) => c.charCodeAt(0)))
            : read(base + decodeURIComponent(def.uri ?? ""));
      const promise = bytes
        .then((b) => host.decodeImage(b, def.mimeType))
        .then((img) => {
          // glTF UVs start at the top-left, so the rows stay top-first (the loader sets flipY = false)
          const tex = dataTexture(img.data, img.width, img.height);
          tex.userData.mimeType = def.mimeType;
          return tex;
        });
      this.sourceCache[sourceIndex] = promise;
      return promise;
    };
    return { name: "liosvideo_images" };
  };

  return {
    async gltf(src) {
      const key = clean(src);
      let p = parsed.get(key);
      if (!p) {
        const base = key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : "";
        p = read(key).then(
          (bytes) =>
            new Promise<GLTF>((resolve, reject) => {
              const loader = new GLTFLoader();
              loader.register(imagePlugin(base));
              const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
              const isGlb = bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
              loader.parse(isGlb ? buffer : new TextDecoder().decode(bytes), base, resolve, (e) =>
                reject(new Error(`gltf(): ${key}: ${(e as unknown as Error)?.message ?? e}`)),
              );
            }),
        );
        parsed.set(key, p);
      }
      const gltf = await p;
      // every call gets its own copy (materials and geometry stay shared) so parts animate per use
      return modelOf(key, { ...gltf, scene: gltf.scene.clone(true) as THREE.Group });
    },

    async hdr(src) {
      const key = clean(src);
      const bytes = await read(key);
      const data = new HDRLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      if (!data) throw new Error(`hdr(): ${key} is not a Radiance .hdr file`);
      const tex = new THREE.DataTexture(data.data as any, data.width, data.height, THREE.RGBAFormat, data.type as THREE.TextureDataType);
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.flipY = true;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;
      return tex;
    },

    async texture(src, opts?: TextureOptions) {
      const key = clean(src);
      const img = await host.decodeImage(await read(key));
      const tex = dataTexture(flipRows(img), img.width, img.height);
      tex.colorSpace = opts?.colorSpace === "linear" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (opts?.repeat) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(opts.repeat[0], opts.repeat[1]);
      }
      return tex;
    },
  };
}

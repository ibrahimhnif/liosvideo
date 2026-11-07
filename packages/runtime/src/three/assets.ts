// Project assets for three() scenes: `await gltf(...)`, `await hdr(...)`, `await texture(...)` inside
// `three({ async setup() { ... } })`. The host (desktop worker or CLI) registers the loaders,
// which read files from the project and decode them the same way in both.
import type * as THREE from "three";
import type { ParticleOptions, Particles } from "./particles";

export type { ParticleOptions, Particles } from "./particles";

/** A loaded glTF / GLB model. */
export interface Model {
  /** Root of the model; add it to the scene. Each `gltf()` call returns its own copy. */
  scene: THREE.Group;
  /** Every named object of the model, by name. */
  parts: Record<string, THREE.Object3D>;
  /** A named part (node or mesh), exact name first, then ignoring case; throws with the names it has. */
  part(name: string): THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export interface TextureOptions {
  /** "srgb" for colour maps (default), "linear" for normal / roughness / metalness data. */
  colorSpace?: "srgb" | "linear";
  /** Tile the texture (sets RepeatWrapping). */
  repeat?: [number, number];
}

export interface ThreeLoaders {
  gltf(src: string): Promise<Model>;
  hdr(src: string): Promise<THREE.DataTexture>;
  texture(src: string, opts?: TextureOptions): Promise<THREE.Texture>;
  particles(opts?: ParticleOptions): Particles;
}

let loaders: ThreeLoaders | undefined;

/** Called by the host that renders three() nodes. */
export function registerThreeLoaders(impl: ThreeLoaders | undefined): void {
  loaders = impl;
}

function need(name: string, awaited = true): ThreeLoaders {
  if (!loaders) {
    throw new Error(`${name}() works inside three({ setup })${awaited ? ": make setup async and await it there" : ""}`);
  }
  return loaders;
}

/** Loads a .glb / .gltf from the project (meshes, PBR materials, textures); parts by name via `model.part()`. */
export async function gltf(src: string): Promise<Model> {
  return need("gltf").gltf(src);
}

/** Loads a Radiance .hdr as an equirectangular environment: `scene.environment = await hdr(...)`. */
export async function hdr(src: string): Promise<THREE.DataTexture> {
  return need("hdr").hdr(src);
}

/** Loads an image from the project as a texture (`map`, `normalMap`, `roughnessMap`, …). */
export async function texture(src: string, opts?: TextureOptions): Promise<THREE.Texture> {
  return need("texture").texture(src, opts);
}

/**
 * Seeded, camera-facing glowing particles (dust, sparks, embers); call inside three({ setup }), add
 * `.object` to the scene and call `.update(time, camera)` from update(). Same field every render.
 */
export function particles(opts?: ParticleOptions): Particles {
  return need("particles", false).particles(opts);
}

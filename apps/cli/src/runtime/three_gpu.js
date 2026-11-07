// GPU renderer for `three(...)` nodes: three.js WebGPURenderer over deno_webgpu (wgpu).
//
// Runs the user's `setup` / `update` callbacks against the real three.js scene graph and
// renders it with three itself (PBR, textures, shadows, tone mapping, post-processing), into an
// offscreen texture that is read back and handed to Rust through `op_three_frame`.
// `renderThreeSceneGpu` resolves to false when no GPU can be used; the CLI then falls back to
// the software rasteriser in three_host.js.

import * as THREE from "three";
import { ClippingGroup, WebGPURenderer } from "three/webgpu";

const TONE_MAPPING = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

/** Same settings as the desktop runner's applyRenderOptions (packages/runtime/src/gpu/three_runner.ts). */
function applyRenderOptions(renderer, props) {
  renderer.shadowMap.enabled = !!props.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = TONE_MAPPING[props.toneMapping ?? "none"] ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = props.exposure ?? 1;
}

const sessions = new Map();
const warned = new Set();
let device = null;
let unavailable = false;

// WebGPURenderer ignores material.clippingPlanes (WebGL's local clipping) and clips by ClippingGroup
// instead. For the render only, each object whose material has planes sits inside an identity
// ClippingGroup holding those planes, so the same scene cuts the same way as the desktop preview.
// The group is kept per object so its clipping context (and compiled pipeline) survives frames.
const clipGroups = new WeakMap();

function clippingMaterial(object) {
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.find((m) => m && m.clippingPlanes && m.clippingPlanes.length);
}

function wrapClipped(scene) {
  const wrapped = [];
  scene.traverse((object) => {
    if (object.isClippingGroup || !object.parent || !object.material) return;
    const material = clippingMaterial(object);
    if (material) wrapped.push([object, material]);
  });
  for (const [object, material] of wrapped) {
    let group = clipGroups.get(object);
    if (!group) {
      group = new ClippingGroup();
      clipGroups.set(object, group);
    }
    group.clippingPlanes = material.clippingPlanes;
    group.clipIntersection = !!material.clipIntersection;
    const parent = object.parent;
    parent.children[parent.children.indexOf(object)] = group;
    group.parent = parent;
    group.children = [object];
    object.parent = group;
  }
  return () => {
    for (const [object] of wrapped) {
      const group = object.parent;
      const parent = group.parent;
      parent.children[parent.children.indexOf(group)] = object;
      object.parent = parent;
      group.parent = null;
      group.children = [];
    }
  };
}

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[three] ${message}`);
}

function walk(node, out) {
  if (!node) return;
  if (node.kind === "three") out.push(node);
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) walk(children[i], out);
}

/** deno_webgpu 0.158 reads writeBuffer's dataOffset / size as bytes; WebGPU counts typed-array elements. */
function patchWriteBuffer() {
  const writeBuffer = GPUQueue.prototype.writeBuffer;
  if (writeBuffer.__lios) return;
  const patched = function (buffer, offset, data, dataOffset = 0, size) {
    if (ArrayBuffer.isView(data) && !(data instanceof DataView)) {
      const bpe = data.BYTES_PER_ELEMENT;
      const count = size ?? data.length - dataOffset;
      return writeBuffer.call(this, buffer, offset, new Uint8Array(data.buffer, data.byteOffset + dataOffset * bpe, count * bpe));
    }
    return writeBuffer.call(this, buffer, offset, data, dataOffset, size);
  };
  patched.__lios = true;
  GPUQueue.prototype.writeBuffer = patched;
}

/**
 * naga 24 cannot convert an abstract float literal to an integer (three emits `u32( 0.0 )` for
 * equirect sizes), and only accepts a signed mip level in textureLoad (three emits `u32( 0 )`).
 */
export function fixWgsl(code) {
  return code
    .replace(/\b(u32|i32)\( (\d+)\.0 \)/g, (_, type, n) => n + (type === "u32" ? "u" : "i"))
    .replace(/(textureLoad\(.*), (?:u32\( (\d+) \)|(\d+)u) \)/g, (_, head, a, b) => `${head}, ${a ?? b}i )`);
}

async function getDevice() {
  if (device || unavailable) return device;
  try {
    if (!globalThis.__liosEnableWebGPU || !globalThis.__liosEnableWebGPU()) throw new Error("WebGPU is not built in");
    patchWriteBuffer();
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("no GPU adapter");
    const wanted = ["float32-filterable", "float32-blendable", "depth32float-stencil8", "texture-compression-bc", "rg11b10ufloat-renderable"];
    const dev = await adapter.requestDevice({ requiredFeatures: [...adapter.features].filter((f) => wanted.includes(f)) });
    // three runs in compatibility mode (no MSAA) unless the device reports core features; wgpu has them
    Object.defineProperty(dev, "features", { value: new Set([...dev.features, "core-features-and-limits"]) });
    if (!dev.lost) Object.defineProperty(dev, "lost", { value: new Promise(() => {}) });
    const createShaderModule = dev.createShaderModule.bind(dev);
    dev.createShaderModule = (desc) => {
      const module = createShaderModule({ ...desc, code: fixWgsl(String(desc.code ?? "")) });
      try {
        module.getCompilationInfo ??= async () => ({ messages: [] });
      } catch {
        // the module object may not take new properties; three only uses this for diagnostics
      }
      return module;
    };
    device = dev;
  } catch (error) {
    unavailable = true;
    warnOnce(`GPU rendering unavailable, using the software rasteriser: ${error && error.message ? error.message : error}`);
  }
  return device;
}

/** A canvas stand-in whose WebGPU context renders into a texture we can read back. */
function offscreen(width, height) {
  const context = {
    format: "rgba8unorm",
    texture: null,
    configure(config) {
      this.format = config.format;
      this.texture?.destroy();
      this.texture = null;
    },
    unconfigure() {},
    getCurrentTexture() {
      const { width: w, height: h } = canvas;
      if (this.texture && (this.texture.width !== w || this.texture.height !== h)) {
        this.texture.destroy();
        this.texture = null;
      }
      this.texture ??= device.createTexture({
        size: [w, h],
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
      });
      return this.texture;
    },
  };
  const canvas = { width, height, style: {}, getContext: () => context, addEventListener() {}, removeEventListener() {} };
  return { canvas, context };
}

async function createSession(node, props, width, height) {
  const scene = new THREE.Scene();
  const orthographic = props.camera === "orthographic";
  const camera = orthographic
    ? new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 2000)
    : new THREE.PerspectiveCamera(props.fov || 50, width / height, 0.1, 1000);
  camera.position.z = orthographic ? 500 : 5;

  const { canvas, context } = offscreen(width, height);
  let renderer;
  try {
    renderer = new WebGPURenderer({ canvas, context, device, antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    await renderer.init();
    if (!renderer.backend?.isWebGPUBackend) throw new Error("three fell back to WebGL");
  } catch (error) {
    throw Object.assign(new Error(`WebGPURenderer: ${error && error.message ? error.message : error}`), { gpu: true });
  }
  // three starts a requestAnimationFrame loop on init; frames are driven by the CLI instead
  renderer._animation?.stop?.();
  applyRenderOptions(renderer, props);

  // setup may be async (gltf / hdr / texture loads)
  const userState = typeof node.setupFn === "function" ? await node.setupFn({ scene, camera, width, height }) : undefined;
  return { scene, camera, renderer, context, userState, width, height };
}

/** sRGB bytes of a plain-colour scene.background, which the desktop (WebGL) does not tone map. */
function backgroundBytes(background) {
  if (!background || !background.isColor) return null;
  const c = background.clone().convertLinearToSRGB();
  return [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

async function readPixels(session, background) {
  const { context, width, height } = session;
  const texture = context.getCurrentTexture();
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(width * height * 4);
  const bgra = context.format.startsWith("bgra");
  for (let y = 0; y < height; y++) {
    let s = y * bytesPerRow;
    let d = y * width * 4;
    for (let x = 0; x < width; x++, s += 4, d += 4) {
      const a = src[s + 3];
      let r = src[s + (bgra ? 2 : 0)];
      let g = src[s + 1];
      let b = src[s + (bgra ? 0 : 2)];
      // the canvas is premultiplied; the compositor takes straight alpha like decoded images
      if (a > 0 && a < 255) {
        r = Math.min(255, Math.round((r * 255) / a));
        g = Math.min(255, Math.round((g * 255) / a));
        b = Math.min(255, Math.round((b * 255) / a));
      }
      if (background && a < 255) {
        r = Math.round((r * a + background[0] * (255 - a)) / 255);
        g = Math.round((g * a + background[1] * (255 - a)) / 255);
        b = Math.round((b * a + background[2] * (255 - a)) / 255);
      }
      out[d] = r;
      out[d + 1] = g;
      out[d + 2] = b;
      out[d + 3] = background ? 255 : a;
    }
  }
  buffer.unmap();
  buffer.destroy();
  return out;
}

/** Renders every three() node of the scene on the GPU; false when the GPU path cannot be used. */
export async function renderThreeSceneGpu(comp, sceneIndex, time, progress) {
  if (!(await getDevice())) return false;
  const def = comp && comp.scenes ? comp.scenes[sceneIndex] : undefined;
  if (!def) return true;
  const root = globalThis.__liosvideo.instantiateScene(comp, def);
  const nodes = [];
  walk(root, nodes);

  // TSL `time` and three's internal clocks follow the video clock, not the wall clock
  const performanceNow = globalThis.performance.now;
  globalThis.performance.now = () => time * 1000;
  try {
    for (const node of nodes) {
      const props = node.propsAt(time);
      const width = Math.max(1, Math.round(props.width || 400));
      const height = Math.max(1, Math.round(props.height || 300));

      let session = sessions.get(node.path());
      if (!session) {
        try {
          session = await createSession(node, props, width, height);
          sessions.set(node.path(), session);
        } catch (error) {
          if (error && error.gpu) {
            unavailable = true;
            warnOnce(`GPU rendering unavailable, using the software rasteriser: ${error.message}`);
            return false;
          }
          warnOnce(`setup() failed: ${error && error.message ? error.message : error}`);
          continue;
        }
      } else if (session.width !== width || session.height !== height) {
        session.width = width;
        session.height = height;
        if (session.camera.isPerspectiveCamera) session.camera.aspect = width / height;
        session.camera.updateProjectionMatrix();
        session.renderer.setSize(width, height, false);
      }

      if (typeof node.updateFn === "function") {
        try {
          node.updateFn(session.userState, progress, time);
        } catch (error) {
          warnOnce(`update() failed: ${error && error.message ? error.message : error}`);
        }
      }

      // a colour background goes behind the rendered image untouched, as in the desktop preview
      const sceneBackground = session.scene.background;
      const background = backgroundBytes(sceneBackground);
      if (background) session.scene.background = null;
      const unwrapClipped = wrapClipped(session.scene);
      try {
        session.renderer.render(session.scene, session.camera);
      } finally {
        unwrapClipped();
        session.scene.background = sceneBackground;
      }
      const pixels = await readPixels(session, background);
      Deno.core.ops.op_three_frame(node.path(), width, height, pixels);
    }
  } finally {
    globalThis.performance.now = performanceNow;
  }
  return true;
}

globalThis.__liosvideoCliGpu = { renderThreeSceneGpu };

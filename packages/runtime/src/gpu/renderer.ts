import { multiply, type Affine } from "../math/affine";
import { parseColor } from "../math/color";
import type { ImageItem, LayerItem, RenderItem, RenderList, TextItem } from "../renderlist";
import blurSrc from "./shaders/blur.wgsl?raw";
import commonSrc from "./shaders/common.wgsl?raw";
import compositeSrc from "./shaders/composite.wgsl?raw";
import quadSrc from "./shaders/quad.wgsl?raw";
import { TextRasterizer } from "./text";

export { measureText } from "./text";

export type AssetMap = Map<string, ImageBitmap>;

export interface Renderer {
  resize(width: number, height: number): void;
  render(list: RenderList, assets: AssetMap): void;
  /** RGBA, row-major, of the last rendered frame */
  readPixels(): Promise<Uint8Array>;
  destroy(): void;
}

const LAYER_FORMAT: GPUTextureFormat = "rgba8unorm";
const INST_FLOATS = 24;
const MAX_BLUR_RADIUS = 64;
const MODE_RECT = 0;
const MODE_TEXTURE = 1;
const MODE_SOLID = 2;
const PREMULTIPLIED: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

type Leaf = Exclude<RenderItem, LayerItem>;
type Draw = { index: number; texture: GPUTexture };

function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1e-12;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export async function createRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  opts: { device?: GPUDevice } = {},
): Promise<Renderer> {
  const adapter = opts.device ? undefined : await navigator.gpu.requestAdapter();
  if (!opts.device && !adapter) throw new Error("WebGPU is not available");
  const device = opts.device ?? (await adapter!.requestDevice());
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  // rgba8unorm is valid for every canvas; bgra8unorm canvases fail in headless Chromium.
  const canvasFormat: GPUTextureFormat = "rgba8unorm";

  const quadModule = device.createShaderModule({ code: commonSrc + quadSrc });
  const blurModule = device.createShaderModule({ code: commonSrc + blurSrc });
  const compositeModule = device.createShaderModule({ code: commonSrc + compositeSrc });

  const quadPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: quadModule, entryPoint: "vs" },
    fragment: { module: quadModule, entryPoint: "fs", targets: [{ format: LAYER_FORMAT, blend: PREMULTIPLIED }] },
  });
  const blurPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: blurModule, entryPoint: "vsFullscreen" },
    fragment: { module: blurModule, entryPoint: "fs", targets: [{ format: LAYER_FORMAT }] },
  });
  const compositePipelines = new Map<string, GPURenderPipeline>();
  const compositePipeline = (format: GPUTextureFormat, blend: boolean) => {
    const key = `${format}:${blend}`;
    let p = compositePipelines.get(key);
    if (!p) {
      p = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: compositeModule, entryPoint: "vsFullscreen" },
        fragment: { module: compositeModule, entryPoint: "fs", targets: [{ format, blend: blend ? PREMULTIPLIED : undefined }] },
      });
      compositePipelines.set(key, p);
    }
    return p;
  };

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const white = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);

  const textureBindGroups = new WeakMap<GPUTexture, GPUBindGroup>();
  const textureGroup = (texture: GPUTexture) => {
    let bg = textureBindGroups.get(texture);
    if (!bg) {
      bg = device.createBindGroup({
        layout: quadPipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: sampler },
        ],
      });
      textureBindGroups.set(texture, bg);
    }
    return bg;
  };

  const text = new TextRasterizer();
  const textTextures = new Map<OffscreenCanvas, GPUTexture>();
  const imageTextures = new WeakMap<ImageBitmap, GPUTexture>();
  const warned = new Set<string>();

  const uploadSource = (source: OffscreenCanvas | ImageBitmap) => {
    const texture = device.createTexture({
      size: [source.width, source.height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: true }, [source.width, source.height]);
    return texture;
  };

  let width = 1;
  let height = 1;
  let target: GPUTexture | undefined;
  let pool: GPUTexture[] = [];

  const newLayerTexture = () =>
    device.createTexture({
      size: [width, height],
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
  const acquire = () => pool.pop() ?? newLayerTexture();

  function resize(w: number, h: number) {
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    canvas.width = width;
    canvas.height = height;
    context.configure({ device, format: canvasFormat, alphaMode: "opaque" });
    target?.destroy();
    pool.forEach((t) => t.destroy());
    pool = [];
    target = newLayerTexture();
  }
  resize(canvas.width || 1, canvas.height || 1);

  function render(list: RenderList, assets: AssetMap) {
    const sx = width / list.width;
    const sy = height / list.height;
    const deviceScale: Affine = [sx, 0, 0, sy, 0, 0];
    const frameBuffers: GPUBuffer[] = [];
    const inUse: GPUTexture[] = [];

    // 1. Flatten leaves into instance data.
    const leaves: Leaf[] = [];
    const collect = (items: RenderItem[]) => items.forEach((i) => (i.kind === "layer" ? collect(i.items) : leaves.push(i)));
    collect(list.items);
    const data = new Float32Array(Math.max(1, leaves.length) * INST_FLOATS);
    const draws = new Map<Leaf, Draw>();
    leaves.forEach((leaf, index) => {
      draws.set(leaf, { index, texture: writeInstance(data, index, leaf, assets, sx) });
    });

    const instances = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(instances, 0, data);
    const globals = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(globals, 0, new Float32Array([width, height, sx, sy]));
    frameBuffers.push(instances, globals);
    const globalsGroup = device.createBindGroup({
      layout: quadPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: globals } },
        { binding: 1, resource: { buffer: instances } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const uniform = (values: number[]) => {
      const buf = device.createBuffer({ size: values.length * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, new Float32Array(values));
      frameBuffers.push(buf);
      return buf;
    };
    const fullscreen = (pipeline: GPURenderPipeline, view: GPUTextureView, values: number[], src: GPUTexture, load: GPULoadOp) => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: load, storeOp: "store", clearValue: [0, 0, 0, 0] }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform(values) } },
            { binding: 1, resource: src.createView() },
          ],
        }),
      );
      pass.draw(3);
      pass.end();
    };

    const drawLeaves = (view: GPUTextureView, run: Leaf[]) => {
      if (!run.length) return;
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "load", storeOp: "store" }] });
      pass.setPipeline(quadPipeline);
      pass.setBindGroup(0, globalsGroup);
      for (const leaf of run) {
        const d = draws.get(leaf)!;
        pass.setBindGroup(1, textureGroup(d.texture));
        pass.draw(6, 1, 0, d.index);
      }
      pass.end();
    };

    const drawItems = (into: GPUTexture, items: RenderItem[]) => {
      const view = into.createView();
      let run: Leaf[] = [];
      for (const item of items) {
        if (item.kind !== "layer") {
          run.push(item);
          continue;
        }
        drawLeaves(view, run);
        run = [];
        drawLayer(view, item);
      }
      drawLeaves(view, run);
    };

    const drawLayer = (parentView: GPUTextureView, layer: LayerItem) => {
      const content = acquire();
      inUse.push(content);
      const cleared = encoder.beginRenderPass({
        colorAttachments: [{ view: content.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
      });
      cleared.end();
      drawItems(content, layer.items);

      if (layer.blur > 0) {
        const sigma = Math.max((layer.blur * sx) / 2, 0.01);
        const radius = Math.min(Math.ceil(sigma * 3), MAX_BLUR_RADIUS);
        const tmp = acquire();
        inUse.push(tmp);
        fullscreen(blurPipeline, tmp.createView(), [1, 0, sigma, radius], content, "clear");
        fullscreen(blurPipeline, content.createView(), [0, 1, sigma, radius], tmp, "clear");
      }

      let clip = [1, 0, 0, 1, 0, 0, 0, 0, layer.opacity, 0, 0, 1];
      if (layer.clip) {
        const full = multiply(deviceScale, layer.clip.matrix);
        const inv = invert(full);
        const unitsPerPx = Math.hypot(inv[0], inv[1]);
        // inv0 (a b c d), inv1 (e f w h), params
        clip = [inv[0], inv[1], inv[2], inv[3], inv[4], inv[5], layer.clip.width, layer.clip.height, layer.opacity, layer.clip.radius, 1, unitsPerPx];
      }
      fullscreen(compositePipeline(LAYER_FORMAT, true), parentView, clip, content, "load");
    };

    // 2. Clear to the background, draw, then blit to the canvas.
    const [r, g, b, a] = parseColor(list.background);
    const clearPass = encoder.beginRenderPass({
      colorAttachments: [{ view: target!.createView(), loadOp: "clear", storeOp: "store", clearValue: [r * a, g * a, b * a, a] }],
    });
    clearPass.end();
    drawItems(target!, list.items);
    fullscreen(compositePipeline(canvasFormat, false), context.getCurrentTexture().createView(), [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1], target!, "clear");

    device.queue.submit([encoder.finish()]);
    frameBuffers.forEach((buf) => buf.destroy());
    pool.push(...inUse);
  }

  function writeInstance(data: Float32Array, index: number, leaf: Leaf, assets: AssetMap, sx: number): GPUTexture {
    const o = index * INST_FLOATS;
    let [a, b, c, d, e, f] = leaf.matrix;
    let w = 0;
    let h = 0;
    let color = [1, 1, 1, 1];
    let stroke = [0, 0, 0, 0];
    let params = [0, 0, leaf.opacity, MODE_TEXTURE];
    let uv = [0, 0, 1, 1];
    let texture = white;

    if (leaf.kind === "rect") {
      w = leaf.width;
      h = leaf.height;
      color = parseColor(leaf.fill);
      if (leaf.stroke) stroke = parseColor(leaf.stroke);
      params = [leaf.radius, leaf.strokeWidth, leaf.opacity, MODE_RECT];
    } else if (leaf.kind === "text") {
      const scale = Math.round(Math.sqrt(Math.abs(a * d - b * c)) * sx * 100) / 100 || 1;
      const raster = text.raster(leaf as TextItem, scale);
      let tex = textTextures.get(raster.canvas);
      if (!tex) {
        if (textTextures.size > 512) {
          textTextures.forEach((t) => t.destroy());
          textTextures.clear();
        }
        tex = uploadSource(raster.canvas);
        textTextures.set(raster.canvas, tex);
      }
      texture = tex;
      w = raster.width;
      h = raster.height;
    } else {
      const img = leaf as ImageItem;
      const bitmap = assets.get(img.src);
      if (!bitmap) {
        if (!warned.has(img.src)) console.warn(`[liosvideo] missing image asset "${img.src}"`);
        warned.add(img.src);
        w = img.width || 100;
        h = img.height || 100;
        color = [1, 0, 1, 1];
        params = [0, 0, img.opacity, MODE_SOLID];
      } else {
        let tex = imageTextures.get(bitmap);
        if (!tex) imageTextures.set(bitmap, (tex = uploadSource(bitmap)));
        texture = tex;
        w = img.width || bitmap.width;
        h = img.height || bitmap.height;
        const boxAspect = w / h;
        const imgAspect = bitmap.width / bitmap.height;
        if (img.fit === "contain") {
          const cw = imgAspect > boxAspect ? w : h * imgAspect;
          const ch = imgAspect > boxAspect ? w / imgAspect : h;
          [e, f] = [e + a * ((w - cw) / 2) + c * ((h - ch) / 2), f + b * ((w - cw) / 2) + d * ((h - ch) / 2)];
          w = cw;
          h = ch;
        } else if (img.fit === "cover") {
          if (imgAspect > boxAspect) {
            const k = boxAspect / imgAspect;
            uv = [(1 - k) / 2, 0, (1 + k) / 2, 1];
          } else {
            const k = imgAspect / boxAspect;
            uv = [0, (1 - k) / 2, 1, (1 + k) / 2];
          }
        }
      }
    }

    data.set([a, b, c, d, e, f, w, h, ...color, ...stroke, ...params, ...uv], o);
    return texture;
  }

  async function readPixels(): Promise<Uint8Array> {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: target! }, { buffer, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  function destroy() {
    target?.destroy();
    pool.forEach((t) => t.destroy());
    textTextures.forEach((t) => t.destroy());
    white.destroy();
    context.unconfigure();
  }

  return { resize, render, readPixels, destroy };
}

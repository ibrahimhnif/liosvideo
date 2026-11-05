import { afterEach, describe, expect, it } from "vitest";
import { composition, scene } from "../../src/composition";
import { evaluateFrame } from "../../src/evaluate";
import { rect } from "../../src/graph/kinds";
import { createRenderer, type Renderer } from "../../src/gpu/renderer";
import type { Filters, RenderItem, RenderList } from "../../src/renderlist";

const SIZE = 256;
const I: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
const at = (x: number, y: number): typeof I => [1, 0, 0, 1, x, y];

let renderer: Renderer | undefined;
afterEach(() => renderer?.destroy());

async function make(): Promise<Renderer> {
  const canvas = document.createElement("canvas");
  renderer = await createRenderer(canvas);
  renderer.resize(SIZE, SIZE);
  return renderer;
}

const list = (items: RenderItem[]): RenderList => ({ width: SIZE, height: SIZE, background: "#000000", items, assets: [] });

const rectItem = (over: Partial<Extract<RenderItem, { kind: "rect" }>> = {}): RenderItem => ({
  kind: "rect", path: "r", matrix: I, width: 100, height: 100, radius: 0, fill: "#ff0000", strokeWidth: 0, opacity: 1, ...over,
});

function px(pixels: Uint8Array, x: number, y: number): number[] {
  const i = (y * SIZE + x) * 4;
  return [...pixels.slice(i, i + 4)];
}
const lum = (p: number[]) => (p[0] + p[1] + p[2]) / 3;

describe("renderer", () => {
  it("draws a solid rect at its position over the background", async () => {
    const r = await make();
    r.render(list([rectItem({ matrix: at(50, 50) })]), new Map());
    const pixels = await r.readPixels();
    const inside = px(pixels, 100, 100);
    expect(Math.abs(inside[0] - 255)).toBeLessThanOrEqual(2);
    expect(inside[1]).toBeLessThanOrEqual(2);
    expect(inside[3]).toBe(255);
    expect(px(pixels, 10, 10)).toEqual([0, 0, 0, 255]);
  });

  it("rounds corners", async () => {
    const r = await make();
    r.render(list([rectItem({ radius: 50, fill: "#ffffff" })]), new Map());
    const pixels = await r.readPixels();
    expect(px(pixels, 2, 2)).toEqual([0, 0, 0, 255]);
    expect(lum(px(pixels, 50, 50))).toBeGreaterThan(250);
  });

  it("runs a custom WGSL shader with time and uniforms", async () => {
    const r = await make();
    const frame = list([
      {
        kind: "shader",
        path: "fx",
        matrix: I,
        width: SIZE,
        height: SIZE,
        code: `
          @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
            return vec4f(u_globals.time.x, u.speed.x, 0.0, 1.0);
          }
        `,
        uniforms: { speed: 0.5 },
        opacity: 1,
        time: 0.25,
        progress: 0.5,
      },
    ]);
    await r.prepare(frame);
    r.render(frame, new Map());
    const p = px(await r.readPixels(), 128, 128);
    expect(Math.abs(p[0] - 64)).toBeLessThanOrEqual(2);
    expect(Math.abs(p[1] - 128)).toBeLessThanOrEqual(2);
    expect(p[3]).toBe(255);
  });

  it("blurs layer edges", async () => {
    const r = await make();
    const white = rectItem({ matrix: at(64, 64), width: 128, height: 128, fill: "#ffffff" });
    r.render(list([white]), new Map());
    const sharp = await r.readPixels();
    expect(lum(px(sharp, 66, 128))).toBeGreaterThan(250);
    expect(lum(px(sharp, 61, 128))).toBeLessThan(5);

    r.render(list([{ kind: "layer", path: "l", items: [white], opacity: 1, blur: 10 }]), new Map());
    const edge = lum(px(await r.readPixels(), 64, 128));
    expect(edge).toBeGreaterThan(40);
    expect(edge).toBeLessThan(215);
  });

  it("applies layer opacity", async () => {
    const r = await make();
    const white = rectItem({ fill: "#ffffff" });
    r.render(list([{ kind: "layer", path: "l", items: [white], opacity: 0.5, blur: 0 }]), new Map());
    expect(Math.abs(lum(px(await r.readPixels(), 50, 50)) - 128)).toBeLessThanOrEqual(3);
  });

  it("clips layer content to a rounded rect", async () => {
    const r = await make();
    const big = rectItem({ width: 256, height: 256, fill: "#ffffff" });
    r.render(
      list([{ kind: "layer", path: "l", items: [big], opacity: 1, blur: 0, clip: { matrix: at(50, 50), width: 100, height: 100, radius: 20 } }]),
      new Map(),
    );
    const pixels = await r.readPixels();
    expect(lum(px(pixels, 100, 100))).toBeGreaterThan(250);
    expect(lum(px(pixels, 20, 20))).toBeLessThan(5);
    expect(lum(px(pixels, 52, 52))).toBeLessThan(5);
  });

  it("rasterizes text", async () => {
    const r = await make();
    r.render(
      list([{ kind: "text", path: "t", matrix: at(20, 20), text: "Ag", fontFamily: "SF Pro Text", fontSize: 48, fontWeight: 400, color: "#ffffff", lineHeight: 1.2, opacity: 1 }]),
      new Map(),
    );
    const pixels = await r.readPixels();
    let lit = 0;
    for (let y = 20; y < 90; y++) for (let x = 20; x < 120; x++) if (lum(px(pixels, x, y)) > 128) lit++;
    expect(lit).toBeGreaterThan(50);
  });

  it("draws an image asset", async () => {
    const r = await make();
    const c = new OffscreenCanvas(4, 4);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, 4, 4);
    const bmp = await createImageBitmap(c);
    r.render(
      list([{ kind: "image", path: "i", matrix: at(10, 10), src: "a.png", width: 50, height: 50, fit: "fill", opacity: 1 }]),
      new Map([["a.png", bmp]]),
    );
    const p = px(await r.readPixels(), 30, 30);
    expect(p[1]).toBeGreaterThan(250);
    expect(p[0]).toBeLessThan(5);
  });

  it("draws a magenta placeholder for a missing image instead of throwing", async () => {
    const r = await make();
    r.render(list([{ kind: "image", path: "i", matrix: at(10, 10), src: "missing.png", width: 50, height: 50, fit: "fill", opacity: 1 }]), new Map());
    expect(px(await r.readPixels(), 30, 30)).toEqual([255, 0, 255, 255]);
  });

  it("draws a three.js item with bitmap", async () => {
    const r = await make();
    const c = new OffscreenCanvas(30, 30);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(0, 0, 30, 30);
    const bmp = await createImageBitmap(c);
    r.render(
      list([{ kind: "three", path: "3d", matrix: at(10, 10), width: 50, height: 50, bitmap: bmp, opacity: 1, time: 0, duration: 1 }]),
      new Map(),
    );
    const p = px(await r.readPixels(), 30, 30);
    expect(p[0]).toBeGreaterThan(40);
    expect(p[1]).toBeGreaterThan(160);
    expect(p[2]).toBeGreaterThan(220);
  });

  it("renders a frame identically whether seeked directly or played up to", async () => {
    const r = await make();
    const c = composition({
      width: SIZE,
      height: SIZE,
      fps: 30,
      scenes: [
        scene("s", { duration: 3 }, ({ root, random }) => {
          root.add(rect({ width: 60, height: 40, radius: 8, x: random() * 100, fill: "#33aaff" })).to({ y: 150, rotation: 30 }, { at: 0.2, duration: 2 });
          root.add(rect({ width: 80, height: 80, blur: 6, opacity: 0.7, fill: "#ffaa00" })).to({ x: 120 }, { at: 0, duration: 2 });
        }),
      ],
    });
    r.render(evaluateFrame(c, 45), new Map());
    const direct = await r.readPixels();
    for (let f = 0; f < 45; f++) r.render(evaluateFrame(c, f), new Map());
    r.render(evaluateFrame(c, 45), new Map());
    expect(await r.readPixels()).toEqual(direct);
  });
});

describe("renderer GPU failures", () => {
  it("reports device loss", async () => {
    const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    const lost: string[] = [];
    const r = await createRenderer(document.createElement("canvas"), { device, onLost: (m) => lost.push(m) });
    device.destroy();
    await new Promise((res) => setTimeout(res, 50));
    expect(lost).toHaveLength(1);
    r.destroy();
  });

  it("reports validation errors instead of failing silently", async () => {
    const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    const errors: string[] = [];
    const r = await createRenderer(document.createElement("canvas"), { device, onError: (m) => errors.push(m) });
    // a storage binding on a format that doesn't support it is a validation error, not an exception
    device.createTexture({ size: [4, 4], format: "rgba8unorm-srgb", usage: GPUTextureUsage.STORAGE_BINDING });
    await device.queue.onSubmittedWorkDone();
    await new Promise((res) => setTimeout(res, 100));
    expect(errors.length).toBeGreaterThan(0);
    r.destroy();
  });
});

describe("text cache", () => {
  it("draws every text item when one frame needs more rasters than the cache holds", async () => {
    const r = await make();
    const items: RenderItem[] = [];
    for (let i = 0; i < 600; i++) {
      const x = (i % 30) * 8;
      const y = Math.floor(i / 30) * 12;
      items.push({ kind: "text", path: `t${i}`, matrix: at(x, y), text: `${i}`, fontFamily: "SF Pro Text", fontSize: 10, fontWeight: 400, color: "#ffffff", lineHeight: 1, opacity: 1 });
    }
    r.render(list(items), new Map());
    const pixels = await r.readPixels();
    const litIn = (x0: number, y0: number) => {
      for (let y = y0; y < y0 + 10; y++) for (let x = x0; x < x0 + 8; x++) if (lum(px(pixels, x, y)) > 100) return true;
      return false;
    };
    expect(litIn(0, 0)).toBe(true);
    expect(litIn((599 % 30) * 8, Math.floor(599 / 30) * 12)).toBe(true);
  });
});

const NO_FILTERS: Filters = { pixelate: 0, posterize: 0, halftone: 0, outline: 0, outlineColor: "#111111", chalk: 0, glow: 0, glowIntensity: 1 };
const filtered = (items: RenderItem[], f: Partial<Filters>, opacity = 1): RenderItem => ({
  kind: "layer", path: "fl", items, opacity, blur: 0, filters: { ...NO_FILTERS, ...f },
});
const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
/** vertical stripes `w` wide, red ramping left to right across `width` */
const gradient = (width = SIZE, w = 4): RenderItem[] =>
  Array.from({ length: width / w }, (_, i) =>
    rectItem({ path: `g${i}`, matrix: at(i * w, 0), width: w, height: width, fill: `#${hex((i * w * 255) / width)}4020` }),
  );
const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

describe("filters", () => {
  it("pixelate makes uniform cells", async () => {
    const r = await make();
    r.render(list([filtered(gradient(), { pixelate: 8 })]), new Map());
    const p = await r.readPixels();
    for (let cx = 0; cx < SIZE; cx += 8) {
      const first = px(p, cx, 16);
      for (let dx = 0; dx < 8; dx++) for (let dy = 0; dy < 8; dy++) expect(diff(px(p, cx + dx, 16 + dy), first)).toBeLessThanOrEqual(1);
    }
    expect(diff(px(p, 0, 16), px(p, 248, 16))).toBeGreaterThan(100);
  });

  it("posterize limits the levels", async () => {
    const r = await make();
    r.render(list([filtered(gradient(), { posterize: 4 })]), new Map());
    const p = await r.readPixels();
    const reds = new Set(Array.from({ length: SIZE }, (_, x) => px(p, x, 100)[0]));
    expect(reds.size).toBeLessThanOrEqual(4);
    expect(reds.size).toBeGreaterThanOrEqual(3);
  });

  it("halftone draws dots that are darker in the middle of each cell", async () => {
    const r = await make();
    r.render(list([filtered([rectItem({ width: SIZE, height: SIZE, fill: "#808080" })], { halftone: 8 })]), new Map());
    const p = await r.readPixels();
    for (const [cx, cy] of [[64, 64], [128, 32], [200, 200]]) {
      expect(lum(px(p, cx + 4, cy + 4))).toBeLessThan(lum(px(p, cx, cy)) - 20);
    }
  });

  it("halftone leaves no dark fringe where a cell centre falls outside the shape", async () => {
    const r = await make();
    // the rect starts at x=102; the cell [96, 104) has its centre (100) outside it
    const card = rectItem({ matrix: at(102, 102), width: 52, height: 52, fill: "#ffffff" });
    r.render(list([filtered([card], { halftone: 8 })]), new Map());
    const p = await r.readPixels();
    expect(lum(px(p, 103, 132))).toBeGreaterThan(240);
    expect(lum(px(p, 132, 103))).toBeGreaterThan(240);
  });

  it("outline draws ink just outside the shape", async () => {
    const r = await make();
    const box = rectItem({ matrix: at(118, 118), width: 20, height: 20, fill: "#ffffff" });
    r.render(list([filtered([box], { outline: 2, outlineColor: "#00ff00" })]), new Map());
    const p = await r.readPixels();
    const edge = px(p, 117, 128);
    expect(edge[1]).toBeGreaterThan(150);
    expect(edge[0]).toBeLessThan(80);
    expect(lum(px(p, 128, 128))).toBeGreaterThan(240);
    expect(px(p, 100, 128)).toEqual([0, 0, 0, 255]);
  });

  it("chalk erodes the shape the same way every frame", async () => {
    const r = await make();
    const frame = list([filtered([rectItem({ matrix: at(78, 78), width: 100, height: 100, fill: "#ffffff" })], { chalk: 0.8 })]);
    r.render(frame, new Map());
    const a = await r.readPixels();
    r.render(frame, new Map());
    const b = await r.readPixels();
    expect([...a]).toEqual([...b]);
    let sum = 0;
    for (let y = 80; y < 176; y++) for (let x = 80; x < 176; x++) sum += lum(px(a, x, y));
    const mean = sum / (96 * 96) / 255;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.9);
  });

  it("glow spreads light around the shape", async () => {
    const r = await make();
    const dot = rectItem({ matrix: at(123, 123), width: 10, height: 10, fill: "#ffffff" });
    r.render(list([filtered([dot], { glow: 8 })]), new Map());
    expect(lum(px(await r.readPixels(), 117, 128))).toBeGreaterThan(13);
    r.render(list([{ kind: "layer", path: "l", items: [dot], opacity: 1, blur: 0 }]), new Map());
    expect(lum(px(await r.readPixels(), 117, 128))).toBe(0);
  });

  it("filter sizes are composition px, scaled with the canvas", async () => {
    const r = await make();
    // alternating red / blue every 2 composition px = every device px at half scale
    const stripes = Array.from({ length: SIZE }, (_, i) =>
      rectItem({ path: `s${i}`, matrix: at(i * 2, 0), width: 2, height: SIZE * 2, fill: i % 2 ? "#0000ff" : "#ff0000" }),
    );
    // 6 composition px = 3 device px; cell centres land on alternating stripes
    const half: RenderList = { width: SIZE * 2, height: SIZE * 2, background: "#000000", items: [filtered(stripes, { pixelate: 6 })], assets: [] };
    r.render(half, new Map());
    const p = await r.readPixels();
    for (let cx = 0; cx + 3 <= SIZE; cx += 3) {
      const first = px(p, cx, 16);
      for (let dx = 0; dx < 3; dx++) expect(diff(px(p, cx + dx, 16), first)).toBeLessThanOrEqual(1);
    }
    expect(diff(px(p, 0, 16), px(p, 3, 16))).toBeGreaterThan(100);
  });

  it("combines with clip and opacity", async () => {
    const r = await make();
    const layer = { ...filtered(gradient(), { pixelate: 8 }, 0.5), clip: { matrix: at(64, 64), width: 128, height: 128, radius: 0 } } as RenderItem;
    r.render(list([layer]), new Map());
    const p = await r.readPixels();
    expect(px(p, 32, 100)).toEqual([0, 0, 0, 255]);
    const first = px(p, 128, 128);
    for (let d = 0; d < 8; d++) expect(diff(px(p, 128 + d, 128), first)).toBeLessThanOrEqual(1);
    expect(first[0]).toBeLessThan(80); // half of ~128 red
    expect(first[0]).toBeGreaterThan(48);
  });

  it("keeps transparent pixels empty and colour hue on premultiplied edges", async () => {
    const r = await make();
    const red = rectItem({ matrix: at(50, 50), width: 100, height: 100, fill: "#ff0000", opacity: 0.5 });
    r.render(list([filtered([red], { posterize: 4, pixelate: 3, halftone: 6 })]), new Map());
    const p = await r.readPixels();
    expect(px(p, 10, 10)).toEqual([0, 0, 0, 255]);
    const inside = px(p, 100, 100);
    expect(inside[1]).toBeLessThanOrEqual(2);
    expect(inside[2]).toBeLessThanOrEqual(2);
    expect(inside[0]).toBeGreaterThan(20);
  });
});

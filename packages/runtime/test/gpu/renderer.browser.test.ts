import { afterEach, describe, expect, it } from "vitest";
import { composition, scene } from "../../src/composition";
import { evaluateFrame } from "../../src/evaluate";
import { rect } from "../../src/graph/kinds";
import { createRenderer, type Renderer } from "../../src/gpu/renderer";
import type { RenderItem, RenderList } from "../../src/renderlist";

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
      list([{ kind: "three", path: "3d", matrix: at(10, 10), width: 50, height: 50, bitmap: bmp, opacity: 1 }]),
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

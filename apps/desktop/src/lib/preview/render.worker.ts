/// <reference lib="webworker" />
import * as runtime from "liosvideo";
import * as THREE from "three";
import { createRenderer, measureText, type AssetMap, type Renderer } from "liosvideo/gpu";
import type { FromWorker, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: FromWorker) => self.postMessage(msg);

// Scene code gets the runtime and nothing that reaches the network or storage.
// Dynamic import() can't be blocked here; the bundler rejects it.
const BLOCKED = [
  "fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "importScripts", "indexedDB", "caches",
  "BroadcastChannel", "Worker", "FontFace", "fonts",
];
for (const name of BLOCKED) {
  Object.defineProperty(globalThis, name, {
    configurable: false,
    get() {
      throw new Error(`${name} is not available in scenes`);
    },
  });
}
(globalThis as unknown as { __liosvideo: typeof runtime }).__liosvideo = runtime;
(globalThis as unknown as { THREE: typeof THREE }).THREE = THREE;
runtime.setTextMeasurer(measureText);

let renderer: Renderer | undefined;
let rendererReady: Promise<Renderer> | undefined;
let size: { width: number; height: number } | undefined;
let comp: runtime.Composition | undefined;
const assets: AssetMap = new Map();
let loading: Promise<void> = Promise.resolve();

function isComposition(v: unknown): v is runtime.Composition {
  const c = v as runtime.Composition;
  return !!c && typeof c === "object" && typeof c.width === "number" && typeof c.height === "number" && typeof c.fps === "number" && Array.isArray(c.scenes);
}

function errorOf(e: unknown): { message: string; stack?: string } {
  return e instanceof Error ? { message: e.message, stack: e.stack } : { message: String(e) };
}

async function load(code: string, generation: number) {
  // Evaluated as a module from a blob URL: CSP allows blob: scripts but not eval.
  const url = URL.createObjectURL(new Blob([`${code}\nexport default __liosProject;`], { type: "text/javascript" }));
  try {
    const project = (await import(/* @vite-ignore */ url)).default;
    const c = project?.default;
    if (!isComposition(c)) throw new Error("Entry file must default-export composition(...)");
    const found = runtime.collectAssets(c); // instantiates every scene, surfacing build errors now
    const { totalFrames, scenes } = runtime.layoutComposition(c);
    const manifest = runtime.buildManifest(c);
    comp = c;
    if (renderer && !size) renderer.resize(c.width, c.height);
    post({ type: "loaded", generation, width: c.width, height: c.height, fps: c.fps, totalFrames, scenes, assets: found, manifest });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function render(frame: number, id: number) {
  const r = await rendererReady;
  if (r && comp) r.render(runtime.evaluateFrame(comp, frame), assets);
  post({ type: "rendered", id, frame });
}

async function snapshot(id: number) {
  const r = await rendererReady;
  if (!r) throw new Error("Renderer not initialized");
  const pixels = await r.readPixels();
  const { width, height } = size ?? { width: comp?.width ?? 1, height: comp?.height ?? 1 };
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height), 0, 0);
  const png = await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
  self.postMessage({ type: "snapshot", id, png } satisfies FromWorker, [png]);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      rendererReady = createRenderer(msg.canvas, {
        onError: (message) => post({ type: "error", phase: "render", message: `GPU error: ${message}` }),
        onLost: (message) => post({ type: "error", phase: "lost", message }),
      }).then((r) => (renderer = r));
      return;
    case "resize":
      size = { width: msg.width, height: msg.height };
      (await rendererReady)?.resize(msg.width, msg.height);
      return;
    case "assets":
      for (const [src, bitmap] of msg.bitmaps) assets.set(src, bitmap);
      return;
    case "timings":
      (globalThis as any).__liosVoTimings = msg.timings;
      if (typeof (runtime as any).registerVoTimings === "function") {
        try {
          (runtime as any).registerVoTimings(msg.timings);
        } catch {
          // ignore if format mismatch
        }
      }
      return;
    case "load":
      // loads are applied strictly in the order they were sent
      loading = loading.then(async () => {
        try {
          await load(msg.code, msg.generation);
        } catch (err) {
          post({ type: "error", phase: "load", generation: msg.generation, ...errorOf(err) });
        }
      });
      return;
    case "snapshot":
      try {
        await snapshot(msg.id);
      } catch (err) {
        post({ type: "snapshot", id: msg.id, error: errorOf(err).message });
      }
      return;
    case "render":
      try {
        await render(msg.frame, msg.id);
      } catch (err) {
        post({ type: "error", phase: "render", ...errorOf(err) });
      }
      return;
  }
};

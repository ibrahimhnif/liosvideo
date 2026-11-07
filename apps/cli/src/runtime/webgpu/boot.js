// Lazily exposes WebGPU (deno_webgpu over wgpu) as `navigator.gpu` for the three.js GPU host.
import { loadWebGPU } from "ext:deno_webgpu/00_init.js";
// deno_core requires every extension module to be evaluated at startup; 01_webgpu.js stays lazy
import "ext:deno_webidl/00_webidl.js";
import "ext:deno_console/01_console.js";
import "ext:deno_web/01_dom_exception.js";
import "ext:deno_web/02_event.js";
import "ext:deno_webgpu/02_surface.js";

let ready = false;
globalThis.__liosEnableWebGPU = () => {
  if (ready) return !!globalThis.navigator?.gpu;
  ready = true;
  const webgpu = loadWebGPU();
  webgpu.initGPU();
  globalThis.navigator = { ...(globalThis.navigator ?? {}), gpu: webgpu.gpu, userAgent: "liosvideo" };
  for (const key of Object.keys(webgpu)) if (key.startsWith("GPU")) globalThis[key] = webgpu[key];
  return true;
};

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // pre-bundled up front: a dependency found mid-run makes Vite reload and stall the next test file
  optimizeDeps: {
    include: ["three", "three/webgpu", "three/examples/jsm/loaders/GLTFLoader.js", "three/examples/jsm/loaders/HDRLoader.js"],
  },
  test: {
    include: ["test/gpu/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      // full Chromium ("new headless"): the headless shell breaks WebGPU after a worker presents a frame
      provider: playwright({ launchOptions: { channel: "chromium", args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
  },
});

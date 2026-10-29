import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) } },
  optimizeDeps: {
    include: [
      "vitest-browser-svelte",
      "@lucide/svelte",
      "esbuild-wasm",
      "source-map-js",
      "marked",
      "mediabunny",
      "three",
    ],
  },
  test: {
    include: ["src/**/*.browser.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    browser: {
      enabled: true,
      headless: true,
      // full Chromium ("new headless"): the headless shell breaks WebGPU after a worker presents a frame
      provider: playwright({ launchOptions: { channel: "chromium", args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
  },
});

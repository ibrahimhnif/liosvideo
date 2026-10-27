import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
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

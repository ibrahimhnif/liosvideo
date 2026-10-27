import { describe, expect, it } from "vitest";
import { blockingFailures, type Capabilities } from "./capabilities";

const allTrue: Capabilities = {
  webgpu: true,
  webgpuInWorker: true,
  offscreen2dInWorker: true,
  systemFontInWorker: true,
  videoEncoderH264: true,
  videoDecoderH264: true,
  audioEncoderAAC: true,
};

describe("blockingFailures", () => {
  it("returns nothing when every capability is present", () => {
    expect(blockingFailures(allTrue)).toEqual([]);
  });

  it("reports only the capabilities this plan depends on", () => {
    expect(blockingFailures({ ...allTrue, webgpuInWorker: false, audioEncoderAAC: false })).toEqual([
      "webgpuInWorker",
    ]);
  });
});

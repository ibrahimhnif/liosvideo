import { describe, expect, it } from "vitest";
import { EXPORT_PRESETS, exportPreset } from "./presets";

describe("export presets (same table as the CLI's --preset)", () => {
  it("preview is 720p at a low bitrate: a 60 s video is about 5 MB", () => {
    expect(exportPreset("preview", 1080, 1920)).toMatchObject({ width: 720, height: 1280, bitrate: 600_000, audioBitrate: 96_000 });
    expect(exportPreset("preview", 1920, 1080)).toMatchObject({ width: 1280, height: 720 });
    expect(exportPreset("preview", 640, 360)).toMatchObject({ width: 640, height: 360 });
    const p = exportPreset("preview", 1080, 1920);
    expect(((p.bitrate + p.audioBitrate) * 60) / 8).toBeLessThan(6_000_000);
  });

  it("platform presets", () => {
    expect(exportPreset("tiktok", 1920, 1080)).toMatchObject({ width: 1080, height: 1920, bitrate: 10_000_000, audioBitrate: 192_000 });
    expect(exportPreset("reels", 1920, 1080)).toMatchObject({ width: 1080, height: 1920 });
    expect(exportPreset("youtube", 3840, 2160)).toMatchObject({ width: 1920, height: 1080, bitrate: 12_000_000, audioBitrate: 320_000 });
    expect(exportPreset("youtube", 1080, 1920)).toMatchObject({ width: 1080, height: 1920 });
    expect(exportPreset("native", 1000, 500)).toMatchObject({ width: 1000, height: 500, bitrate: 10_000_000 });
    expect(EXPORT_PRESETS.map((p) => p.id)).toEqual(["native", "1080p", "4k", "shorts", "preview", "tiktok", "reels", "youtube"]);
  });
});

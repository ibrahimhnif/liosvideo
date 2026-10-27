import { describe, expect, it } from "vitest";
import { composition, scene } from "../src/composition";
import { buildManifest } from "../src/manifest";
import { vo } from "../src/audio/timing";

describe("Runtime Audio Model", () => {
  it("includes audio tracks in composition and manifest", () => {
    const comp = composition({
      width: 1920,
      height: 1080,
      fps: 30,
      scenes: [scene("intro", { duration: 5.0 }, () => {})],
      audio: [
        {
          id: "narration",
          name: "Narration",
          clips: [{ src: "assets/audio/vo/line-1.mp3", startFrame: 0, duration: 4.0, volume: 1.0 }],
        },
      ],
    });

    const manifest = buildManifest(comp);
    expect(manifest.audioTracks).toBeDefined();
    expect(manifest.audioTracks?.length).toBe(1);
    expect(manifest.audioTracks?.[0].clips[0].endFrame).toBe(120);
  });

  it("calculates word timestamps with vo() helper", () => {
    const timing = {
      lineId: "line-1",
      duration: 3.0,
      words: [
        { word: "Welcome", start: 0.1, end: 0.6 },
        { word: "to", start: 0.7, end: 0.9 },
        { word: "Liosvideo", start: 1.0, end: 1.8 },
      ],
    };

    const helper = vo("line-1", timing);
    expect(helper.start).toBe(0);
    expect(helper.end).toBe(3.0);
    expect(helper.word("Liosvideo").start).toBe(1.0);
    expect(helper.word("Liosvideo").end).toBe(1.8);
    expect(helper.word("nonexistent").start).toBe(0);
  });
});

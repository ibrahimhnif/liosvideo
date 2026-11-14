import { describe, expect, it } from "vitest";
import { registerVoTimings, vo } from "../src/audio/timing";
import { clipVideo, focusAt } from "../src/components/clip";
import { composition, instantiateScene, scene } from "../src/composition";
import { evaluateFrame } from "../src/evaluate";
import { buildManifest } from "../src/manifest";

registerVoTimings({
  "clip-a": {
    duration: 10,
    src: "assets/audio/clips/clip-a.wav",
    words: [{ word: "Well,", start: 0.2, end: 0.5 }],
    clip: {
      video: "assets/video/talk.mp4",
      from: 812.4,
      to: 822.4,
      focus: [
        { start: 0, end: 4, keys: [[0, 0.3], [4, 0.5]] },
        { start: 4, end: 10, keys: [[4, 0.8]] },
      ],
    },
  },
});

const comp = (s: ReturnType<typeof scene>) => composition({ width: 1080, height: 1920, fps: 30, scenes: [s] });

describe("clips from long videos", () => {
  it("plays a clip's own audio file instead of assets/audio/vo/<id>.mp3", () => {
    const m = buildManifest(comp(scene("c", { vo: ["clip-a"], pad: 0 }, () => {})));
    const clips = m.audioTracks!.flatMap((t) => t.clips);
    expect(clips).toEqual([expect.objectContaining({ src: "assets/audio/clips/clip-a.wav", startFrame: 0, duration: 10, role: "vo" })]);
    expect(vo("clip-a").src).toBe("assets/audio/clips/clip-a.wav");
  });

  it("follows the speaker within a shot and cuts with the shot", () => {
    const f = vo("clip-a").clip!.focus!;
    expect(focusAt(f, 0)).toBeCloseTo(0.3, 9);
    expect(focusAt(f, 2)).toBeCloseTo(0.4, 9);
    expect(focusAt(f, 3.99)).toBeCloseTo(0.4995, 3);
    expect(focusAt(f, 4)).toBe(0.8);
    expect(focusAt(f, 9)).toBe(0.8);
    expect(focusAt([], 1)).toBe(0.5);
  });

  it("adds the long video at the clip's start, covering the frame and panning with the speaker", () => {
    const s = scene("c", { vo: ["clip-a"], pad: 0 }, ({ root, width, height }) => {
      clipVideo(root, "clip-a", { width, height });
    });
    const c = comp(s);
    instantiateScene(c, s);
    const item = (t: number) => evaluateFrame(c, Math.round(t * 30)).items.find((i) => i.kind === "video") as any;
    expect(item(0)).toMatchObject({ src: "assets/video/talk.mp4", width: 1080, height: 1920, fit: "cover", focusX: 0.3 });
    expect(item(0).time).toBeCloseTo(812.4, 6);
    expect(item(2).time).toBeCloseTo(814.4, 6);
    expect(item(2).focusX).toBeCloseTo(0.4, 6);
    expect(item(5).focusX).toBe(0.8);
  });

  it("names the problem when the line is not a clip", () => {
    registerVoTimings({ "plain-vo": { duration: 2, words: [] } });
    const s = scene("p", { vo: ["plain-vo"] }, ({ root }) => {
      clipVideo(root, "plain-vo");
    });
    expect(() => instantiateScene(comp(s), s)).toThrow(/"plain-vo" is not a clip.*video_clip/);
  });
});

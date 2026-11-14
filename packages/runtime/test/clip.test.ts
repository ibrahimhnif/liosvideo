import { describe, expect, it } from "vitest";
import { registerVoTimings, vo } from "../src/audio/timing";
import { registerAttributions } from "../src/assets/attributions";
import { setTextMeasurer, type TextProps } from "../src/graph/kinds";
import { clipShort, clipVideo, focusAt } from "../src/components/clip";
import { creditText } from "../src/components/credit";
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

describe("clipShort", () => {
  registerAttributions(
    "| Asset | Source / URL | Author / Creator | License | Notes / Usage |\n| :--- | :--- | :--- | :--- | :--- |\n" +
      "| `assets/video/podcast.mp4` | https://www.youtube.com/watch?v=x | Ann Lee | YouTube Standard License | clipped with permission |\n" +
      "| `assets/video/cc.mp4` | https://www.youtube.com/watch?v=y | Bob | Creative Commons Attribution license (reuse allowed) | |\n",
  );
  registerVoTimings({
    "short-1": {
      duration: 12,
      src: "assets/video/clips/short-1.mp4",
      words: [
        { word: "Mars", start: 0.5, end: 0.9 },
        { word: "first.", start: 1.0, end: 1.4 },
      ],
      clip: { video: "assets/video/clips/short-1.mp4", from: 0, to: 12, source: { video: "assets/video/podcast.mp4", from: 60, to: 72 } },
    },
  });

  const texts = (c: ReturnType<typeof clipShort>, t: number) => {
    const out: string[] = [];
    const walk = (items: any[]) =>
      items.forEach((i) => (i.kind === "layer" ? walk(i.items) : i.kind === "text" && i.opacity > 0.01 ? out.push(i.text) : null));
    walk(evaluateFrame(c, Math.round(t * c.fps)).items);
    return out.join(" | ");
  };

  it("makes a 9:16 short as long as the clip, with the video, captions, hook title and credit", () => {
    const c = clipShort("short-1", { title: "Why Mars before the Moon?" });
    expect([c.width, c.height, c.fps]).toEqual([1080, 1920, 30]);
    expect(c.scenes).toHaveLength(1);
    expect(c.scenes[0].duration).toBe(12);
    const at = (t: number) => evaluateFrame(c, Math.round(t * 30)).items;
    expect(JSON.stringify(at(1))).toContain('"src":"assets/video/clips/short-1.mp4"');
    expect(texts(c, 0.6)).toContain("Why Mars before the Moon?");
    expect(texts(c, 0.6)).toContain("Mars");
    expect(texts(c, 0.6)).toContain("Video: Ann Lee");
    expect(texts(c, 0.6)).not.toContain("Standard License");
    expect(texts(c, 6)).not.toContain("Why Mars before the Moon?");
  });

  it("sizes the hook card to the wrapped title", () => {
    setTextMeasurer((p: TextProps) => {
      const lines = p.text.split("\n");
      return { width: Math.max(...lines.map((l) => l.length)) * p.fontSize * 0.55, height: lines.length * p.fontSize * p.lineHeight };
    });
    try {
      const c = clipShort("short-1", { title: "Why go to Mars before the Moon, and what would it take?", credit: false, captions: false });
      const find = (items: any[], kind: string): any[] =>
        items.flatMap((i) => (i.kind === "layer" ? find(i.items, kind) : i.kind === kind ? [i] : []));
      const items = evaluateFrame(c, 30).items;
      const title = find(items, "text")[0];
      const card = find(items, "rect")[0];
      const lines = title.text.split("\n").length;
      expect(lines).toBeGreaterThan(1);
      expect(card.height).toBeGreaterThanOrEqual(lines * title.fontSize * title.lineHeight);
    } finally {
      setTextMeasurer(undefined);
    }
  });

  it("leaves out what is turned off", () => {
    const c = clipShort("short-1", { credit: false, captions: false });
    expect(texts(c, 0.6)).toBe("");
  });

  it("credits a reuse licence on screen", () => {
    expect(creditText({ asset: "assets/video/cc.mp4" })).toBe("Video: Bob, Creative Commons Attribution license (reuse allowed)");
    expect(creditText({ asset: "assets/video/podcast.mp4" })).toBe("Video: Ann Lee");
  });
});

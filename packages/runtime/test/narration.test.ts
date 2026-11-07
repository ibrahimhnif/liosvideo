import { describe, expect, it } from "vitest";
import { registerVoTimings } from "../src/audio/timing";
import { composition, instantiateScene, scene, type SceneContext } from "../src/composition";
import { buildManifest } from "../src/manifest";

const words = (list: [string, number, number][]) => list.map(([word, start, end]) => ({ word, start, end }));

registerVoTimings({
  "n-h1": { duration: 3.91, words: words([["Presiden", 0, 0.48], ["ini", 0.53, 0.67], ["diktator", 1.97, 2.38]]) },
  "n-h2": { duration: 2.5, words: words([["Namanya", 0, 0.4], ["Nayib", 0.45, 0.8], ["Bukele,", 0.85, 1.3]]) },
  "n-k1": { duration: 4.2, words: words([["Mantan", 0, 0.3], ["dilantik", 1.2, 1.6]]) },
});

function captured(def: ReturnType<typeof scene>) {
  let ctx!: SceneContext;
  const wrapped = { ...def, build: (c: SceneContext) => ((ctx = c), def.build(c)) };
  instantiateScene(composition({ width: 100, height: 100, fps: 30, scenes: [wrapped] }), wrapped);
  return ctx;
}

describe("scene({ vo })", () => {
  it("derives the duration from its narration lines", () => {
    const s = scene("hook", { vo: ["n-h1", "n-h2"], lead: 0.4, gap: 0.3, tail: 0.35 }, () => {});
    expect(s.duration).toBeCloseTo(0.4 + 3.91 + 0.3 + 2.5 + 0.35, 9);
  });

  it("pads both ends with pad and spaces lines with gap by default", () => {
    const s = scene("k", { vo: ["n-k1"], pad: 0.5 }, () => {});
    expect(s.duration).toBeCloseTo(0.5 + 4.2 + 0.5, 9);
    expect(scene("k2", { vo: ["n-h1", "n-h2"] }, () => {}).duration).toBeCloseTo(0.35 + 3.91 + 0.3 + 2.5 + 0.35, 9);
  });

  it("follows a regenerated line without code changes", () => {
    registerVoTimings({ "n-tmp": { duration: 2, words: [] } });
    const s = scene("t", { vo: ["n-tmp"], pad: 0 }, () => {});
    expect(s.duration).toBe(2);
    registerVoTimings({ "n-tmp": { duration: 3.25, words: [] } });
    expect(scene("t", { vo: ["n-tmp"], pad: 0 }, () => {}).duration).toBe(3.25);
  });

  it("keeps an explicit duration", () => {
    expect(scene("x", { vo: ["n-k1"], duration: 9 }, () => {}).duration).toBe(9);
  });

  it("gives the builder scene-local cue() and word() times", () => {
    const ctx = captured(scene("hook", { vo: ["n-h1", "n-h2"], lead: 0.4, gap: 0.3 }, () => {}));
    expect(ctx.cue("n-h1")).toBeCloseTo(0.4, 9);
    expect(ctx.cue("n-h2")).toBeCloseTo(0.4 + 3.91 + 0.3, 9);
    expect(ctx.word("n-h1", "diktator")).toBeCloseTo(0.4 + 1.97, 9);
    expect(ctx.word("n-h2", "bukele")).toBeCloseTo(0.4 + 3.91 + 0.3 + 0.85, 9);
    expect(ctx.word("n-h2", "nay")).toBeCloseTo(0.4 + 3.91 + 0.3 + 0.45, 9);
    expect(ctx.word("n-h2", 0)).toBeCloseTo(ctx.cue("n-h2"), 9);
  });

  it("names the problem when a line or word is not there", () => {
    const ctx = captured(scene("hook", { vo: ["n-h1"] }, () => {}));
    expect(() => ctx.cue("n-k1")).toThrow(/"n-k1" is not narrated in scene "hook".*n-h1/);
    expect(() => ctx.word("n-h1", "presidennya")).toThrow(/no word "presidennya" in VO line "n-h1".*Presiden, ini, diktator/);
    expect(() => ctx.word("n-h1", 7)).toThrow(/word 7/);
  });

  it("uses a 2.5 s stand-in for a line that has not been generated yet", () => {
    const s = scene("draft", { vo: ["n-missing"], pad: 0 }, () => {});
    expect(s.duration).toBe(2.5);
    const ctx = captured(s);
    expect(ctx.word("n-missing", "anything")).toBe(0);
  });
});

describe("narration audio", () => {
  const hook = scene("hook", { vo: ["n-h1", "n-h2"], lead: 0.4, gap: 0.3, tail: 0.35 }, () => {});
  const karier = scene("karier", { vo: ["n-k1"], pad: 0.35 }, () => {});

  it("places each line at its scene's start plus its cue", () => {
    const m = buildManifest(composition({ width: 100, height: 100, fps: 30, scenes: [hook, karier] }));
    const clips = m.audioTracks!.flatMap((t) => t.clips);
    expect(clips.map((c) => [c.src, c.startFrame, c.role])).toEqual([
      ["assets/audio/vo/n-h1.mp3", 12, "vo"],
      ["assets/audio/vo/n-h2.mp3", Math.round((0.4 + 3.91 + 0.3) * 30), "vo"],
      ["assets/audio/vo/n-k1.mp3", m.scenes[1].startFrame + Math.round(0.35 * 30), "vo"],
    ]);
    expect(clips[0].endFrame - clips[0].startFrame).toBe(Math.round(3.91 * 30));
  });

  it("leaves lines the composition already lists, and stops with narration: false", () => {
    const listed = composition({
      width: 100,
      height: 100,
      fps: 30,
      scenes: [hook],
      audio: [{ id: "h1", src: "assets/audio/vo/n-h1.mp3", startAt: 0.4 }],
    });
    expect(buildManifest(listed).audioTracks!.flatMap((t) => t.clips).map((c) => c.src)).toEqual([
      "assets/audio/vo/n-h1.mp3",
      "assets/audio/vo/n-h2.mp3",
    ]);
    const off = buildManifest(composition({ width: 100, height: 100, fps: 30, scenes: [hook], narration: false }));
    expect(off.audioTracks).toBeUndefined();
  });

  it("sets the narration volume", () => {
    const m = buildManifest(composition({ width: 100, height: 100, fps: 30, scenes: [karier], narration: { volume: 0.9 } }));
    expect(m.audioTracks![0].clips[0].volume).toBe(0.9);
  });

  it("skips lines that have no audio yet", () => {
    const draft = scene("draft", { vo: ["n-missing"] }, () => {});
    expect(buildManifest(composition({ width: 100, height: 100, fps: 30, scenes: [draft] })).audioTracks).toBeUndefined();
  });
});

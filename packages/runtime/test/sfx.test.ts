import { describe, expect, it } from "vitest";
import { composition, scene } from "../src/composition";
import { rect } from "../src/graph/kinds";
import { three } from "../src/graph/three";
import { registerAttributions } from "../src/assets/attributions";
import { buildManifest } from "../src/manifest";
import { cameraPath, dolly, orbit } from "../src/three/camera_path";

const intro = scene("intro", { duration: 2 }, () => {});

function sfxClips(c: Parameters<typeof buildManifest>[0]) {
  return (buildManifest(c).audioTracks ?? []).flatMap((t) => t.clips.filter((clip) => clip.role === "sfx").map((clip) => ({ id: t.id, ...clip })));
}

describe("motion-synced SFX", () => {
  it("places a camera move's whoosh at the move's start, after earlier scenes", () => {
    const shot = scene("shot", { duration: 4 }, ({ root }) => {
      root.add(three({ name: "stage", setup() {}, cameraPath: dolly({ from: [-3, 1, 6], to: [3, 1, 6], target: [0, 0, 0], start: 0.5, end: 2.5, sfx: "whoosh" }) }));
    });
    const c = composition({ width: 640, height: 360, fps: 30, scenes: [intro, shot] });
    const clips = sfxClips(c);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ src: "assets/audio/sfx/whoosh.wav", startFrame: 60 + 15, role: "sfx", volume: 0.5 });
    expect(sfxClips(c)).toEqual(clips); // deterministic
  });

  it("finds a downloaded sound by name whatever its extension, from its attribution row", () => {
    registerAttributions(`| Asset | Source / URL | Author / Creator | License | Notes / Usage |
| :--- | :--- | :--- | :--- | :--- |
| \`assets/audio/sfx/whoosh.mp3\` | https://freesound.org/people/qubodup/sounds/60026 | qubodup | CC0 | via Openverse |
| \`assets/audio/sfx/pop.ogg\` | https://example.org/pop | x | CC0 | |
| \`assets/audio/sfx/pop.wav\` | https://github.com/Leonxlnx/earshot | earshot (made in code) | MIT | |
| \`assets/audio/sfx/deep/hit.mp3\` | https://example.org/hit | x | CC0 | |
`);
    try {
      const shot = scene("shot", { duration: 3 }, ({ root }) => {
        const card = root.add(rect({ name: "card" }));
        card.to({ x: 100 }, { at: 1, duration: 0.5, sfx: "whoosh" });
        card.to({ x: 0 }, { at: 1.5, duration: 0.5, sfx: "pop" });
        card.to({ x: 50 }, { at: 2, duration: 0.5, sfx: "hit" });
      });
      const clips = sfxClips(composition({ width: 100, height: 100, fps: 30, scenes: [shot] }));
      expect(clips.map((c) => c.src)).toEqual(["assets/audio/sfx/whoosh.mp3", "assets/audio/sfx/pop.wav", "assets/audio/sfx/hit.wav"]);
    } finally {
      registerAttributions("");
    }
  });

  it("places keyframe SFX at the start or the end of the move", () => {
    const shot = scene("shot", { duration: 3 }, ({ root }) => {
      const card = root.add(rect({ name: "card" }));
      card.to({ x: 100 }, { at: 1, duration: 0.5, sfx: "swoosh" });
      card.to({ scaleX: 1.2 }, { at: 2, duration: 0.4, sfx: { name: "pop", on: "end", volume: 0.3 } });
    });
    const clips = sfxClips(composition({ width: 100, height: 100, fps: 30, scenes: [shot] }));
    expect(clips.map((c) => [c.src, c.startFrame, c.volume])).toEqual([
      ["assets/audio/sfx/swoosh.wav", 30, 0.5],
      ["assets/audio/sfx/pop.wav", 72, 0.3],
    ]);
  });

  it("fires key SFX when the camera leaves that key, and preset SFX on end", () => {
    const shot = scene("shot", { duration: 6 }, ({ root }) => {
      root.add(
        three({
          name: "a",
          setup() {},
          cameraPath: cameraPath([
            { at: 0, position: [0, 0, 5] },
            { at: 2, position: [3, 0, 5], sfx: "whoosh" },
            { at: 4, position: [3, 2, 5] },
          ]),
        }),
      );
      root.add(three({ name: "b", setup() {}, cameraPath: orbit({ target: [0, 0, 0], radius: 5, from: 0, to: 1, start: 1, end: 3, sfx: { name: "impact", on: "end" } }) }));
    });
    const clips = sfxClips(composition({ width: 100, height: 100, fps: 10, scenes: [shot] }));
    expect(clips.map((c) => [c.src, c.startFrame])).toEqual([
      ["assets/audio/sfx/whoosh.wav", 20],
      ["assets/audio/sfx/impact.wav", 30],
    ]);
  });

  it("takes files and levels from the composition's SFX library, and fades each clip", () => {
    const shot = scene("shot", { duration: 3 }, ({ root }) => {
      const card = root.add(rect({ name: "card" }));
      card.to({ x: 1 }, { at: 0, duration: 1, sfx: "whoosh" });
      card.to({ x: 2 }, { at: 1, duration: 1, sfx: { name: "whoosh", volume: 0.9, duration: 0.6 } });
      card.to({ x: 3 }, { at: 2, duration: 1, sfx: "assets/audio/hit.mp3" });
    });
    const c = composition({
      width: 100,
      height: 100,
      fps: 30,
      scenes: [shot],
      sfx: { volume: 0.7, library: { whoosh: { src: "assets/audio/sfx/whoosh_fast.wav", volume: 0.4 } } },
    });
    const clips = sfxClips(c);
    expect(clips.map((x) => [x.src, x.volume, x.duration])).toEqual([
      ["assets/audio/sfx/whoosh_fast.wav", 0.4, undefined],
      ["assets/audio/sfx/whoosh_fast.wav", 0.9, 0.6],
      ["assets/audio/hit.mp3", 0.7, undefined],
    ]);
    expect(clips[0]).toMatchObject({ fadeIn: 0.005, fadeOut: 0.03 });
    expect(clips[1]).toMatchObject({ fadeOut: 0.12, endFrame: 30 + 18 }); // trimmed: a longer fade
  });

  it("can be turned off, and checks `on`", () => {
    const shot = scene("shot", { duration: 1 }, ({ root }) => {
      root.add(rect({ name: "card" })).to({ x: 1 }, { at: 0, duration: 1, sfx: "whoosh" });
    });
    expect(sfxClips(composition({ width: 1, height: 1, fps: 30, scenes: [shot], sfx: false }))).toEqual([]);
    expect(() => rect({ name: "card" }).to({ x: 1 }, { at: 0, duration: 1, sfx: { name: "pop", on: "middle" as any } })).toThrow(/on "middle".*start, end/);
  });
});

describe("clip fades", () => {
  it("plans a fade in from silence and out to silence over the played span", async () => {
    const { fadePlan, fadeGainAt } = await import("../src/audio/mix");
    const plan = fadePlan(2, 1, 0.1, 0.2);
    expect(plan).toEqual([[2, 0], [2.1, 1], [2.8, 1], [3, 0]]);
    expect(fadeGainAt(plan, 1)).toBe(0);
    expect(fadeGainAt(plan, 2.05)).toBeCloseTo(0.5);
    expect(fadeGainAt(plan, 2.5)).toBe(1);
    expect(fadeGainAt(plan, 2.9)).toBeCloseTo(0.5);
    expect(fadeGainAt(plan, 4)).toBe(0);
    expect(fadePlan(2, 1)).toEqual([]);
    expect(fadeGainAt([], 5)).toBe(1);
  });
});

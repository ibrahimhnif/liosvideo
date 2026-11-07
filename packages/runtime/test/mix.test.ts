import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIX,
  duckGainAt,
  duckPlan,
  duckSchedule,
  isVoice,
  limit,
  master,
  measureLoudness,
  resolveMix,
  shouldDuck,
} from "../src/audio/mix";

const SR = 48000;

function sine(seconds: number, amplitude: number, hz = 1000): [Float32Array, Float32Array] {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return [l, l.slice()];
}

describe("measureLoudness (BS.1770)", () => {
  it("reads a -20 dBFS stereo 1 kHz sine as about -20 LUFS", () => {
    expect(measureLoudness(sine(5, 0.1), SR)).toBeCloseTo(-20, 0);
  });

  it("is 6 dB louder at twice the amplitude", () => {
    const a = measureLoudness(sine(5, 0.1), SR);
    const b = measureLoudness(sine(5, 0.2), SR);
    expect(b - a).toBeCloseTo(6.02, 1);
  });

  it("gates silence out instead of averaging it in", () => {
    const [l, r] = sine(4, 0.1);
    const padded = [new Float32Array(SR * 8), new Float32Array(SR * 8)];
    padded[0].set(l);
    padded[1].set(r);
    expect(measureLoudness(padded, SR)).toBeCloseTo(-20, 0);
  });

  it("returns -Infinity for silence", () => {
    expect(measureLoudness([new Float32Array(SR), new Float32Array(SR)], SR)).toBe(-Infinity);
  });
});

describe("limit", () => {
  it("keeps every sample under the ceiling", () => {
    const ch = sine(1, 1.5);
    limit(ch, SR, -1);
    const ceiling = 10 ** (-1 / 20);
    for (const c of ch) for (const s of c) expect(Math.abs(s)).toBeLessThanOrEqual(ceiling + 1e-6);
  });

  it("leaves audio under the ceiling untouched", () => {
    const ch = sine(1, 0.5);
    const before = ch[0].slice();
    limit(ch, SR, -1);
    expect(ch[0]).toEqual(before);
  });

  it("ramps gain in before a peak instead of stepping", () => {
    const n = SR;
    const l = new Float32Array(n).fill(0.5);
    l[SR / 2] = 2;
    const ch = [l, l.slice()];
    limit(ch, SR, -1);
    // a few ms before the spike the gain is already easing down, not jumping
    const before = ch[0][SR / 2 - 120];
    expect(before).toBeLessThan(0.5);
    expect(before).toBeGreaterThan(0.3);
  });
});

describe("ducking", () => {
  it("knows voice-over by role or by living in assets/audio/vo", () => {
    expect(isVoice({ src: "assets/audio/vo/h1.mp3" })).toBe(true);
    expect(isVoice({ src: "x.mp3", role: "vo" })).toBe(true);
    expect(isVoice({ src: "assets/audio/music/bed.mp3" })).toBe(false);
  });

  it("ducks music beds but not short SFX or voice", () => {
    expect(shouldDuck({ src: "assets/audio/music/bed.mp3" }, 60)).toBe(true);
    expect(shouldDuck({ src: "assets/audio/music/whoosh.mp3" }, 0.8)).toBe(false);
    expect(shouldDuck({ src: "assets/audio/music/hit.mp3", ducking: true }, 0.8)).toBe(true);
    expect(shouldDuck({ src: "assets/audio/music/bed.mp3", ducking: false }, 60)).toBe(false);
    expect(shouldDuck({ src: "assets/audio/music/x.mp3", role: "sfx" }, 60)).toBe(false);
    expect(shouldDuck({ src: "assets/audio/vo/a.mp3" }, 60)).toBe(false);
  });

  it("treats files named sfx as effects even when they run the whole video", () => {
    expect(shouldDuck({ src: "assets/audio/music/sfx.wav" }, 60)).toBe(false);
    expect(shouldDuck({ src: "assets/audio/sfx/hits.wav" }, 60)).toBe(false);
    expect(shouldDuck({ src: "assets/audio/music/sfx-bed.wav", role: "music" }, 60)).toBe(true);
  });

  it("dips before each line, holds through short gaps and recovers after", () => {
    const plan = duckPlan([[2, 4], [4.3, 6], [10, 11]], DEFAULT_MIX.duck);
    const low = 10 ** (-12 / 20);
    expect(duckGainAt(plan, 0)).toBe(1);
    expect(duckGainAt(plan, 1.925)).toBeCloseTo((1 + low) / 2, 5); // halfway down the 0.15 s attack
    expect(duckGainAt(plan, 3)).toBeCloseTo(low, 6);
    expect(duckGainAt(plan, 4.15)).toBeCloseTo(low, 6); // 0.3 s gap is held, no pumping
    expect(duckGainAt(plan, 6.4)).toBeCloseTo(1, 6);
    expect(duckGainAt(plan, 8)).toBe(1);
    expect(duckGainAt(plan, 10.5)).toBeCloseTo(low, 6);
  });

  it("does nothing when ducking is off", () => {
    expect(duckPlan([[1, 2]], false)).toEqual([]);
  });
});

describe("resolveMix", () => {
  it("defaults to -14 LUFS, -1 dB ceiling and -12 dB ducking", () => {
    expect(resolveMix(undefined)).toEqual(DEFAULT_MIX);
    expect(DEFAULT_MIX).toMatchObject({ loudness: -14, ceiling: -1, duck: { amount: 12, attack: 0.15, release: 0.4 } });
  });

  it("lets a composition turn either off or override values", () => {
    expect(resolveMix({ loudness: false, duck: false })).toMatchObject({ loudness: false, duck: false });
    expect(resolveMix({ duck: { amount: 18 } }).duck).toEqual({ amount: 18, attack: 0.15, release: 0.4 });
  });
});

describe("master", () => {
  it("brings a -20 LUFS mix to -14 LUFS without passing the ceiling", () => {
    const ch = sine(6, 0.1);
    const report = master(ch, SR, DEFAULT_MIX);
    expect(report.measured).toBeCloseTo(-20, 0);
    expect(Math.abs(report.final + 14)).toBeLessThan(0.5);
    expect(report.peak).toBeLessThanOrEqual(-1 + 1e-4);
  });

  it("only limits when loudness normalisation is off", () => {
    const ch = sine(2, 0.1);
    const report = master(ch, SR, resolveMix({ loudness: false }));
    expect(report.gain).toBe(0);
    expect(report.final).toBeCloseTo(report.measured, 6);
  });
});

describe("duckSchedule", () => {
  it("builds the dip from voice clips and marks which clips follow it", () => {
    const { plan, ducked } = duckSchedule(
      [
        { src: "assets/audio/music/bed.mp3", start: 0, played: 30 },
        { src: "assets/audio/vo/a.mp3", start: 2, played: 2 },
        { src: "assets/audio/music/whoosh.mp3", start: 1, played: 0.5 },
        { src: "lines/b.mp3", role: "vo", start: 10, played: 1 },
      ],
      DEFAULT_MIX.duck,
    );
    expect(ducked).toEqual([true, false, false, false]);
    expect(plan.map(([t]) => t)).toEqual([1.85, 2, 4, 4.4, 9.85, 10, 11, 11.4]);
  });

  it("ducks nothing without voice-over", () => {
    const { plan, ducked } = duckSchedule([{ src: "assets/audio/music/bed.mp3", start: 0, played: 30 }], DEFAULT_MIX.duck);
    expect(plan).toEqual([]);
    expect(ducked).toEqual([false]);
  });
});

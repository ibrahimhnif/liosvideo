import type { TimelineManifest } from "liosvideo";
import { measureLoudness } from "liosvideo";
import { describe, expect, it } from "vitest";
import { mixdownAudio } from "./audio_mixdown";

class MockOfflineAudioContext {
  destination = {};
  scheduled: any[] = [];

  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}

  createBufferSource() {
    const s = {
      buffer: null,
      startedAt: null as number | null,
      offset: null as number | null,
      duration: null as number | null,
      connect: () => {},
      start: (when = 0, offset = 0, duration?: number) => {
        s.startedAt = when;
        s.offset = offset;
        s.duration = duration ?? null;
      },
    };
    this.scheduled.push(s);
    return s as any;
  }

  gains: any[] = [];
  createGain() {
    const g = {
      gain: {
        value: 1,
        events: [] as Array<[string, number, number]>,
        setValueAtTime(v: number, t: number) {
          g.gain.events.push(["set", v, t]);
        },
        linearRampToValueAtTime(v: number, t: number) {
          g.gain.events.push(["ramp", v, t]);
        },
      },
      connect: () => {},
    };
    this.gains.push(g);
    return g as any;
  }

  /** what startRendering returns: a 1 kHz sine at -20 LUFS unless replaced */
  rendered: Float32Array[] | null = null;

  decodedDuration = 3.0;
  async decodeAudioData(_raw: ArrayBuffer) {
    return { duration: this.decodedDuration, length: 144000, numberOfChannels: 2, sampleRate: 48000 } as any;
  }

  async startRendering() {
    const data = this.rendered ?? [new Float32Array(this.length), new Float32Array(this.length)];
    return {
      duration: this.length / this.sampleRate,
      length: this.length,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate,
      getChannelData: (i: number) => data[i],
    } as any;
  }
}

describe("mixdownAudio", () => {
  it("returns null when composition has no audio tracks", async () => {
    const manifest: TimelineManifest = {
      width: 1920,
      height: 1080,
      fps: 30,
      totalFrames: 90,
      scenes: [],
    };

    const res = await mixdownAudio(manifest, async () => new ArrayBuffer(0));
    expect(res).toBeNull();
  });

  it("mixes clips onto timeline accurately", async () => {
    const manifest: TimelineManifest = {
      width: 1920,
      height: 1080,
      fps: 30,
      totalFrames: 90, // 3 seconds
      scenes: [],
      audioTracks: [
        {
          id: "vo",
          name: "Narration",
          clips: [
            {
              src: "assets/audio/vo/line-1.mp3",
              startFrame: 30, // 1.0 second
              endFrame: 90,
              duration: 2.0,
              startOffset: 0.5,
              volume: 0.9,
            },
          ],
        },
      ],
    };

    let mockCtx: any = null;
    const res = await mixdownAudio(
      manifest,
      async () => new ArrayBuffer(16),
      {
        sampleRate: 48000,
        createContext: (channels, length, sampleRate) => {
          mockCtx = new MockOfflineAudioContext(channels, length, sampleRate);
          return mockCtx as any;
        },
      },
    );

    expect(res).toBeDefined();
    expect(res?.sampleRate).toBe(48000);
    expect(res?.length).toBe(90 / 30 * 48000); // 144000 samples
    expect(mockCtx?.scheduled.length).toBe(1);
    expect(mockCtx?.scheduled[0].startedAt).toBeCloseTo(1.0);
    expect(mockCtx?.scheduled[0].offset).toBeCloseTo(0.5);
    expect(mockCtx?.scheduled[0].duration).toBeCloseTo(2.0);
  });
});

const base = { width: 1920, height: 1080, fps: 30, scenes: [] };

describe("mixdownAudio mix bus", () => {
  it("ducks a music bed under voice-over with gain ramps", async () => {
    const manifest: TimelineManifest = {
      ...base,
      totalFrames: 600, // 20 s
      audioTracks: [
        { id: "bgm", name: "bgm", clips: [{ src: "assets/audio/music/bed.mp3", startFrame: 0, endFrame: 600, volume: 0.5 }] },
        { id: "vo", name: "vo", clips: [{ src: "assets/audio/vo/a.mp3", startFrame: 60, endFrame: 150, duration: 3 }] },
      ],
    };
    let ctx: any = null;
    await mixdownAudio(manifest, async () => new ArrayBuffer(16), {
      createContext: (c, l, sr) => {
        ctx = new MockOfflineAudioContext(c, l, sr);
        ctx.decodedDuration = 20;
        return ctx;
      },
    });
    const [bed, vo] = ctx.gains;
    const low = 0.5 * 10 ** (-12 / 20);
    expect(bed.gain.events[0]).toEqual(["set", 0.5, 0]);
    expect(bed.gain.events.slice(1).map(([k, v, t]: any) => [k, +v.toFixed(4), +t.toFixed(2)])).toEqual([
      ["ramp", 0.5, 1.85],
      ["ramp", +low.toFixed(4), 2],
      ["ramp", +low.toFixed(4), 5],
      ["ramp", 0.5, 5.4],
    ]);
    expect(vo.gain.events).toEqual([]);
    expect(vo.gain.value).toBe(1);
  });

  it("normalises the rendered mix to -14 LUFS", async () => {
    const manifest: TimelineManifest = {
      ...base,
      totalFrames: 150,
      audioTracks: [{ id: "vo", name: "vo", clips: [{ src: "assets/audio/vo/a.mp3", startFrame: 0, endFrame: 150 }] }],
    };
    const res = await mixdownAudio(manifest, async () => new ArrayBuffer(16), {
      createContext: (c, l, sr) => {
        const ctx = new MockOfflineAudioContext(c, l, sr);
        const sine = new Float32Array(l).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sr));
        ctx.rendered = [sine, sine.slice()];
        return ctx as any;
      },
    });
    const out = [res!.getChannelData(0), res!.getChannelData(1)];
    expect(Math.abs(measureLoudness(out, 48000) + 14)).toBeLessThan(0.5);
  });

  it("keeps the raw level when the composition turns loudness off", async () => {
    const manifest: TimelineManifest = {
      ...base,
      totalFrames: 150,
      mix: { loudness: false },
      audioTracks: [{ id: "vo", name: "vo", clips: [{ src: "assets/audio/vo/a.mp3", startFrame: 0, endFrame: 150 }] }],
    };
    const res = await mixdownAudio(manifest, async () => new ArrayBuffer(16), {
      createContext: (c, l, sr) => {
        const ctx = new MockOfflineAudioContext(c, l, sr);
        ctx.rendered = [new Float32Array(l).fill(0.25), new Float32Array(l).fill(0.25)];
        return ctx as any;
      },
    });
    expect(res!.getChannelData(0)[100]).toBe(0.25);
  });
});

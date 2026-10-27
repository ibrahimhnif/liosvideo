import type { TimelineManifest } from "liosvideo";
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

  createGain() {
    return {
      gain: { value: 1 },
      connect: () => {},
    } as any;
  }

  async decodeAudioData(_raw: ArrayBuffer) {
    return { duration: 3.0, length: 144000, numberOfChannels: 2, sampleRate: 48000 } as any;
  }

  async startRendering() {
    return {
      duration: this.length / this.sampleRate,
      length: this.length,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate,
      getChannelData: () => new Float32Array(this.length),
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

    let mockCtx: MockOfflineAudioContext | null = null;
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer, type AudioClipDef } from "./audio_player";

class MockBufferSource {
  buffer: any = null;
  startedAt: number | null = null;
  offset: number | null = null;
  stoppedAt: number | null = null;
  connectedTo: any = null;

  connect(target: any) {
    this.connectedTo = target;
  }
  start(when = 0, offset = 0) {
    this.startedAt = when;
    this.offset = offset;
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
  disconnect() {}
}

class MockGain {
  gain = { value: 1 };
  connectedTo: any = null;
  connect(target: any) {
    this.connectedTo = target;
  }
  disconnect() {}
}

class MockAudioContext {
  currentTime = 10;
  destination = {};
  createdSources: MockBufferSource[] = [];
  createdGains: MockGain[] = [];

  createBufferSource() {
    const s = new MockBufferSource();
    this.createdSources.push(s);
    return s as any;
  }

  createGain() {
    const g = new MockGain();
    this.createdGains.push(g);
    return g as any;
  }

  async decodeAudioData(_buffer: ArrayBuffer) {
    return { duration: 5.0, length: 220500, numberOfChannels: 2, sampleRate: 44100 } as any;
  }

  async resume() {}
  async close() {}
}

describe("AudioPlayer", () => {
  let mockCtx: MockAudioContext;
  let player: AudioPlayer;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    player = new AudioPlayer({
      createContext: () => mockCtx as any,
      loadBuffer: async () => new ArrayBuffer(8),
    });
  });

  it("loads and schedules clips upon play()", async () => {
    const clips: AudioClipDef[] = [
      {
        src: "audio/vo.mp3",
        startFrame: 30, // at 30fps = 1.0s
        endFrame: 120, // 4.0s
        duration: 3.0,
        volume: 0.8,
      },
    ];

    await player.setClips(clips);
    player.play(0, 30); // start at frame 0 (time 0s)

    expect(mockCtx.createdSources.length).toBe(1);
    const src = mockCtx.createdSources[0];
    // currentTime is 10, startFrame is 30 (1s), so when should be 10 + 1 = 11
    expect(src.startedAt).toBeCloseTo(11.0);
    expect(src.offset).toBeCloseTo(0);
    expect(mockCtx.createdGains[0].gain.value).toBe(0.8);
  });

  it("calculates offset when playback starts mid-clip", async () => {
    const clips: AudioClipDef[] = [
      {
        src: "audio/vo.mp3",
        startFrame: 0,
        endFrame: 90, // 3.0s
        duration: 3.0,
      },
    ];

    await player.setClips(clips);
    player.play(30, 30); // frame 30 = 1.0s into the clip

    expect(mockCtx.createdSources.length).toBe(1);
    const src = mockCtx.createdSources[0];
    expect(src.startedAt).toBeCloseTo(10.0); // starts immediately
    expect(src.offset).toBeCloseTo(1.0); // 1.0s into clip
  });

  it("stops sources when paused", async () => {
    const clips: AudioClipDef[] = [
      {
        src: "audio/vo.mp3",
        startFrame: 0,
        endFrame: 90,
        duration: 3.0,
      },
    ];

    await player.setClips(clips);
    player.play(0, 30);
    expect(mockCtx.createdSources.length).toBe(1);

    player.pause();
    expect(mockCtx.createdSources[0].stoppedAt).toBeDefined();
  });

  it("reschedules sources when seeked while playing", async () => {
    const clips: AudioClipDef[] = [
      {
        src: "audio/vo.mp3",
        startFrame: 0,
        endFrame: 90,
        duration: 3.0,
      },
    ];

    await player.setClips(clips);
    player.play(0, 30);
    expect(mockCtx.createdSources.length).toBe(1);

    mockCtx.currentTime = 12;
    player.seek(45, 30); // seek to 1.5s
    expect(mockCtx.createdSources[0].stoppedAt).toBeDefined(); // previous stopped
    expect(mockCtx.createdSources.length).toBe(2); // new source started
    expect(mockCtx.createdSources[1].offset).toBeCloseTo(1.5);
  });

  it("plays clips with undefined duration or endFrame by inferring from decoded buffer", async () => {
    // In many composition files, duration & endFrame are omitted or 0
    const clips: AudioClipDef[] = [
      {
        src: "audio/vo.mp3",
        startFrame: 0,
        endFrame: 0, // was 0 before buffer decode!
      },
    ];

    await player.setClips(clips);
    player.play(0, 30);

    // Mock decodeAudioData returned duration: 5.0s
    expect(mockCtx.createdSources.length).toBe(1);
    const src = mockCtx.createdSources[0];
    expect(src.startedAt).toBeCloseTo(10.0);
    expect(src.offset).toBeCloseTo(0);
  });

  it("invalidates cached buffers so subsequent setClips re-fetches", async () => {
    let loadCount = 0;
    const testPlayer = new AudioPlayer({
      createContext: () => mockCtx as any,
      loadBuffer: async () => {
        loadCount++;
        return new ArrayBuffer(8);
      },
    });

    const clips: AudioClipDef[] = [{ src: "audio/vo.mp3", startFrame: 0, endFrame: 30 }];
    await testPlayer.setClips(clips);
    expect(loadCount).toBe(1);

    // Calling setClips again with same clips shouldn't re-load
    await testPlayer.setClips(clips);
    expect(loadCount).toBe(1);

    // Invalidate the src
    testPlayer.invalidate("audio/vo.mp3");
    await testPlayer.setClips(clips);
    expect(loadCount).toBe(2);

    // Invalidate all via clearCache
    testPlayer.clearCache();
    await testPlayer.setClips(clips);
    expect(loadCount).toBe(3);

    // forceReload in setClips
    await testPlayer.setClips(clips, true);
    expect(loadCount).toBe(4);
  });
});

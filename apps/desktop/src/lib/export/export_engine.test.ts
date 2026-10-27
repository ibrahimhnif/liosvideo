import { beforeEach, describe, expect, it } from "vitest";
import { ExportEngine, type ExportConfig } from "./export_engine";

class MockCanvasSource {
  frames: Array<{ timestamp: number; duration: number }> = [];
  constructor(
    public canvas: any,
    public config: any,
  ) {}

  async add(timestamp: number, duration: number) {
    this.frames.push({ timestamp, duration });
  }
}

class MockAudioBufferSource {
  buffers: any[] = [];
  constructor(public config: any) {}

  async add(buffer: any) {
    this.buffers.push(buffer);
  }
}

class MockOutput {
  tracks: any[] = [];
  started = false;
  finalized = false;
  cancelled = false;

  constructor(public opts: { format: any; target: any }) {}

  addVideoTrack(track: any) {
    this.tracks.push({ type: "video", track });
  }

  addAudioTrack(track: any) {
    this.tracks.push({ type: "audio", track });
  }

  async start() {
    this.started = true;
  }

  async cancel() {
    this.cancelled = true;
  }

  async finalize() {
    this.finalized = true;
    this.opts.target.buffer = new Uint8Array([1, 2, 3, 4]).buffer;
  }
}

class MockBufferTarget {
  buffer: ArrayBuffer | null = null;
}

class MockMp4OutputFormat {
  constructor(public opts?: any) {}
}

class MockQuality {
  constructor(public opts?: any) {}
}

describe("ExportEngine", () => {
  let engine: ExportEngine;
  let mockOutputInstance: MockOutput | null = null;
  let mockCanvasSourceInstance: MockCanvasSource | null = null;

  const config: ExportConfig = {
    width: 1920,
    height: 1080,
    fps: 30,
    totalFrames: 10,
    bitrate: 8_000_000,
  };

  beforeEach(() => {
    mockOutputInstance = null;
    mockCanvasSourceInstance = null;

    engine = new ExportEngine(config, {
      OutputClass: class extends MockOutput {
        constructor(opts: any) {
          super(opts);
          mockOutputInstance = this;
        }
      } as any,
      CanvasSourceClass: class extends MockCanvasSource {
        constructor(canvas: any, cfg: any) {
          super(canvas, cfg);
          mockCanvasSourceInstance = this;
        }
      } as any,
      AudioBufferSourceClass: MockAudioBufferSource as any,
      BufferTargetClass: MockBufferTarget as any,
      Mp4OutputFormatClass: MockMp4OutputFormat as any,
      QualityClass: MockQuality as any,
    });
  });

  it("encodes all frames and reports progress", async () => {
    const progressUpdates: number[] = [];
    const fakeCanvas = { width: 1920, height: 1080 } as any;

    const result = await engine.export(
      async () => fakeCanvas,
      null,
      (pct) => progressUpdates.push(pct),
    );

    expect(result).toBeInstanceOf(Uint8Array);
    expect(mockOutputInstance?.started).toBe(true);
    expect(mockOutputInstance?.finalized).toBe(true);
    expect(mockCanvasSourceInstance?.frames.length).toBe(10);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });

  it("can be cancelled mid-export", async () => {
    const fakeCanvas = { width: 1920, height: 1080 } as any;

    const exportPromise = engine.export(
      async (f) => {
        if (f === 3) {
          engine.cancel();
        }
        return fakeCanvas;
      },
      null,
    );

    await expect(exportPromise).rejects.toThrow("Export cancelled");
    expect(mockOutputInstance?.cancelled).toBe(true);
  });

  it("encodes audio buffer when provided", async () => {
    const fakeCanvas = { width: 1920, height: 1080 } as any;
    const fakeAudioBuffer = { duration: 2.5 } as any;

    const result = await engine.export(
      async () => fakeCanvas,
      fakeAudioBuffer,
    );

    expect(result).toBeInstanceOf(Uint8Array);
    expect(mockOutputInstance?.tracks.some((t) => t.type === "audio")).toBe(true);
  });
});

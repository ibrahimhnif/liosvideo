import { beforeEach, describe, expect, it } from "vitest";
import { ExportEngine, type ExportConfig } from "./export_engine";

class MockMuxer {
  videoChunks: any[] = [];
  audioChunks: any[] = [];
  finalized = false;

  constructor(public opts: any) {}

  addVideoChunk(chunk: any, meta: any) {
    this.videoChunks.push({ chunk, meta });
  }

  addAudioChunk(chunk: any, meta: any) {
    this.audioChunks.push({ chunk, meta });
  }

  finalize() {
    this.finalized = true;
    (this.opts.target as any).buffer = new Uint8Array([1, 2, 3, 4]).buffer;
  }
}

class MockVideoEncoder {
  state: "configured" | "closed" = "configured";
  encodedFrames: any[] = [];
  output: (chunk: any, meta: any) => void;

  constructor(init: any) {
    this.output = init.output;
  }

  configure(_config: any) {}

  encode(frame: any, opts?: any) {
    this.encodedFrames.push({ frame, opts });
    this.output({ data: "chunk", timestamp: frame.timestamp }, { keyFrame: opts?.keyFrame });
  }

  async flush() {}
  close() {
    this.state = "closed";
  }
}

class MockVideoFrame {
  constructor(
    public source: any,
    public init: { timestamp: number; duration: number },
  ) {}
  get timestamp() {
    return this.init.timestamp;
  }
  close() {}
}

describe("ExportEngine", () => {
  let engine: ExportEngine;
  let mockMuxerInstance: MockMuxer | null = null;

  const config: ExportConfig = {
    width: 1920,
    height: 1080,
    fps: 30,
    totalFrames: 10,
    bitrate: 8_000_000,
  };

  beforeEach(() => {
    engine = new ExportEngine(config, {
      VideoEncoder: MockVideoEncoder as any,
      VideoFrame: MockVideoFrame as any,
      MuxerClass: class extends MockMuxer {
        constructor(opts: any) {
          super(opts);
          mockMuxerInstance = this;
        }
      } as any,
    });
  });

  it("encodes all frames and reports progress", async () => {
    const progressUpdates: number[] = [];
    const fakeCanvas = {} as CanvasImageSource;

    const result = await engine.export(
      async (f) => fakeCanvas,
      null,
      (pct) => progressUpdates.push(pct),
    );

    expect(result).toBeInstanceOf(Uint8Array);
    expect(mockMuxerInstance?.finalized).toBe(true);
    expect(mockMuxerInstance?.videoChunks.length).toBe(10);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });

  it("can be cancelled mid-export", async () => {
    const fakeCanvas = {} as CanvasImageSource;

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
  });

  it("applies backpressure when encodeQueueSize exceeds threshold", async () => {
    let dequeueListener: (() => void) | null = null;
    let queueSize = 6;
    let drained = false;

    class QueueMockVideoEncoder extends MockVideoEncoder {
      get encodeQueueSize() {
        return queueSize;
      }
      addEventListener(event: string, listener: () => void) {
        if (event === "dequeue") {
          dequeueListener = listener;
          // Simulate queue draining asynchronously
          setTimeout(() => {
            queueSize = 2;
            drained = true;
            listener();
          }, 20);
        }
      }
      removeEventListener(event: string, listener: () => void) {
        if (dequeueListener === listener) {
          dequeueListener = null;
        }
      }
    }

    const backpressureEngine = new ExportEngine(config, {
      VideoEncoder: QueueMockVideoEncoder as any,
      VideoFrame: MockVideoFrame as any,
      MuxerClass: class extends MockMuxer {} as any,
    });

    const fakeCanvas = {} as CanvasImageSource;
    await backpressureEngine.export(async () => fakeCanvas, null);

    expect(drained).toBe(true);
  });
});

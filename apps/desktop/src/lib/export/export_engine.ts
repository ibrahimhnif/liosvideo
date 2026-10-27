import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
} from "mediabunny";

/**
 * In Safari / WebKit (e.g. macOS WKWebView in Tauri), hardware VideoToolbox buffers
 * lookahead frames for rate control and B-frames without emitting chunks or firing 'dequeue'
 * until additional future frames are pushed into the pipeline.
 *
 * Mediabunny pauses feeding when `encodeQueueSize >= 4` and waits for a 'dequeue' event.
 * Without this fallback timer, VideoToolbox waits for frames while Mediabunny waits for dequeue,
 * causing a permanent deadlock at Frame 5.
 */
function patchEncoderDequeue(EncoderClass: any) {
  if (!EncoderClass?.prototype) return;
  const proto = EncoderClass.prototype;
  if (proto.__dequeuePatched) return;
  proto.__dequeuePatched = true;

  const origAddEventListener = proto.addEventListener;
  proto.addEventListener = function (type: string, listener: any, options: any) {
    if (type === "dequeue" && typeof listener === "function") {
      let fired = false;
      const wrapped = (e: any) => {
        if (!fired) {
          fired = true;
          clearTimeout(timer);
          listener.call(this, e);
        }
      };
      const timer = setTimeout(() => {
        if (!fired) {
          fired = true;
          try {
            this.removeEventListener("dequeue", wrapped);
          } catch {}
          listener.call(this, new Event("dequeue"));
        }
      }, 4);
      return origAddEventListener.call(this, type, wrapped, options);
    }
    return origAddEventListener.call(this, type, listener, options);
  };
}

if (typeof globalThis !== "undefined") {
  patchEncoderDequeue((globalThis as any).VideoEncoder);
  patchEncoderDequeue((globalThis as any).AudioEncoder);
}

export interface ExportConfig {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate?: number;
  audioBitrate?: number;
}

export interface ExportEngineDeps {
  OutputClass?: typeof Output;
  CanvasSourceClass?: typeof CanvasSource;
  AudioBufferSourceClass?: typeof AudioBufferSource;
  Mp4OutputFormatClass?: typeof Mp4OutputFormat;
  BufferTargetClass?: typeof BufferTarget;
  QualityClass?: typeof Quality;
  log?: (message: string) => void;
}

export class ExportEngine {
  private cancelled = false;
  private currentOutput: Output | null = null;
  private OutputClass: typeof Output;
  private CanvasSourceClass: typeof CanvasSource;
  private AudioBufferSourceClass: typeof AudioBufferSource;
  private Mp4OutputFormatClass: typeof Mp4OutputFormat;
  private BufferTargetClass: typeof BufferTarget;
  private QualityClass: typeof Quality;
  private log: (message: string) => void;

  constructor(
    private config: ExportConfig,
    deps?: ExportEngineDeps,
  ) {
    this.OutputClass = deps?.OutputClass ?? Output;
    this.CanvasSourceClass = deps?.CanvasSourceClass ?? CanvasSource;
    this.AudioBufferSourceClass = deps?.AudioBufferSourceClass ?? AudioBufferSource;
    this.Mp4OutputFormatClass = deps?.Mp4OutputFormatClass ?? Mp4OutputFormat;
    this.BufferTargetClass = deps?.BufferTargetClass ?? BufferTarget;
    this.QualityClass = deps?.QualityClass ?? Quality;
    this.log = deps?.log ?? ((_m: string) => {});
  }

  cancel(): void {
    this.cancelled = true;
    this.currentOutput?.cancel().catch(() => {});
  }

  async export(
    renderFrame: (frame: number) => Promise<CanvasImageSource>,
    audioBuffer: AudioBuffer | null = null,
    onProgress?: (percent: number, stage?: string, logLine?: string) => void,
  ): Promise<Uint8Array> {
    this.cancelled = false;
    patchEncoderDequeue((globalThis as any).VideoEncoder);
    patchEncoderDequeue((globalThis as any).AudioEncoder);

    this.log(
      `export: Initializing Mediabunny (${this.config.width}x${this.config.height} @ ${this.config.fps}fps, totalFrames=${this.config.totalFrames})`,
    );
    onProgress?.(0, "Initializing export...", "Setting up Mediabunny MP4 muxer");

    // Render frame 0 first to acquire canvas element and ensure initial frame is painted
    const firstRenderT0 = performance.now();
    const firstCanvas = (await renderFrame(0)) as HTMLCanvasElement;
    const firstRenderMs = Math.round(performance.now() - firstRenderT0);

    if (this.cancelled) {
      throw new Error("Export cancelled");
    }

    const target = new this.BufferTargetClass();
    const output = new this.OutputClass({
      format: new this.Mp4OutputFormatClass({ fastStart: "in-memory" }),
      target,
    });
    this.currentOutput = output;

    const videoSource = new this.CanvasSourceClass(firstCanvas, {
      codec: "avc",
      quality: new this.QualityClass({ bitrate: this.config.bitrate ?? 10_000_000 }),
      hardwareAcceleration: "prefer-hardware",
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource);

    let audioSource: AudioBufferSource | null = null;
    if (audioBuffer) {
      audioSource = new this.AudioBufferSourceClass({
        codec: "aac",
        quality: new this.QualityClass({ bitrate: this.config.audioBitrate ?? 192_000 }),
      });
      output.addAudioTrack(audioSource);
    }

    await output.start();

    // Encode audio if present
    if (audioBuffer && audioSource) {
      const audioDuration = audioBuffer.duration;
      this.log(`export: Audio encoding started (${audioDuration.toFixed(1)}s)`);
      onProgress?.(0, "Encoding audio...", `Encoding audio track (${audioDuration.toFixed(1)}s)`);

      await audioSource.add(audioBuffer);

      this.log("export: Audio encoding complete");
      onProgress?.(0, "Audio ready", "Audio track encoded successfully");
    }

    if (this.cancelled) {
      await output.cancel();
      throw new Error("Export cancelled");
    }

    // Video frames encoding loop
    const totalFrames = this.config.totalFrames;
    const frameDuration = 1 / this.config.fps;

    this.log(`export: Video encoding started for ${totalFrames} frames`);
    onProgress?.(0, `Rendering frame 1/${totalFrames}...`, `Video encoding started (${totalFrames} frames)`);

    for (let f = 0; f < totalFrames; f++) {
      if (this.cancelled) {
        await output.cancel();
        throw new Error("Export cancelled");
      }

      let renderMs = firstRenderMs;
      if (f > 0) {
        const renderT0 = performance.now();
        await renderFrame(f);
        renderMs = Math.round(performance.now() - renderT0);
      }

      const timestamp = f * frameDuration;
      await videoSource.add(timestamp, frameDuration);

      // Periodically flush encoder every 60 frames (2 seconds) to prevent VideoToolbox lookahead
      // memory explosion in WebKit (which causes WebProcess OOM crashes at ~2000 frames)
      if (f > 0 && f % 60 === 0) {
        const underlyingEncoder = (videoSource as any)._encoder?.encoder;
        if (underlyingEncoder && typeof underlyingEncoder.flush === "function") {
          await underlyingEncoder.flush();
        }
      }

      const pct = Math.round(((f + 1) / totalFrames) * 100);
      const logLine =
        f < 5 || f % 10 === 0 || f === totalFrames - 1 || renderMs > 150
          ? `Frame ${f + 1}/${totalFrames} (${pct}%) [render: ${renderMs}ms]`
          : undefined;

      if (logLine) {
        this.log(`export: ${logLine}`);
      }
      onProgress?.(pct, `Rendering frame ${f + 1}/${totalFrames} (${pct}%)...`, logLine);
    }

    this.log("export: Finalizing MP4 container with Mediabunny...");
    onProgress?.(100, "Finalizing MP4 container...", "Finalizing MP4 with Mediabunny");

    await output.finalize();

    const buffer = target.buffer;
    if (!buffer) {
      throw new Error("Mediabunny did not produce an output buffer");
    }

    this.log(`export: Export complete! Output size: ${buffer.byteLength} bytes`);
    return new Uint8Array(buffer);
  }
}

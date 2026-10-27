import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export interface ExportConfig {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  bitrate?: number;
  audioBitrate?: number;
}

export interface WebCodecsDeps {
  VideoEncoder?: any;
  VideoFrame?: any;
  AudioEncoder?: any;
  AudioData?: any;
  MuxerClass?: any;
  log?: (message: string) => void;
}

async function waitForQueueDrain(
  encoder: any,
  maxQueue: number,
  isCancelled: () => boolean,
  getError: () => any,
  fallbackMs: number = 4,
): Promise<void> {
  while ((encoder?.encodeQueueSize ?? 0) > maxQueue) {
    if (isCancelled()) throw new Error("Export cancelled");
    const err = getError();
    if (err) throw err;

    await new Promise<void>((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        encoder?.removeEventListener?.("dequeue", onDequeue);
        clearTimeout(timer);
        resolve();
      };
      const onDequeue = () => cleanup();
      encoder?.addEventListener?.("dequeue", onDequeue);
      const timer = setTimeout(cleanup, fallbackMs);
    });
  }
}

export class ExportEngine {
  private cancelled = false;
  private VideoEncoderClass: any;
  private VideoFrameClass: any;
  private AudioEncoderClass: any;
  private AudioDataClass: any;
  private MuxerClass: any;
  private log: (message: string) => void;

  constructor(
    private config: ExportConfig,
    deps?: WebCodecsDeps,
  ) {
    this.VideoEncoderClass = deps?.VideoEncoder ?? globalThis.VideoEncoder;
    this.VideoFrameClass = deps?.VideoFrame ?? globalThis.VideoFrame;
    this.AudioEncoderClass = deps?.AudioEncoder ?? globalThis.AudioEncoder;
    this.AudioDataClass = deps?.AudioData ?? globalThis.AudioData;
    this.MuxerClass = deps?.MuxerClass ?? Muxer;
    this.log = deps?.log ?? ((_m: string) => {});
  }

  cancel(): void {
    this.cancelled = true;
  }

  async export(
    renderFrame: (frame: number) => Promise<CanvasImageSource>,
    audioBuffer: AudioBuffer | null = null,
    onProgress?: (percent: number, stage?: string, logLine?: string) => void,
  ): Promise<Uint8Array> {
    this.cancelled = false;
    const target = new ArrayBufferTarget();

    this.log(`export: Initializing muxer (${this.config.width}x${this.config.height} @ ${this.config.fps}fps, totalFrames=${this.config.totalFrames})`);
    onProgress?.(0, "Initializing export...", "Initializing MP4 muxer and encoders");

    const muxer = new this.MuxerClass({
      target,
      video: {
        codec: "avc",
        width: this.config.width,
        height: this.config.height,
      },
      audio: audioBuffer
        ? {
            codec: "aac",
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
          }
        : undefined,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    if (!this.VideoEncoderClass) {
      throw new Error("WebCodecs VideoEncoder is not available in this environment");
    }

    let encoderError: any = null;
    let audioEncoder: any = null;
    let videoEncoder: any = null;

    try {
      videoEncoder = new this.VideoEncoderClass({
        output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
        error: (e: any) => {
          encoderError = e;
        },
      });

      videoEncoder.configure({
        codec: "avc1.640028",
        width: this.config.width,
        height: this.config.height,
        bitrate: this.config.bitrate ?? 10_000_000,
        framerate: this.config.fps,
        hardwareAcceleration: "prefer-hardware",
      });

      // 2. Setup AudioEncoder if audioBuffer is provided
      if (audioBuffer && this.AudioEncoderClass && this.AudioDataClass) {
        audioEncoder = new this.AudioEncoderClass({
          output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
          error: (e: any) => {
            encoderError = e;
          },
        });

        audioEncoder.configure({
          codec: "mp4a.40.2",
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels,
          bitrate: this.config.audioBitrate ?? 192_000,
        });

        const frameSize = 1024;
        const sampleRate = audioBuffer.sampleRate;
        const channels = audioBuffer.numberOfChannels;
        const totalSamples = audioBuffer.length;
        let sampleOffset = 0;

        this.log(`export: Audio encoding started, ${totalSamples} samples (${(totalSamples / sampleRate).toFixed(1)}s)`);
        onProgress?.(0, "Encoding audio...", `Audio encoding started (${(totalSamples / sampleRate).toFixed(1)}s)`);

        while (sampleOffset < totalSamples) {
          if (this.cancelled) break;
          if (encoderError) throw encoderError;

          await waitForQueueDrain(audioEncoder, 128, () => this.cancelled, () => encoderError, 2);

          const currentChunkSize = Math.min(frameSize, totalSamples - sampleOffset);
          const planarData = new Float32Array(channels * currentChunkSize);
          for (let ch = 0; ch < channels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            planarData.set(channelData.subarray(sampleOffset, sampleOffset + currentChunkSize), ch * currentChunkSize);
          }

          const timestampUs = Math.round((sampleOffset / sampleRate) * 1_000_000);
          const audioData = new this.AudioDataClass({
            format: "f32-planar",
            sampleRate,
            numberOfFrames: currentChunkSize,
            numberOfChannels: channels,
            timestamp: timestampUs,
            data: planarData,
          });

          audioEncoder.encode(audioData);
          audioData.close();
          sampleOffset += currentChunkSize;

          if (sampleOffset % (frameSize * 50) === 0 || sampleOffset >= totalSamples) {
            const audioPct = Math.round((sampleOffset / totalSamples) * 100);
            this.log(`export: Audio encoding ${audioPct}% (${sampleOffset}/${totalSamples})`);
            onProgress?.(0, `Encoding audio (${audioPct}%)...`, `Audio encoding: ${audioPct}%`);
          }
        }

        this.log("export: Flushing audio encoder");
        await audioEncoder.flush();
        audioEncoder.close();
        audioEncoder = null;
        this.log("export: Audio encoding complete");
      }

      if (this.cancelled) {
        throw new Error("Export cancelled");
      }

      // 3. Render and encode video frames
      const totalFrames = this.config.totalFrames;
      const keyFrameInterval = this.config.fps * 2;

      this.log(`export: Video encoding started for ${totalFrames} frames`);
      onProgress?.(0, `Rendering frame 1/${totalFrames}...`, `Video encoding started (${totalFrames} frames)`);

      for (let f = 0; f < totalFrames; f++) {
        if (this.cancelled) {
          throw new Error("Export cancelled");
        }
        if (encoderError) {
          throw encoderError;
        }

        const waitT0 = Date.now();
        await waitForQueueDrain(videoEncoder, 64, () => this.cancelled, () => encoderError, 2);
        const waitMs = Date.now() - waitT0;

        const renderT0 = Date.now();
        const canvasSource = await renderFrame(f);
        const renderMs = Date.now() - renderT0;

        const timestampUs = Math.round((f / this.config.fps) * 1_000_000);
        const durationUs = Math.round((1 / this.config.fps) * 1_000_000);

        const videoFrame = new this.VideoFrameClass(canvasSource, {
          timestamp: timestampUs,
          duration: durationUs,
        });

        const isKeyFrame = f % keyFrameInterval === 0;
        videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
        videoFrame.close();

        const pct = Math.round(((f + 1) / totalFrames) * 100);
        const logLine = (f < 5 || f % 10 === 0 || f === totalFrames - 1 || renderMs > 150)
          ? `Frame ${f + 1}/${totalFrames} (${pct}%) [render: ${renderMs}ms, wait: ${waitMs}ms, queue=${videoEncoder.encodeQueueSize ?? 0}]`
          : undefined;

        if (logLine) {
          this.log(`export: ${logLine}`);
        }
        onProgress?.(pct, `Rendering frame ${f + 1}/${totalFrames} (${pct}%)...`, logLine);
      }

      this.log("export: Flushing video encoder");
      onProgress?.(100, "Flushing video encoder...", "Flushing video encoder");
      await videoEncoder.flush();
      videoEncoder.close();
      videoEncoder = null;

      this.log("export: Finalizing MP4 muxer");
      onProgress?.(100, "Finalizing MP4 container...", "Finalizing MP4 container");
      muxer.finalize();
      this.log(`export: Muxer finalized, total size: ${target.buffer.byteLength} bytes`);

      return new Uint8Array(target.buffer);
    } catch (err: any) {
      this.log(`export: Error encountered: ${err?.message ?? err}`);
      try {
        audioEncoder?.close?.();
      } catch {}
      try {
        videoEncoder?.close?.();
      } catch {}
      throw err;
    }
  }
}

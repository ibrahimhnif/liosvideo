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
}

async function waitForQueueDrain(
  encoder: any,
  maxQueue: number,
  isCancelled: () => boolean,
  getError: () => any,
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
      const timer = setTimeout(cleanup, 16);
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

  constructor(
    private config: ExportConfig,
    deps?: WebCodecsDeps,
  ) {
    this.VideoEncoderClass = deps?.VideoEncoder ?? globalThis.VideoEncoder;
    this.VideoFrameClass = deps?.VideoFrame ?? globalThis.VideoFrame;
    this.AudioEncoderClass = deps?.AudioEncoder ?? globalThis.AudioEncoder;
    this.AudioDataClass = deps?.AudioData ?? globalThis.AudioData;
    this.MuxerClass = deps?.MuxerClass ?? Muxer;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async export(
    renderFrame: (frame: number) => Promise<CanvasImageSource>,
    audioBuffer: AudioBuffer | null = null,
    onProgress?: (percent: number) => void,
  ): Promise<Uint8Array> {
    this.cancelled = false;
    const target = new ArrayBufferTarget();

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

        while (sampleOffset < totalSamples) {
          if (this.cancelled) break;
          if (encoderError) throw encoderError;

          await waitForQueueDrain(audioEncoder, 8, () => this.cancelled, () => encoderError);

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
        }

        await audioEncoder.flush();
        audioEncoder.close();
        audioEncoder = null;
      }

      if (this.cancelled) {
        throw new Error("Export cancelled");
      }

      // 3. Render and encode video frames
      const totalFrames = this.config.totalFrames;
      const keyFrameInterval = this.config.fps * 2;

      for (let f = 0; f < totalFrames; f++) {
        if (this.cancelled) {
          throw new Error("Export cancelled");
        }
        if (encoderError) {
          throw encoderError;
        }

        await waitForQueueDrain(videoEncoder, 4, () => this.cancelled, () => encoderError);

        const canvasSource = await renderFrame(f);
        const timestampUs = Math.round((f / this.config.fps) * 1_000_000);
        const durationUs = Math.round((1 / this.config.fps) * 1_000_000);

        const videoFrame = new this.VideoFrameClass(canvasSource, {
          timestamp: timestampUs,
          duration: durationUs,
        });

        const isKeyFrame = f % keyFrameInterval === 0;
        videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
        videoFrame.close();

        if (onProgress) {
          onProgress(Math.round(((f + 1) / totalFrames) * 100));
        }
      }

      await videoEncoder.flush();
      videoEncoder.close();
      videoEncoder = null;

      muxer.finalize();
      return new Uint8Array(target.buffer);
    } catch (err) {
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

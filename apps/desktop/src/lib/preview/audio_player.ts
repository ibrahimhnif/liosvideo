import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface AudioClipDef {
  src: string;
  startFrame: number;
  endFrame: number;
  duration?: number;
  startOffset?: number;
  volume?: number;
  ducking?: boolean;
}

export interface AudioPlayerOptions {
  createContext?: () => AudioContext;
  loadBuffer?: (src: string) => Promise<ArrayBuffer>;
}

async function defaultLoadBuffer(src: string): Promise<ArrayBuffer> {
  const path = await invoke<string>("asset_url_path", { rel: src });
  const url = convertFileSrc(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load audio asset "${src}" (${res.status})`);
  return res.arrayBuffer();
}

interface ActiveNode {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private createContext: () => AudioContext;
  private loadBuffer: (src: string) => Promise<ArrayBuffer>;

  private clips: AudioClipDef[] = [];
  private bufferCache = new Map<string, AudioBuffer>();
  private activeNodes: ActiveNode[] = [];
  private isPlaying = false;
  private currentFrame = 0;
  private currentFps = 30;

  constructor(opts?: AudioPlayerOptions) {
    this.createContext = opts?.createContext ?? (() => new (window.AudioContext || (window as any).webkitAudioContext)());
    this.loadBuffer = opts?.loadBuffer ?? defaultLoadBuffer;
  }

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = this.createContext();
    }
    return this.ctx;
  }

  async setClips(clips: AudioClipDef[]): Promise<void> {
    this.clips = clips;
    const ctx = this.getContext();

    // Preload audio buffers for new clips
    const uniqueSources = Array.from(new Set(clips.map((c) => c.src)));
    await Promise.all(
      uniqueSources.map(async (src) => {
        if (!this.bufferCache.has(src)) {
          try {
            const raw = await this.loadBuffer(src);
            const decoded = await ctx.decodeAudioData(raw);
            this.bufferCache.set(src, decoded);
          } catch (e) {
            console.warn(`[AudioPlayer] Failed to load/decode "${src}":`, e);
          }
        }
      }),
    );

    if (this.isPlaying) {
      this.reschedule();
    }
  }

  play(startFrame: number, fps: number): void {
    this.isPlaying = true;
    this.currentFrame = startFrame;
    this.currentFps = fps;

    const ctx = this.getContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    this.reschedule();
  }

  pause(): void {
    this.isPlaying = false;
    this.stopActiveNodes();
  }

  seek(frame: number, fps: number): void {
    this.currentFrame = frame;
    this.currentFps = fps;
    if (this.isPlaying) {
      this.reschedule();
    }
  }

  private stopActiveNodes(): void {
    for (const node of this.activeNodes) {
      try {
        node.source.stop();
        node.source.disconnect();
        node.gain.disconnect();
      } catch {
        // Node might have already stopped
      }
    }
    this.activeNodes = [];
  }

  private reschedule(): void {
    this.stopActiveNodes();
    if (!this.isPlaying) return;

    const ctx = this.getContext();
    const now = ctx.currentTime;
    const playheadSec = this.currentFrame / this.currentFps;

    for (const clip of this.clips) {
      if (clip.endFrame <= this.currentFrame) {
        continue;
      }

      const buffer = this.bufferCache.get(clip.src);
      if (!buffer) continue;

      const clipStartSec = clip.startFrame / this.currentFps;
      const baseOffset = clip.startOffset ?? 0;

      let delay = 0;
      let offset = baseOffset;
      let duration: number | undefined;

      if (clip.startFrame >= this.currentFrame) {
        // Scheduled in the future
        delay = clipStartSec - playheadSec;
        offset = baseOffset;
        if (clip.duration !== undefined) {
          duration = clip.duration;
        }
      } else {
        // Active right now, played partially
        delay = 0;
        const elapsedInClip = playheadSec - clipStartSec;
        offset = baseOffset + elapsedInClip;
        const totalDuration = clip.duration ?? (clip.endFrame - clip.startFrame) / this.currentFps;
        duration = Math.max(0, totalDuration - elapsedInClip);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gain = ctx.createGain();
      gain.gain.value = clip.volume ?? 1.0;

      source.connect(gain);
      gain.connect(ctx.destination);

      const when = now + delay;
      if (duration !== undefined) {
        source.start(when, offset, duration);
      } else {
        source.start(when, offset);
      }

      this.activeNodes.push({ source, gain });
    }
  }

  destroy(): void {
    this.pause();
    this.bufferCache.clear();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

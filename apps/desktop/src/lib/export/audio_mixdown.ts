import type { TimelineManifest } from "liosvideo";

export interface MixdownOptions {
  sampleRate?: number;
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

export async function mixdownAudio(
  manifest: TimelineManifest,
  loadBuffer: (src: string) => Promise<ArrayBuffer>,
  options?: MixdownOptions,
): Promise<AudioBuffer | null> {
  const tracks = manifest.audioTracks ?? [];
  const clips = tracks.flatMap((t) => t.clips);
  if (!clips.length) return null;

  const sampleRate = options?.sampleRate ?? 48000;
  const totalDurationSec = manifest.totalFrames / manifest.fps;
  if (totalDurationSec <= 0) return null;

  const totalLengthSamples = Math.max(1, Math.ceil(totalDurationSec * sampleRate));
  const createContext =
    options?.createContext ??
    ((ch, len, sr) => new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(ch, len, sr));

  const ctx = createContext(2, totalLengthSamples, sampleRate);

  const decodedBuffers = new Map<string, AudioBuffer>();
  for (const clip of clips) {
    if (!decodedBuffers.has(clip.src)) {
      try {
        const raw = await loadBuffer(clip.src);
        const decoded = await ctx.decodeAudioData(raw);
        decodedBuffers.set(clip.src, decoded);
      } catch (err) {
        console.warn(`[audio_mixdown] Failed to load/decode "${clip.src}":`, err);
      }
    }
  }

  for (const clip of clips) {
    const buffer = decodedBuffers.get(clip.src);
    if (!buffer) continue;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = clip.volume ?? 1.0;

    source.connect(gain);
    gain.connect(ctx.destination);

    const when = clip.startFrame / manifest.fps;
    const offset = clip.startOffset ?? 0;
    if (clip.duration !== undefined) {
      source.start(when, offset, clip.duration);
    } else {
      source.start(when, offset);
    }
  }

  return ctx.startRendering();
}

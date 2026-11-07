import { duckGainAt, duckSchedule, fadePlan, master, resolveMix, type MasterReport, type TimelineManifest } from "liosvideo";

export interface MixdownOptions {
  sampleRate?: number;
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
  /** Called with the loudness/limiter result of the master bus. */
  onMaster?: (report: MasterReport) => void;
}

export async function mixdownAudio(
  manifest: TimelineManifest,
  loadBuffer: (src: string) => Promise<ArrayBuffer>,
  options?: MixdownOptions,
): Promise<AudioBuffer | null> {
  const tracks = manifest.audioTracks ?? [];
  const clips = tracks.flatMap((t) => t?.clips ?? []);
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

  const mix = resolveMix(manifest.mix);
  const playable = clips
    .map((clip) => ({ clip, buffer: decodedBuffers.get(clip.src) }))
    .filter((c): c is { clip: (typeof clips)[number]; buffer: AudioBuffer } => !!c.buffer);
  const scheduled = playable.map(({ clip, buffer }) => {
    const start = clip.startFrame / manifest.fps;
    const available = Math.max(0, buffer.duration - (clip.startOffset ?? 0));
    const played = Math.min(clip.duration ?? available, available, Math.max(0, totalDurationSec - start));
    return { src: clip.src, role: clip.role, ducking: clip.ducking, start, played };
  });
  const { plan, ducked } = duckSchedule(scheduled, mix.duck);

  playable.forEach(({ clip, buffer }, i) => {
    const { start, played } = scheduled[i];
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const volume = clip.volume ?? 1.0;
    const gain = ctx.createGain();
    if (ducked[i]) {
      gain.gain.setValueAtTime(volume * duckGainAt(plan, 0), 0);
      for (const [t, g] of plan) if (t > 0) gain.gain.linearRampToValueAtTime(volume * g, t);
    } else {
      gain.gain.value = volume;
    }

    // fade in / out: its own gain stage, so it multiplies with ducking
    const fades = fadePlan(start, played, clip.fadeIn, clip.fadeOut);
    if (fades.length) {
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(fades[0][1], fades[0][0]);
      for (const [t, g] of fades.slice(1)) fade.gain.linearRampToValueAtTime(g, t);
      source.connect(fade);
      fade.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(ctx.destination);

    const when = clip.startFrame / manifest.fps;
    const offset = clip.startOffset ?? 0;
    if (clip.duration !== undefined) {
      source.start(when, offset, clip.duration);
    } else {
      source.start(when, offset);
    }
  });

  const rendered = await ctx.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i));
  const report = master(channels, sampleRate, mix);
  options?.onMaster?.(report);
  return rendered;
}

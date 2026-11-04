/**
 * SFX registry and soundtrack helpers.
 *
 * The WAV files are synthesized deterministically by
 * `scripts/generate-sfx.mjs` and are royalty-free (no attribution required).
 *
 * Mixing targets follow the Indonesian short-form playbook:
 *   VO -3..-5 dB · impact -6..-8 dB · transitions -8..-12 dB · bed -20..-26 dB under VO.
 */

import type { AudioTrack } from "liosvideo";

export const SFX = {
  whooshFast: "assets/audio/sfx/whoosh_fast.wav",
  whooshDeep: "assets/audio/sfx/whoosh_deep.wav",
  impactThud: "assets/audio/sfx/impact_thud.wav",
  impactSub: "assets/audio/sfx/impact_sub.wav",
  pop: "assets/audio/sfx/pop.wav",
  uiClick: "assets/audio/sfx/ui_click.wav",
  bell: "assets/audio/sfx/bell.wav",
  bellRound: "assets/audio/sfx/bell_round.wav",
  typewriterRun: "assets/audio/sfx/typewriter_run.wav",
  paperTear: "assets/audio/sfx/paper_tear.wav",
  cameraShutter: "assets/audio/sfx/camera_shutter.wav",
  glitch: "assets/audio/sfx/glitch.wav",
  riser: "assets/audio/sfx/riser.wav",
  heartbeat: "assets/audio/sfx/heartbeat.wav",
  kaching: "assets/audio/sfx/kaching.wav",
  braam: "assets/audio/sfx/braam.wav",
  stamp: "assets/audio/sfx/stamp.wav",
  tapeStop: "assets/audio/sfx/tape_stop.wav",
  softSwoosh: "assets/audio/sfx/soft_swoosh.wav",
  tick: "assets/audio/sfx/tick.wav",
  tock: "assets/audio/sfx/tock.wav",
} as const;

export type SfxId = keyof typeof SFX;

export interface SfxCue {
  sfx: SfxId;
  /** Seconds from the start of the composition. */
  at: number;
  /** 0..1 linear gain. Defaults to 0.5. */
  volume?: number;
}

export const BED = "assets/audio/music/ambient_bed.wav";

export function soundtrack(
  cues: SfxCue[],
  opts: { bed?: boolean; bedVolume?: number; bedSrc?: string } = {},
): AudioTrack[] {
  const tracks: AudioTrack[] = [];
  if (opts.bed !== false) {
    tracks.push({
      id: "ambient-bed",
      name: "Ambient bed",
      src: opts.bedSrc ?? BED,
      startAt: 0,
      volume: opts.bedVolume ?? 0.1,
      loop: true,
    });
  }
  cues.forEach((cue, i) => {
    tracks.push({
      id: `sfx-${String(i + 1).padStart(2, "0")}-${cue.sfx}`,
      name: cue.sfx,
      src: SFX[cue.sfx],
      startAt: cue.at,
      volume: cue.volume ?? 0.5,
    });
  });
  return tracks;
}

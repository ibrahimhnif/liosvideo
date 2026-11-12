// Sound effects tied to motion: `node.to(..., { sfx })`, camera presets and cameraPath keys carry cues;
// the manifest turns them into "sfx" clips at the scene time the move starts (or ends).

import { attributedFile } from "../assets/attributions";

/** "whoosh" (a library name or a project path), or the details. */
export type SfxSpec =
  | string
  | {
      name: string;
      /** Play when the move starts (default) or ends. */
      on?: "start" | "end";
      /** 0..1 linear gain; default from the library entry, then `composition({ sfx: { volume } })`, then 0.5. */
      volume?: number;
      /** Seconds to shift the sound (negative plays it early, e.g. a whoosh that leads the move). */
      offset?: number;
      /** Trim the sound to this many seconds (faded out). */
      duration?: number;
    };

/** One sound placed in its scene: `at` is seconds from the scene start. */
export interface SfxCue {
  name: string;
  at: number;
  volume?: number;
  duration?: number;
}

export interface SfxOptions {
  /** Default level of every SFX (default 0.5). */
  volume?: number;
  /** Names to files (and their level): `{ whoosh: "assets/audio/sfx/whoosh_fast.wav", hit: { src, volume } }`. */
  library?: Record<string, string | { src: string; volume?: number }>;
}

const ON = ["start", "end"] as const;

/** The cue for a move from `start` to `end` (scene seconds). */
export function sfxCue(spec: SfxSpec, start: number, end: number, where: string): SfxCue {
  const o = typeof spec === "string" ? { name: spec } : spec;
  if (!o.name) throw new Error(`SFX for ${where} needs a name`);
  const on = o.on ?? "start";
  if (!ON.includes(on)) throw new Error(`SFX on ${JSON.stringify(on)} for ${where}: use one of: ${ON.join(", ")}`);
  const cue: SfxCue = { name: o.name, at: Math.max(0, (on === "end" ? end : start) + (o.offset ?? 0)) };
  if (o.volume !== undefined) cue.volume = o.volume;
  if (o.duration !== undefined) cue.duration = o.duration;
  return cue;
}

/**
 * File, level and fades of a cue: the library entry, else a path as written, else the
 * `assets/audio/sfx/<name>.*` recorded in assets/ATTRIBUTIONS.md, else assets/audio/sfx/<name>.wav.
 */
export function resolveSfx(cue: SfxCue, opts: SfxOptions = {}) {
  const entry = opts.library?.[cue.name];
  const libSrc = typeof entry === "string" ? entry : entry?.src;
  const libVolume = typeof entry === "object" ? entry.volume : undefined;
  const looksLikePath = /[/.]/.test(cue.name);
  return {
    src: libSrc ?? (looksLikePath ? cue.name : (attributedFile("assets/audio/sfx", cue.name) ?? `assets/audio/sfx/${cue.name}.wav`)),
    volume: cue.volume ?? libVolume ?? opts.volume ?? 0.5,
    duration: cue.duration,
    // a few ms in and out so no clip clicks; a trimmed sound fades out over up to a third of what is left
    fadeIn: 0.005,
    fadeOut: cue.duration !== undefined ? Math.min(0.12, cue.duration / 3) : 0.03,
  };
}

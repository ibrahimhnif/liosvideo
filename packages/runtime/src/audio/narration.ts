import { vo } from "./timing";

/** Spacing of the narration lines inside a scene, in seconds. */
export interface SceneVoOptions {
  /** VO line ids spoken in this scene, back to back. */
  vo?: string[];
  /** Silence before the first and after the last line (default 0.35); `lead` / `tail` override one end. */
  pad?: number;
  lead?: number;
  tail?: number;
  /** Silence between two lines of the scene (default 0.3). */
  gap?: number;
}

/** One narration line placed in its scene: `at` is seconds from the scene start. */
export interface VoCue {
  id: string;
  at: number;
  duration: number;
  /** False until the line has been generated (its duration is then a 2.5 s stand-in). */
  ready: boolean;
}

export const VO_PAD = 0.35;
export const VO_GAP = 0.3;
/** Stand-in length of a line that has no audio yet, so the scene can be previewed. */
export const VO_PLACEHOLDER = 2.5;

/** Where each line of a scene starts, and how long the scene runs to hold them all. */
export function planVo(opts: SceneVoOptions): { cues: VoCue[]; duration: number } {
  const lead = opts.lead ?? opts.pad ?? VO_PAD;
  const tail = opts.tail ?? opts.pad ?? VO_PAD;
  const gap = opts.gap ?? VO_GAP;
  let t = lead;
  const cues = (opts.vo ?? []).map((id, i) => {
    const line = vo(id);
    const ready = line.isReady && line.duration > 0;
    if (i > 0) t += gap;
    const cue = { id, at: t, duration: ready ? line.duration : VO_PLACEHOLDER, ready };
    t += cue.duration;
    return cue;
  });
  return { cues, duration: t + tail };
}

const norm = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The `cue(line)` and `word(line, wordOrIndex)` helpers of a scene's builder: scene-local seconds. */
export function sceneCues(sceneId: string, cues: VoCue[]) {
  const find = (id: string) => {
    const cue = cues.find((c) => c.id === id);
    if (!cue) {
      const list = cues.length ? cues.map((c) => c.id).join(", ") : "none; add scene(id, { vo: [...] })";
      throw new Error(`cue(): VO line "${id}" is not narrated in scene "${sceneId}" (its lines: ${list})`);
    }
    return cue;
  };
  const cue = (id: string): number => find(id).at;
  const word = (id: string, which: string | number): number => {
    const c = find(id);
    const words = vo(id).words;
    if (!c.ready || !words.length) return c.at;
    if (typeof which === "number") {
      const w = words[which];
      if (!w) throw new Error(`word(): VO line "${id}" has no word ${which} (it has ${words.length})`);
      return c.at + w.start;
    }
    const target = norm(which);
    const w = words.find((x) => norm(x.word) === target) ?? words.find((x) => norm(x.word).startsWith(target));
    if (!w) {
      throw new Error(`word(): no word "${which}" in VO line "${id}" (words: ${words.map((x) => x.word).join(", ")})`);
    }
    return c.at + w.start;
  };
  return { cue, word };
}

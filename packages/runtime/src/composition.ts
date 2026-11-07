import type { AudioRole, MixOptions } from "./audio/mix";
import type { SfxOptions } from "./audio/sfx";
import { planVo, sceneCues, type SceneVoOptions, type VoCue } from "./audio/narration";
import { group } from "./graph/kinds";
import type { Node } from "./graph/node";
import { seededRandom } from "./math/random";
import type { TransitionDef } from "./anim/transition";

export type SceneContext = {
  root: Node;
  width: number;
  height: number;
  duration: number;
  random: () => number;
  /** Scene-local start (seconds) of a VO line listed in `scene(id, { vo: [...] })`. */
  cue: (lineId: string) => number;
  /** Scene-local time a word of that line starts: by its index, or the first word matching the text. */
  word: (lineId: string, word: string | number) => number;
};

export type SceneDef = {
  id: string;
  /** seconds */
  duration: number;
  background?: string;
  transition?: TransitionDef;
  build: (ctx: SceneContext) => void;
  /** Narration lines of the scene and where they start (from `scene(id, { vo })`). */
  vo?: VoCue[];
  /** stack captured where scene() was called; the host maps it to the scene's source file */
  site?: string;
};

export type AudioClip = {
  src: string;
  /** Start frame in timeline (defaults to 0) */
  startFrame?: number;
  /** Start time in seconds (alternative to startFrame) */
  startAt?: number;
  /** duration in seconds */
  duration?: number;
  /** offset within audio asset in seconds */
  startOffset?: number;
  /** volume 0.0 - 1.0 */
  volume?: number;
  /** Dip under voice-over (default: music beds and anything >= 8 s that is not VO). */
  ducking?: boolean;
  /** "vo" lines duck the music; "music" always ducks; "sfx" never does. */
  role?: AudioRole;
  loop?: boolean;
  /** Seconds to fade in from silence at the start of the clip. */
  fadeIn?: number;
  /** Seconds to fade out to silence at the end of the clip. */
  fadeOut?: number;
};

export type AudioTrack = {
  id: string;
  name?: string;
  src?: string;
  startAt?: number;
  startFrame?: number;
  duration?: number;
  startOffset?: number;
  volume?: number;
  loop?: boolean;
  ducking?: boolean;
  role?: AudioRole;
  clips?: AudioClip[];
};

export type Composition = {
  width: number;
  height: number;
  fps: number;
  background: string;
  scenes: SceneDef[];
  audio?: AudioTrack[];
  /** Master bus: loudness target (default -14 LUFS), limiter ceiling and music ducking. */
  mix?: MixOptions;
  /** VO lines of `scene({ vo })` scenes are added as audio automatically; false turns that off. */
  narration?: false | { volume?: number };
  /** Sound effects of moves (`sfx` on `to()`, camera paths): file names and levels; false leaves them out. */
  sfx?: false | SfxOptions;
};

export type SceneSpan = { id: string; startFrame: number; endFrame: number };

export type SceneOptions = { background?: string; transition?: TransitionDef } & (
  | ({ duration: number } & SceneVoOptions)
  | ({ duration?: number } & SceneVoOptions & { vo: string[] })
);

/**
 * A scene. With `vo: [lineIds]` the lines are spoken back to back (`lead`/`gap`/`tail`, or `pad`) and
 * the duration follows the generated audio unless `duration` is given; the builder's `cue()` and
 * `word()` give scene-local times and the composition places the audio.
 */
export function scene(id: string, opts: SceneOptions, build: SceneDef["build"]): SceneDef {
  const site = new Error().stack;
  if (!opts.vo) return { id, duration: opts.duration!, background: opts.background, transition: opts.transition, build, site };
  const plan = planVo(opts);
  return {
    id,
    duration: opts.duration ?? plan.duration,
    background: opts.background,
    transition: opts.transition,
    build,
    vo: plan.cues,
    site,
  };
}

export function composition(c: Omit<Composition, "background"> & { background?: string }): Composition {
  return { ...c, background: c.background ?? "#000000" };
}

export function layoutComposition(c: Composition): { totalFrames: number; scenes: SceneSpan[] } {
  const seen = new Set<string>();
  for (const s of c.scenes) {
    if (seen.has(s.id)) throw new Error(`Duplicate scene id "${s.id}"`);
    seen.add(s.id);
  }
  let frame = 0;
  const scenes = c.scenes.map((s) => {
    const startFrame = frame;
    frame += Math.round(s.duration * c.fps);
    return { id: s.id, startFrame, endFrame: frame };
  });
  return { totalFrames: frame, scenes };
}

export function clampFrame(c: Composition, frame: number): number {
  const last = Math.max(layoutComposition(c).totalFrames - 1, 0);
  return Math.min(Math.max(Math.floor(frame), 0), last);
}

const instances = new WeakMap<Composition, WeakMap<SceneDef, Node>>();

export function instantiateScene(c: Composition, def: SceneDef): Node {
  let byDef = instances.get(c);
  if (!byDef) instances.set(c, (byDef = new WeakMap()));
  let root = byDef.get(def);
  if (!root) {
    root = group({ name: def.id, width: c.width, height: c.height });
    const { cue, word } = sceneCues(def.id, def.vo ?? []);
    def.build({ root, width: c.width, height: c.height, duration: def.duration, random: seededRandom(def.id), cue, word });
    byDef.set(def, root);
  }
  return root;
}

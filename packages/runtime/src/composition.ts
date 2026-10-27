import { group } from "./graph/kinds";
import type { Node } from "./graph/node";
import { seededRandom } from "./math/random";

export type SceneContext = {
  root: Node;
  width: number;
  height: number;
  duration: number;
  random: () => number;
};

export type SceneDef = {
  id: string;
  /** seconds */
  duration: number;
  background?: string;
  build: (ctx: SceneContext) => void;
};

export type Composition = {
  width: number;
  height: number;
  fps: number;
  background: string;
  scenes: SceneDef[];
};

export type SceneSpan = { id: string; startFrame: number; endFrame: number };

export function scene(id: string, opts: { duration: number; background?: string }, build: SceneDef["build"]): SceneDef {
  return { id, duration: opts.duration, background: opts.background, build };
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
    def.build({ root, width: c.width, height: c.height, duration: def.duration, random: seededRandom(def.id) });
    byDef.set(def, root);
  }
  return root;
}

/**
 * Motion primitives.
 *
 * Every helper only writes deterministic keyframes (`node.to` / `node.set`),
 * so the result is identical on every render. Times are scene-local seconds.
 */

import type { EaseName, Node } from "liosvideo";

export type FxNode = Node<any>;

export interface MotionOptions {
  at?: number;
  duration?: number;
  ease?: EaseName;
}

/** Scale/opacity entrance with a small overshoot. */
export function popIn(
  node: FxNode,
  opts: MotionOptions & { from?: number } = {},
): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.45;
  const from = opts.from ?? 0.84;
  node.set({ opacity: 0, scaleX: from, scaleY: from }, 0);
  node.to(
    { opacity: 1, scaleX: 1, scaleY: 1 },
    { at, duration, ease: opts.ease ?? "outBack" },
  );
  return node;
}

/** Simple opacity ramp. */
export function fadeIn(node: FxNode, opts: MotionOptions & { from?: number } = {}): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.4;
  node.set({ opacity: opts.from ?? 0 }, 0);
  node.to({ opacity: 1 }, { at, duration, ease: opts.ease ?? "outCubic" });
  return node;
}

/** Slide in from a screen direction to the node's authored position. */
export function slideIn(
  node: FxNode,
  opts: MotionOptions & { from?: "left" | "right" | "up" | "down"; distance?: number } = {},
): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.5;
  const dir = opts.from ?? "left";
  const distance = opts.distance ?? 40;
  const p = node.propsAt(0);
  const dx = dir === "left" ? distance : dir === "right" ? -distance : 0;
  const dy = dir === "up" ? distance : dir === "down" ? -distance : 0;
  node.set({ x: p.x + dx, y: p.y + dy, opacity: 0 }, 0);
  node.to({ x: p.x, y: p.y, opacity: 1 }, { at, duration, ease: opts.ease ?? "outCubic" });
  return node;
}

/** Punch-in zoom. Best on a group that is anchored at its centre. */
export function crashZoom(
  node: FxNode,
  opts: MotionOptions & { from?: number; to?: number } = {},
): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.24;
  const from = opts.from ?? 1;
  const to = opts.to ?? 1.34;
  node.set({ scaleX: from, scaleY: from }, 0);
  node.to({ scaleX: to, scaleY: to }, { at, duration, ease: opts.ease ?? "outCubic" });
  return node;
}

/** Decaying hand-held camera shake around the node's authored position. */
export function shake(
  node: FxNode,
  opts: { at?: number; duration?: number; intensity?: number; steps?: number } = {},
): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.36;
  const intensity = opts.intensity ?? 6;
  const steps = opts.steps ?? 9;
  const p = node.propsAt(0);
  const step = duration / steps;
  for (let i = 0; i <= steps; i++) {
    const decay = 1 - i / (steps + 2);
    const dx = (i % 2 === 0 ? 1 : -1) * intensity * decay;
    const dy = ((i + 1) % 2 === 0 ? 1 : -1) * intensity * decay * 0.55;
    node.set({ x: p.x + dx, y: p.y + dy }, at + i * step);
  }
  node.set({ x: p.x, y: p.y }, at + duration);
  return node;
}

/** Repeated scale pulse (beat sync). */
export function pulse(
  node: FxNode,
  opts: {
    at?: number;
    times?: number;
    duration?: number;
    gap?: number;
    scale?: number;
    ease?: EaseName;
  } = {},
): FxNode {
  const at = opts.at ?? 0;
  const times = opts.times ?? 2;
  const duration = opts.duration ?? 0.16;
  const gap = opts.gap ?? 0.12;
  const scale = opts.scale ?? 1.07;
  for (let i = 0; i < times; i++) {
    const start = at + i * (duration * 2 + gap);
    node.to(
      { scaleX: scale, scaleY: scale },
      { at: start, duration, ease: opts.ease ?? "outCubic" },
    );
    node.to(
      { scaleX: 1, scaleY: 1 },
      { at: start + duration, duration, ease: "inOutCubic" },
    );
  }
  return node;
}

/** Gentle vertical drift, used for floating cards and dust. */
export function floatLoop(
  node: FxNode,
  opts: { at?: number; duration?: number; distance?: number; cycles?: number } = {},
): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 2;
  const distance = opts.distance ?? 8;
  const cycles = opts.cycles ?? 2;
  const p = node.propsAt(0);
  const leg = duration / (cycles * 2);
  for (let i = 0; i < cycles * 2; i++) {
    const up = i % 2 === 0;
    node.to(
      { y: p.y + (up ? -distance : 0) },
      { at: at + i * leg, duration: leg, ease: "inOutCubic" },
    );
  }
  return node;
}

/** Times for a staggered entrance. */
export function stagger(count: number, at = 0, step = 0.12): number[] {
  return Array.from({ length: count }, (_, i) => at + i * step);
}

/** Uniform scale "breath" used to keep a static page alive. */
export function breathe(
  node: FxNode,
  opts: { at?: number; duration?: number; amount?: number } = {},
): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 3;
  const amount = opts.amount ?? 0.012;
  node.to(
    { scaleX: 1 + amount, scaleY: 1 + amount },
    { at, duration: duration / 2, ease: "inOutCubic" },
  );
  node.to({ scaleX: 1, scaleY: 1 }, { at: at + duration / 2, duration: duration / 2, ease: "inOutCubic" });
  return node;
}

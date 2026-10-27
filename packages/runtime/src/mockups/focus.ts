import type { Node } from "../graph/node";
import { CursorNode } from "./cursor";

export interface FocusOptions {
  at: number;
  duration?: number;
  scale?: number;
  dimOthers?: number;
  blurOthers?: number;
}

/**
 * Cinematographic focus helper: brings `target` window to front, slightly scales it up,
 * and dims & blurs other sibling windows in the desktop.
 */
export function focus(target: Node<any>, opts: FocusOptions): void {
  const duration = opts.duration ?? 0.5;
  const scale = opts.scale ?? 1.02;
  const dimOthers = opts.dimOthers ?? 0.4;
  const blurOthers = opts.blurOthers ?? 6;

  // Elevate and sharpen target node
  target.to(
    {
      z: 10,
      scaleX: scale,
      scaleY: scale,
      opacity: 1,
      blur: 0,
    },
    { at: opts.at, duration },
  );

  // Dim and blur siblings on the same desktop/parent
  if (target.parent) {
    for (const sibling of target.parent.children) {
      if (sibling === target || sibling instanceof CursorNode) continue;
      sibling.to(
        {
          z: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: dimOthers,
          blur: blurOthers,
        },
        { at: opts.at, duration },
      );
    }
  }
}

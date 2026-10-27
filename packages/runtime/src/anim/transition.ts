import type { Node } from "../graph/node";

export type TransitionType = "fade" | "slide" | "zoom" | "wipe";

export interface TransitionDef {
  type: TransitionType;
  /** duration in seconds */
  duration: number;
}

export function transition(type: TransitionType, duration = 0.5): TransitionDef {
  return { type, duration };
}

export function applyTransition(
  node: Node<any>,
  def: TransitionDef,
  progress: number,
  width: number,
  height: number,
): void {
  const t = Math.max(0, Math.min(1, progress));
  const anyNode = node as any;
  switch (def.type) {
    case "fade":
      anyNode.base.opacity = t;
      break;
    case "slide":
      anyNode.base.x = (1 - t) * width;
      break;
    case "zoom":
      anyNode.base.scaleX = 0.8 + 0.2 * t;
      anyNode.base.scaleY = 0.8 + 0.2 * t;
      anyNode.base.opacity = t;
      break;
    case "wipe":
      anyNode.base.opacity = t;
      break;
  }
}

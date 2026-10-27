import type { Node } from "../graph/node";

export type TransitionApplyFn = (
  node: Node<any>,
  progress: number,
  width: number,
  height: number,
) => void;

export type TransitionType = "fade" | "slide" | "zoom" | "wipe" | "custom";

export interface TransitionDef {
  type: TransitionType;
  /** duration in seconds */
  duration: number;
  direction?: "left" | "right" | "up" | "down";
  apply?: TransitionApplyFn;
}

export function transition(
  typeOrFn: TransitionType | TransitionApplyFn,
  optsOrDuration:
    | number
    | {
        duration?: number;
        direction?: "left" | "right" | "up" | "down";
        apply?: TransitionApplyFn;
      } = 0.5,
): TransitionDef {
  if (typeof typeOrFn === "function") {
    const duration = typeof optsOrDuration === "number" ? optsOrDuration : (optsOrDuration.duration ?? 0.5);
    return { type: "custom", duration, apply: typeOrFn };
  }
  if (typeof optsOrDuration === "number") {
    return { type: typeOrFn, duration: optsOrDuration };
  }
  return {
    type: typeOrFn,
    duration: optsOrDuration.duration ?? 0.5,
    direction: optsOrDuration.direction,
    apply: optsOrDuration.apply,
  };
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

  if (def.apply) {
    def.apply(node, t, width, height);
    return;
  }

  switch (def.type) {
    case "fade":
      anyNode.base.opacity = t;
      break;
    case "slide": {
      const dir = def.direction ?? "left";
      if (dir === "left") anyNode.base.x = (1 - t) * width;
      else if (dir === "right") anyNode.base.x = -(1 - t) * width;
      else if (dir === "up") anyNode.base.y = (1 - t) * height;
      else if (dir === "down") anyNode.base.y = -(1 - t) * height;
      break;
    }
    case "zoom":
      anyNode.base.scaleX = 0.8 + 0.2 * t;
      anyNode.base.scaleY = 0.8 + 0.2 * t;
      anyNode.base.opacity = t;
      break;
    case "wipe":
      anyNode.base.opacity = t;
      break;
    case "custom":
      break;
  }
}

/**
 * Scene-level transitions for compositions.
 *
 * Usage:
 *   scene("intro", { duration: 4, transition: whipPan("left") }, ...)
 */

import { transition, type TransitionDef } from "liosvideo";

/** Fast directional slide with a slight rotation, the classic whip pan. */
export function whipPan(
  direction: "left" | "right" | "up" | "down" = "left",
  duration = 0.34,
): TransitionDef {
  return transition((node, progress, width, height) => {
    const n = node as any;
    const p = progress;
    const ease = 1 - (1 - p) ** 3;
    if (direction === "left") n.base.x = (1 - ease) * width;
    else if (direction === "right") n.base.x = -(1 - ease) * width;
    else if (direction === "up") n.base.y = (1 - ease) * height;
    else n.base.y = -(1 - ease) * height;
    n.base.opacity = Math.min(1, p * 2.4);
    n.base.rotation = (direction === "left" || direction === "right" ? 1 : 0) * (1 - ease) * 2.2;
  }, duration);
}

/** Punch-in entrance: oversized and transparent, snapping into place. */
export function crashZoomIn(duration = 0.26): TransitionDef {
  return transition((node, progress, width, height) => {
    const n = node as any;
    const eased = 1 - (1 - progress) ** 4;
    n.base.anchorX = 0.5;
    n.base.anchorY = 0.5;
    n.base.x = width / 2;
    n.base.y = height / 2;
    n.base.scaleX = 1.24 - 0.24 * eased;
    n.base.scaleY = 1.24 - 0.24 * eased;
    n.base.opacity = Math.min(1, progress * 2.2);
  }, duration);
}

/** Digital cut: horizontal jitter that settles quickly. */
export function glitchCut(duration = 0.3): TransitionDef {
  return transition((node, progress, width) => {
    const n = node as any;
    const decay = (1 - progress) ** 2;
    n.base.x = Math.sin(progress * 47) * width * 0.035 * decay;
    n.base.opacity = Math.min(1, progress * 3);
  }, duration);
}

/** Torn-paper style wipe: reveal from the left with a tiny skew. */
export function tearWipe(duration = 0.45): TransitionDef {
  return transition((node, progress, width) => {
    const n = node as any;
    const eased = 1 - (1 - progress) ** 3;
    n.base.x = -(1 - eased) * width * 0.35;
    n.base.opacity = Math.min(1, progress * 2.6);
    n.base.rotation = (1 - eased) * -1.2;
  }, duration);
}

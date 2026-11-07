import { GroupNode, TextNode } from "../graph/kinds";
import type { Node } from "../graph/node";
import type { Box } from "./grid";

export type StackAlign = "start" | "center" | "end" | "left" | "right";

export interface StackOptions {
  /** Space between children (use layout().gap(n)). */
  gap: number;
  /** "column" (default) stacks top to bottom; "row" left to right. */
  direction?: "column" | "row";
  /** Cross-axis alignment; defaults to the box's own `align` (slots carry one), else start. */
  align?: StackAlign;
  /** Main-axis placement of the whole run inside the box. */
  justify?: "start" | "center" | "end";
  name?: string;
}

const factor = (a: StackAlign | undefined) => (a === "center" ? 0.5 : a === "end" || a === "right" ? 1 : 0);
const textAlign = (a: StackAlign | undefined) => (a === "center" ? "center" : a === "end" || a === "right" ? "right" : "left");

/**
 * Lays children out in a box and returns a group at the box's position holding them.
 * Sizes are read once, when the scene is built: text is measured (and, in a column, wrapped to the box
 * width with the stack's alignment); other nodes need an explicit width/height. Animate opacity/scale on
 * the children freely; animating their x/y replaces the stacked position.
 */
export function stack(box: Box & { align?: StackAlign }, children: Node<any>[], opts: StackOptions): GroupNode {
  const direction = opts.direction ?? "column";
  const align = opts.align ?? box.align;
  const k = factor(align);
  const g = new GroupNode({ name: opts.name ?? "stack", x: box.x, y: box.y, width: box.width, height: box.height });

  if (direction === "column") {
    for (const c of children) {
      if (c instanceof TextNode) {
        const p = c.propsAt(0);
        c.assign({ maxWidth: p.maxWidth || box.width, align: textAlign(align) });
      }
    }
  }
  const sizes = children.map((c) => {
    const p = c.propsAt(0);
    return { w: p.width, h: p.height, ax: p.anchorX, ay: p.anchorY };
  });
  const main = (s: { w: number; h: number }) => (direction === "column" ? s.h : s.w);
  const total = sizes.reduce((sum, s) => sum + main(s), 0) + opts.gap * Math.max(0, children.length - 1);
  const room = (direction === "column" ? box.height : box.width) - total;
  let cursor = room * factor(opts.justify);

  children.forEach((c, i) => {
    const s = sizes[i];
    const cross = direction === "column" ? (box.width - s.w) * k : (box.height - s.h) * k;
    const [x, y] = direction === "column" ? [cross, cursor] : [cursor, cross];
    c.assign({ x: x + s.ax * s.w, y: y + s.ay * s.h });
    cursor += main(s) + opts.gap;
    g.add(c);
  });
  return g;
}

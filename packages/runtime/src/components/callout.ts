import { CircleNode, GroupNode, RectNode, TextNode } from "../graph/kinds";
import type { ThreeNode } from "../graph/three";
import type { Vec3 } from "../three/camera_path";

export interface CalloutOptions {
  /** World-space point on the model, or a function of scene time for a part that moves. */
  target: Vec3 | ((time: number) => Vec3);
  label: string;
  /** Label position relative to the point, in pixels (default up and to the right). */
  offset?: [number, number];
  /** Fade in at this scene time (default: shown from the start). */
  at?: number;
  /** Fade out at this scene time. */
  until?: number;
  color?: string;
  /** Dot and leader line colour (default `color`). */
  accent?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  name?: string;
}

/**
 * A dot, leader line and label pinned to a 3D point of a `three()` node; it follows the point as the
 * camera moves (the node needs a `cameraPath`). Added next to the three node, on top of it.
 */
export function callout(stage: ThreeNode, o: CalloutOptions): GroupNode {
  const parent = stage.parent;
  if (!parent) throw new Error(`callout("${o.label}"): add the three() node to the scene before its callouts`);
  const u = Math.min(stage.width, stage.height) / 100;
  const [dx, dy] = o.offset ?? [u * 10, -u * 8];
  const color = o.color ?? "#ffffff";
  const accent = o.accent ?? color;
  const fontSize = o.fontSize ?? Math.max(12, u * 3.4);

  const box = new GroupNode({ name: o.name ?? "callout", opacity: o.at === undefined ? 1 : 0 });
  box.add(new CircleNode({ name: "dot", radius: u * 0.9, anchorX: 0.5, anchorY: 0.5, fill: accent }));
  box.add(
    new RectNode({
      name: "leader",
      width: Math.hypot(dx, dy),
      height: Math.max(1, u * 0.25),
      anchorY: 0.5,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      fill: accent,
    }),
  );
  box.add(
    new TextNode({
      name: "label",
      text: o.label,
      x: dx + Math.sign(dx || 1) * u * 1.5,
      y: dy,
      anchorX: dx < 0 ? 1 : 0,
      anchorY: 0.5,
      fontSize,
      fontWeight: o.fontWeight ?? 600,
      ...(o.fontFamily ? { fontFamily: o.fontFamily } : {}),
      color,
    }),
  );
  parent.add(box);

  if (o.at !== undefined) box.to({ opacity: 1 }, { at: o.at, duration: 0.3, ease: "outCubic" });
  if (o.until !== undefined) box.to({ opacity: 0 }, { at: o.until, duration: 0.3, ease: "inCubic" });
  box.drive((t) => {
    const p = stage.project(o.target, t);
    return p.visible ? { x: p.x, y: p.y } : { x: p.x, y: p.y, opacity: 0 };
  });
  return box;
}

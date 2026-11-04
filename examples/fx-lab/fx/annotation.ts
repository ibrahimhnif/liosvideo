/**
 * Annotation components: the hand-drawn circle and arrow used by reviewers
 * and educators to point at a spec, a mistake or a detail.
 */

import { circle, group, rect, shader, type GroupNode, type Node } from "liosvideo";
import { palette, rgb } from "./theme";

/** Hand-drawn ellipse that sweeps around its subject. */
export function annotationCircle(
  parent: GroupNode,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    at?: number;
    duration?: number;
    color?: string;
    thickness?: number;
    name?: string;
  },
): Node<any> {
  const [r, g, b] = rgb(opts.color ?? palette.rose);
  return parent.add(
    shader({
      name: opts.name ?? "annotation-circle",
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      uniforms: {
        color: [r, g, b, 1],
        thickness: opts.thickness ?? 0.035,
        duration: opts.duration ?? 0.6,
        t0: opts.at ?? 0,
      },
      code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let sweep = clamp(t / u.duration.x, 0.0, 1.0);
  let p = (uv - vec2f(0.5)) * 2.0;
  let ang = atan2(p.y, p.x);
  let wob = 1.0 + 0.03 * sin(ang * 7.0 + 1.1) + 0.014 * sin(ang * 13.0 + 2.3);
  let d = length(p) * wob;
  let ring = 1.0 - smoothstep(u.thickness.x, u.thickness.x * 2.0, abs(d - 0.9));
  let a01 = fract((ang + 3.14159265) / 6.2831853);
  let reveal = step(a01, sweep);
  let a = ring * reveal * 0.95;
  return vec4f(u.color.rgb * a, a);
}`,
    }),
  );
}

/** Leader arrow: shaft grows from `from`, head pops at `to`. */
export function arrowPointer(
  parent: GroupNode,
  opts: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    at?: number;
    duration?: number;
    color?: string;
    thickness?: number;
    headLength?: number;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.4;
  const color = opts.color ?? palette.rose;
  const thickness = opts.thickness ?? 4;
  const headLength = opts.headLength ?? 28;
  const dx = opts.to.x - opts.from.x;
  const dy = opts.to.y - opts.from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  const box = parent.add(group({ name: opts.name ?? "arrow-pointer", width: 0, height: 0 }));

  const shaft = box.add(
    rect({
      name: "shaft",
      x: opts.from.x,
      y: opts.from.y - thickness / 2,
      width: length,
      height: thickness,
      radius: thickness / 2,
      fill: color,
      anchorX: 0,
      rotation: angle,
    }),
  );
  shaft.set({ scaleX: 0 }, 0);
  shaft.to({ scaleX: 1 }, { at, duration, ease: "outCubic" });

  const head = box.add(group({ name: "head", opacity: 0 }));
  for (const sign of [-1, 1]) {
    const barbAngle = angle + 180 + sign * 32;
    const rad = (barbAngle * Math.PI) / 180;
    const midX = opts.to.x + Math.cos(rad) * (headLength / 2);
    const midY = opts.to.y + Math.sin(rad) * (headLength / 2);
    head.add(
      rect({
        name: `barb-${sign}`,
        x: midX,
        y: midY,
        width: headLength,
        height: thickness,
        radius: thickness / 2,
        fill: color,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: barbAngle,
      }),
    );
  }
  head.to({ opacity: 1 }, { at: at + duration * 0.8, duration: 0.15 });

  const origin = box.add(
    circle({
      name: "origin",
      radius: thickness * 1.6,
      x: opts.from.x,
      y: opts.from.y,
      anchorX: 0.5,
      anchorY: 0.5,
      fill: color,
      opacity: 0,
    }),
  );
  origin.to({ opacity: 1 }, { at, duration: 0.2 });

  return box;
}

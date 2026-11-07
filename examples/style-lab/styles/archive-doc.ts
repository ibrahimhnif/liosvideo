/**
 * Archive Documentary — dimmed archive photo, film grain and a vignette, a mono kicker, a big
 * serif headline, karaoke captions and a source/photo credit. The look of the EP1/EP2 and
 * Nayib Bukele videos.
 *
 * Start every scene with `archiveBackdrop` (photo or, until you have one, a paper texture),
 * put type in `layout()` slots, caption the narration with `narrate` (the official captions,
 * only once the VO exists) and credit every photo with `credit(root, { asset })`. Never add a
 * progress bar: the platforms draw their own.
 */
import { group, image, rect, shader, text, captions, vo, type BaseProps, type CaptionLine, type Ease, type GroupNode, type Node } from "liosvideo";

export const theme = {
  colors: {
    bg: "#080a0e",
    ink: "#f4efe6",
    amber: "#f2b33d",
    red: "#e5383b",
    dim: "#8c93a1",
    paper: "#2a2219",
  },
  fonts: { headline: "Georgia", body: "Avenir Next", kicker: "Menlo" },
  ease: { pop: "outBack" as Ease, rise: "outCubic" as Ease },
};

/** The grade lives in the backdrop (dim, grain, vignette); the layers need no filter. */
export const look: Partial<BaseProps> = {};

/** "#rrggbb" -> [r, g, b] in 0–1, for shader uniforms. */
export function rgb(hex: string): number[] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const hash21 = `
fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Moving film grain: 24 new patterns a second, the same on every render. */
export function grain(width: number, height: number, amount = 0.16): Node<any> {
  return shader({
    name: "grain",
    width,
    height,
    uniforms: { amount },
    code: `
${hash21}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = u_globals.resolution.xy;
  let step = floor(u_globals.time.x * 24.0);
  let n = hash21(floor(uv * res / 1.6) + vec2f(step * 11.3, step * 5.7)) - 0.5;
  let a = abs(n) * u.amount.x;
  return vec4f(select(vec3f(0.0), vec3f(a), n > 0.0), a);
}`,
  });
}

/** Darkens the edges of the frame. */
export function vignette(width: number, height: number, strength = 0.8): Node<any> {
  return shader({
    name: "vignette",
    width,
    height,
    uniforms: { strength },
    code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let d = distance(uv, vec2f(0.5)) * 1.414;
  return vec4f(vec3f(0.0), clamp(smoothstep(0.32, 1.05, d) * u.strength.x, 0.0, 1.0));
}`,
  });
}

/** A stained-paper texture: the stand-in backdrop until the scene has an archive photo. */
export function paper(width: number, height: number): Node<any> {
  return shader({
    name: "paper",
    width,
    height,
    uniforms: { tint: rgb(theme.colors.paper) },
    code: `
${hash21}
fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), s.x), mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), s.x), s.y);
}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u_globals.resolution.x / u_globals.resolution.y;
  let p = uv * vec2f(aspect, 1.0) * 6.0;
  let stain = noise(p) * 0.5 + noise(p * 2.1) * 0.3 + noise(p * 5.3) * 0.2;
  let fibre = hash21(floor(uv * u_globals.resolution.xy / 3.0)) * 0.06;
  return vec4f(u.tint.rgb * (0.55 + stain * 0.9 + fibre), 1.0);
}`,
  });
}

/**
 * The archive look, full frame: the photo (`src`, cover-fit, slow push-in over `duration`) or the
 * paper texture, then a dark grade, grain and a vignette. Add it first, then your type on top.
 */
export function archiveBackdrop(o: { width: number; height: number; duration: number; src?: string; dim?: number; grain?: number }): GroupNode {
  const { width, height } = o;
  const g = group({ name: "archive", width, height });
  const photo = o.src
    ? g.add(image({ name: "photo", src: o.src, x: width / 2, y: height / 2, anchorX: 0.5, anchorY: 0.5, width, height, fit: "cover" }))
    : g.add(group({ name: "photo", x: width / 2, y: height / 2, anchorX: 0.5, anchorY: 0.5, width, height }));
  if (!o.src) photo.add(paper(width, height));
  photo.to({ scaleX: 1.08, scaleY: 1.08 }, { at: 0, duration: Math.max(0.1, o.duration), ease: "linear" });
  g.add(rect({ name: "grade", width, height, fill: theme.colors.bg, opacity: o.dim ?? (o.src ? 0.78 : 0.3) }));
  g.add(grain(width, height, o.grain ?? 0.16));
  g.add(vignette(width, height));
  return g;
}

/** Fades a node in, popping from 92% (headlines) or rising a little (everything else). */
export function reveal<N extends Node<any>>(node: N, at: number, kind: "pop" | "rise" = "rise"): N {
  const p = node.propsAt(0);
  if (kind === "pop") {
    node.set({ opacity: 0, scaleX: 0.92, scaleY: 0.92 }, 0);
    node.to({ opacity: 1 }, { at, duration: 0.25, ease: "outCubic" });
    node.to({ scaleX: 1, scaleY: 1 }, { at, duration: 0.45, ease: theme.ease.pop });
  } else {
    node.set({ opacity: 0 }, 0);
    node.to({ opacity: p.opacity }, { at, duration: 0.4, ease: theme.ease.rise });
  }
  return node;
}

/** Text styles; spread a `layout().type.*` size in front: `text({ ...L.type.h1, ...headline() })`. */
export const kickerStyle = () => ({ fontFamily: theme.fonts.kicker, fontWeight: 700, color: theme.colors.amber });
export const headlineStyle = (accent = false) => ({ fontFamily: theme.fonts.headline, fontWeight: 700, color: accent ? theme.colors.red : theme.colors.ink });
export const detailStyle = () => ({ fontFamily: theme.fonts.body, fontWeight: 600, color: theme.colors.ink });

/** A kicker / headline / detail text node. */
export function line(kind: "kicker" | "headline" | "accent" | "detail", label: string, size: { fontSize: number; lineHeight?: number; fontWeight?: number }, name = kind): Node<any> {
  const style = kind === "kicker" ? kickerStyle() : kind === "detail" ? detailStyle() : headlineStyle(kind === "accent");
  return text({ name, text: label, ...size, ...style });
}

/**
 * Karaoke captions for these VO lines, in the archive palette. Returns false (and draws nothing)
 * while any line has no audio yet, so a scene previews before the voice is generated.
 */
export function narrate(root: GroupNode, lines: CaptionLine[]): boolean {
  const ids = lines.map((l) => (typeof l === "string" ? l : "id" in l ? l.id : undefined)).filter((id): id is string => !!id);
  if (!ids.every((id) => vo(id).isReady)) return false;
  captions(root, { lines, fontFamily: theme.fonts.body, color: theme.colors.ink, activeColor: "#ffd60a" });
  return true;
}

/**
 * Full-frame and stage overlays: grain, vignette, letterbox, torn paper,
 * glitch, scanlines, spotlight, speed lines, light leaks and dust.
 *
 * Overlay shaders output *premultiplied* alpha so they composite correctly
 * over whatever is underneath. `filmGrain` and `tornPaper` are opaque looks.
 */

import { circle, group, rect, seededRandom, shader, type GroupNode, type Node } from "liosvideo";
import { palette, rgb } from "./theme";

export interface OverlayOptions {
  width: number;
  height: number;
  name?: string;
  /** Scene-local second at which the effect starts. */
  at?: number;
}

const hash21 = `
fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const valueNoise = `
${hash21}
fn vnoise1(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(hash21(vec2f(i, 1.0)), hash21(vec2f(i + 1.0, 1.0)), u);
}
`;

/** Opaque archival film look: 24 fps grain, warm falloff, soft scan flicker. */
export function filmGrain(
  parent: GroupNode,
  opts: OverlayOptions & { amount?: number; at?: number } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  return parent.add(
    shader({
      name: opts.name ?? "film-grain",
      width,
      height,
      uniforms: { t0: opts.at ?? 0, amount: opts.amount ?? 0.16 },
      code: `
${hash21}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = u_globals.resolution.xy;
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let frame = floor(t * 24.0);
  let cell = floor(uv * res / 1.4);
  let n = hash21(cell + vec2f(frame * 13.7, frame * 7.31)) - 0.5;
  let vig = smoothstep(0.95, 0.18, distance(uv, vec2f(0.5)));
  let base = mix(vec3f(0.045, 0.047, 0.052), vec3f(0.28, 0.23, 0.16), 0.3 + uv.y * 0.7);
  let scan = 1.0 + sin(uv.y * res.y * 0.65 + t * 2.6) * 0.018;
  let col = base * (0.55 + 0.45 * vig) + vec3f(n) * u.amount.x * vig;
  return vec4f(col * scan, 1.0);
}`,
    }),
  );
}

/** Transparent luminance grain, for stacking on top of clean footage. */
export function grainOverlay(
  parent: GroupNode,
  opts: OverlayOptions & { amount?: number; at?: number } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  return parent.add(
    shader({
      name: opts.name ?? "grain-overlay",
      width,
      height,
      uniforms: { t0: opts.at ?? 0, amount: opts.amount ?? 0.2 },
      code: `
${hash21}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = u_globals.resolution.xy;
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let cell = floor(uv * res / 1.6);
  let n = hash21(cell + vec2f(floor(t * 24.0) * 11.3, floor(t * 24.0) * 5.7)) - 0.5;
  let a = abs(n) * u.amount.x;
  let c = select(vec3f(0.0), vec3f(1.0), n > 0.0) * a;
  return vec4f(c, a);
}`,
    }),
  );
}

/** Radial darkening around the frame. */
export function vignette(
  parent: GroupNode,
  opts: OverlayOptions & { strength?: number; name?: string } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  return parent.add(
    shader({
      name: opts.name ?? "vignette",
      width,
      height,
      uniforms: { strength: opts.strength ?? 0.75 },
      code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u_globals.time.x;
  let d = distance(uv, vec2f(0.5)) * 1.414;
  let breathe = 1.0 + 0.0025 * sin(t);
  let a = clamp(smoothstep(0.32, 1.05, d) * u.strength.x * breathe, 0.0, 1.0);
  return vec4f(vec3f(0.0), a);
}`,
    }),
  );
}

/** CRT / VHS scanlines with a slow vertical roll. */
export function scanlines(
  parent: GroupNode,
  opts: OverlayOptions & { pitch?: number; strength?: number; at?: number } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  return parent.add(
    shader({
      name: opts.name ?? "scanlines",
      width,
      height,
      uniforms: {
        pitch: opts.pitch ?? 4,
        strength: opts.strength ?? 0.22,
        t0: opts.at ?? 0,
      },
      code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = u_globals.resolution.xy;
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let y = uv.y * res.y / u.pitch.x + t * 18.0;
  let band = smoothstep(0.45, 0.55, fract(y * 0.5));
  let roll = 0.55 + 0.45 * smoothstep(0.75, 1.0, fract(uv.y - t * 0.15));
  let a = band * u.strength.x * roll;
  return vec4f(vec3f(0.0), a);
}`,
    }),
  );
}

/** Movable spotlight. `center` and `radius` are in 0..1 stage space. */
export function spotlight(
  parent: GroupNode,
  opts: OverlayOptions & {
    center?: [number, number];
    radius?: number;
    drift?: number;
    strength?: number;
    at?: number;
  } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  const center = opts.center ?? [0.5, 0.5];
  return parent.add(
    shader({
      name: opts.name ?? "spotlight",
      width,
      height,
      uniforms: {
        center: [center[0], center[1], 0, 0],
        radius: opts.radius ?? 0.24,
        drift: opts.drift ?? 0,
        strength: opts.strength ?? 0.82,
        t0: opts.at ?? 0,
      },
      code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let res = u_globals.resolution.xy;
  let aspect = res.x / max(res.y, 1.0);
  let c = u.center.xy + vec2f(sin(t * 0.9) * u.drift.x, cos(t * 0.7) * u.drift.x * 0.45);
  let d = distance((uv - c) * vec2f(aspect, 1.0), vec2f(0.0));
  let lit = smoothstep(u.radius.x, u.radius.x * 0.45, d);
  let a = (1.0 - lit) * u.strength.x;
  return vec4f(vec3f(0.0), a);
}`,
    }),
  );
}

/** Radial speed / impact lines. */
export function speedLines(
  parent: GroupNode,
  opts: OverlayOptions & {
    color?: string;
    count?: number;
    strength?: number;
    at?: number;
  } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  const [r, g, b] = rgb(opts.color ?? palette.amber);
  return parent.add(
    shader({
      name: opts.name ?? "speed-lines",
      width,
      height,
      uniforms: {
        color: [r, g, b, 1],
        count: opts.count ?? 26,
        strength: opts.strength ?? 0.9,
        t0: opts.at ?? 0,
      },
      code: `
${hash21}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let c = uv - vec2f(0.5);
  let ang = atan2(c.y, c.x);
  let rad = length(c) * 1.414;
  let jitter = hash21(vec2f(floor(ang * 14.0), floor(t * 9.0)));
  let rays = pow(abs(sin(ang * u.count.x + jitter * 0.8)), 10.0);
  let mask = smoothstep(0.18, 0.6, rad) * (1.0 - smoothstep(0.62, 1.0, rad));
  let pulse = 0.55 + 0.45 * abs(sin(t * 5.0));
  let a = rays * mask * pulse * u.strength.x;
  return vec4f(u.color.rgb * a, a);
}`,
    }),
  );
}

/** Torn archival paper sweeping across the stage, revealing the dark panel. */
export function tornPaper(
  parent: GroupNode,
  opts: OverlayOptions & { accent?: string; speed?: number; at?: number } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  const [ar, ag, ab] = rgb(opts.accent ?? palette.amber);
  return parent.add(
    shader({
      name: opts.name ?? "torn-paper",
      width,
      height,
      uniforms: {
        accent: [ar, ag, ab, 1],
        speed: opts.speed ?? 0.9,
        t0: opts.at ?? 0,
      },
      code: `
${valueNoise}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = clamp((u_globals.time.x - u.t0.x) / u.speed.x, 0.0, 1.0);
  let edge = mix(-0.08, 1.08, t);
  let wob = (vnoise1(uv.y * 24.0) - 0.5) * 0.075 + (vnoise1(uv.y * 67.0 + 5.0) - 0.5) * 0.022;
  let x = uv.x + wob;
  let paper = select(0.0, 1.0, x > edge);
  let tint = vnoise1(uv.x * 16.0 + uv.y * 38.0);
  let paperCol = mix(vec3f(0.70, 0.66, 0.56), vec3f(0.88, 0.85, 0.76), tint);
  let grain = (hash21(floor(uv * vec2f(320.0, 320.0))) - 0.5) * 0.06;
  let fiber = (vnoise1(uv.y * 150.0) - 0.5) * 0.035;
  let darkCol = mix(vec3f(0.055, 0.06, 0.07), vec3f(0.10, 0.11, 0.13), uv.y);
  var col = mix(darkCol, paperCol + vec3f(fiber + grain), paper);
  let glow = 1.0 - smoothstep(0.0, 0.010, abs(x - edge));
  col = mix(col, u.accent.rgb, glow * 0.9);
  return vec4f(col, 1.0);
}`,
    }),
  );
}

/** RGB split + block jitter. Opaque stage look. */
export function glitchRGB(
  parent: GroupNode,
  opts: OverlayOptions & { amount?: number; at?: number } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  return parent.add(
    shader({
      name: opts.name ?? "glitch-rgb",
      width,
      height,
      uniforms: { amount: opts.amount ?? 0.55, t0: opts.at ?? 0 },
      code: `
${hash21}
fn signal(p: vec2f, t: f32) -> f32 {
  let row = floor(p.y * 18.0);
  let block = hash21(vec2f(floor(p.x * 14.0), row + floor(t * 6.0)));
  let bars = step(0.5, fract(p.y * 26.0)) * 0.22;
  let scan = 0.06 * step(0.5, fract(p.y * 120.0));
  return 0.08 + block * 0.34 + bars * 0.8 + scan;
}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = u_globals.resolution.xy;
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let rows = floor(uv.y * 20.0);
  let jit = hash21(vec2f(rows, floor(t * 9.0)));
  let isOn = step(0.55, jit);
  let shift = (hash21(vec2f(rows, floor(t * 13.0))) - 0.5) * 0.16 * isOn * u.amount.x;
  let uvR = uv + vec2f(shift, 0.0);
  let uvB = uv - vec2f(shift, 0.0);
  let sr = signal(uvR, t);
  let sg = signal(uv, t);
  let sb = signal(uvB, t);
  let dropout = step(0.9, hash21(vec2f(floor(uv.y * 9.0), floor(t * 7.0)))) * 0.28;
  let hot = step(0.93, hash21(vec2f(floor(uv.x * 6.0), rows + floor(t * 11.0))));
  let flick = 0.88 + 0.12 * sin(t * 42.0);
  let rgb = vec3f(sr, sg, sb) * flick - vec3f(dropout);
  return vec4f(mix(rgb, vec3f(0.80, 0.88, 1.0), hot * 0.35) * 0.82, 1.0);
}`,
    }),
  );
}

/** Warm anamorphic light streak. */
export function lightLeak(
  parent: GroupNode,
  opts: OverlayOptions & { color?: string; strength?: number; at?: number } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  const [r, g, b] = rgb(opts.color ?? palette.amber);
  return parent.add(
    shader({
      name: opts.name ?? "light-leak",
      width,
      height,
      uniforms: { color: [r, g, b, 1], strength: opts.strength ?? 0.6, t0: opts.at ?? 0 },
      code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let cx = 0.5 + sin(t * 0.55) * 0.28;
  let band = exp(-pow((uv.x - cx) / 0.22, 2.0));
  let falloff = 1.0 - smoothstep(0.55, 1.0, abs(uv.y - 0.5) * 2.0);
  let a = band * falloff * u.strength.x;
  return vec4f(u.color.rgb * a, a);
}`,
    }),
  );
}

/** Cinematic bars. Returns the two bar nodes so callers can animate them. */
export function letterbox(
  parent: GroupNode,
  opts: {
    width: number;
    height: number;
    ratio?: number;
    color?: string;
    at?: number;
    duration?: number;
  },
): { top: ReturnType<typeof rect>; bottom: ReturnType<typeof rect> } {
  const { width, height } = opts;
  const bar = Math.round(height * (opts.ratio ?? 0.115));
  const duration = opts.duration ?? 0.55;
  const at = opts.at ?? 0;
  const fill = opts.color ?? "#000000";

  const top = parent.add(
    rect({ name: "letterbox-top", x: 0, y: 0, width, height: 0, fill }),
  );
  const bottom = parent.add(
    rect({ name: "letterbox-bottom", x: 0, y: height, width, height: 0, anchorY: 1, fill }),
  );
  top.to({ height: bar }, { at, duration, ease: "outCubic" });
  bottom.to({ height: bar }, { at, duration, ease: "outCubic" });
  return { top, bottom };
}

/** Warm pool of light. Pair with spotlight() drawn on top. */
export function lightPool(
  parent: GroupNode,
  opts: OverlayOptions & {
    color?: string;
    center?: [number, number];
    radius?: number;
    drift?: number;
    strength?: number;
    at?: number;
  } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  const [r, g, b] = rgb(opts.color ?? "#FFE7B0");
  const center = opts.center ?? [0.5, 0.5];
  return parent.add(
    shader({
      name: opts.name ?? "light-pool",
      width,
      height,
      uniforms: {
        color: [r, g, b, 1],
        center: [center[0], center[1], 0, 0],
        radius: opts.radius ?? 0.7,
        drift: opts.drift ?? 0,
        strength: opts.strength ?? 0.38,
        t0: opts.at ?? 0,
      },
      code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let res = u_globals.resolution.xy;
  let aspect = res.x / max(res.y, 1.0);
  let c = u.center.xy + vec2f(sin(t * 0.9) * u.drift.x, cos(t * 0.7) * u.drift.x * 0.45);
  let d = distance((uv - c) * vec2f(aspect, 1.0), vec2f(0.0));
  let a = smoothstep(u.radius.x, 0.0, d) * u.strength.x;
  return vec4f(u.color.rgb * a, a);
}`,
    }),
  );
}

/** Newsprint / comic halftone dots. */
export function halftone(
  parent: GroupNode,
  opts: OverlayOptions & {
    size?: number;
    strength?: number;
    color?: string;
    at?: number;
  } = { width: 0, height: 0 },
): Node<any> {
  const { width, height } = opts;
  const [r, g, b] = rgb(opts.color ?? "#05070A");
  return parent.add(
    shader({
      name: opts.name ?? "halftone",
      width,
      height,
      uniforms: {
        color: [r, g, b, 1],
        size: opts.size ?? 6,
        strength: opts.strength ?? 0.35,
        t0: opts.at ?? 0,
      },
      code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = u_globals.resolution.xy;
  let t = max(0.0, u_globals.time.x - u.t0.x);
  let cell = fract(uv * res / u.size.x + vec2f(t * 0.015, 0.0)) - vec2f(0.5);
  let dot = smoothstep(0.5, 0.16, length(cell));
  let shade = 0.3 + 0.7 * smoothstep(0.0, 1.0, uv.y);
  let a = dot * shade * u.strength.x;
  return vec4f(u.color.rgb * a, a);
}`,
    }),
  );
}

/** Seeded drifting dust motes (archival / 35 mm atmosphere). */
export function dustMotes(
  parent: GroupNode,
  opts: OverlayOptions & {
    count?: number;
    seed?: number;
    color?: string;
    duration?: number;
  } = { width: 0, height: 0 },
): GroupNode {
  const { width, height } = opts;
  const count = opts.count ?? 18;
  const rand = seededRandom(String(opts.seed ?? 7));
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 3;
  const motes = parent.add(group({ name: opts.name ?? "dust-motes", width, height }));

  for (let i = 0; i < count; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const r = 0.6 + rand() * 1.7;
    const drift = 10 + rand() * 26;
    const delay = rand() * 0.6;
    const peak = 0.25 + rand() * 0.45;
    const mote = motes.add(
      circle({
        name: `mote-${i}`,
        radius: r,
        x,
        y,
        fill: opts.color ?? "#E8DCC0",
        opacity: 0,
      }),
    );
    mote.to({ opacity: peak }, { at: at + delay, duration: 0.5 });
    mote.to(
      { y: y - drift, x: x + (rand() - 0.5) * 18, opacity: 0 },
      { at: at + delay + 0.5, duration, ease: "linear" },
    );
  }
  return motes;
}

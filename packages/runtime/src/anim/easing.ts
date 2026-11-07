export type EaseName =
  | "linear"
  | "inQuad"
  | "outQuad"
  | "inOutQuad"
  | "inCubic"
  | "outCubic"
  | "inOutCubic"
  | "outBack"
  | "inExpo"
  | "outExpo"
  | "inOutExpo"
  | "inSine"
  | "outSine"
  | "inOutSine";

export type Ease = EaseName | ((t: number) => number);

const C1 = 1.70158;
const C3 = C1 + 1;

const EASINGS: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => 1 + C3 * (t - 1) ** 3 + C1 * (t - 1) ** 2,
  inExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

/** Every built-in easing name, in documentation order. */
export const EASE_NAMES = Object.keys(EASINGS) as EaseName[];

export function isEase(e: unknown): e is Ease {
  return typeof e === "function" || (typeof e === "string" && Object.hasOwn(EASINGS, e));
}

export function ease(e: Ease, t: number): number {
  const fn = typeof e === "function" ? e : Object.hasOwn(EASINGS, e) ? EASINGS[e] : undefined;
  if (!fn) throw new Error(`Unknown ease ${JSON.stringify(e)}. Use one of: ${EASE_NAMES.join(", ")}`);
  const c = Math.min(1, Math.max(0, t));
  if (c === 0) return 0;
  if (c === 1) return 1;
  return fn(c);
}

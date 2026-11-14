import type { Filters } from "../renderlist";

/**
 * Where the sticker line sits in the layer blurred by `sigma`: outside a straight edge, Gaussian-blurred
 * alpha at distance d is Φ(−d/σ), so the line between `gap` and `gap + width` is the band of blurred
 * alpha between Φ(−gap/σ) (`inner`) and Φ(−(gap + width)/σ) (`outer`). σ puts the outer edge at
 * 1.6σ, where 8-bit alpha still resolves it well; the blur shader's 64 px radius caps σ at 21 device px.
 * Mirrored in apps/cli/src/gpu/renderer/mod.rs (`sticker_params`).
 */
export function stickerParams(f: Pick<Filters, "sticker" | "stickerGap" | "stickerWobble">, sx: number) {
  const width = Math.max(f.sticker, 0) * sx;
  const gap = Math.max(f.stickerGap, 0) * sx;
  const total = width + gap;
  const sigma = Math.min(Math.max(total / 1.6, 0.5), 21);
  return {
    sigma,
    inner: phi(-gap / sigma),
    outer: phi(-total / sigma),
    /** wobble amplitude and wavelength, device px */
    wobble: Math.min(Math.max(f.stickerWobble, 0), 1) * total * 0.35,
    wave: Math.max(total * 2.5, 1),
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function phi(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

import { describe, expect, it } from "vitest";
import { phi, stickerParams } from "../../src/gpu/sticker";

describe("sticker line levels", () => {
  it("phi is the standard normal CDF", () => {
    expect(phi(0)).toBeCloseTo(0.5, 6);
    expect(phi(-1)).toBeCloseTo(0.158655, 5);
    expect(phi(1.6)).toBeCloseTo(0.945201, 5);
  });

  it("puts the band between the gap and gap + width, in device px", () => {
    const p = stickerParams({ sticker: 6, stickerGap: 10, stickerWobble: 0.5 }, 2);
    expect(p.sigma).toBeCloseTo(20); // (12 + 20) / 1.6
    expect(p.inner).toBeCloseTo(phi(-1), 6); // gap 20 px = 1 σ
    expect(p.outer).toBeCloseTo(phi(-1.6), 6);
    expect(p.inner).toBeGreaterThan(p.outer);
    expect(p.wobble).toBeCloseTo(0.5 * 32 * 0.35);
  });

  it("a line with no gap starts at the shape's edge, and a wide one is capped by the blur radius", () => {
    expect(stickerParams({ sticker: 4, stickerGap: 0, stickerWobble: 0 }, 1).inner).toBeCloseTo(0.5, 6);
    expect(stickerParams({ sticker: 80, stickerGap: 20, stickerWobble: 0 }, 1).sigma).toBe(21);
  });
});

import { describe, expect, it } from "vitest";
import { lerpColor, parseColor } from "../src/math/color";

describe("color", () => {
  it("parses short hex", () => {
    expect(parseColor("#f00")).toEqual([1, 0, 0, 1]);
  });

  it("parses hex with alpha", () => {
    expect(parseColor("#00ff0080")[3]).toBeCloseTo(128 / 255);
  });

  it("lerps between colors and formats as #rrggbbaa", () => {
    expect(lerpColor("#000000", "#ffffff", 0.5)).toBe("#808080ff");
  });
});

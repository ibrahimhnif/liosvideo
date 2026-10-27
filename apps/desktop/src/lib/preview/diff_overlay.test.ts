import { describe, expect, it } from "vitest";

describe("Reference Overlay Mode", () => {
  it("calculates perceptual difference blend style", () => {
    const getOverlayStyle = (mode: "blend" | "difference", opacity: number) => ({
      mixBlendMode: mode === "difference" ? "difference" : "normal",
      opacity: mode === "difference" ? 1 : opacity,
    });

    expect(getOverlayStyle("blend", 0.5)).toEqual({
      mixBlendMode: "normal",
      opacity: 0.5,
    });

    expect(getOverlayStyle("difference", 0.5)).toEqual({
      mixBlendMode: "difference",
      opacity: 1,
    });
  });
});

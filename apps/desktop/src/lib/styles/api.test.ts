import { describe, expect, it } from "vitest";
import { stylePrompt } from "./api";

describe("stylePrompt", () => {
  it("restyles the whole video without a selection", () => {
    expect(stylePrompt("Comic Art", "comic")).toBe(
      "Restyle this video in the Comic Art style — follow .agents/skills/liosvideo/styles/comic.md and use styles/comic.ts.",
    );
  });

  it("restyles the selection when there is one", () => {
    expect(stylePrompt("Pixel Art", "pixel-art", "intro/title (0.20–0.80s)")).toBe(
      "Restyle intro/title (0.20–0.80s) in the Pixel Art style — follow .agents/skills/liosvideo/styles/pixel-art.md and use styles/pixel-art.ts.",
    );
  });
});

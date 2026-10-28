import { describe, expect, it } from "vitest";
import { shouldRebuild, touchesAudio } from "./rebuild";

describe("shouldRebuild", () => {
  const files = new Set(["long.ts", "scenes/a.ts"]);

  it("rebuilds when a file of the last good build changes", () => {
    expect(shouldRebuild(["scenes/a.ts"], files, true)).toBe(true);
  });

  it("ignores unrelated files after a good build", () => {
    expect(shouldRebuild(["scenes/other.ts", "notes.md"], files, true)).toBe(false);
  });

  it("rebuilds on new root composition files", () => {
    expect(shouldRebuild(["teaser.ts"], files, true)).toBe(true);
  });

  it("rebuilds on any TypeScript change while the last build failed", () => {
    expect(shouldRebuild(["scenes/new.ts"], files, false)).toBe(true);
    expect(shouldRebuild(["assets/a.png"], files, false)).toBe(false);
  });

  it("detects audio and timing changes with touchesAudio", () => {
    expect(touchesAudio(["assets/audio/vo/intro-1.mp3"])).toBe(true);
    expect(touchesAudio(["assets/audio/vo/intro-1.timing.json"])).toBe(true);
    expect(touchesAudio(["custom/audio/track.wav"])).toBe(true);
    expect(touchesAudio(["scenes/intro.ts", "notes.md"])).toBe(false);
  });
});

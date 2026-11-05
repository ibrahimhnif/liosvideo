import { describe, expect, it } from "vitest";
import { detectOutOfScopeChanges } from "./scope_warning";

describe("detectOutOfScopeChanges", () => {
  it("detects no out-of-scope files when changes match selected scene and composition", () => {
    const selection = { composition: "long.ts", sceneFile: "scenes/intro.ts" };
    const changed = ["scenes/intro.ts", "long.ts", "assets/audio/vo/line-1.mp3", "script.md"];

    const result = detectOutOfScopeChanges(changed, selection);
    expect(result.hasOutOfScope).toBe(false);
    expect(result.outOfScopeFiles).toEqual([]);
  });

  it("flags other scene files and compositions as out-of-scope", () => {
    const selection = { composition: "long.ts", sceneFile: "scenes/intro.ts" };
    const changed = [
      "scenes/intro.ts",
      "scenes/outro.ts",
      "short.ts",
    ];

    const result = detectOutOfScopeChanges(changed, selection);
    expect(result.hasOutOfScope).toBe(true);
    expect(result.outOfScopeFiles).toEqual(["scenes/outro.ts", "short.ts"]);
  });

  it("allows every scene file a time range overlaps", () => {
    const selection = {
      composition: "long.ts",
      scenes: [{ file: "scenes/intro.ts" }, { file: "scenes/features.ts" }],
    };
    const changed = ["scenes/intro.ts", "scenes/features.ts", "long.ts", "scenes/outro.ts"];
    expect(detectOutOfScopeChanges(changed, selection).outOfScopeFiles).toEqual(["scenes/outro.ts"]);
  });

  it("returns no out-of-scope when there is no active selection", () => {
    const result = detectOutOfScopeChanges(["scenes/outro.ts"]);
    expect(result.hasOutOfScope).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildCoordinator, bundleComposition, type BuildResult } from "./bundler";

const files: Record<string, string> = {
  "long.ts": `import { composition } from "liosvideo";\nimport intro from "./scenes/intro";\nexport default composition({ width: 1920, height: 1080, fps: 30, scenes: [intro] });\n`,
  "scenes/intro.ts": `import { scene } from "liosvideo";\nimport { color } from "./util";\nexport default scene("intro", { duration: 1, background: color }, () => {});\n`,
  "scenes/util/index.ts": `export const color = "#123456";\n`,
  "missing.ts": `import x from "./nope";\nexport default x;\n`,
  "node.ts": `import fs from "fs";\nexport default fs;\n`,
  "syntax.ts": `export default {\n  oops: ,\n};\n`,
  "escape.ts": `import x from "../shared/x";\nexport default x;\n`,
  "shared/x.ts": `export default 1;\n`,
  "dynamic.ts": `const url = "https://example.com/x.js";\nexport default await import(url);\n`,
};
const readFile = async (rel: string) => {
  if (!(rel in files)) throw new Error(`not found: ${rel}`);
  return files[rel];
};

describe("bundleComposition", () => {
  it("bundles relative imports and maps liosvideo to the global runtime", async () => {
    const r = await bundleComposition("long.ts", readFile);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.sort()).toEqual(["long.ts", "scenes/intro.ts", "scenes/util/index.ts"]);
    const fakeRuntime = {
      composition: (c: object) => ({ kind: "comp", ...c }),
      scene: (id: string, opts: object) => ({ id, ...opts }),
    };
    const project = new Function("globalThis", `${r.code};return __liosProject`)({ __liosvideo: fakeRuntime });
    expect(project.default).toMatchObject({ kind: "comp", scenes: [{ id: "intro", background: "#123456" }] });
  });

  it("bundles import * as THREE from 'three' and maps to global runtime", async () => {
    const filesWithThree: Record<string, string> = {
      ...files,
      "three_scene.ts": `import * as THREE from "three";\nexport default THREE;\n`,
    };
    const r = await bundleComposition("three_scene.ts", async (rel) => filesWithThree[rel]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fakeThree = { BoxGeometry: class {} };
    const project = new Function("globalThis", `${r.code};return __liosProject`)({ THREE: fakeThree });
    expect(project.default.BoxGeometry).toBe(fakeThree.BoxGeometry);
  });

  it("reports a missing import with file and line", async () => {
    const r = await bundleComposition("missing.ts", readFile);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ file: "missing.ts", line: 1 });
  });

  it("rejects bare imports other than liosvideo and three", async () => {
    const r = await bundleComposition("node.ts", readFile);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toContain("Only 'liosvideo', 'three', and relative imports are allowed");
  });

  it("reports syntax errors with file and line", async () => {
    const r = await bundleComposition("syntax.ts", readFile);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ file: "syntax.ts", line: 2 });
  });
});

describe("bundleComposition sandbox rules", () => {
  it("rejects imports that climb out of the project instead of clamping them", async () => {
    const r = await bundleComposition("escape.ts", readFile);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ file: "escape.ts", line: 1 });
    expect(r.errors[0].message).toContain("outside the project");
  });

  it("rejects dynamic import() with its location", async () => {
    const r = await bundleComposition("dynamic.ts", readFile);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ file: "dynamic.ts", line: 2 });
    expect(r.errors[0].message).toContain("Dynamic import() is not allowed in scenes");
  });
});

describe("BuildCoordinator", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces bursts of triggers into one build", async () => {
    vi.useFakeTimers();
    const build = vi.fn(async (): Promise<BuildResult> => ({ ok: true, code: "", files: [] }));
    const coord = new BuildCoordinator(build, () => {}, 80);
    coord.trigger();
    await vi.advanceTimersByTimeAsync(40);
    coord.trigger();
    await vi.advanceTimersByTimeAsync(40);
    coord.trigger();
    await vi.advanceTimersByTimeAsync(100);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("drops results of builds that finish after a newer build", async () => {
    vi.useFakeTimers();
    const resolvers: ((r: BuildResult) => void)[] = [];
    const build = () => new Promise<BuildResult>((res) => resolvers.push(res));
    const results: BuildResult[] = [];
    const coord = new BuildCoordinator(build, (r) => results.push(r), 10);
    coord.trigger();
    await vi.advanceTimersByTimeAsync(20);
    coord.trigger();
    await vi.advanceTimersByTimeAsync(20);
    expect(resolvers).toHaveLength(2);
    resolvers[1]({ ok: true, code: "second", files: [] });
    await Promise.resolve();
    resolvers[0]({ ok: true, code: "first", files: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(results.map((r) => (r.ok ? r.code : ""))).toEqual(["second"]);
  });
});

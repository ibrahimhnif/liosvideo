import { describe, expect, it } from "vitest";
import { bundleComposition } from "../bundle/bundler";
import { locate } from "./sourcemap";

const files: Record<string, string> = {
  "long.ts": `import { composition } from "liosvideo";\nimport x from "./scenes/x";\nexport default composition({ width: 1, height: 1, fps: 30, scenes: [x] });\n`,
  "scenes/x.ts": `import { scene } from "liosvideo";\nexport default scene("x", { duration: 1 }, () => {\n  throw new Error("boom");\n});\n`,
};

describe("locate", () => {
  it("maps a blob stack frame back to the project file and line", async () => {
    const r = await bundleComposition("long.ts", async (rel) => files[rel]);
    if (!r.ok) throw new Error("bundle failed");
    const lines = r.code.split("\n");
    const line = lines.findIndex((l) => l.includes('throw new Error("boom")')) + 1;
    const column = lines[line - 1].indexOf("throw") + 1;
    const stack = `Error: boom\n    at build (blob:http://localhost/1234-abcd:${line}:${column})\n    at instantiateScene (http://localhost/runtime.js:10:5)`;
    expect(locate(stack, r.code)).toMatchObject({ file: "scenes/x.ts", line: 3 });
  });

  it("handles JavaScriptCore stack format", async () => {
    const r = await bundleComposition("long.ts", async (rel) => files[rel]);
    if (!r.ok) throw new Error("bundle failed");
    const lines = r.code.split("\n");
    const line = lines.findIndex((l) => l.includes('throw new Error("boom")')) + 1;
    const column = lines[line - 1].indexOf("throw") + 1;
    expect(locate(`build@blob:tauri://localhost/5678:${line}:${column}\nfoo@x.js:1:1`, r.code)).toMatchObject({ file: "scenes/x.ts", line: 3 });
  });

  it("returns undefined when no frame points into the bundle", () => {
    expect(locate("Error\n    at f (http://localhost/a.js:1:1)", "var x;")).toBeUndefined();
  });
});

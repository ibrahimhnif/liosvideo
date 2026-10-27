import { afterEach, describe, expect, it } from "vitest";
import { PreviewHost } from "./host";

const project = (body: string) =>
  `var __liosProject = (() => { const L = globalThis.__liosvideo; return { default: ${body} }; })();`;

let host: PreviewHost | undefined;
afterEach(() => host?.dispose());

function makeHost() {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  host = new PreviewHost(canvas, async () => createImageBitmap(new ImageData(1, 1)));
  return host;
}

describe("render worker sandbox", () => {
  it("loads a valid composition", async () => {
    const info = await makeHost().load(
      project(`L.composition({ width: 320, height: 180, fps: 30, scenes: [L.scene("s", { duration: 1 }, () => {})] })`),
    );
    expect(info.totalFrames).toBe(30);
    expect(info.scenes).toEqual([{ id: "s", startFrame: 0, endFrame: 30 }]);
  });

  it("blocks network access from scene code", async () => {
    const code = project(
      `L.composition({ width: 320, height: 180, fps: 30, scenes: [L.scene("s", { duration: 1 }, () => { fetch("https://example.com"); })] })`,
    );
    await expect(makeHost().load(code)).rejects.toThrow("fetch is not available in scenes");
  });

  it("rejects entries that don't export a composition", async () => {
    await expect(makeHost().load(project("42"))).rejects.toThrow("Entry file must default-export composition(...)");
  });

  it("renders frames after loading", async () => {
    const h = makeHost();
    await h.load(project(`L.composition({ width: 64, height: 64, fps: 30, scenes: [L.scene("s", { duration: 1 }, ({ root }) => { root.add(L.rect({ width: 10, height: 10 })); })] })`));
    const errors: string[] = [];
    h.onError((e) => errors.push(e.message));
    await h.renderFrame(5);
    expect(errors).toEqual([]);
  });

  it("keeps the previous composition when a reload fails", async () => {
    const h = makeHost();
    await h.load(project(`L.composition({ width: 64, height: 64, fps: 30, scenes: [L.scene("s", { duration: 1 }, () => {})] })`));
    await expect(h.load(project(`L.composition({ width: 64, height: 64, fps: 30, scenes: [L.scene("s", { duration: 1 }, () => { throw new Error("broken scene"); })] })`))).rejects.toThrow("broken scene");
    const errors: string[] = [];
    h.onError((e) => errors.push(e.message));
    await h.renderFrame(3);
    expect(errors).toEqual([]);
  });
});

describe("snapshot", () => {
  it("returns a PNG of the last rendered frame", async () => {
    const h = makeHost();
    h.resize(64, 64);
    await h.load(project(`L.composition({ width: 64, height: 64, fps: 30, scenes: [L.scene("s", { duration: 1, background: "#ff0000" }, () => {})] })`));
    await h.renderFrame(0);
    const png = new Uint8Array(await h.snapshot());
    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    const bmp = await createImageBitmap(new Blob([png]));
    const ctx = new OffscreenCanvas(64, 64).getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    expect([...ctx.getImageData(10, 10, 1, 1).data]).toEqual([255, 0, 0, 255]);
  });
});

describe("text layout in the worker", () => {
  it("centers anchored text using measured size", async () => {
    const h = makeHost();
    h.resize(256, 64);
    await h.load(
      project(`L.composition({ width: 256, height: 64, fps: 30, scenes: [L.scene("s", { duration: 1 }, ({ root }) => {
        root.add(L.text({ text: "MMMMMM", fontSize: 24, x: 128, y: 32, anchorX: 0.5, anchorY: 0.5 }));
      })] })`),
    );
    await h.renderFrame(0);
    const bmp = await createImageBitmap(new Blob([await h.snapshot()]));
    const ctx = new OffscreenCanvas(256, 64).getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, 256, 64).data;
    const lit: number[] = [];
    for (let x = 0; x < 256; x++) for (let y = 0; y < 64; y++) if (data[(y * 256 + x) * 4] > 128) lit.push(x);
    const center = (Math.min(...lit) + Math.max(...lit)) / 2;
    expect(Math.abs(center - 128)).toBeLessThan(4);
  });
});

describe("scene error locations", () => {
  it("reports the project file and line of a throw in scene code", async () => {
    const { bundleComposition } = await import("../bundle/bundler");
    const files: Record<string, string> = {
      "long.ts": `import { composition } from "liosvideo";\nimport x from "./scenes/x";\nexport default composition({ width: 64, height: 64, fps: 30, scenes: [x] });\n`,
      "scenes/x.ts": `import { scene } from "liosvideo";\nexport default scene("x", { duration: 1 }, () => {\n  throw new Error("boom");\n});\n`,
    };
    const r = await bundleComposition("long.ts", async (rel) => files[rel]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const err = await makeHost().load(r.code).catch((e) => e);
    expect(err.message).toBe("boom");
    expect(err.location).toMatchObject({ file: "scenes/x.ts", line: 3 });
  });
});

describe("more network paths are blocked", () => {
  for (const [name, call] of [
    ["FontFace", `new FontFace("x", "url(https://example.com/x.woff2)")`],
    ["WebTransport", `new WebTransport("https://example.com")`],
    ["fonts", `self.fonts.add`],
  ]) {
    it(`blocks ${name}`, async () => {
      const code = project(`L.composition({ width: 32, height: 32, fps: 30, scenes: [L.scene("s", { duration: 1 }, () => { ${call}; })] })`);
      await expect(makeHost().load(code)).rejects.toThrow(`${name} is not available in scenes`);
    });
  }
});

describe("load ordering", () => {
  it("applies back-to-back loads in the order they were sent", async () => {
    const h = makeHost();
    h.resize(16, 16);
    const slow = project(`L.composition({ width: 16, height: 16, fps: 30, scenes: [L.scene("s", { duration: 1, background: "#ff0000" }, () => { const t = performance.now(); while (performance.now() - t < 300) {} })] })`);
    const fast = project(`L.composition({ width: 16, height: 16, fps: 30, scenes: [L.scene("s", { duration: 1, background: "#0000ff" }, () => {})] })`);
    const a = h.load(slow).catch(() => {});
    await h.load(fast);
    await a;
    await h.renderFrame(0);
    const bmp = await createImageBitmap(new Blob([await h.snapshot()]));
    const ctx = new OffscreenCanvas(16, 16).getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    expect([...ctx.getImageData(8, 8, 1, 1).data]).toEqual([0, 0, 255, 255]);
  });
});

describe("timeline manifest", () => {
  it("is sent with every load", async () => {
    const info = await makeHost().load(
      project(`L.composition({ width: 32, height: 32, fps: 30, scenes: [L.scene("s", { duration: 1 }, ({ root }) => {
        root.add(L.group({ name: "desktop" })).add(L.rect({ name: "win" })).to({ x: 5 }, { at: 0.2, duration: 0.2 });
      })] })`),
    );
    expect(info.manifest.scenes[0].tree.children[0].children[0]).toMatchObject({
      path: "s/desktop/win",
      spans: [{ startFrame: 6, endFrame: 12 }],
    });
  });
});

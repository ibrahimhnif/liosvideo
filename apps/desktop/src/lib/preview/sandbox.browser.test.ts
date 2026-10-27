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

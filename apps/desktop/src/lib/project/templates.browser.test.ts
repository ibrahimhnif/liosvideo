import { afterEach, describe, expect, it } from "vitest";
import longTs from "../../../src-tauri/templates/long.ts?raw";
import shortTs from "../../../src-tauri/templates/short.ts?raw";
import introTs from "../../../src-tauri/templates/scenes/intro.ts?raw";
import { bundleComposition } from "../bundle/bundler";
import { PreviewHost } from "../preview/host";

const files: Record<string, string> = { "long.ts": longTs, "short.ts": shortTs, "scenes/intro.ts": introTs };
const readFile = async (rel: string) => {
  if (!(rel in files)) throw new Error(`not found: ${rel}`);
  return files[rel];
};

let host: PreviewHost | undefined;
afterEach(() => host?.dispose());

describe("new project templates", () => {
  for (const entry of ["long.ts", "short.ts"]) {
    it(`${entry} bundles and loads`, async () => {
      const built = await bundleComposition(entry, readFile);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      host = new PreviewHost(canvas, async () => createImageBitmap(new ImageData(1, 1)));
      const info = await host.load(built.code);
      expect(info.totalFrames).toBe(90);
      expect(info.scenes[0].id).toBe("intro");
    });
  }
});

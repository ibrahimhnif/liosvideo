import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composition, type SceneDef } from "../src/composition";
import { buildManifest } from "../src/manifest";
import { STYLES } from "../../../examples/style-lab/styles/catalog";
import showcase from "../../../examples/style-lab/showcase";
import long from "../../../examples/style-lab/long";

const LAB = join(__dirname, "../../../examples/style-lab");
const styleMods = import.meta.glob("../../../examples/style-lab/styles/*.ts", { eager: true }) as Record<string, Record<string, any>>;
const sceneMods = import.meta.glob("../../../examples/style-lab/scenes/*.ts", { eager: true }) as Record<string, { default: SceneDef }>;
const styleOf = (id: string) => styleMods[`../../../examples/style-lab/styles/${id}.ts`];
const sceneOf = (id: string) => sceneMods[`../../../examples/style-lab/scenes/${id}.ts`]?.default;

const IDS = ["pixel-art", "chalkboard", "glow-sketch", "ps2-lowpoly", "comic", "flat-vector", "minimal-mono", "cgi-motion", "brick", "explainer-3d"];

function countNodes(tree: { children: any[] }): number {
  return 1 + tree.children.reduce((n, c) => n + countNodes(c), 0);
}

function manifest(scene: SceneDef, width: number, height: number) {
  const m = buildManifest(composition({ width, height, fps: 30, scenes: [scene] }));
  return { ...m, scenes: m.scenes.map(({ site: _, ...s }) => s) };
}

describe("style lab", () => {
  it("catalogues the ten styles in spec order", () => {
    expect(STYLES.map((s) => s.id)).toEqual(IDS);
    expect(STYLES.filter((s) => s.three).map((s) => s.id)).toEqual(["ps2-lowpoly", "cgi-motion", "brick", "explainer-3d"]);
  });

  it("every catalogued style has a module, a demo scene and a doc", () => {
    for (const s of STYLES) {
      for (const f of [`styles/${s.id}.ts`, `scenes/${s.id}.ts`, `docs/${s.id}.md`]) expect(existsSync(join(LAB, f)), f).toBe(true);
    }
  });

  it("demo scenes build deterministically at 16:9 and 9:16", () => {
    for (const s of STYLES) {
      const scene = sceneOf(s.id);
      expect(scene?.id, s.id).toBe(s.id);
      for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
        const a = manifest(scene, w, h);
        expect(countNodes(a.scenes[0].tree), s.id).toBeGreaterThanOrEqual(3);
        expect(manifest(scene, w, h)).toEqual(a);
      }
    }
  });

  it("style files import only liosvideo and three", () => {
    for (const dir of ["styles", "scenes"]) {
      for (const f of readdirSync(join(LAB, dir)).filter((n) => n.endsWith(".ts"))) {
        const src = readFileSync(join(LAB, dir, f), "utf8");
        for (const [, spec] of src.matchAll(/from\s+"([^"]+)"/g)) {
          expect(spec === "liosvideo" || spec === "three" || spec.startsWith("./") || spec.startsWith("../"), `${dir}/${f}: ${spec}`).toBe(true);
        }
      }
    }
  });

  it("no nondeterminism", () => {
    for (const dir of ["styles", "scenes"]) {
      for (const f of readdirSync(join(LAB, dir)).filter((n) => n.endsWith(".ts"))) {
        const src = readFileSync(join(LAB, dir, f), "utf8");
        expect(src, `${dir}/${f}`).not.toMatch(/Math\.random|Date\.now|\bawait\b|new Promise/);
      }
    }
  });

  it("filter looks are used", () => {
    expect(styleOf("pixel-art").look.pixelate).toBeGreaterThan(0);
    expect(styleOf("pixel-art").look.posterize).toBeGreaterThan(0);
    expect(styleOf("comic").look.outline).toBeGreaterThan(0);
    expect(styleOf("comic").look.halftone).toBeGreaterThan(0);
    expect(styleOf("chalkboard").look.chalk).toBeGreaterThan(0);
    expect(styleOf("glow-sketch").look.glow).toBeGreaterThan(0);
  });

  it("every style module exports theme and look", () => {
    for (const s of STYLES) {
      expect(styleOf(s.id)?.theme?.colors, s.id).toBeTypeOf("object");
      expect(styleOf(s.id)?.look, s.id).toBeTypeOf("object");
    }
  });

  it("3D styles use three()", () => {
    const kinds = (n: { kind: string; children: any[] }): string[] => [n.kind, ...n.children.flatMap(kinds)];
    for (const s of STYLES.filter((x) => x.three)) {
      expect(kinds(manifest(sceneOf(s.id), 1080, 1920).scenes[0].tree), s.id).toContain("three");
    }
  });

  it("the showcase lists every style once", () => {
    const ids = ["title", ...STYLES.map((s) => s.id)];
    expect(buildManifest(showcase).scenes.map((s) => s.id)).toEqual(ids);
    expect([showcase.width, showcase.height, showcase.fps]).toEqual([1080, 1920, 30]);
    expect(buildManifest(long).scenes.map((s) => s.id)).toEqual(ids);
    expect([long.width, long.height]).toEqual([1920, 1080]);
  });
});

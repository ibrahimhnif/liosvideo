import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EASE_NAMES, ease } from "../src/anim/easing";
import { transition } from "../src/anim/transition";
import { group, image, rect, text } from "../src/graph/kinds";

describe("easing names", () => {
  it("supports the Sine family agents reach for", () => {
    expect(ease("inOutSine", 0.5)).toBeCloseTo(0.5, 9);
    expect(ease("inSine", 0.5)).toBeCloseTo(1 - Math.cos(Math.PI / 4), 9);
    expect(ease("outSine", 0.5)).toBeCloseTo(Math.sin(Math.PI / 4), 9);
    expect(ease("outExpo", 1)).toBe(1);
    expect(ease("inExpo", 0.5)).toBeCloseTo(2 ** -5, 9);
  });

  it("gives the same clear error when ease() itself gets an unknown name", () => {
    expect(() => ease("nope" as any, 0.5)).toThrow(/Unknown ease "nope"/);
  });

  it("matches the scene validator's list in both Rust copies", () => {
    for (const file of ["../../../apps/cli/src/project/scene_validator.rs", "../../../apps/desktop/src-tauri/src/scene_validator.rs"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      const list = /const EASE_NAMES: &\[&str\] = &\[([^\]]*)\]/.exec(src)?.[1] ?? "";
      expect([...list.matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual(EASE_NAMES);
    }
  });

  it("rejects an unknown ease when the keyframe is written, naming node, property and call site", () => {
    const title = text({ name: "title", text: "hi" });
    let message = "";
    try {
      title.to({ opacity: 1 }, { at: 0.2, duration: 0.5, ease: "bouncy" as any });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Unknown ease "bouncy" on node "title" \(opacity\)/);
    expect(message).toMatch(/enums\.test\.ts:\d+/);
    expect(message).toMatch(/Use one of: linear, inQuad, .*inOutSine/);
  });
});

describe("enum props", () => {
  it("rejects an unknown image fit when the node is made", () => {
    expect(() => image({ name: "hero", src: "a.png", fit: "stretch" as any })).toThrow(
      /Unknown fit "stretch" on node "hero".*Use one of: fill, contain, cover/,
    );
  });

  it("rejects an unknown text align, also through set() and to()", () => {
    expect(() => text({ name: "t", align: "middle" as any })).toThrow(/Unknown align "middle" on node "t"/);
    const t = text({ name: "t2" });
    expect(() => t.set({ align: "justify" as any }, 1)).toThrow(/Unknown align "justify" on node "t2"/);
    expect(() => t.assign({ align: "centre" as any })).toThrow(/Unknown align "centre"/);
  });

  it("still accepts every valid value", () => {
    expect(() => {
      for (const fit of ["fill", "contain", "cover"] as const) image({ src: "a.png", fit });
      for (const align of ["left", "center", "right"] as const) text({ align });
      group().add(rect()).to({ x: 1 }, { at: 0, duration: 1, ease: (t) => t });
    }).not.toThrow();
  });

  it("rejects an unknown transition and direction", () => {
    expect(() => transition("dissolve" as any)).toThrow(/Unknown transition "dissolve".*fade, slide, zoom, wipe/);
    expect(() => transition("slide", { direction: "sideways" as any })).toThrow(/Unknown direction "sideways"/);
  });
});

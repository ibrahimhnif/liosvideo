import { describe, expect, it } from "vitest";
import { spriteCharacter, spriteProp, type SpriteCastCharacter, type SpriteCastProp } from "../src/components/spritecast";
import { composition, scene } from "../src/composition";
import { collectAssets, evaluateFrame } from "../src/evaluate";
import { image } from "../src/graph/kinds";

const FACINGS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];
const strips = (prefix: string, facings = FACINGS) => Object.fromEntries(facings.map((f) => [f, `${prefix}-${f}.png`]));
const shadows = (prefix: string, n: number, facings = FACINGS) =>
  Object.fromEntries(facings.map((f) => [f, Array.from({ length: n }, (_, i) => ({ file: `shadows/${prefix}-${f}-${i}.png`, offset: [-30, 118] as [number, number] }))]));

/** rain_girl's character.json, trimmed: 165×256 frames, 8 walk frames at 6.76 fps, a one-shot 8-frame slash with a trail. */
const girl: SpriteCastCharacter = {
  frame: [165, 256],
  anchor: [0.5, 0.875],
  fps: 6.76,
  walk: strips("walk"),
  idle: strips("idle"),
  shadows: {
    walk: shadows("walk", 8),
    idle: Object.fromEntries(FACINGS.map((f) => [f, { file: `shadows/idle-${f}.png`, offset: [-35, 119] as [number, number] }])),
  },
  actions: {
    slash: {
      frame: [299, 324],
      anchor: [0.5, 0.9],
      frames: 8,
      loop: false,
      fps: 4,
      strips: strips("slash"),
      shadows: shadows("slash", 8),
      trail: Object.fromEntries(FACINGS.map((f) => [f, { file: `slash-${f}-trail.png`, frame: [173, 400] as [number, number], offset: [7, 16] as [number, number], frames: 24, per_frame: 3 }])),
    },
  },
  sit: {
    frame: [132, 221],
    ...Object.fromEntries(FACINGS.map((f) => [f, { file: `sit-${f}.png`, seat: [0.5, 0.6] as [number, number], seat_height: 0.25 }])),
  } as SpriteCastCharacter["sit"],
};

type Item = { kind: string; src?: string; crop?: number[]; matrix: number[]; width: number; height: number; opacity: number; path: string };

function items(c: ReturnType<typeof composition>, t: number): Item[] {
  const out: Item[] = [];
  const walk = (list: any[]) => list.forEach((i) => (i.kind === "layer" ? walk(i.items) : out.push(i)));
  walk(evaluateFrame(c, Math.round(t * c.fps)).items);
  return out;
}

/** builds the scene right away (as the hosts do on load), so build errors throw here */
function make(build: (root: any) => void, duration = 10) {
  const c = composition({ width: 1920, height: 1080, fps: 30, scenes: [scene("s", { duration }, ({ root }) => build(root))] });
  collectAssets(c);
  return c;
}

const body = (c: ReturnType<typeof composition>, t: number) => items(c, t).find((i) => i.path.endsWith("/body"))!;
const shadow = (c: ReturnType<typeof composition>, t: number) => items(c, t).find((i) => i.path.endsWith("/shadow"))!;
/** where the body's top-left corner lands on screen */
const corner = (i: Item) => [i.matrix[4], i.matrix[5]];

describe("spriteCharacter", () => {
  it("stands on its feet: the idle frame of its facing, scaled to the height, with the anchor at x, y", () => {
    const c = make((root) => spriteCharacter(root, { src: "assets/sprites/girl", data: girl, x: 500, y: 800, height: 512, facing: "east" }));
    const b = body(c, 0.5);
    expect(b.src).toBe("assets/sprites/girl/idle-east.png");
    expect(b.crop).toBeUndefined();
    // scale 2: the frame is 330×512 on screen, its anchor (82.5, 224 frame px) on the feet
    expect(b.matrix[0]).toBeCloseTo(2);
    expect(corner(b)[0]).toBeCloseTo(500 - 0.5 * 165 * 2);
    expect(corner(b)[1]).toBeCloseTo(800 - 0.875 * 256 * 2);
    const s = shadow(c, 0.5);
    expect(s.src).toBe("assets/sprites/girl/shadows/idle-east.png");
    expect(s.opacity).toBeCloseTo(0.3);
    expect(corner(s)[0]).toBeCloseTo(corner(b)[0] - 35 * 2);
  });

  it("walks to a point: the strip of the way it goes, frame by frame at the clip's fps, then stands there", () => {
    const c = make((root) => {
      const g = spriteCharacter(root, { src: "assets/sprites/girl", data: girl, x: 100, y: 500, height: 256 });
      g.walkTo(700, 500, { at: 1, duration: 3 });
    });
    const mid = body(c, 2.5);
    expect(mid.src).toBe("assets/sprites/girl/walk-east.png");
    const frame = Math.floor(1.5 * 6.76) % 8; // 1.5 s into the walk
    expect(mid.crop).toEqual([frame * 165, 0, 165, 256]);
    expect(corner(mid)[0]).toBeCloseTo(400 - 82.5, 0); // half way
    expect(shadow(c, 2.5).src).toBe(`assets/sprites/girl/shadows/walk-east-${frame}.png`);
    const after = body(c, 5);
    expect(after.src).toBe("assets/sprites/girl/idle-east.png");
    expect(corner(after)[0]).toBeCloseTo(700 - 82.5);
  });

  it("faces the way it walks on screen: up-left is north-west, down is south", () => {
    const c = make((root) => {
      const g = spriteCharacter(root, { src: "s", data: girl, x: 500, y: 500 });
      g.walkTo(300, 300, { at: 0, duration: 1 }).walkTo(300, 600, { at: 1, duration: 1 });
    });
    expect(body(c, 0.5).src).toBe("s/walk-north-west.png");
    expect(body(c, 1.5).src).toBe("s/walk-south.png");
    expect(body(c, 3).src).toBe("s/idle-south.png");
  });

  it("walks at a steady speed when no duration is given, and returns where its moves end", () => {
    let end = 0;
    make((root) => {
      const g = spriteCharacter(root, { src: "s", data: girl, x: 0, y: 0 });
      g.walkTo(300, 0, { at: 1, speed: 100 });
      end = g.end;
    });
    expect(end).toBeCloseTo(4);
  });

  it("plays an action once in its facing, with its own frame size, anchor and trail, then stands again", () => {
    const c = make((root) => {
      const g = spriteCharacter(root, { src: "s", data: girl, x: 500, y: 800, facing: "south-east" });
      g.play("slash", { at: 1 });
    });
    const b = body(c, 1 + 2.1); // 8 frames at 4 fps last 2 s: done, standing again
    expect(b.src).toBe("s/idle-south-east.png");
    const during = body(c, 1 + 0.6); // frame 2
    expect(during.src).toBe("s/slash-south-east.png");
    expect(during.crop).toEqual([2 * 299, 0, 299, 324]);
    expect(corner(during)[1]).toBeCloseTo(800 - 0.9 * 324);
    const trail = items(c, 1.6).find((i) => i.path.endsWith("/trail"))!;
    expect(trail.src).toBe("s/slash-south-east-trail.png");
    expect(trail.crop).toEqual([Math.floor(0.6 * 4 * 3) * 173, 0, 173, 400]);
    expect(items(c, 0.5).find((i) => i.path.endsWith("/trail"))?.opacity ?? 0).toBe(0);
  });

  it("loops an action for a given time when asked", () => {
    const c = make((root) => spriteCharacter(root, { src: "s", data: girl, x: 0, y: 0 }).play("slash", { at: 0, duration: 5 }));
    expect(body(c, 4.6).src).toBe("s/slash-south.png");
    expect(body(c, 5.5).src).toBe("s/idle-south.png");
  });

  it("turns, and sits with the seat point on x, y", () => {
    const c = make((root) => {
      const g = spriteCharacter(root, { src: "s", data: girl, x: 400, y: 400, height: 256 });
      g.face("west", { at: 1 }).sit({ at: 2 });
    });
    expect(body(c, 1.5).src).toBe("s/idle-west.png");
    const seated = body(c, 2.5);
    expect(seated.src).toBe("s/sit-west.png");
    expect(corner(seated)).toEqual([400 - 0.5 * 132, 400 - 0.6 * 221]);
  });

  it("shows the nearest drawn facing when a set has only the four diagonals", () => {
    const diagonals = ["south-east", "south-west", "north-east", "north-west"];
    const four: SpriteCastCharacter = { ...girl, walk: strips("walk", diagonals), idle: strips("idle", diagonals), shadows: undefined, actions: undefined };
    const c = make((root) => spriteCharacter(root, { src: "s", data: four, x: 0, y: 0, facing: "east" }).face("south", { at: 1 }));
    expect(["s/idle-south-east.png", "s/idle-north-east.png"]).toContain(body(c, 0.5).src);
    expect(["s/idle-south-east.png", "s/idle-south-west.png"]).toContain(body(c, 1.5).src);
  });

  it("names a missing action, and lists every frame it may show so the preview loads them", () => {
    expect(() => make((root) => spriteCharacter(root, { src: "s", data: girl, x: 0, y: 0 }).play("jump", { at: 0 }))).toThrow(/jump.*slash/);
    const c = make((root) => spriteCharacter(root, { src: "s", data: girl, x: 0, y: 0 }).walkTo(10, 0, { at: 1, duration: 1 }));
    const assets = collectAssets(c);
    expect(assets).toContain("s/walk-east.png");
    expect(assets).toContain("s/shadows/walk-east-7.png");
    expect(assets).toContain("s/idle-south.png");
  });
});

describe("spriteProp", () => {
  const monstera: SpriteCastProp = {
    px_per_m: 256,
    sprite: { file: "sprite.png", size: [194, 372], anchor: [0.5, 1] },
    shadow: { file: "shadow.png", offset_px: [-144, 204] },
  };

  it("puts the footprint's front corner on x, y, its shadow under it at 30 %, scaled by height or scale", () => {
    const c = make((root) => spriteProp(root, { src: "assets/props/monstera", data: monstera, x: 960, y: 900, height: 744 }));
    const b = body(c, 0);
    expect(b.src).toBe("assets/props/monstera/sprite.png");
    expect(b.matrix[0]).toBeCloseTo(2);
    expect(corner(b)).toEqual([960 - 194, 900 - 744]);
    const s = shadow(c, 0);
    expect(corner(s)).toEqual([960 - 194 - 288, 900 - 744 + 408]);
    expect(s.opacity).toBeCloseTo(0.3);
  });
});

describe("image crop", () => {
  it("writes the crop rectangle into the render list only when set", () => {
    const c = make((root) => {
      root.add(image({ name: "a", src: "x.png", crop: [10, 0, 10, 10] }));
      root.add(image({ name: "b", src: "x.png" }));
    });
    const [a, b] = items(c, 0);
    expect(a.crop).toEqual([10, 0, 10, 10]);
    expect("crop" in b).toBe(false);
  });
});

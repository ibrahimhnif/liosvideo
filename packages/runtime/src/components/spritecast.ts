import { GroupNode, ImageNode } from "../graph/kinds";
import type { Node } from "../graph/node";

/**
 * Sprites made with SpriteCast (https://github.com/Sunghwan0112/spritecast): its `out/` folder copied into the
 * project, its `character.json` / `sprite.json` imported, and the strips played here frame by frame.
 */

type Pair = [number, number];
type Facings<T> = Partial<Record<string, T>>;

export interface SpriteCastShadow {
  file: string;
  /** from the frame's top-left corner, in frame pixels */
  offset: Pair;
}

export interface SpriteCastTrail {
  file: string;
  frame: Pair;
  offset: Pair;
  frames: number;
  per_frame: number;
}

export interface SpriteCastAction {
  frame: Pair;
  anchor: Pair;
  frames: number;
  loop: boolean;
  fps: number;
  strips: Facings<string>;
  shadows?: Facings<SpriteCastShadow[]>;
  trail?: Facings<SpriteCastTrail>;
}

export interface SpriteCastSeat {
  file: string;
  seat: Pair;
  seat_height?: number;
  shadow?: SpriteCastShadow;
}

/** SpriteCast's `character.json` (what liosvideo reads of it; the rest is ignored). */
export interface SpriteCastCharacter {
  frame: Pair;
  anchor: Pair;
  fps: number;
  frames?: number;
  walk: Facings<string>;
  idle: Facings<string>;
  shadows?: { walk?: Facings<SpriteCastShadow[]>; idle?: Facings<SpriteCastShadow> };
  actions?: Record<string, SpriteCastAction>;
  sit?: { frame: Pair } & Facings<SpriteCastSeat | Pair>;
}

/** SpriteCast's `sprite.json` for a prop. */
export interface SpriteCastProp {
  px_per_m?: number;
  sprite: { file: string; size: Pair; anchor: Pair };
  shadow?: { file: string; offset_px: Pair };
}

export type Facing = "south" | "south-east" | "east" | "north-east" | "north" | "north-west" | "west" | "south-west";

/** Screen angles (y down): east is right, south is toward the viewer (down). */
const ANGLE: Record<Facing, number> = {
  east: 0, "south-east": 45, south: 90, "south-west": 135, west: 180, "north-west": 225, north: 270, "north-east": 315,
};
const FACINGS = Object.keys(ANGLE) as Facing[];

const gap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** The facing nearest to `want` among those drawn; between two as near, the one turned more toward the viewer. */
function nearest(want: Facing, drawn: string[]): string {
  if (drawn.includes(want)) return want;
  const known = drawn.filter((f): f is Facing => f in ANGLE);
  if (!known.length) return drawn[0];
  const a = ANGLE[want];
  return known.sort((x, y) => gap(ANGLE[x], a) - gap(ANGLE[y], a) || gap(ANGLE[x], 90) - gap(ANGLE[y], 90))[0];
}

/** The facing of a move on screen. */
function heading(dx: number, dy: number): Facing {
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  return FACINGS.find((f) => gap(ANGLE[f], deg) <= 22.5) ?? "east";
}

const join = (dir: string, file: string) => (dir ? `${dir.replace(/\/+$/, "")}/${file}` : file);

function checkFacing(f: string | undefined, where: string): asserts f is Facing | undefined {
  if (f !== undefined && !(f in ANGLE)) throw new Error(`${where}: unknown facing "${f}". Use one of: ${FACINGS.join(", ")}`);
}

export interface SpriteCharacterOptions {
  /** The folder holding SpriteCast's output (the strips, `shadows/`), e.g. "assets/sprites/hero". */
  src: string;
  /** Its `character.json`: `import hero from "./assets/sprites/hero/character.json" with { type: "json" }`. */
  data: SpriteCastCharacter;
  /** Where the feet stand at the start. */
  x: number;
  y: number;
  /** Height of a frame on screen in px (default: the frame's own height); or give `scale`. */
  height?: number;
  scale?: number;
  /** Facing at the start (default "south", toward the viewer). */
  facing?: Facing;
  /** Opacity of the ground shadow (default 0.3, as SpriteCast advises); 0 for none. */
  shadow?: number;
  name?: string;
}

type Event =
  | { kind: "walk"; at: number; to: Pair; duration: number; facing?: Facing }
  | { kind: "play"; at: number; action: string; duration?: number; facing?: Facing }
  | { kind: "face"; at: number; facing: Facing }
  | { kind: "sit"; at: number; facing?: Facing }
  | { kind: "idle"; at: number };

interface Pose {
  x: number;
  y: number;
  /** file, frame size, crop (null: the whole file), anchor (fraction of the frame) */
  file: string;
  size: Pair;
  crop: [number, number, number, number] | null;
  anchor: Pair;
  shadow?: SpriteCastShadow;
  trail?: { file: string; crop: [number, number, number, number]; offset: Pair };
}

/** A SpriteCast character on the stage, moved by `walkTo`, `play`, `face`, `sit` and `idle` (each returns it, to chain). */
export class SpriteCharacter {
  readonly node: GroupNode;
  private readonly events: Event[] = [];
  private readonly scale: number;
  private readonly body: ImageNode;
  private readonly shadowNode?: ImageNode;
  private readonly trailNode?: ImageNode;

  constructor(parent: Node<any>, private readonly opts: SpriteCharacterOptions) {
    const d = opts.data;
    if (!d?.frame || !d.walk || !d.idle) {
      throw new Error("spriteCharacter(): `data` must be SpriteCast's character.json (with frame, walk and idle)");
    }
    checkFacing(opts.facing, "spriteCharacter()");
    this.scale = opts.scale ?? (opts.height ? opts.height / d.frame[1] : 1);
    this.node = parent.add(
      new GroupNode({ name: (opts.name ?? "character").replaceAll("/", "-"), x: opts.x, y: opts.y, scaleX: this.scale, scaleY: this.scale }),
    ) as GroupNode;
    const shadowOpacity = opts.shadow ?? 0.3;
    const hasShadows = !!(d.shadows?.walk || d.shadows?.idle || Object.values(d.actions ?? {}).some((a) => a.shadows));
    const shadow = hasShadows && shadowOpacity > 0 ? (this.node.add(new ImageNode({ name: "shadow", src: "" })) as ImageNode) : undefined;
    this.body = this.node.add(new ImageNode({ name: "body", src: "" })) as ImageNode;
    const hasTrails = Object.values(d.actions ?? {}).some((a) => a.trail);
    const trail = hasTrails ? (this.node.add(new ImageNode({ name: "trail", src: "", opacity: 0 })) as ImageNode) : undefined;
    this.shadowNode = shadow;
    this.trailNode = trail;
    this.uses("idle");

    this.node.drive((t) => {
      const p = this.poseAt(t);
      return { x: p.x, y: p.y };
    });
    this.body.drive((t) => {
      const p = this.poseAt(t);
      return { src: p.file, crop: p.crop, width: p.size[0], height: p.size[1], x: -p.anchor[0] * p.size[0], y: -p.anchor[1] * p.size[1] };
    });
    shadow?.drive((t) => {
      const p = this.poseAt(t);
      if (!p.shadow) return { opacity: 0 };
      return {
        src: join(opts.src, p.shadow.file),
        opacity: shadowOpacity,
        x: -p.anchor[0] * p.size[0] + p.shadow.offset[0],
        y: -p.anchor[1] * p.size[1] + p.shadow.offset[1],
      };
    });
    trail?.drive((t) => {
      const p = this.poseAt(t);
      if (!p.trail) return { opacity: 0 };
      const [, , w, h] = p.trail.crop;
      return {
        src: p.trail.file, crop: p.trail.crop, width: w, height: h, opacity: 1,
        x: -p.anchor[0] * p.size[0] + p.trail.offset[0],
        y: -p.anchor[1] * p.size[1] + p.trail.offset[1],
      };
    });
  }

  /** When the last move ends (scene seconds). */
  get end(): number {
    return this.events.reduce((end, e) => Math.max(end, e.at + ("duration" in e && e.duration ? e.duration : e.kind === "play" ? this.actionLength(e.action) : 0)), 0);
  }

  /** Walk in a straight line to (x, y), facing the way it goes; `duration` in seconds, or `speed` in px a second. */
  walkTo(x: number, y: number, o: { at: number; duration?: number; speed?: number; facing?: Facing }): this {
    checkFacing(o.facing, "walkTo()");
    const from = this.poseAt(o.at);
    const dist = Math.hypot(x - from.x, y - from.y);
    const speed = o.speed ?? this.walkSpeed();
    const duration = o.duration ?? (speed > 0 ? dist / speed : 0);
    this.events.push({ kind: "walk", at: o.at, to: [x, y], duration, facing: o.facing });
    this.uses("walk");
    return this;
  }

  /** Play one of the character's actions (run, jump, slash…): once, or looped for `duration` seconds. */
  play(action: string, o: { at: number; duration?: number; facing?: Facing }): this {
    checkFacing(o.facing, "play()");
    const actions = this.opts.data.actions ?? {};
    if (!actions[action]) {
      const names = Object.keys(actions);
      throw new Error(`play(): the character has no action "${action}"${names.length ? `; it has: ${names.join(", ")}` : " (it has only walk and idle)"}`);
    }
    this.events.push({ kind: "play", at: o.at, action, duration: o.duration, facing: o.facing });
    this.uses("action", action);
    return this;
  }

  /** Stand facing another way. */
  face(facing: Facing, o: { at: number }): this {
    checkFacing(facing, "face()");
    this.events.push({ kind: "face", at: o.at, facing });
    return this;
  }

  /** Sit (SpriteCast's `sit` set): the seat point lands on the character's position, e.g. a prop's seat. */
  sit(o: { at: number; facing?: Facing }): this {
    checkFacing(o.facing, "sit()");
    if (!this.opts.data.sit) throw new Error("sit(): the character has no sit set (run SpriteCast's `charpipe.py sit <name>.json --draw`)");
    this.events.push({ kind: "sit", at: o.at, facing: o.facing });
    this.uses("sit");
    return this;
  }

  /** Stop and stand. */
  idle(o: { at: number }): this {
    this.events.push({ kind: "idle", at: o.at });
    return this;
  }

  /** About 0.8 of its height per walk cycle, the stride of a person walking. */
  private walkSpeed(): number {
    const d = this.opts.data;
    const cycle = this.walkFrames(nearest("south", Object.keys(d.walk))) / d.fps;
    return (0.8 * d.frame[1] * this.scale) / cycle;
  }

  private walkFrames(facing: string): number {
    const d = this.opts.data;
    return d.shadows?.walk?.[facing]?.length || d.frames || 8;
  }

  private actionLength(name: string): number {
    const a = this.opts.data.actions?.[name];
    return a ? a.frames / a.fps : 0;
  }

  /** Every file a clip may show, so the preview loads them before playing. */
  private uses(clip: "idle" | "walk" | "sit" | "action", action?: string): void {
    const d = this.opts.data;
    const files: string[] = [];
    const add = (f?: string) => f && files.push(f);
    if (clip === "idle") {
      Object.values(d.idle).forEach(add);
      Object.values(d.shadows?.idle ?? {}).forEach((s) => add(s?.file));
    } else if (clip === "walk") {
      Object.values(d.walk).forEach(add);
      Object.values(d.shadows?.walk ?? {}).forEach((list) => list?.forEach((s) => add(s.file)));
    } else if (clip === "sit") {
      for (const [k, v] of Object.entries(d.sit ?? {})) if (k !== "frame" && v && !Array.isArray(v)) add(v.file), add(v.shadow?.file);
    } else if (action) {
      const a = d.actions![action];
      Object.values(a.strips).forEach(add);
      Object.values(a.shadows ?? {}).forEach((list) => list?.forEach((s) => add(s.file)));
      Object.values(a.trail ?? {}).forEach((tr) => add(tr?.file));
    }
    for (const f of files) {
      const src = join(this.opts.src, f);
      const node = /(^|\/)shadows\//.test(f) ? this.shadowNode : /-trail\.png$/.test(f) ? this.trailNode : this.body;
      (node ?? this.body).uses.add(src);
    }
  }

  /** Where the character is and which frame it shows at scene time `t`. */
  private poseAt(t: number): Pose {
    const d = this.opts.data;
    let pos: Pair = [this.opts.x, this.opts.y];
    let facing: Facing = this.opts.facing ?? "south";
    let mode: "idle" | "walk" | "play" | "sit" = "idle";
    let walk: { from: Pair; to: Pair; start: number; duration: number } | undefined;
    let play: { action: string; start: number; duration?: number } | undefined;
    const lerp = (w: NonNullable<typeof walk>, at: number): Pair => {
      const k = w.duration > 0 ? Math.min(Math.max((at - w.start) / w.duration, 0), 1) : 1;
      return [w.from[0] + (w.to[0] - w.from[0]) * k, w.from[1] + (w.to[1] - w.from[1]) * k];
    };
    const ordered = this.events.map((e, i) => [e, i] as const).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]);
    for (const [e] of ordered) {
      if (e.at > t) break;
      if (walk) pos = lerp(walk, e.at);
      walk = undefined;
      play = undefined;
      if (e.kind === "walk") {
        const [dx, dy] = [e.to[0] - pos[0], e.to[1] - pos[1]];
        facing = e.facing ?? (Math.hypot(dx, dy) > 0.001 ? heading(dx, dy) : facing);
        walk = { from: pos, to: e.to, start: e.at, duration: e.duration };
        mode = "walk";
      } else if (e.kind === "play") {
        facing = e.facing ?? facing;
        play = { action: e.action, start: e.at, duration: e.duration };
        mode = "play";
      } else if (e.kind === "face") {
        facing = e.facing;
        mode = "idle";
      } else if (e.kind === "sit") {
        facing = e.facing ?? facing;
        mode = "sit";
      } else mode = "idle";
    }

    if (walk) {
      pos = lerp(walk, t);
      if (t >= walk.start + walk.duration) mode = "idle";
    }
    const [x, y] = pos;

    if (mode === "walk" && walk) {
      const f = nearest(facing, Object.keys(d.walk));
      const n = this.walkFrames(f);
      const i = Math.floor((t - walk.start) * d.fps) % n;
      const [w, h] = d.frame;
      return { x, y, file: join(this.opts.src, d.walk[f]!), size: d.frame, crop: [i * w, 0, w, h], anchor: d.anchor, shadow: d.shadows?.walk?.[f]?.[i] };
    }
    if (mode === "play" && play) {
      const a = d.actions![play.action];
      const elapsed = t - play.start;
      const length = play.duration ?? (a.loop ? Infinity : a.frames / a.fps);
      if (elapsed < length) {
        const f = nearest(facing, Object.keys(a.strips));
        const raw = Math.floor(elapsed * a.fps);
        const i = play.duration !== undefined || a.loop ? raw % a.frames : Math.min(raw, a.frames - 1);
        const [w, h] = a.frame;
        const tr = a.trail?.[f];
        const step = tr ? Math.floor(elapsed * a.fps * tr.per_frame) : 0;
        const k = tr ? (play.duration !== undefined || a.loop ? step % tr.frames : Math.min(step, tr.frames - 1)) : 0;
        return {
          x, y, file: join(this.opts.src, a.strips[f]!), size: a.frame, crop: [i * w, 0, w, h], anchor: a.anchor, shadow: a.shadows?.[f]?.[i],
          trail: tr ? { file: join(this.opts.src, tr.file), crop: [k * tr.frame[0], 0, tr.frame[0], tr.frame[1]], offset: tr.offset } : undefined,
        };
      }
    }
    if (mode === "sit" && d.sit) {
      const drawn = Object.keys(d.sit).filter((k) => k !== "frame");
      const seat = d.sit[nearest(facing, drawn)] as SpriteCastSeat;
      return { x, y, file: join(this.opts.src, seat.file), size: d.sit.frame, crop: null, anchor: seat.seat, shadow: seat.shadow };
    }
    const f = nearest(facing, Object.keys(d.idle));
    return { x, y, file: join(this.opts.src, d.idle[f]!), size: d.frame, crop: null, anchor: d.anchor, shadow: d.shadows?.idle?.[f] };
  }
}

/** Put a SpriteCast character on the stage; move it with the returned object's `walkTo`, `play`, `face`, `sit`, `idle`. */
export function spriteCharacter(parent: Node<any>, opts: SpriteCharacterOptions): SpriteCharacter {
  return new SpriteCharacter(parent, opts);
}

export interface SpritePropOptions {
  /** The folder holding the prop's `sprite.png` and `shadow.png`. */
  src: string;
  /** Its `sprite.json`. */
  data: SpriteCastProp;
  /** Where the footprint's front corner stands. */
  x: number;
  y: number;
  /** Height on screen in px (default: the sprite's own); or give `scale`. */
  height?: number;
  scale?: number;
  /** Opacity of the ground shadow (default 0.3); 0 for none. */
  shadow?: number;
  name?: string;
}

/** A SpriteCast prop standing on (x, y) with its shadow under it. Returns its group, to animate like any node. */
export function spriteProp(parent: Node<any>, opts: SpritePropOptions): GroupNode {
  const s = opts.data?.sprite;
  if (!s?.file || !s.size || !s.anchor) throw new Error("spriteProp(): `data` must be SpriteCast's sprite.json (with sprite.file, size and anchor)");
  const scale = opts.scale ?? (opts.height ? opts.height / s.size[1] : 1);
  const group = parent.add(
    new GroupNode({ name: (opts.name ?? "prop").replaceAll("/", "-"), x: opts.x, y: opts.y, scaleX: scale, scaleY: scale }),
  ) as GroupNode;
  const left = -s.anchor[0] * s.size[0];
  const top = -s.anchor[1] * s.size[1];
  const shadowOpacity = opts.shadow ?? 0.3;
  if (opts.data.shadow && shadowOpacity > 0) {
    const sh = opts.data.shadow;
    group.add(new ImageNode({ name: "shadow", src: join(opts.src, sh.file), x: left + sh.offset_px[0], y: top + sh.offset_px[1], opacity: shadowOpacity }));
  }
  group.add(new ImageNode({ name: "body", src: join(opts.src, s.file), x: left, y: top, width: s.size[0], height: s.size[1] }));
  return group;
}

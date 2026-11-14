import { EASE_NAMES, isEase, type Ease } from "../anim/easing";
import { Track } from "../anim/track";
import { multiply, rotate, scale, translate, type Affine } from "../math/affine";
import { checkEnumProps, unknownValue } from "./enums";
import { sfxCue, type SfxCue, type SfxSpec } from "../audio/sfx";

export interface BaseProps {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** degrees, clockwise on screen */
  rotation: number;
  /** 0–1 of node size */
  anchorX: number;
  anchorY: number;
  opacity: number;
  z: number;
  /** px */
  blur: number;
  width: number;
  height: number;
  /** corner / clip radius */
  radius: number;
  clip: boolean;
  /** Layer filters, applied after blur in this order; 0 turns each off. */
  /** cell size, px */
  pixelate: number;
  /** levels per channel (≥ 2 when on) */
  posterize: number;
  /** dot cell size, px */
  halftone: number;
  /** ink line width, px */
  outline: number;
  outlineColor: string;
  /** chalk grain strength, 0–1 */
  chalk: number;
  /** bloom radius, px */
  glow: number;
  glowIntensity: number;
  /** brightness (0–1) a pixel needs before it glows: 0 glows everything, ~0.7 blooms only the highlights */
  glowThreshold: number;
  /** sticker / cut-out line drawn outside the shape, px wide (0 off) */
  sticker: number;
  stickerColor: string;
  /** px between the shape and the line */
  stickerGap: number;
  /** 0–1: how hand-drawn the line wobbles (0 = smooth) */
  stickerWobble: number;
  /** times a second the line is redrawn with a new wobble, like hand animation (0 = still) */
  stickerBoil: number;
}

export const BASE_DEFAULTS: BaseProps = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0,
  opacity: 1, z: 0, blur: 0, width: 0, height: 0, radius: 0, clip: false,
  pixelate: 0, posterize: 0, halftone: 0, outline: 0, outlineColor: "#111111", chalk: 0, glow: 0, glowIntensity: 1, glowThreshold: 0,
  sticker: 0, stickerColor: "#ffffff", stickerGap: 6, stickerWobble: 0.5, stickerBoil: 8,
};

type PropValue = number | string | boolean;

export type NodeInit<P> = Partial<P> & { name?: string };

export abstract class Node<P extends BaseProps = BaseProps> {
  parent?: Node<any>;
  children: Node<any>[] = [];
  private _name: string;
  private readonly requestedName?: string;
  private readonly base: P;
  private readonly tracks = new Map<keyof P, Track<PropValue>>();
  private readonly drivers: ((t: number) => Partial<P>)[] = [];
  private readonly cues: SfxCue[] = [];

  protected constructor(readonly kind: string, defaults: P, init: NodeInit<P> = {}) {
    const { name, ...props } = init;
    if (name?.includes("/")) throw new Error(`Node name "${name}" must not contain "/"`);
    this.requestedName = name;
    this._name = name ?? `${kind}0`;
    checkEnumProps(props, this._name);
    this.base = { ...defaults, ...(props as Partial<P>) };
  }

  get name(): string {
    return this._name;
  }

  path(): string {
    return this.parent ? `${this.parent.path()}/${this._name}` : this._name;
  }

  add<N extends Node<any>>(child: N): N {
    if (child.requestedName === undefined) {
      child._name = `${child.kind}${this.children.filter((c) => c.kind === child.kind).length}`;
    } else {
      const same = this.children.filter((c) => c.requestedName === child.requestedName).length;
      child._name = same === 0 ? child.requestedName : `${child.requestedName}~${same + 1}`;
    }
    child.parent = this;
    this.children.push(child);
    return child;
  }

  private track(key: keyof P): Track<PropValue> {
    let tr = this.tracks.get(key);
    if (!tr) {
      tr = new Track<PropValue>(this.base[key] as PropValue);
      this.tracks.set(key, tr);
    }
    return tr;
  }

  /** Changes base (un-animated) values, e.g. from a layout helper; keyframes still win where they apply. */
  assign(props: Partial<P>): this {
    checkEnumProps(props as Record<string, unknown>, this._name);
    Object.assign(this.base, props);
    for (const key of Object.keys(props) as (keyof P)[]) this.tracks.get(key)?.setBase(props[key] as PropValue);
    return this;
  }

  set(props: Partial<P>, at: number): this {
    return this.to(props, { at, duration: 0 });
  }

  /**
   * Animates to `props`. `sfx: "whoosh"` (or `{ name, on: "start" | "end", volume, offset, duration }`)
   * plays a sound effect with the move; the composition adds it to the soundtrack.
   */
  to(props: Partial<P>, opts: { at: number; duration: number; ease?: Ease; sfx?: SfxSpec }): this {
    checkEnumProps(props as Record<string, unknown>, this._name);
    if (opts.ease !== undefined && !isEase(opts.ease)) {
      throw unknownValue("ease", opts.ease, EASE_NAMES, `node "${this._name}" (${Object.keys(props).join(", ")})`);
    }
    for (const key of Object.keys(props) as (keyof P)[]) {
      this.track(key).add({
        start: opts.at,
        end: opts.at + opts.duration,
        from: undefined,
        to: props[key] as PropValue,
        ease: opts.ease ?? "inOutCubic",
      });
    }
    if (opts.sfx !== undefined) this.cues.push(sfxCue(opts.sfx, opts.at, opts.at + opts.duration, `node "${this._name}"`));
    return this;
  }

  /** Sound effects of this node's moves, in scene seconds. */
  sfxCues(): readonly SfxCue[] {
    return this.cues;
  }

  /**
   * Sets props from a pure function of scene time, applied after keyframes (later drivers win).
   * For values that follow something else, e.g. a callout pinned to a projected 3D point.
   */
  drive(fn: (t: number) => Partial<P>): this {
    this.drivers.push(fn);
    return this;
  }

  /** Time ranges (seconds) in which any property animates; overlapping or touching ranges are merged. */
  spans(): { start: number; end: number }[] {
    const all = [...this.tracks.values()].flatMap((tr) => tr.segments().map((s) => ({ start: s.start, end: s.end })));
    all.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: { start: number; end: number }[] = [];
    for (const s of all) {
      const last = merged.at(-1);
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else merged.push({ ...s });
    }
    return merged;
  }

  propsAt(t: number): P {
    const p = { ...this.base };
    for (const [key, tr] of this.tracks) (p as Record<keyof P, PropValue>)[key] = tr.valueAt(t);
    for (const fn of this.drivers) Object.assign(p, fn(t));
    return p;
  }

  localMatrix(t: number): Affine {
    const p = this.propsAt(t);
    return multiply(
      multiply(multiply(translate(p.x, p.y), rotate(p.rotation)), scale(p.scaleX, p.scaleY)),
      translate(-p.anchorX * p.width, -p.anchorY * p.height),
    );
  }
}

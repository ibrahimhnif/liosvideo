import type { Ease } from "../anim/easing";
import { Track } from "../anim/track";
import { multiply, rotate, scale, translate, type Affine } from "../math/affine";

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
}

export const BASE_DEFAULTS: BaseProps = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0,
  opacity: 1, z: 0, blur: 0, width: 0, height: 0, radius: 0, clip: false,
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

  protected constructor(readonly kind: string, defaults: P, init: NodeInit<P> = {}) {
    const { name, ...props } = init;
    this.requestedName = name;
    this._name = name ?? `${kind}0`;
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

  set(props: Partial<P>, at: number): this {
    return this.to(props, { at, duration: 0 });
  }

  to(props: Partial<P>, opts: { at: number; duration: number; ease?: Ease }): this {
    for (const key of Object.keys(props) as (keyof P)[]) {
      this.track(key).add({
        start: opts.at,
        end: opts.at + opts.duration,
        from: undefined,
        to: props[key] as PropValue,
        ease: opts.ease ?? "inOutCubic",
      });
    }
    return this;
  }

  propsAt(t: number): P {
    const p = { ...this.base };
    for (const [key, tr] of this.tracks) (p as Record<keyof P, PropValue>)[key] = tr.valueAt(t);
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

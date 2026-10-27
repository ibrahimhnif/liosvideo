import type { Ease } from "../anim/easing";
import { group, GroupNode, text, TextNode } from "../graph/kinds";
import { BASE_DEFAULTS, type BaseProps, type NodeInit } from "../graph/node";

export interface CursorInit extends NodeInit<BaseProps> {
  pointer?: boolean;
}

export class CursorNode extends GroupNode {
  readonly icon: TextNode;

  constructor(init: CursorInit = {}) {
    const { pointer = false, x = 0, y = 0, ...rest } = init;
    super({ ...rest, x, y, z: 999 });

    this.icon = this.add(
      text({
        name: "icon",
        text: pointer ? "👆" : "↖",
        fontSize: 24,
        fontFamily: "-apple-system, sans-serif",
        color: "#ffffff",
      }),
    );
  }

  moveTo(x: number, y: number, opts: { at: number; duration: number; ease?: Ease }): this {
    return this.to({ x, y }, opts);
  }

  click(opts: { at: number; duration?: number }): this {
    const dur = opts.duration ?? 0.15;
    const half = dur / 2;
    this.to({ scaleX: 0.8, scaleY: 0.8 }, { at: opts.at, duration: half });
    this.to({ scaleX: 1.0, scaleY: 1.0 }, { at: opts.at + half, duration: half });
    return this;
  }
}

export const cursor = (init?: CursorInit) => new CursorNode(init);

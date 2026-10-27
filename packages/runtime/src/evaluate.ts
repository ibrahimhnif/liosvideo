import { clampFrame, instantiateScene, layoutComposition, type Composition } from "./composition";
import { ImageNode, RectNode, TextNode, VideoNode } from "./graph/kinds";
import type { Node } from "./graph/node";
import { multiply, type Affine } from "./math/affine";
import type { RenderItem, RenderList } from "./renderlist";

/** The node's own drawable (groups have none), with opacity already multiplied in. */
function drawable(node: Node<any>, t: number, matrix: Affine, opacity: number): RenderItem | undefined {
  const path = node.path();
  if (node instanceof RectNode) {
    const p = node.propsAt(t);
    return {
      kind: "rect", path, matrix, width: p.width, height: p.height, radius: p.radius,
      fill: p.fill, stroke: p.stroke || undefined, strokeWidth: p.strokeWidth, opacity,
    };
  }
  if (node instanceof TextNode) {
    const p = node.propsAt(t);
    return {
      kind: "text", path, matrix, text: p.text, fontFamily: p.fontFamily, fontSize: p.fontSize,
      fontWeight: p.fontWeight, color: p.color, lineHeight: p.lineHeight, opacity,
    };
  }
  if (node instanceof ImageNode) {
    const p = node.propsAt(t);
    return { kind: "image", path, matrix, src: p.src, width: p.width, height: p.height, fit: p.fit, opacity };
  }
  if (node instanceof VideoNode) {
    const p = node.propsAt(t);
    const time = t * p.speed + p.startOffset;
    return { kind: "video", path, matrix, src: p.src, time, width: p.width, height: p.height, fit: p.fit, opacity };
  }
  return undefined;
}

function sortedChildren(node: Node<any>, t: number): Node<any>[] {
  return node.children
    .map((child, i) => ({ child, i, z: child.propsAt(t).z }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((e) => e.child);
}

/** Emits items for `node` into `out`. `inherited` is the ancestors' opacity not yet absorbed by a layer. */
function emit(node: Node<any>, t: number, parent: Affine, inherited: number, out: RenderItem[]): void {
  const p = node.propsAt(t);
  const opacity = inherited * p.opacity;
  if (opacity <= 0) return;
  const matrix = multiply(parent, node.localMatrix(t));
  const isolated = p.blur > 0 || p.clip || (p.opacity < 1 && node.children.length > 0);
  const childOpacity = isolated ? 1 : opacity;
  const target: RenderItem[] = isolated ? [] : out;

  const own = drawable(node, t, matrix, childOpacity);
  if (own) target.push(own);
  for (const child of sortedChildren(node, t)) emit(child, t, matrix, childOpacity, target);

  if (isolated) {
    out.push({
      kind: "layer",
      path: node.path(),
      items: target,
      opacity,
      blur: p.blur,
      ...(p.clip ? { clip: { matrix, width: p.width, height: p.height, radius: p.radius } } : {}),
    });
  }
}

function imageSrcs(items: RenderItem[], into: Set<string>): Set<string> {
  for (const item of items) {
    if (item.kind === "image" || item.kind === "video") into.add(item.src);
    else if (item.kind === "layer") imageSrcs(item.items, into);
  }
  return into;
}

export function evaluateFrame(c: Composition, frame: number): RenderList {
  const f = clampFrame(c, frame);
  const { scenes } = layoutComposition(c);
  const index = scenes.findIndex((s) => f >= s.startFrame && f < s.endFrame);
  if (index < 0) return { width: c.width, height: c.height, background: c.background, items: [], assets: [] };

  const def = c.scenes[index];
  const t = (f - scenes[index].startFrame) / c.fps;
  const items: RenderItem[] = [];
  emit(instantiateScene(c, def), t, [1, 0, 0, 1, 0, 0], 1, items);
  return {
    width: c.width,
    height: c.height,
    background: def.background ?? c.background,
    items,
    assets: [...imageSrcs(items, new Set())].sort(),
  };
}

export function collectAssets(c: Composition): string[] {
  const srcs = new Set<string>();
  const walk = (node: Node<any>) => {
    if (node instanceof ImageNode || node instanceof VideoNode) srcs.add(node.propsAt(0).src);
    node.children.forEach(walk);
  };
  for (const def of c.scenes) walk(instantiateScene(c, def));
  return [...srcs].sort();
}

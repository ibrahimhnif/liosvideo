import { vo, type FocusSegment } from "../audio/timing";
import { composition, scene, type Composition } from "../composition";
import { GroupNode, measureText, RectNode, TextNode, VideoNode } from "../graph/kinds";
import type { Node } from "../graph/node";
import { layout } from "../layout";
import { captions, type CaptionOptions } from "./captions";
import { credit, type CreditOptions } from "./credit";

/** Where the speaker sits at clip time `t`: eased between keys inside a shot, a straight cut between shots. */
export function focusAt(segments: FocusSegment[], t: number): number {
  if (!segments.length) return 0.5;
  const seg = segments.find((s) => t < s.end) ?? segments[segments.length - 1];
  const keys = seg.keys;
  if (!keys.length) return 0.5;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, x1] = keys[i];
    if (t <= t1) {
      const [t0, x0] = keys[i - 1];
      return x0 + ((x1 - x0) * (t - t0)) / (t1 - t0 || 1);
    }
  }
  return keys[keys.length - 1][1];
}

export interface ClipVideoOptions {
  /** Box size (default: 1080×1920); usually the scene's width and height. */
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  /** Scene time the clip's audio starts: `cue(id)` (default 0, for `scene({ vo: [id], pad: 0 })`). */
  at?: number;
  /** Keep the crop centred instead of following the speaker. */
  still?: boolean;
  name?: string;
}

/**
 * Adds the long video a `video_clip` line was cut from, in step with its audio: full-bleed (`cover`)
 * and panning to keep the speaker in frame, cutting with the camera.
 */
export function clipVideo(parent: Node, id: string, opts: ClipVideoOptions = {}): VideoNode {
  const clip = vo(id).clip;
  if (!clip) {
    throw new Error(`clipVideo(): VO line "${id}" is not a clip; cut one from a long video with video_clip first`);
  }
  const at = opts.at ?? 0;
  const node = parent.add(
    new VideoNode({
      name: opts.name ?? `${id}-video`,
      src: clip.video,
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      width: opts.width ?? 1080,
      height: opts.height ?? 1920,
      fit: "cover",
      startOffset: clip.from - at,
    }),
  ) as VideoNode;
  const focus = clip.focus ?? [];
  if (!opts.still && focus.length) node.drive((t) => ({ focusX: focusAt(focus, t - at) }));
  return node;
}

export interface ClipShortOptions {
  /** Hook title over the first seconds, e.g. the question the clip answers. */
  title?: string;
  /** How long the title stays (seconds, default 3). */
  titleHold?: number;
  /** Caption options, or false for none (default: karaoke captions on a dark pill). */
  captions?: false | Omit<CaptionOptions, "lines">;
  /** Credit for the long video the clip was cut from (from its assets/ATTRIBUTIONS.md row), or false for none. */
  credit?: false | Omit<CreditOptions, "asset">;
  /** Keep the crop centred instead of following the speaker. */
  still?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  /** Music beds and other tracks, as in composition(). */
  audio?: Composition["audio"];
  mix?: Composition["mix"];
  fontFamily?: string;
}

/**
 * A whole short from one `video_clip` line: the clip full-frame following the speaker, karaoke
 * captions, an optional hook title and the source credit, as long as the clip. `export default clipShort("clip-01", { title })`.
 */
export function clipShort(id: string, opts: ClipShortOptions = {}): Composition {
  const width = opts.width ?? 1080;
  const height = opts.height ?? 1920;
  const def = scene(id, { vo: [id], pad: 0, background: "#000000" }, ({ root }) => {
    clipVideo(root, id, { width, height, still: opts.still });
    const source = vo(id).clip?.source?.video;
    if (opts.credit !== false && source) credit(root, { ...(opts.credit || {}), asset: source });
    if (opts.title) hookTitle(root, opts.title, opts.titleHold ?? 3, opts.fontFamily);
    if (opts.captions !== false) {
      captions(root, { background: "#000000b3", fontFamily: opts.fontFamily, ...(opts.captions || {}), lines: [id] });
    }
  });
  return composition({ width, height, fps: opts.fps ?? 30, background: "#000000", scenes: [def], audio: opts.audio, mix: opts.mix });
}

/** The hook: centred near the top under the credit line, on a dark card, gone after `hold` seconds. */
function hookTitle(root: Node<any>, title: string, hold: number, fontFamily = "SF Pro Display"): void {
  const { width, height } = root.propsAt(0);
  const L = layout({ width, height });
  const type = L.orientation === "portrait" ? L.type.h2 : L.type.h1;
  const pad = L.gap(2);
  const maxWidth = L.safe.width - pad * 2;
  // wrap first (a text node does it at the measured width), then size the card to the wrapped lines
  const text = new TextNode({ text: title, ...type, fontFamily, maxWidth }).propsAt(0).text;
  const size = measureText({ text, ...type, fontFamily });
  const w = Math.min(size.width, maxWidth) + pad * 2;
  const h = size.height + pad * 2;
  // below the credit line, which sits at the top of the safe area
  const top = L.safe.y + L.type.label.fontSize * L.type.label.lineHeight + L.gap(4);
  const card = root.add(
    new GroupNode({ name: "hook", x: width / 2, y: top, width: w, height: h, anchorX: 0.5, anchorY: 0, opacity: 0, scaleX: 0.92, scaleY: 0.92 }),
  );
  card.add(new RectNode({ name: "card", width: w, height: h, radius: L.u * 1.5, fill: "#000000c7" }));
  card.add(
    new TextNode({
      name: "title",
      text,
      ...type,
      fontFamily,
      color: "#ffffff",
      align: "center",
      x: w / 2,
      y: h / 2,
      width: w - pad * 2,
      height: size.height,
      anchorX: 0.5,
      anchorY: 0.5,
    }),
  );
  card.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.1, duration: 0.35, ease: "outBack" });
  card.to({ opacity: 0 }, { at: Math.max(hold, 0.6), duration: 0.3, ease: "inOutCubic" });
}

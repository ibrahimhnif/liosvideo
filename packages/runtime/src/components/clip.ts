import { vo, type FocusSegment } from "../audio/timing";
import { VideoNode } from "../graph/kinds";
import type { Node } from "../graph/node";

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

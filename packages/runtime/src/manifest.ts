import { instantiateScene, layoutComposition, type Composition, type SceneSpan } from "./composition";
import type { Node } from "./graph/node";

export type FrameSpan = { startFrame: number; endFrame: number };
export type ManifestNode = { path: string; name: string; kind: string; spans: FrameSpan[]; children: ManifestNode[] };
export type ManifestScene = SceneSpan & {
  tree: ManifestNode;
  /** where scene() was called (a stack trace) */
  site?: string;
  /** project-relative file defining the scene, filled in by the host from `site` */
  source?: string;
};
export type TimelineManifest = { width: number; height: number; fps: number; totalFrames: number; scenes: ManifestScene[] };

function describe(node: Node<any>, scene: SceneSpan, fps: number): ManifestNode {
  const clamp = (f: number) => Math.min(Math.max(f, scene.startFrame), scene.endFrame);
  return {
    path: node.path(),
    name: node.name,
    kind: node.kind,
    spans: node.spans().map((s) => ({
      startFrame: clamp(scene.startFrame + Math.round(s.start * fps)),
      endFrame: clamp(scene.startFrame + Math.round(s.end * fps)),
    })),
    children: node.children.map((c) => describe(c, scene, fps)),
  };
}

/** The timeline view of a composition: scenes, their object trees, and when each object animates. */
export function buildManifest(c: Composition): TimelineManifest {
  const { totalFrames, scenes } = layoutComposition(c);
  return {
    width: c.width,
    height: c.height,
    fps: c.fps,
    totalFrames,
    scenes: scenes.map((span, i) => ({ ...span, tree: describe(instantiateScene(c, c.scenes[i]), span, c.fps), site: c.scenes[i].site })),
  };
}

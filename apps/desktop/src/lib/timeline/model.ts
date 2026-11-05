import type { FrameSpan, ManifestNode, ManifestScene, TimelineManifest } from "liosvideo";

export const MIN_MARKER_PX = 3;

/** A scene the selected time range overlaps. */
export type SceneSpan = { id: string; file?: string; startFrame: number; endFrame: number };

/** `sceneId` sentinel for a time range that can span scenes. */
export const RANGE_SCENE_ID = "range";

/** What the user pointed at; becomes revision context for the agent. */
export type Selection = {
  composition: string;
  sceneId: string;
  sceneFile?: string;
  path?: string;
  startFrame: number;
  endFrame: number;
  /** Present on range selections: the scenes the range overlaps, in order. */
  scenes?: SceneSpan[];
};

export const isRangeSelection = (sel?: Selection): boolean => !!sel && sel.sceneId === RANGE_SCENE_ID;

export type Row = {
  /** scene id (= scene root path) or node path */
  key: string;
  sceneId: string;
  path?: string;
  label: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  spans: FrameSpan[];
  isAudio?: boolean;
};

export function visibleRows(m: TimelineManifest, expanded: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (n: ManifestNode, sceneId: string, depth: number) => {
    const open = expanded.has(n.path);
    rows.push({ key: n.path, sceneId, path: n.path, label: n.name, depth, expandable: n.children.length > 0, expanded: open, spans: n.spans });
    if (open) n.children.forEach((c) => walk(c, sceneId, depth + 1));
  };
  for (const s of m.scenes) {
    const open = expanded.has(s.tree.path);
    rows.push({
      key: s.tree.path, sceneId: s.id, label: s.id, depth: 0, expandable: s.tree.children.length > 0, expanded: open,
      spans: [{ startFrame: s.startFrame, endFrame: s.endFrame }],
    });
    if (open) s.tree.children.forEach((c) => walk(c, s.id, 1));
  }
  if (m.audioTracks && m.audioTracks.length > 0) {
    for (const track of m.audioTracks) {
      const clips = Array.isArray(track?.clips) ? track.clips : [];
      rows.push({
        key: `audio:${track.id}`,
        sceneId: "audio",
        label: `🎵 ${track.name || track.id}`,
        depth: 0,
        expandable: false,
        expanded: false,
        spans: clips.map((c) => ({ startFrame: c.startFrame, endFrame: c.endFrame })),
        isAudio: true,
      });
    }
  }
  return rows;
}

export function spanToPx(span: FrameSpan, totalFrames: number, widthPx: number): { x: number; width: number } {
  const scale = widthPx / Math.max(totalFrames, 1);
  return { x: span.startFrame * scale, width: Math.max(MIN_MARKER_PX, (span.endFrame - span.startFrame) * scale) };
}

export function frameAtX(x: number, widthPx: number, totalFrames: number): number {
  const f = Math.floor((x / Math.max(widthPx, 1)) * totalFrames);
  return Math.min(Math.max(f, 0), Math.max(totalFrames - 1, 0));
}

function findNode(n: ManifestNode, path: string): ManifestNode | undefined {
  if (n.path === path) return n;
  for (const c of n.children) {
    const hit = findNode(c, path);
    if (hit) return hit;
  }
  return undefined;
}

function nodeSelection(composition: string, scene: ManifestScene, n: ManifestNode): Selection {
  const spans: FrameSpan[] = [];
  const collect = (x: ManifestNode) => {
    spans.push(...x.spans);
    x.children.forEach(collect);
  };
  collect(n);
  const startFrame = spans.length ? Math.min(...spans.map((s) => s.startFrame)) : scene.startFrame;
  const endFrame = spans.length ? Math.max(...spans.map((s) => s.endFrame)) : scene.endFrame;
  return { composition, sceneId: scene.id, sceneFile: scene.source, path: n.path, startFrame, endFrame };
}

const sceneSelection = (composition: string, s: ManifestScene): Selection => ({
  composition, sceneId: s.id, sceneFile: s.source, startFrame: s.startFrame, endFrame: s.endFrame,
});

export function selectionFor(row: Row, composition: string, m: TimelineManifest): Selection {
  if (row.isAudio) {
    const startFrame = row.spans.length ? Math.min(...row.spans.map((s) => s.startFrame)) : 0;
    const endFrame = row.spans.length ? Math.max(...row.spans.map((s) => s.endFrame)) : m.totalFrames;
    return { composition, sceneId: "audio", path: row.key, startFrame, endFrame };
  }
  const scene = m.scenes.find((s) => s.id === row.sceneId)!;
  const n = row.path ? findNode(scene.tree, row.path) : undefined;
  return n ? nodeSelection(composition, scene, n) : sceneSelection(composition, scene);
}

/**
 * A time-only selection over the whole timeline: the scenes stay derived from the manifest, so a
 * range survives scene edits as long as the composition keeps its length.
 */
export function rangeFor(composition: string, m: TimelineManifest, from: number, to: number): Selection {
  const total = Math.max(m.totalFrames, 0);
  const startFrame = Math.max(0, Math.min(from, to, Math.max(total - 1, 0)));
  const endFrame = Math.max(startFrame, Math.min(Math.max(from, to), total));
  // a clicked point still means "this frame": widen it enough to pick the scene it sits in
  const probeEnd = endFrame > startFrame ? endFrame : startFrame + 1;
  const scenes = m.scenes
    .filter((s) => s.startFrame < probeEnd && s.endFrame > startFrame)
    .map((s) => ({ id: s.id, file: s.source, startFrame: s.startFrame, endFrame: s.endFrame }));
  return { composition, sceneId: RANGE_SCENE_ID, startFrame, endFrame, scenes };
}

/** Keeps a selection valid after a reload: same node if it still exists, else its scene, else nothing. A selection in another composition is cleared. */
export function reconcileSelection(sel: Selection | undefined, composition: string, m: TimelineManifest): Selection | undefined {
  if (!sel || sel.composition !== composition) return undefined;
  if (isRangeSelection(sel)) {
    if (m.totalFrames === 0) return undefined;
    return rangeFor(composition, m, sel.startFrame, sel.endFrame);
  }
  if (sel.sceneId === "audio") {
    return sel;
  }
  const scene = m.scenes.find((s) => s.id === sel.sceneId);
  if (!scene) return undefined;
  const n = sel.path ? findNode(scene.tree, sel.path) : undefined;
  return n ? nodeSelection(composition, scene, n) : sceneSelection(composition, scene);
}

export function selectionLabel(sel: Selection): string {
  if (isRangeSelection(sel)) {
    const count = sel.scenes?.length ?? 0;
    const scenes = count === 1 ? sel.scenes![0].id : `${count} scenes`;
    return `${sel.composition} › frames ${sel.startFrame}–${sel.endFrame} (${scenes})`;
  }
  const parts = [sel.composition, sel.sceneId];
  if (sel.path) parts.push(sel.path.slice(sel.sceneId.length + 1));
  return parts.join(" › ");
}

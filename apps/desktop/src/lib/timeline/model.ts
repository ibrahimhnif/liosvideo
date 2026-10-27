import type { FrameSpan, ManifestNode, ManifestScene, TimelineManifest } from "liosvideo";

export const MIN_MARKER_PX = 3;

/** What the user pointed at; becomes revision context for the agent. */
export type Selection = { composition: string; sceneId: string; path?: string; startFrame: number; endFrame: number };

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
  return { composition, sceneId: scene.id, path: n.path, startFrame, endFrame };
}

const sceneSelection = (composition: string, s: ManifestScene): Selection => ({
  composition, sceneId: s.id, startFrame: s.startFrame, endFrame: s.endFrame,
});

export function selectionFor(row: Row, composition: string, m: TimelineManifest): Selection {
  const scene = m.scenes.find((s) => s.id === row.sceneId)!;
  const n = row.path ? findNode(scene.tree, row.path) : undefined;
  return n ? nodeSelection(composition, scene, n) : sceneSelection(composition, scene);
}

/** Keeps a selection valid after a reload: same node if it still exists, else its scene, else nothing. */
export function reconcileSelection(sel: Selection | undefined, composition: string, m: TimelineManifest): Selection | undefined {
  if (!sel || sel.composition !== composition) return sel;
  const scene = m.scenes.find((s) => s.id === sel.sceneId);
  if (!scene) return undefined;
  const n = sel.path ? findNode(scene.tree, sel.path) : undefined;
  return n ? nodeSelection(composition, scene, n) : sceneSelection(composition, scene);
}

export function selectionLabel(sel: Selection): string {
  const parts = [sel.composition, sel.sceneId];
  if (sel.path) parts.push(sel.path.slice(sel.sceneId.length + 1));
  return parts.join(" › ");
}

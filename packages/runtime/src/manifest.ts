import { instantiateScene, layoutComposition, type AudioClip, type Composition, type SceneSpan } from "./composition";
import type { Node } from "./graph/node";
import type { AudioRole, MixOptions } from "./audio/mix";

export type FrameSpan = { startFrame: number; endFrame: number };
export type ManifestNode = { path: string; name: string; kind: string; spans: FrameSpan[]; children: ManifestNode[] };
export type ManifestScene = SceneSpan & {
  tree: ManifestNode;
  /** where scene() was called (a stack trace) */
  site?: string;
  /** project-relative file defining the scene, filled in by the host from `site` */
  source?: string;
};
export type ManifestAudioClip = {
  src: string;
  startFrame: number;
  endFrame: number;
  duration?: number;
  startOffset?: number;
  volume?: number;
  ducking?: boolean;
  role?: AudioRole;
};
export type ManifestAudioTrack = {
  id: string;
  name: string;
  clips: ManifestAudioClip[];
};
export type TimelineManifest = {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  scenes: ManifestScene[];
  audioTracks?: ManifestAudioTrack[];
  mix?: MixOptions;
};

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
  const audioTracks: ManifestAudioTrack[] | undefined = c.audio?.map((track) => {
    const clipsList: AudioClip[] = Array.isArray(track.clips)
      ? track.clips
      : track.src
        ? [
            {
              src: track.src,
              startFrame: track.startFrame ?? Math.round((track.startAt ?? 0) * c.fps),
              duration: track.duration,
              startOffset: track.startOffset,
              volume: track.volume,
              ducking: track.ducking,
              role: track.role,
            },
          ]
        : [];

    return {
      id: track.id,
      name: track.name ?? track.id,
      clips: clipsList.map((clip) => {
        const startFrame = clip.startFrame ?? Math.round((clip.startAt ?? 0) * c.fps);
        const endFrame = clip.duration !== undefined
          ? startFrame + Math.round(clip.duration * c.fps)
          : Math.max(startFrame + 1, totalFrames);
        return {
          src: clip.src,
          startFrame,
          endFrame,
          duration: clip.duration,
          startOffset: clip.startOffset,
          volume: clip.volume,
          ducking: clip.ducking,
          role: clip.role ?? track.role,
        };
      }),
    };
  });

  const narration = narrationTracks(c, scenes, audioTracks ?? []);
  const tracks = audioTracks || narration.length ? [...(audioTracks ?? []), ...narration] : undefined;

  return {
    width: c.width,
    height: c.height,
    fps: c.fps,
    totalFrames,
    scenes: scenes.map((span, i) => ({ ...span, tree: describe(instantiateScene(c, c.scenes[i]), span, c.fps), site: c.scenes[i].site })),
    ...(tracks ? { audioTracks: tracks } : {}),
    ...(c.mix ? { mix: c.mix } : {}),
  };
}

/** Audio for the VO lines of `scene({ vo })` scenes that the composition does not already list. */
function narrationTracks(c: Composition, scenes: SceneSpan[], listed: ManifestAudioTrack[]): ManifestAudioTrack[] {
  if (c.narration === false) return [];
  const volume = c.narration?.volume;
  const have = new Set(listed.flatMap((t) => t.clips.map((clip) => clip.src.replace(/^\.\//, ""))));
  const out: ManifestAudioTrack[] = [];
  c.scenes.forEach((def, i) => {
    for (const line of def.vo ?? []) {
      const src = `assets/audio/vo/${line.id}.mp3`;
      if (!line.ready || have.has(src)) continue;
      const startFrame = scenes[i].startFrame + Math.round(line.at * c.fps);
      out.push({
        id: `vo-${line.id}`,
        name: `VO ${line.id}`,
        clips: [
          {
            src,
            startFrame,
            endFrame: startFrame + Math.round(line.duration * c.fps),
            duration: line.duration,
            role: "vo",
            ...(volume !== undefined ? { volume } : {}),
          },
        ],
      });
    }
  });
  return out;
}

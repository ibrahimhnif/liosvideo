/**
 * Volume 2 reel: ten more effects, each in a standalone 3-second scene.
 *
 *   liosvideo render fx-examples-vol2.ts -o out/fx-examples-vol2.mp4
 */

import { composition, type SceneDef, type TransitionDef } from "liosvideo";
import { crashZoomIn, palette, soundtrack, whipPan, type SfxCue } from "./fx";
import karaokeCaption from "./scenes/examples/karaoke-caption";
import versusSplit from "./scenes/examples/versus-split";
import confetti from "./scenes/examples/confetti";
import quoteCard from "./scenes/examples/quote-card";
import chapterCard from "./scenes/examples/chapter-card";
import polaroidFrame from "./scenes/examples/polaroid-frame";
import breakingBanner from "./scenes/examples/breaking-banner";
import barChart from "./scenes/examples/bar-chart";
import waveform from "./scenes/examples/waveform";
import annotation from "./scenes/examples/annotation";

const SCENE_SECONDS = 3;
const at = (index: number, offset: number) => index * SCENE_SECONDS + offset;

function withTransition(def: SceneDef, transition: TransitionDef): SceneDef {
  return { ...def, transition };
}

const cues: SfxCue[] = [
  { sfx: "pop", at: at(0, 0.45), volume: 0.28 },
  { sfx: "pop", at: at(0, 0.85), volume: 0.28 },
  { sfx: "pop", at: at(0, 1.3), volume: 0.28 },
  { sfx: "pop", at: at(0, 1.75), volume: 0.28 },
  { sfx: "pop", at: at(0, 2.05), volume: 0.28 },

  { sfx: "bellRound", at: at(1, 0.2), volume: 0.4 },

  { sfx: "kaching", at: at(2, 0.2), volume: 0.42 },
  { sfx: "bell", at: at(2, 0.6), volume: 0.28 },

  { sfx: "paperTear", at: at(3, 0.15), volume: 0.42 },

  { sfx: "tick", at: at(4, 0.2), volume: 0.32 },

  { sfx: "cameraShutter", at: at(5, 0.15), volume: 0.34 },
  { sfx: "cameraShutter", at: at(5, 0.55), volume: 0.3 },
  { sfx: "cameraShutter", at: at(5, 0.95), volume: 0.28 },

  { sfx: "impactThud", at: at(6, 0.15), volume: 0.4 },
  { sfx: "tick", at: at(6, 0.7), volume: 0.24 },

  { sfx: "pop", at: at(7, 0.25), volume: 0.26 },
  { sfx: "pop", at: at(7, 0.42), volume: 0.26 },
  { sfx: "pop", at: at(7, 0.59), volume: 0.26 },
  { sfx: "pop", at: at(7, 0.76), volume: 0.26 },
  { sfx: "pop", at: at(7, 0.93), volume: 0.26 },

  { sfx: "heartbeat", at: at(8, 0.2), volume: 0.38 },
  { sfx: "heartbeat", at: at(8, 1.4), volume: 0.3 },

  { sfx: "uiClick", at: at(9, 0.55), volume: 0.34 },
  { sfx: "uiClick", at: at(9, 0.9), volume: 0.3 },
];

export default composition({
  width: 1920,
  height: 1080,
  fps: 30,
  background: palette.bg,
  scenes: [
    karaokeCaption,
    withTransition(versusSplit, whipPan("left")),
    withTransition(confetti, crashZoomIn(0.24)),
    withTransition(quoteCard, whipPan("right")),
    withTransition(chapterCard, crashZoomIn(0.22)),
    withTransition(polaroidFrame, whipPan("left")),
    withTransition(breakingBanner, crashZoomIn(0.2)),
    withTransition(barChart, whipPan("left")),
    withTransition(waveform, crashZoomIn(0.22)),
    annotation,
  ],
  audio: soundtrack(cues, { bed: true, bedVolume: 0.08 }),
});

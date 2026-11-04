/**
 * Per-effect example reel: twelve standalone scenes, each showing one effect
 * from the kit in a realistic composition.
 *
 *   liosvideo render fx-examples.ts -o out/fx-examples.mp4
 *   liosvideo render fx-examples.ts --frames 0..90 -o out/fx-examples-preview.mp4
 */

import { composition, type SceneDef, type TransitionDef } from "liosvideo";
import { crashZoomIn, palette, soundtrack, whipPan, type SfxCue } from "./fx";
import filmGrain from "./scenes/examples/film-grain";
import paperTear from "./scenes/examples/paper-tear";
import typewriter from "./scenes/examples/typewriter";
import kineticCaption from "./scenes/examples/kinetic-caption";
import crashZoom from "./scenes/examples/crash-zoom";
import whipPanScene from "./scenes/examples/whip-pan";
import glitchRgb from "./scenes/examples/glitch-rgb";
import letterbox from "./scenes/examples/letterbox";
import countUp from "./scenes/examples/count-up";
import impactBurst from "./scenes/examples/impact-burst";
import lowerThird from "./scenes/examples/lower-third";
import spotlight from "./scenes/examples/spotlight";

const SCENE_SECONDS = 3;

function withTransition(def: SceneDef, transition: TransitionDef): SceneDef {
  return { ...def, transition };
}

const at = (sceneIndex: number, offset: number) => sceneIndex * SCENE_SECONDS + offset;

const cues: SfxCue[] = [
  { sfx: "softSwoosh", at: at(0, 0.1), volume: 0.35 },
  { sfx: "cameraShutter", at: at(0, 0.9), volume: 0.3 },
  { sfx: "paperTear", at: at(1, 0.1), volume: 0.5 },
  { sfx: "typewriterRun", at: at(2, 0.2), volume: 0.4 },
  { sfx: "pop", at: at(3, 0.25), volume: 0.32 },
  { sfx: "pop", at: at(3, 0.67), volume: 0.32 },
  { sfx: "pop", at: at(3, 1.09), volume: 0.32 },
  { sfx: "whooshDeep", at: at(4, 0.2), volume: 0.4 },
  { sfx: "impactThud", at: at(4, 0.5), volume: 0.4 },
  { sfx: "whooshFast", at: at(5, 0.35), volume: 0.45 },
  { sfx: "whooshFast", at: at(5, 1.7), volume: 0.42 },
  { sfx: "glitch", at: at(6, 0.1), volume: 0.35 },
  { sfx: "softSwoosh", at: at(7, 0.15), volume: 0.38 },
  { sfx: "kaching", at: at(8, 1.35), volume: 0.4 },
  { sfx: "bell", at: at(8, 1.55), volume: 0.26 },
  { sfx: "riser", at: at(9, 0.05), volume: 0.34 },
  { sfx: "impactSub", at: at(9, 0.36), volume: 0.45 },
  { sfx: "tick", at: at(10, 0.35), volume: 0.3 },
  { sfx: "heartbeat", at: at(11, 0.1), volume: 0.42 },
];

export default composition({
  width: 1920,
  height: 1080,
  fps: 30,
  background: palette.bg,
  scenes: [
    filmGrain,
    withTransition(paperTear, whipPan("left")),
    withTransition(typewriter, crashZoomIn(0.26)),
    withTransition(kineticCaption, whipPan("right")),
    withTransition(crashZoom, crashZoomIn(0.22)),
    withTransition(whipPanScene, whipPan("left")),
    withTransition(glitchRgb, crashZoomIn(0.22)),
    withTransition(letterbox, whipPan("left")),
    withTransition(countUp, crashZoomIn(0.26)),
    withTransition(impactBurst, crashZoomIn(0.2)),
    withTransition(lowerThird, whipPan("left")),
    spotlight,
  ],
  audio: soundtrack(cues, { bed: true, bedVolume: 0.08 }),
});

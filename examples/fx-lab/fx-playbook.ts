/**
 * FX playbook — one-page render of the whole effect kit.
 *
 *   liosvideo render fx-playbook.ts -o out/fx-playbook.mp4
 *   liosvideo snapshot fx-playbook.ts --frame 180 -o out/fx-playbook.png
 */

import { composition } from "liosvideo";
import playbook from "./scenes/fx-playbook";
import { palette, soundtrack, type SfxCue } from "./fx";
import { PAGE, tileDemo, tileEnter } from "./scenes/timing";

const cues: SfxCue[] = [
  { sfx: "softSwoosh", at: 0.02, volume: 0.4 },

  // tile cascade — a mechanical tick per card
  ...Array.from({ length: 12 }, (_, i) => ({
    sfx: (i % 2 === 0 ? "tick" : "tock") as "tick" | "tock",
    at: tileEnter(i) + 0.12,
    volume: 0.13,
  })),

  // one signature sound per demo
  { sfx: "cameraShutter", at: tileDemo(0) + 0.4, volume: 0.32 },
  { sfx: "paperTear", at: tileDemo(1) + 0.02, volume: 0.5 },
  { sfx: "typewriterRun", at: tileDemo(2) + 0.02, volume: 0.42 },
  { sfx: "pop", at: tileDemo(3) + 0.14, volume: 0.3 },
  { sfx: "pop", at: tileDemo(3) + 0.48, volume: 0.3 },
  { sfx: "pop", at: tileDemo(3) + 0.82, volume: 0.3 },
  { sfx: "whooshDeep", at: tileDemo(4) + 0.12, volume: 0.42 },
  { sfx: "impactThud", at: tileDemo(4) + 0.42, volume: 0.4 },
  { sfx: "whooshFast", at: tileDemo(5) + 0.2, volume: 0.45 },
  { sfx: "whooshFast", at: tileDemo(5) + 1.15, volume: 0.4 },
  { sfx: "glitch", at: tileDemo(6) + 0.02, volume: 0.35 },
  { sfx: "softSwoosh", at: tileDemo(7) + 0.1, volume: 0.38 },
  { sfx: "kaching", at: tileDemo(8) + 0.9, volume: 0.4 },
  { sfx: "bell", at: tileDemo(8) + 1.1, volume: 0.28 },
  { sfx: "riser", at: 1.0, volume: 0.34 },
  { sfx: "impactSub", at: tileDemo(9) + 0.31, volume: 0.45 },
  { sfx: "tick", at: tileDemo(10) + 0.15, volume: 0.32 },
  { sfx: "heartbeat", at: tileDemo(11) + 0.1, volume: 0.45 },

  { sfx: "softSwoosh", at: 5.35, volume: 0.28 },
];

export default composition({
  width: PAGE.width,
  height: PAGE.height,
  fps: PAGE.fps,
  background: palette.bg,
  scenes: [playbook],
  audio: soundtrack(cues, { bed: true, bedVolume: 0.09 }),
});

# Recipes — copy, paste, adjust

Semua contoh mengasumsikan `fx/` sudah ada di root project dan scene berada di
`scenes/`.

---

## 1. Scene + soundtrack

```ts
// scenes/intro.ts
import { rect, scene, text } from "liosvideo";
import { fadeIn, fonts, palette, soundtrack, type SfxCue } from "../fx";

export default scene("intro", { duration: 3, background: palette.bg }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: palette.bg }));
  const title = root.add(
    text({ name: "title", text: "Judul", x: 160, y: 380, fontFamily: fonts.serif, fontSize: 92, fontWeight: 700, color: "#EFE6D2", opacity: 0 }),
  );
  fadeIn(title, { at: 0.3, duration: 0.6 });
});

// composition.ts
export const cues: SfxCue[] = [{ sfx: "softSwoosh", at: 0.1, volume: 0.4 }];
// audio: soundtrack(cues, { bed: true, bedVolume: 0.09 })
```

---

## 2. Archival title over real b-roll

```ts
image({ src: "assets/images/old-newspaper.jpg", width, height, fit: "cover" });
rect({ name: "grade", width, height, fill: palette.bg, opacity: 0.45 });
grainOverlay(root, { width, height, amount: 0.26 });
scanlines(root, { width, height, strength: 0.12, pitch: 4 });
dustMotes(root, { width, height, count: 24, seed: 4, duration: 2.4 });

const title = root.add(text({ name: "title", text: "Kebenaran yang Tertunda", x: 160, y: 372,
  fontFamily: fonts.serif, fontSize: 84, fontWeight: 700, color: "#EFE6D2", opacity: 0 }));
fadeIn(title, { at: 0.4, duration: 0.6 });
vignette(root, { width, height, strength: 0.9 });
```

---

## 3. Paper-tear reveal

```ts
tornPaper(root, { width, height, at: 0.05, accent: palette.amber, speed: 1.0 });

const head = root.add(text({ name: "head", text: "FAKTA", x: 112, y: 372,
  fontFamily: fonts.display, fontSize: 180, color: palette.amber, opacity: 0 }));
fadeIn(head, { at: 0.42, duration: 0.3 });
```

The paper starts covering the frame and is torn away left → right; put content
on the left side so it is revealed first.

---

## 4. Photo letterbox

```ts
image({ src: "assets/images/misty-mountains.jpg", width, height, fit: "cover" });
rect({ name: "grade", width, height, fill: palette.bg, opacity: 0.34 });
letterbox(root, { width, height, ratio: 0.115, at: 0.15, duration: 0.6 });
lightLeak(root, { width, height, at: 0.6, strength: 0.45 });
```

---

## 5. Karaoke caption

```ts
karaokeCaption(root, {
  words: [
    { text: "INI",    start: 0.45, end: 0.85 },
    { text: "BUKAN",  start: 0.85, end: 1.30 },
    { text: "MITOS,", start: 1.30, end: 1.75 },
    { text: "TAPI",   start: 1.75, end: 2.05 },
    { text: "DATA.",  start: 2.05, end: 2.55 },
  ],
  x: width / 2, y: height / 2, size: 84,
  activeColor: palette.amber, dimColor: "#3E4757",
});
```

---

## 6. Typewriter + stabilo

```ts
const line = "Data tidak pernah berbohong.";
highlighter(root, { x: 196, y: 470, width: line.length * 32 + 20, height: 74, at: 1.5, opacity: 0.26 });
typewriter(root, { text: line, x: 208, y: 468, fontSize: 54, at: 0.15, duration: 1.25 });
```

---

## 7. Versus duel with photos

```ts
versusSplit(root, {
  width, height, at: 0.1,
  top:    { label: "LARI",   sub: "5 KM · PAGI",  score: 42, color: "#C2410C", imageSrc: "assets/images/road-cycling.jpg" },
  bottom: { label: "SEPEDA", sub: "20 KM · PAGI", score: 58, color: "#0E7490", imageSrc: "assets/images/jakarta-skyline.jpg" },
});
```

---

## 8. Polaroid collage (one white tape)

```ts
halftone(root, { width, height, size: 7, strength: 0.16 });
polaroidFrame(root, { x: 250, y: 310, width: 380, height: 450, rotation: -7, at: 0.15,
  caption: "JAKARTA · 1998", imageSrc: "assets/images/old-newspaper.jpg" });
polaroidFrame(root, { x: 720, y: 270, width: 380, height: 450, rotation: 4, at: 0.3,
  caption: "ARSIP · BPS", imageSrc: "assets/images/road-cycling.jpg" });
```

---

## 9. Data story

```ts
barChart(root, {
  x: 220, y: 280, width: 1440, height: 460, at: 0.15,
  values: [38, 52, 61, 74, 89].map((v, i) => ({ label: String(2020 + i), value: v })),
  color: "#2B3A4E", highlightColor: palette.amber,
});
```

---

## 10. One-page tile grid (playbook pattern)

```ts
const TILE_W = 426, TILE_H = 258, GAP = 24;

function tile(root, index: number, build: (stage: GroupNode) => void) {
  const col = index % 4, row = Math.floor(index / 4);
  const x = 72 + col * (TILE_W + GAP);
  const y = 204 + row * (TILE_H + 22);
  const box = root.add(group({ name: `tile-${index}`, x: x + TILE_W / 2, y: y + TILE_H / 2,
    width: TILE_W, height: TILE_H, anchorX: 0.5, anchorY: 0.5 }));
  box.add(rect({ name: "surface", width: TILE_W, height: TILE_H, radius: 16,
    fill: palette.panel, stroke: palette.border, strokeWidth: 1 }));
  box.add(rect({ name: "stage-bg", x: 18, y: 44, width: 390, height: 148, radius: 10, fill: palette.panelDeep }));
  const stage = box.add(group({ name: "stage", x: 18, y: 44, width: 390, height: 148, clip: true, radius: 10 }));
  build(stage);
  popIn(box, { at: 0.35 + index * 0.1, from: 0.9 });
}
```

Use `clip: true` only on tiles whose content escapes the stage (full-bleed
shaders, whip pan, zoom).

---

## 11. Composition with transitions

```ts
import { composition } from "liosvideo";
import { crashZoomIn, palette, soundtrack, whipPan, type SfxCue } from "./fx";

const cues: SfxCue[] = [
  { sfx: "whooshFast", at: 3.0, volume: 0.45 },
  { sfx: "impactThud", at: 6.2, volume: 0.4 },
];

export default composition({
  width: 1920, height: 1080, fps: 30, background: palette.bg,
  scenes: [
    { ...intro, transition: crashZoomIn(0.26) },
    { ...middle, transition: whipPan("left") },
    outro,
  ],
  audio: soundtrack(cues, { bed: true, bedVolume: 0.09 }),
});
```

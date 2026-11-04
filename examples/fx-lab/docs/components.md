# Component reference — per type

Semua komponen diimpor dari folder `fx/` (satu pintu lewat `fx/index.ts`):

```ts
import {
  palette, fonts, archetypes, rgb,
  popIn, fadeIn, slideIn, crashZoom, shake, pulse,
  filmGrain, grainOverlay, vignette, scanlines, tornPaper,
  glitchRGB, letterbox, lightLeak, spotlight, lightPool, speedLines,
  halftone, dustMotes,
  typewriter, highlighter, kineticWord, countUp, lowerThird,
  ticker, stampText,
  pillBadge, chip, progressBar, callout, frameBrackets,
  whipPan, crashZoomIn, glitchCut, tearWipe,
  karaokeCaption, versusSplit, confetti,
  quoteCard, chapterCard, polaroidFrame, breakingBanner,
  barChart, waveform,
  annotationCircle, arrowPointer,
  SFX, soundtrack, type SfxId, type SfxCue,
} from "../fx";
```

Aturan umum:

- Semua waktu (`at`) adalah **detik lokal scene**, bukan detik komposisi.
- Semua komponen mengembalikan node/grup yang bisa dianimasikan lagi.
- Semua animasi memakai keyframe (`node.to` / `node.set`) — deterministik.
- Nama node otomatis unik; hindari `name` yang mengandung `/`.

---

## 1. Theme

```ts
palette.bg | panel | panelDeep | border | borderSoft
        text | muted | dim
        cyan | amber | rose | emerald | violet

fonts.serif   // Playfair Display  (video essay)
fonts.mono    // IBM Plex Mono     (data / typewriter)
fonts.sans    // Inter             (UI / lower third)
fonts.display // Bebas Neue        (hype / sport)

archetypes.malaka   // { label: "DARK ACADEMIA", color: amber }
archetypes.agung    // { label: "HYPER-CREATIVE", color: violet }
archetypes.aulion   // { label: "POP RHYTHM", color: rose }
archetypes.gadgetin // { label: "TECH STUDIO", color: emerald }
archetypes.urban    // { label: "URBAN SPORT", color: cyan }

rgb("#38BDF8") // -> [0.22, 0.74, 0.97] untuk uniform shader
```

---

## 2. Motion

Animasi dasar yang dipakai semua demo. Semuanya menerima `at` (default `0`).

| Fungsi | Props | Efek |
| :--- | :--- | :--- |
| `popIn(node, opts)` | `at, duration=0.45, from=0.84, ease="outBack"` | scale + opacity masuk |
| `fadeIn(node, opts)` | `at, duration=0.4, from=0, ease="outCubic"` | opacity |
| `slideIn(node, opts)` | `at, from="left"\|"right"\|"up"\|"down", distance=40` | geser ke posisi authored |
| `crashZoom(node, opts)` | `at, from=1, to=1.34, duration=0.24` | punch-in |
| `shake(node, opts)` | `at, duration=0.36, intensity=6, steps=9` | getaran kamera |
| `pulse(node, opts)` | `at, times=2, duration=0.16, gap=0.12, scale=1.07` | pulse beat |
| `floatLoop(node, opts)` | `at, duration=2, distance=8, cycles=2` | naik-turun halus |
| `breathe(node, opts)` | `at, duration=3, amount=0.012` | napas skala |
| `stagger(count, at, step)` | — | array waktu untuk entrance bertahap |

> `shake`, `slideIn`, dan `floatLoop` membaca posisi awal lewat `propsAt(0)`.
> Panggil setelah posisi node di-set, sebelum animasi lain di properti yang sama.

---

## 3. Texture & overlay

Semua shader overlay mengembalikan **premultiplied alpha**; `filmGrain` dan
`tornPaper`/`glitchRGB` bersifat opaque (menutup full stage).

| Fungsi | Props utama | Catatan |
| :--- | :--- | :--- |
| `filmGrain(parent, o)` | `width, height, amount=0.16, at` | look arsip 24 fps, opaque |
| `grainOverlay(parent, o)` | `width, height, amount=0.2, at` | grain transparan di atas foto |
| `vignette(parent, o)` | `width, height, strength=0.75` | gelap di tepi |
| `scanlines(parent, o)` | `width, height, pitch=4, strength=0.22, at` | CRT/VHS |
| `tornPaper(parent, o)` | `width, height, accent=amber, speed=0.9, at` | kertas robek, opaque |
| `glitchRGB(parent, o)` | `width, height, amount=0.55, at` | RGB split + dropout |
| `lightLeak(parent, o)` | `width, height, color=amber, strength=0.6, at` | streak anamorfik |
| `halftone(parent, o)` | `width, height, size=6, strength=0.35, color` | titik koran |
| `letterbox(parent, o)` | `width, height, ratio=0.115, at, duration` | return `{ top, bottom }` |
| `dustMotes(parent, o)` | `width, height, count=18, seed=7, duration=3` | debu melayang (seeded) |

Contoh:

```ts
image({ src: "assets/images/old-newspaper.jpg", width, height, fit: "cover" });
rect({ name: "grade", width, height, fill: palette.bg, opacity: 0.4 });
grainOverlay(root, { width, height, amount: 0.24 });
vignette(root, { width, height, strength: 0.9 });
```

---

## 4. Camera

| Fungsi | Props | Catatan |
| :--- | :--- | :--- |
| `spotlight(parent, o)` | `width, height, center=[0.5,0.5], radius=0.24, drift=0, strength=0.82, at` | overlay gelap di luar sorot |
| `lightPool(parent, o)` | `width, height, color="#FFE7B0", center, radius=0.7, drift, strength=0.38, at` | kolam cahaya; pasangkan dengan `spotlight` |
| `speedLines(parent, o)` | `width, height, color, count=26, strength=0.9, at` | garis radial impact |

`radius` memakai satuan tinggi frame (aspect-corrected). `center` dalam 0..1.

```ts
lightPool(root, { width, height, center: [0.5, 0.55], radius: 0.5, drift: 0.06, strength: 0.45 });
spotlight(root, { width, height, center: [0.5, 0.55], radius: 0.58, drift: 0.06, strength: 0.82 });
```

---

## 5. Typography

| Fungsi | Props | Return |
| :--- | :--- | :--- |
| `typewriter(parent, o)` | `text, x, y, fontSize=20, color, fontFamily=mono, charWidth=fontSize*0.6, at, duration=1.2, cursor=true, cursorColor` | `{ group, cursor, width, text }` |
| `highlighter(parent, o)` | `textNode?, x?, y?, width?, height?, padding=8, at, duration=0.4, color=amber, opacity=0.34, rotation=-1.2, z` | rect |
| `kineticWord(parent, o)` | `word, x, y, at, size=22, color, accent, family=display` | text |
| `countUp(parent, o)` | `from, to, x, y, at, duration=1.1, size=44, color, family=mono, prefix, suffix, steps=26` | text |
| `lowerThird(parent, o)` | `name, role, x, y, width=320, at, accent=cyan` | group |
| `ticker(parent, o)` | `text, x, y, width, at, speed=70, fontSize=12, color, bg, height=24, startX` | group |
| `stampText(node, o)` | `at, duration=0.2, from=1.7, rotation=-7` | node |

`typewriter` memotong teks dengan clip group yang lebarnya dianimasikan; kursor
adalah rect terpisah yang bergerak dengan timing linear yang sama.

**Ukuran otomatis.** Host memasang text measurer, jadi `propsAt(0).width`
mengembalikan lebar glyph sebenarnya. `typewriter` memakai angka itu untuk clip
dan kursor, dan `highlighter({ textNode })` memasang stabilo tepat selebar teks
(di dalam clip, tepat di belakang teks). Ganti font/size — stabilo tetap pas:

```ts
const line = typewriter(root, { text: "Data tidak pernah berbohong.", x: 208, y: 468, fontSize: 54 });
highlighter(root, { textNode: line.text, at: 1.5, opacity: 0.26, padding: 12 });
```

`measureText(node)` mengekspos pengukuran yang sama untuk komponen lain.

```ts
highlighter(root, { x: 196, y: 470, width: 620, height: 74, at: 1.5, opacity: 0.26 });
typewriter(root, { text: "Data tidak pernah berbohong.", x: 208, y: 468, fontSize: 54, at: 0.15, duration: 1.25 });
```

---

## 6. Graphics

| Fungsi | Props |
| :--- | :--- |
| `pillBadge(parent, o)` | `label, x, y, at, size=11, color, bg, height=24, paddingX=10, radius` |
| `chip(parent, o)` | `label, x, y, at, color, size=10, dot=true` |
| `progressBar(parent, o)` | `x, y, width, height=6, at, duration=0.9, progress=1, color, track` |
| `callout(parent, o)` | `x, y, tx, ty, label, at, color, size=11` |
| `frameBrackets(parent, o)` | `x, y, width, height, color, size=16, thickness=2, at` |

---

## 7. Transitions (scene-level)

```ts
scene("intro", { duration: 4, transition: whipPan("left") }, ...)
```

| Fungsi | Efek |
| :--- | :--- |
| `whipPan(direction="left", duration=0.34)` | slide + rotasi kecil + streak |
| `crashZoomIn(duration=0.26)` | masuk dari 1.24× ke 1.0× (center-anchored) |
| `glitchCut(duration=0.3)` | jitter horizontal yang mereda |
| `tearWipe(duration=0.45)` | sapuan dari kiri + skew tipis |

Untuk transisi custom:

```ts
transition((node, progress, width, height) => {
  const n = node as any;
  n.base.anchorX = 0.5; n.base.anchorY = 0.5;
  n.base.x = width / 2; n.base.y = height / 2;
  n.base.scaleX = 0.8 + 0.2 * progress;
}, 0.4)
```

---

## 8. Social

### `karaokeCaption`

```ts
karaokeCaption(root, {
  words: [
    { text: "INI", start: 0.45, end: 0.85 },
    { text: "BUKAN", start: 0.85, end: 1.3 },
    { text: "MITOS,", start: 1.3, end: 1.75 },
  ],
  x: width / 2, y: height / 2,
  size: 84, activeColor: palette.amber, dimColor: "#3E4757",
});
```

Kata aktif membesar 1.08× dan berubah warna; setelah `end` kembali ke `color`.

### `versusSplit`

```ts
versusSplit(root, {
  width, height, axis: "vertical", at: 0.1,
  top:    { label: "LARI",   sub: "5 KM",  score: 42, color: "#C2410C", imageSrc: "assets/images/road-cycling.jpg" },
  bottom: { label: "SEPEDA", sub: "20 KM", score: 58, color: "#0E7490", imageSrc: "assets/images/jakarta-skyline.jpg" },
});
```

Skor berhitung naik; divider dan badge `VS` muncul di tengah.

### `confetti`

```ts
confetti(root, { width, height, count: 64, at: 0.15, duration: 2.2, seed: 9 });
```

---

## 9. Editorial

| Fungsi | Props |
| :--- | :--- |
| `quoteCard(parent, o)` | `lines: string[], author, role, x, y, at, size=46, accent` |
| `chapterCard(parent, o)` | `index, total=5, kicker, title, x, y, at, accent` |
| `polaroidFrame(parent, o)` | `width, height, x, y, at, rotation=-5, caption, imageSrc, tint, body` |
| `breakingBanner(parent, o)` | `width, y, headline, at, height=56, color="#C81E2B"` |

`polaroidFrame` memakai **satu strip lakban putih** di tengah atas.

---

## 10. Data

```ts
barChart(root, {
  x: 220, y: 280, width: 1440, height: 460, at: 0.15,
  values: [{ label: "2020", value: 38 }, { label: "2024", value: 89 }],
  color: "#2B3A4E", highlightColor: palette.amber,
});

waveform(root, {
  x: 200, y: 600, width: 1520, height: 220,
  bars: 44, at: 0.1, step: 0.13, color: palette.cyan, seed: 17,
});
```

---

## 11. Annotation

```ts
annotationCircle(root, {
  x: 100, y: 560, width: 800, height: 400,
  at: 0.35, duration: 0.6, color: palette.rose, thickness: 0.016,
});

arrowPointer(root, {
  from: { x: 1240, y: 860 }, to: { x: 930, y: 790 },
  at: 0.7, color: palette.rose, thickness: 4, headLength: 34,
});
```

`annotationCircle` adalah shader dan menggambar garis tangan yang menyapu
searah jarum jam. `thickness` dalam satuan UV node.

---

## 12. Audio & SFX

Registry (`SFX`) berisi 22 file WAV yang disintesis oleh
`scripts/generate-sfx.mjs`:

| Kategori | ID |
| :--- | :--- |
| Motion | `whooshFast`, `whooshDeep`, `softSwoosh`, `riser`, `tapeStop` |
| Impact | `impactThud`, `impactSub`, `braam`, `stamp`, `heartbeat` |
| UI / tactile | `uiClick`, `pop`, `typewriterRun`, `cameraShutter`, `tick`, `tock` |
| Punctuation | `bell`, `bellRound`, `kaching`, `glitch`, `paperTear` |

```ts
import { soundtrack, type SfxCue } from "./fx";

const cues: SfxCue[] = [
  { sfx: "whooshDeep", at: 1.2, volume: 0.42 },
  { sfx: "impactThud", at: 1.5, volume: 0.4 },
];

export default composition({
  /* … */
  audio: soundtrack(cues, { bed: true, bedVolume: 0.09 }),
});
```

Panduan mix (mobile): VO -3..-5 dB, impact -6..-8 dB, transisi -8..-12 dB,
BGM -20..-26 dB saat VO aktif. `volume` di API adalah linear 0..1.

---

## 13. Catalog

```ts
import { FX_CATALOG, FX_IDS, fxById } from "./fx/catalog";

FX_CATALOG.filter((e) => e.volume === 1); // 12 tile playbook
fxById("karaoke-caption");                // metadata + sfx ids
```

---

## 14. Aturan penting (jebakan)

1. **Set initial state di `t = 0`, bukan `at - 0.001`.**
   Nilai sebelum keyframe pertama adalah nilai *base*, jadi `set(..., at)`
   membuat node terlihat penuh sebelum animasi dimulai. Semua helper kit sudah
   memakai `set(..., 0)`.
2. **Shader wajib menyentuh `u_globals` dan `u`.**
   wgpu membuat auto bind-group layout hanya dari binding yang dipakai; kalau
   shader tidak memakai `u_globals`, bind group gagal.
3. **`active` adalah reserved word WGSL.** Jangan pakai sebagai nama variabel.
   (Gunakan `isOn`.)
4. **Overlay shader harus premultiplied:** `return vec4f(rgb * a, a);`
5. **Determinisme:** tanpa `Math.random()`, `Date.now()`, `performance.now()`.
   Gunakan `random()` dari scene context atau `seededRandom("seed")`.
6. **Font:** CLI merender dengan font sistem. TTF OFL ada di `assets/fonts/`
   dan sudah dipasang ke `~/Library/Fonts` (Playfair Display, Inter,
   IBM Plex Mono, Bebas Neue).
7. **Clip mahal:** `clip: true` merender layer full-canvas per frame. Pakai
   seperlunya (di playbook hanya 6 tile).
8. **Lebar teks diukur otomatis** bila host measurer aktif (CLI & desktop).
   `typewriter`, `highlighter({textNode})`, `karaokeCaption`, `ticker`, dan
   `pillBadge` memakai lebar glyph asli; estimasi hanya fallback.

# FX Kit — full prop reference

All `at` / `duration` values are **seconds, scene-local**. `opts` defaults in
parentheses. `node` is any liosvideo node (`group`, `rect`, `text`, …).

---

## theme

```ts
palette: Record<colorToken, string>
fonts: { serif, mono, sans, display }
archetypes: Record<"malaka"|"agung"|"aulion"|"gadgetin"|"urban", { label: string; color: string }>
rgb(hex: string): [number, number, number]
```

---

## motion

| fn | props |
| :--- | :--- |
| `popIn` | `at(0), duration(0.45), ease("outBack"), from(0.84)` |
| `fadeIn` | `at(0), duration(0.4), ease("outCubic"), from(0)` |
| `slideIn` | `at(0), duration(0.5), ease("outCubic"), from("left"), distance(40)` — `left|right|up|down` |
| `crashZoom` | `at(0), duration(0.24), ease("outCubic"), from(1), to(1.34)` |
| `shake` | `at(0), duration(0.36), intensity(6), steps(9)` |
| `pulse` | `at(0), times(2), duration(0.16), gap(0.12), scale(1.07), ease("outCubic")` |
| `floatLoop` | `at(0), duration(2), distance(8), cycles(2)` |
| `breathe` | `at(0), duration(3), amount(0.012)` |
| `stagger` | `(count, at=0, step=0.12): number[]` |

---

## overlays

| fn | props | output |
| :--- | :--- | :--- |
| `filmGrain` | `width, height, at(0), amount(0.16), name` | opaque shader |
| `grainOverlay` | `width, height, at(0), amount(0.2), name` | transparent shader |
| `vignette` | `width, height, strength(0.75), name` | transparent shader |
| `scanlines` | `width, height, at(0), pitch(4), strength(0.22), name` | transparent shader |
| `tornPaper` | `width, height, at(0), accent(amber), speed(0.9), name` | opaque shader |
| `glitchRGB` | `width, height, at(0), amount(0.55), name` | opaque shader |
| `lightLeak` | `width, height, at(0), color(amber), strength(0.6), name` | transparent shader |
| `halftone` | `width, height, at(0), size(6), strength(0.35), color("#05070A"), name` | transparent shader |
| `letterbox` | `width, height, at(0), ratio(0.115), duration(0.55), color("#000")` | `{ top, bottom }` |
| `dustMotes` | `width, height, at(0), count(18), seed(7), color("#E8DCC0"), duration(3), name` | group |

Notes: shader nodes render into a texture sized from their transform; composite
uses premultiplied alpha. `letterbox` bars animate `height`.

---

## camera

| fn | props |
| :--- | :--- |
| `spotlight` | `width, height, at(0), center([0.5,0.5]), radius(0.24), drift(0), strength(0.82), name` |
| `lightPool` | `width, height, at(0), color("#FFE7B0"), center([0.5,0.5]), radius(0.7), drift(0), strength(0.38), name` |
| `speedLines` | `width, height, at(0), color(amber), count(26), strength(0.9), name` |

`radius` is expressed in frame-height units (aspect-corrected internally).
Keep `center` + `drift` identical between `lightPool` and `spotlight`.

---

## typography

| fn | props | output |
| :--- | :--- | :--- |
| `typewriter` | `text, x, y, fontSize(20), color(text), fontFamily(mono), charWidth(fontSize*0.6), at(0), duration(1.2), cursor(true), cursorColor(color), name` | `{ group, cursor?, width, text }` (width measured) |
| `highlighter` | `textNode?, x?, y?, width?, height?, padding(8), at(0), duration(0.4), color(amber), opacity(0.34), rotation(-1.2), z` | rect — fits the text node and sits behind it |
| `kineticWord` | `word, x, y, at(0), size(22), color(text), accent(amber), family(display), name` | text |
| `countUp` | `from, to, x, y, at(0), duration(1.1), size(44), color(text), family(mono), weight(700), prefix(""), suffix(""), steps(26), name` | text |
| `lowerThird` | `name, role, x, y, width(320), at(0), duration(0.42), accent(cyan)` | group |
| `ticker` | `text, x, y, width, at(0), speed(70), fontSize(12), color(muted), bg(panelDeep), height(24), startX(width), name` | group |
| `stampText` | `at(0), duration(0.2), from(1.7), rotation(-7)` | node |

---

## graphics

| fn | props |
| :--- | :--- |
| `pillBadge` | `label, x, y, at(0), size(11), color(emerald), bg("#11251F"), height(24), paddingX(10), radius(height/2), name` |
| `chip` | `label, x, y, at(0), color(cyan), size(10), dot(true), name` |
| `progressBar` | `x, y, width, height(6), at(0), duration(0.9), progress(1), color(cyan), track(borderSoft), name` |
| `callout` | `x, y, tx, ty, label, at(0), color(emerald), size(11), name` |
| `frameBrackets` | `x, y, width, height, color(cyan), size(16), thickness(2), at(0), name` |

---

## transitions

```ts
whipPan(direction: "left"|"right"|"up"|"down" = "left", duration = 0.34)
crashZoomIn(duration = 0.26)
glitchCut(duration = 0.3)
tearWipe(duration = 0.45)
```

Attach with `scene(id, { duration, transition: whipPan("left") }, build)`.
`crashZoomIn` centre-anchors the scene root before scaling.

---

## social

| fn | props |
| :--- | :--- |
| `karaokeCaption` | `words: { text, start, end }[], x, y, at(0), size(44), color(text), activeColor(amber), dimColor(dim), gap(size*0.42), fontFamily(sans), name` |
| `versusSplit` | `width, height, top, bottom, axis("vertical"\|"horizontal"), at(0), duration(0.5), ease("outCubic"), name` |
| `confetti` | `width, height, at(0), count(30), duration(2.4), seed(5), colors(palette set), name` |

`VersusSide = { label, sub?, score, color, imageSrc? }`.

---

## editorial

| fn | props |
| :--- | :--- |
| `quoteCard` | `lines: string[], author, role?, x, y, at(0), size(46), color("#EFE6D2"), accent(amber), name` |
| `chapterCard` | `index, total(5), kicker?, title, x, y, at(0), accent(amber), name` |
| `polaroidFrame` | `width, height, x, y, at(0), rotation(-5), caption, tint("#26313F"), body, imageSrc?, name` |
| `breakingBanner` | `width, y, headline, at(0), height(56), color("#C81E2B"), name` |

`polaroidFrame` draws one white tape strip centred on the top edge.

---

## data

| fn | props |
| :--- | :--- |
| `barChart` | `x, y, width, height, values: {label,value}[], at(0), duration(0.55), color(border), highlightColor(cyan), max(auto), name` |
| `waveform` | `x, y, width, height, bars(28), at(0), step(0.12), color(cyan), seed(17), name` |

---

## annotation

| fn | props |
| :--- | :--- |
| `annotationCircle` | `x, y, width, height, at(0), duration(0.6), color(rose), thickness(0.035), name` |
| `arrowPointer` | `from:{x,y}, to:{x,y}, at(0), duration(0.4), color(rose), thickness(4), headLength(28), name` |

`thickness` is in UV units of the node box (0.02 ≈ 2% of the width).

`measureText(node)` returns `{ width, height }` from the host measurer.
`highlighter({ textNode })` re-parents the bar behind the text in the same
parent, so it also works inside a `typewriter` clip.

---

## audio

```ts
type SfxId = keyof typeof SFX;
type SfxCue = { sfx: SfxId; at: number; volume?: number };

soundtrack(cues: SfxCue[], opts?: {
  bed?: boolean;          // default true
  bedVolume?: number;     // default 0.1
  bedSrc?: string;        // default assets/audio/music/ambient_bed.wav
}): AudioTrack[]
```

Files (48 kHz mono WAV, synthesized):

`whooshFast`, `whooshDeep`, `impactThud`, `impactSub`, `pop`, `uiClick`,
`bell`, `bellRound`, `typewriterRun`, `paperTear`, `cameraShutter`, `glitch`,
`riser`, `heartbeat`, `kaching`, `braam`, `stamp`, `tapeStop`, `softSwoosh`,
`tick`, `tock`, `ambient_bed` (music).

Mixing guide: VO −3…−5 dB, impact −6…−8, transitions −8…−12, bed −20…−26
under VO. `volume` is linear 0..1.

---

## catalog

```ts
type FxEntry = {
  id: string; name: string; category: FxCategory; archetype: ArchetypeId;
  blurb: string; recipe: string; sfx: SfxId[]; volume: 1 | 2;
};
FX_CATALOG: FxEntry[]
FX_IDS: string[]
fxById(id): FxEntry
```

# FX Lab — reusable cinematic effects for liosvideo

A deterministic, code-first FX kit modelled on the editing language of
Indonesian creators (Ferry Irwandi / Tim Malaka, Agung Hapsah, Aulion,
GadgetIn-style tech reviewers, urban sport creators).

- **22 reusable effects** in `fx/` (texture, camera, typography, transition,
  graphic, social, editorial, data, annotation).
- **22 standalone example scenes** in `scenes/examples/`.
- **3 demo videos**: a one-page playbook, a 12-scene reel and a 10-scene reel.
- **22 synthesized SFX** in `assets/audio/sfx/` (no licensing, no attribution).
- **Licensed b-roll** in `assets/images/` (see `assets/ATTRIBUTIONS.md`).

---

## Quick start

```bash
# from the repo root
./target/release/liosvideo info  examples/fx-lab/fx-playbook.ts

# one-page catalog (7.5s)
./target/release/liosvideo render examples/fx-lab/fx-playbook.ts -o examples/fx-lab/out/fx-playbook.mp4

# per-effect reels (36s / 30s)
./target/release/liosvideo render examples/fx-lab/fx-examples.ts      -o examples/fx-lab/out/fx-examples.mp4
./target/release/liosvideo render examples/fx-lab/fx-examples-vol2.ts -o examples/fx-lab/out/fx-examples-vol2.mp4

# still frame
./target/release/liosvideo snapshot examples/fx-lab/fx-playbook.ts --frame 75 -o out/frame.png
```

Open **this folder** (`examples/fx-lab`) in the desktop app: every root `.ts`
that default-exports `composition(...)` appears in the composition switcher.

---

## Layout

```
fx-playbook.ts           # volume 1 — one-page catalog (12 tiles)
fx-examples.ts           # volume 1 — 12 standalone example scenes
fx-examples-vol2.ts      # volume 2 — 10 standalone example scenes

fx/
  theme.ts               # palette, fonts, archetype colours
  motion.ts              # popIn, fadeIn, slideIn, crashZoom, shake, pulse…
  overlays.ts            # grain, vignette, scanlines, torn paper, glitch…
  typography.ts          # typewriter, highlighter, countUp, lowerThird…
  graphics.ts            # pills, chips, progress, callouts, brackets
  transitions.ts         # whipPan, crashZoomIn, glitchCut, tearWipe
  social.ts              # karaokeCaption, versusSplit, confetti
  editorial.ts           # quoteCard, chapterCard, polaroidFrame, breakingBanner
  data.ts                # barChart, waveform
  annotation.ts          # annotationCircle, arrowPointer
  sfx.ts                 # SFX registry + soundtrack()
  catalog.ts             # machine-readable effect list

scenes/
  fx-playbook.ts         # the catalog page
  tiles.ts               # 12 tile demos
  timing.ts              # shared timeline constants
  examples/              # 22 standalone 3s scenes

assets/
  images/                # licensed b-roll (see ATTRIBUTIONS.md)
  fonts/                 # OFL font copies (installed locally for rendering)
  audio/sfx/             # synthesized WAV effects
  audio/music/           # ambient bed
scripts/generate-sfx.mjs # deterministic SFX synthesizer
docs/                    # per-type usage + example index
```

---

## Type system

| Token | Font | Register |
| :--- | :--- | :--- |
| `fonts.serif` | Playfair Display | Video-essay headlines (Ferry / Tim Malaka) |
| `fonts.mono` | IBM Plex Mono | Data, timecode, typewriter |
| `fonts.sans` | Inter | UI, lower thirds, labels (tech review) |
| `fonts.display` | Bebas Neue | Hype titles, numbers, sport edits |

The headless CLI renders with **system fonts**, so the TTFs in `assets/fonts/`
are installed once into `~/Library/Fonts` (macOS). Without that step the renderer
falls back to system defaults. See `docs/components.md` for details.

---

## Adding a new effect

1. Write the component in the right `fx/*.ts` module (pure keyframes only).
2. Export it from `fx/index.ts`.
3. Add a catalog entry in `fx/catalog.ts` (`volume: 2` for new work).
4. Add a 3-second scene in `scenes/examples/`.
5. Pair it with an SFX id in the catalog and cue it in the reel.
6. Document it in `docs/components.md` and the `fx-kit` skill.

---

## Docs

- [`docs/components.md`](docs/components.md) — every component, per type, with props.
- [`docs/examples.md`](docs/examples.md) — what each of the 22 example scenes shows.
- [`assets/ATTRIBUTIONS.md`](assets/ATTRIBUTIONS.md) — image/font licenses.

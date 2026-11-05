# Design: Animation Styles (engine filters, style kit, style picker)

- **Date**: 2026-11-05
- **Status**: Approved scope (option 3: filters + kit + skill + showcase + app picker)
- **Author**: Claude & Hanif

## 1. Intent

Creators ask for named looks ("make it Pixel Art", "Comic style", "like ZackD Films"). Today an agent has
to invent each look from raw shapes, and looks that need a whole-image treatment (pixelation, halftone,
ink outlines, bloom, chalk grain) can't be done at all. This adds ten ready looks that a person can pick
when creating a project or apply from the chat, and that the agent can apply without re-reading the code.

Success: picking "Pixel Art" (or any of the ten) and sending "make a 10 s intro about X" produces a video
that a viewer recognises as that style, in the preview and in the exported MP4 alike.

## 2. The ten styles

Ids are generic; names credit the inspiration where it is a creator. No trademarked names in ids, file
names or UI titles.

| id | UI title | Look | Main tools |
| :--- | :--- | :--- | :--- |
| `pixel-art` | Pixel Art | chunky pixels, limited palette, stepped motion | `pixelate`, `posterize`, stepped easing |
| `chalkboard` | Chalkboard | dark green board, chalk strokes written on, smudges | `chalk`, path draw-on |
| `glow-sketch` | Glow Sketch | neon line drawings on black, boiling lines | `glow`, path draw-on, per-frame jitter |
| `ps2-lowpoly` | PS2 Style | low-poly 3D, low resolution, fog, wobbly vertices | `three()`, `pixelate`, `posterize` |
| `comic` | Comic Art | panels, ink outlines, halftone shading, action words | `outline`, `halftone`, `posterize` |
| `flat-vector` | Flat Vector | flat colour shapes, no gradients, bouncy motion | primitives, `outBack` |
| `minimal-mono` | Minimal Mono (Dan Koe style) | black/white, serif statements, hand underline | text, path draw-on |
| `cgi-motion` | CGI Motion | glossy soft-lit 3D object, slow orbit camera | `three()`, `glow` |
| `brick` | Brick Build (LEGO-like) | toy bricks with studs that stack into shapes | `three()` |
| `explainer-3d` | 3D Explainer (ZackD Films style) | soft 3D macro shots, shallow depth of field, captions | `three()`, `blur` |

## 3. Engine filters

New animatable props on every node (like `blur`). Any non-zero filter turns the node into an isolated
layer; filters run on the layer after `blur`, in this fixed order:

`pixelate → posterize → halftone → outline → chalk → glow`

| prop | unit / default | effect |
| :--- | :--- | :--- |
| `pixelate` | cell size, composition px, 0 = off | each cell takes the colour at its centre |
| `posterize` | levels per channel, 0 = off (≥ 2 when on) | quantises unpremultiplied colour |
| `halftone` | dot cell size, composition px, 0 = off | dot per cell, radius grows with darkness; dots darken the colour |
| `outline` | width, composition px, 0 = off | ink line where alpha or luminance changes sharply |
| `outlineColor` | colour, `#111111` | ink colour |
| `chalk` | strength 0–1, 0 = off | grainy alpha erosion + streaks, fixed per pixel (no flicker) |
| `glow` | radius, composition px, 0 = off | layer plus its blurred copy (additive bloom) |
| `glowIntensity` | 0–4, default 1 | bloom strength |

Units are composition px scaled by the device scale, so a preview at any size matches the export.
Both renderers (desktop WebGPU in `packages/runtime`, CLI wgpu in `apps/cli`) run the same
`filter.wgsl`; the existing shader-parity test covers it.

## 4. Style kit

`examples/style-lab/` is a liosvideo project (like `examples/fx-lab/`) and the single source of truth:

- `styles/<id>.ts` — one self-contained module per style (imports only `liosvideo`): `theme`
  (colours, fonts, easing), `look` (props to spread on a group, e.g. `{ pixelate: 6, posterize: 6 }`),
  and 2–4 helpers that make the style's signature elements.
- `scenes/<id>.ts` — one demo scene per style, responsive 16:9 / 9:16.
- `styles/catalog.ts` — id, title, inspiration, one-line description, recommended ratio.
- `docs/<id>.md` — how to apply the style: look, palette, motion rules, helper API, do / don't.
- `showcase.ts` — 1080×1920 reel: title card listing all ten, then ~4 s per style.
- `long.ts` — 1920×1080 version of the same reel.

Projects get copies of these files (scaffold and chat install), embedded at build time with
`include_str!` from `examples/style-lab`, so there is no second copy in the repo.

## 5. Picking a style

- **New project** (desktop `ProjectPicker`, CLI `project new --style <id>`): an optional style row next to
  the templates. With a style, the project gets `styles/<id>.ts`, `.agents/skills/liosvideo/styles/<id>.md`
  and `"style": "<id>"` in `.liosvideo/project.json`. With the blank template, the style's demo scene
  replaces `scenes/intro.ts`. Other templates keep their scenes.
- **From the chat**: a Style menu in the composer lists the ten. Choosing one installs the same files
  (never overwriting a file that already exists) and fills the composer with
  `Restyle <selection or "this video"> in the <title> style — follow .agents/skills/liosvideo/styles/<id>.md and use styles/<id>.ts.`
  The person edits or sends it.
- **CLI**: `liosvideo styles` lists ids and titles.
- `AGENTS.md` and the director skill gain a short "Visual styles" section pointing at these files.

## 6. Non-goals

- No automatic restyling of existing scenes without the agent (filters can be added by hand, though).
- No style mixing UI; a project can hold several style files, but the picker sets one.
- No new fonts that need bundling; styles use system fonts or the already-bundled OFL fonts.

## 7. Left to the builder

Helper names and exact visuals per style, shader maths for each filter within the table above, showcase
pacing and copy.

# Flat Vector

Explainer-infographic style: flat colour shapes, no gradients, no outlines, bouncy motion.

## Look
- Rounded rectangles and circles in flat fills. No strokes, no shadows, no filters (`look` is empty).
- A warm off-white background with one or two big soft blobs behind the content.
- Heavy rounded sans (Avenir Next, 800) for headlines and numbers.

## Palette
Background `#f4efe6`, navy `#1f2a44` (text), coral `#ff6b5b`, teal `#2ec4b6`, yellow `#ffbf3c`, lavender `#8e7dff`, white cards `#ffffff`. One dark, one light, three accents.

## Motion
- Everything enters with `pop(node, at)` — scale from 0 with an `outBack` overshoot — staggered 0.08–0.15 s.
- Bars and meters `grow(node, at)` from their base.
- Characters do small, friendly motions (a 4° sway, a wave).

## Helpers (`styles/flat-vector.ts`)
- `pop(node, at, duration)`, `grow(node, at, duration)`
- `person(x, y, size, { shirt, skin })` — a simple flat character standing on (x, y)
- `stat(value, label, { x, y, width, color })` — a white card with a big number
- `coin(x, y, r)`

## Do / Don't
- Do keep generous whitespace and align things to a simple grid.
- Do lay out per aspect ratio: chart and character side by side, cards below (9:16); cards beside the chart (16:9).
- Don't add gradients, strokes or drop shadows.
- Don't overlap content shapes — flat style reads through clear separation.

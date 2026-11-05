# Chalkboard

A teacher's chalk talk: lines and handwriting appear on a green board.

## Look
- Start with `board(width, height)` — the green slate, faint smudges and a wooden ledge.
- Draw everything chalky inside `chalkLayer()`; it carries `chalk: 0.55`, which breaks strokes into grainy, streaky chalk.
- Strokes are slightly wobbly and not perfectly closed. Lettering is handwritten (Chalkduster for titles, Chalkboard SE for notes).

## Palette
Board `#1f3d2b`. Chalk white `#f1f1e6`, chalk yellow `#f6e27f`, chalk pink `#f4a7b9`, chalk blue `#9fd3f0`. Use white for most things and one colour to point at the idea.

## Motion
- Everything is *drawn on*: `chalkLine`, `chalkCircle` and `chalkArrow` take `at` and `duration` and reveal along the stroke; `chalkWrite` reveals text left to right.
- Pace like a hand: ~0.4–0.8 s per stroke, one thing at a time, small gaps between.
- Moving parts (a moon on its orbit) move slowly and linearly.

## Helpers (`styles/chalkboard.ts`)
- `board(w, h)`, `chalkLayer()`
- `chalkLine(points, { width, color, at, duration, name })`
- `chalkCircle(cx, cy, r, { …, wobble })`, `chalkArrow(from, to, { … })`
- `chalkWrite(label, { x, y, size, font, color, at, duration })`

## Do / Don't
- Do underline titles and circle the key term.
- Do hatch shapes (a few parallel strokes) instead of filling them.
- Don't use solid filled shapes or saturated colours.
- Don't fade things in — chalk is written, not faded.

# Glow Sketch

Glowing neon line drawings that draw themselves on black.

## Look
- Black background with a few dim stars.
- Draw inside `neonLayer()` — it carries `glow: 24, glowIntensity: 2.6`, so every thin line blooms.
- Lines are thin (2–6 px) and bright; the glow does the rest. Text uses `neonText()` (a bright core with a soft halo).

## Palette
Background `#05060a`. Neon cyan `#3df2ff`, magenta `#ff4fd8`, lime `#9dff5c`, amber `#ffb347`, white `#f5fbff`. Two colours per scene, max three.

## Motion
- Lines draw on along their length (`neonLine`, `neonCircle` with `at` / `duration`).
- `boil(node, random, amount, from, to, fps)` jitters a drawing a pixel or two at 8–12 fps — the hand-drawn "line boil" look.
- `flicker(node, at, …)` stutters a sign on, like a neon tube catching.

## Helpers (`styles/glow-sketch.ts`)
- `neonLayer()`, `neonLine(points, o)`, `neonCircle(cx, cy, r, o)`, `spark(x, y, r, color)`
- `neonText(label, o)`, `boil(...)`, `flicker(...)`

## Do / Don't
- Do keep lots of black around the drawing.
- Do use line boil on still drawings so they feel alive.
- Don't fill large shapes — the glow turns them into a blur.
- Don't stack many bright lines on top of each other; they wash out to white.

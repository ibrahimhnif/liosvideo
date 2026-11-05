# Pixel Art

Chunky pixels, a limited palette and stepped motion — a 16-bit game screen.

## Look
- Build the scene at full resolution, then put it inside `pixelStage(width, height)` (or any group with `look`): `pixelate: 6` turns everything into 6 px cells and `posterize: 6` snaps colours to a few levels.
- Hard edges only: no blur, no soft shadows, no gradients other than banded ones.
- Text uses `pixelText()` (Menlo, bold, no smoothing tricks) and should be short: "LEVEL 1", "PRESS START".

## Palette
PICO-8-like: `theme.colors` — dark navy `#1d2b53`, purple `#7e2553`, green `#008751`, brown `#ab5236`, grey `#5f574f`, light `#c2c3c7`, white `#fff1e8`, red `#ff004d`, orange `#ffa300`, yellow `#ffec27`, lime `#00e436`, blue `#29adff`, lavender `#83769c`, pink `#ff77a8`, peach `#ffccaa`. Never introduce an off-palette colour.

## Motion
- Use `theme.ease.snap` (`stepped(6)`) for everything — motion moves in visible steps, like a low frame rate.
- Walk cycles: swap or bob a sprite every 0.15–0.2 s. Blink prompts on/off with `set()`, not fades.
- Hops and coin collects are short (0.2–0.35 s).

## Helpers (`styles/pixel-art.ts`)
- `pixelStage(w, h)` — full-frame group carrying the look.
- `sprite(rows, colors, cell, init)` — draws a sprite from strings of palette keys (`"..rr.."`), merging runs into rects.
- `sprites` — `hero`, `coin`, `heart`, `cloud`; `spriteColors` maps their keys.
- `pixelText(label, size, init)`, `stepped(steps)`.

## Do / Don't
- Do keep shapes axis-aligned and sized in whole cells.
- Do layer the sky as flat horizontal bands.
- Don't rotate sprites by arbitrary angles or scale them smoothly.
- Don't use smooth easings (`outBack`, `inOutCubic`) — they break the illusion.

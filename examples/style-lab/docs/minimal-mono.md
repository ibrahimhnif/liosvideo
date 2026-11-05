# Minimal Mono (Dan Koe style)

Black and white serif statements, one idea per screen, with a hand-drawn underline on the key word.

## Look
- Near-black background, off-white serif type (Georgia), left-aligned, lots of empty space.
- One statement per screen, broken into short lines. A small muted caption is optional.
- No colour, no filters (`look` is empty). The only mark is the hand-drawn underline.

## Palette
Background `#0b0b0b`, ink `#f2efe8`, muted `#8a8780`. Nothing else.

## Motion
- Lines `fadeUp` one after another, ~0.35–0.45 s apart, `outCubic`, rising a third of the font size.
- When the key word lands, `handUnderline` draws under it left to right in ~0.45 s.
- Hold the finished statement for at least a second before cutting.

## Helpers (`styles/minimal-mono.ts`)
- `statement(lines, { x, y, size, at, stagger })` — one text node per line, fading up
- `handUnderline(x, y, width, { at, duration, thickness })` — a few slightly tilted strokes
- `measure(label, size)` — line width (to place the underline under a word), `fadeUp(node, at)`

## Do / Don't
- Do write short, punchy lines; break them by meaning, not by width.
- Do underline exactly one word per statement.
- Don't add images, icons or colour.
- Don't animate words individually or bounce anything — the calm is the point.

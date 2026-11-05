# Comic Art

A comic-book page: panels, ink outlines, halftone shading and action words.

## Look
- Lay the page out with `panel(x, y, w, h, { bg })` — thick black borders, gutters of ~2.5% of the short side.
- Put each panel's art in `panel.art`; it carries `outline: 3, halftone: 7, posterize: 5`, which inks the edges, adds halftone dots and flattens the colours.
- Lettering (`speechBubble`, `caption`, `actionWord`) goes on the panel, *outside* `art`, so it stays crisp.

## Palette
Paper `#fdf6e3`, ink `#111111`, red `#e63946`, yellow `#ffd23f`, blue `#3a86ff`, sky `#8ecae6`, skin `#f4c095`, purple `#6a4c93`. Bold primaries; one background colour per panel.

## Motion
- Panels appear one at a time (~0.7 s apart) with a fast `outBack` pop (0.2–0.3 s).
- Bubbles pop in just after their panel. Sound effects slam in at a slight angle.
- `shake(node, at, amount)` on impacts.

## Helpers (`styles/comic.ts`)
- `panel(...)` → `Panel` with `.art`
- `speechBubble(label, { x, y, width, size, tailX, tailY })` — grows to fit the text, tail points at the speaker
- `caption(label, { x, y, size })`, `actionWord(label, { x, y, size, color, burst, rotation })`
- `shake(...)`, `speedLines(w, h, count, color)`

## Do / Don't
- Do stack panels vertically in 9:16 and place them side by side in 16:9.
- Do use speed lines behind close-ups and impacts.
- Don't put lettering inside `panel.art` — the outline and halftone filters will smear it.
- Don't use soft fades; comics cut.

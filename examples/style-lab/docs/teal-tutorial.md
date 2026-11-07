# Teal Tutorial

Calm dark-teal screens for software how-tos: a numbered step card, a code pane that writes itself line by line, and the UI mockups (`browserWindow`, `fileExplorer`, `chatThread`, `notification`) showing the result.

## Look
- One step per scene. `stepCard` in `layout().slot("title")`; code in `slot("left")`, the result in `slot("right")` (they stack top/bottom in 9:16).
- Code is Menlo with line numbers and simple colouring (keywords teal, strings amber, numbers pink, comments muted). The pane shrinks its type to fit the longest line (down to 70%).
- Mockups use `theme: "dark"`; put the teal panel colour on cards inside them.

## Palette
Background `#061a1d`, panel `#0c2a2f`, border `#1b4a50`, teal `#2dd4bf`, ink `#e6fffb`, muted `#7fa8a3`.

## Motion
- Step card rises in first; code lines appear ~0.18 s apart in reading order.
- `codePane(...).focus(line, at)` slides a soft teal bar to the line being explained; move it as the narration reaches each line.
- The result appears only after the code that produces it.

## Helpers (`styles/teal-tutorial.ts`)
- `stepCard(box, { step, title, summary?, at, size })`
- `codePane(box, { file, code, at, stagger?, fontSize })` with `.focus(index, at)` and `.lines`
- `tag(label, { x, y, size, at })` — a small teal pill ("Terminal", "Tip"); `tokens(line)`; `rise(node, at)`

## Do / Don't
- Do keep code short (≤ 8 lines) and real; split longer code across steps.
- Do show the result in a mockup, not a screenshot, so it scales in both ratios.
- Don't animate characters one by one: whole lines read better on video.
- Don't use more than one accent colour.

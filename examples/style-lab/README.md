# Style Lab

Ten ready-made animation styles for liosvideo, each a small kit you can copy into any project:

| # | Style | id | Built with |
| :- | :- | :- | :- |
| 1 | Pixel Art | `pixel-art` | 2D + pixelate/posterize filters |
| 2 | Chalkboard | `chalkboard` | 2D + chalk filter |
| 3 | Glow Sketch | `glow-sketch` | 2D + glow filter |
| 4 | PS2 Style | `ps2-lowpoly` | three() + pixelate/posterize |
| 5 | Comic Art | `comic` | 2D + outline/halftone/posterize |
| 6 | Flat Vector | `flat-vector` | 2D |
| 7 | Minimal Mono (Dan Koe style) | `minimal-mono` | 2D |
| 8 | CGI Motion | `cgi-motion` | three() + glow |
| 9 | Brick Build (LEGO-like) | `brick` | three() |
| 10 | 3D Explainer (ZackD Films style) | `explainer-3d` | three() + blur |

Each style has three files:

- `styles/<id>.ts` — the kit: `theme` (colours, fonts, easings), `look` (the filter props for the style's layer) and helpers.
- `scenes/<id>.ts` — a 4-second demo that lays out for both 16:9 and 9:16.
- `docs/<id>.md` — look, palette, motion, helpers, do / don't.

`styles/catalog.ts` lists all ten in order.

## Render the reel

```bash
liosvideo render showcase.ts --out out/showcase.mp4   # 1080×1920
liosvideo render long.ts --out out/long.mp4           # 1920×1080
liosvideo snapshot showcase.ts --frame 120 --out out/frame.png
```

## Use a style in your project

- In the app: **Style** menu in the chat panel, or pick a style when creating a project.
- From the CLI: `liosvideo project new my-video --style comic`.
- By hand: copy `styles/<id>.ts` (and `scenes/<id>.ts` as a starting point) into your project and read `docs/<id>.md`.

The renderer's `three()` support is a software rasteriser: no textures, shadows or fog, so the 3D styles fake fog and depth of field in code. Names like "Dan Koe style" or "ZackD Films style" describe an inspiration; the styles use no one's assets or brand marks.

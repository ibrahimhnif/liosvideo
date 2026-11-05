---
name: style-kit
description: Ten ready-made animation styles for liosvideo (pixel art, chalkboard, glow sketch, PS2 low-poly, comic, flat vector, minimal mono, CGI motion, toy bricks, 3D explainer) — theme, filter look, helpers and a demo scene for each. Use when a video should look like one of these styles, when restyling scenes, or when picking a visual direction.
---

# liosvideo Style Kit

The kits live in `examples/style-lab/`. Each style is three files:

- `styles/<id>.ts` — `theme` (colours, fonts, easings), `look` (filter props to spread on the style's layer group) and helpers.
- `scenes/<id>.ts` — a 4 s demo laid out for 16:9 and 9:16. Start from it.
- `docs/<id>.md` — look, palette, motion, helpers, do / don't. **Read it before writing scenes in that style.**

## The ten styles

| id | Title | Use it when |
| :- | :- | :- |
| `pixel-art` | Pixel Art | games, retro, playful explainers; short labels — [doc](../../../examples/style-lab/docs/pixel-art.md) |
| `chalkboard` | Chalkboard | teaching a concept step by step, diagrams, formulas — [doc](../../../examples/style-lab/docs/chalkboard.md) |
| `glow-sketch` | Glow Sketch | tech, space, night, "idea" moments; line drawings on black — [doc](../../../examples/style-lab/docs/glow-sketch.md) |
| `ps2-lowpoly` | PS2 Style | nostalgia, gaming, eerie or dreamy worlds (3D) — [doc](../../../examples/style-lab/docs/ps2-lowpoly.md) |
| `comic` | Comic Art | stories with beats, reactions, punchlines — [doc](../../../examples/style-lab/docs/comic.md) |
| `flat-vector` | Flat Vector | business explainers, stats, product how-tos — [doc](../../../examples/style-lab/docs/flat-vector.md) |
| `minimal-mono` | Minimal Mono (Dan Koe style) | quotes, essays, one-idea-per-screen voice-overs — [doc](../../../examples/style-lab/docs/minimal-mono.md) |
| `cgi-motion` | CGI Motion | product reveals, launches, premium brand moments (3D) — [doc](../../../examples/style-lab/docs/cgi-motion.md) |
| `brick` | Brick Build (LEGO-like) | building, growth, step-by-step assembly, kids (3D) — [doc](../../../examples/style-lab/docs/brick.md) |
| `explainer-3d` | 3D Explainer (ZackD Films style) | "what happens when…" shorts, science and body explainers, 9:16 (3D) — [doc](../../../examples/style-lab/docs/explainer-3d.md) |

`styles/catalog.ts` exports this list as `STYLES` (`id`, `title`, `inspiration`, `description`, `ratio`, `three`).

## Install a style into a project

- **App:** the chat panel's **Style** menu (installs the files and asks the agent to restyle), or choose a style in the new-project dialog.
- **CLI:** `liosvideo project new <name> --style <id>`; `liosvideo styles` lists the ids.
- **By hand:** copy `examples/style-lab/styles/<id>.ts` to the project's `styles/`, and the doc to `.agents/skills/liosvideo/styles/<id>.md`. Never overwrite files the user already has.

## Using a style

```ts
import { group, scene } from "liosvideo";
import { look, theme, panel, speechBubble } from "../styles/comic";

export default scene("beat-1", { duration: 4, background: theme.colors.paper }, ({ root, width, height }) => {
  const p = root.add(panel(24, 24, width - 48, height * 0.4, { bg: theme.colors.sky })); // panel.art already carries `look`
  // …draw in p.art, letter on p
});
```

- Spread `look` on the group holding the style's art; keep text that must stay crisp **outside** it.
- Use `theme.colors` / `theme.fonts` / `theme.ease` instead of new values.
- 3D styles: draw all random numbers in the scene builder (`random()`), not in `setup`/`update`; the 3D renderer has no textures, shadows or fog.
- Lay out for both ratios (`const portrait = height > width`), as every demo does.

## Filters (any node)

`pixelate` (px), `posterize` (levels), `halftone` (dot px), `outline` (px) + `outlineColor`, `chalk` (0–1), `glow` (px) + `glowIntensity`. Any non-zero filter makes the node render as its own layer; filters run after `blur`, in that order.

## Rendering the reel

`liosvideo render examples/style-lab/showcase.ts --project examples/style-lab --out out/showcase.mp4` (9:16), `long.ts` for 16:9.

# liosvideo project

This folder is a video project for liosvideo. Videos are written as TypeScript code; the app renders them with WebGPU and shows a live preview that reloads whenever a file changes.

## Layout

```
long.ts                16:9 composition (YouTube)
short.ts               9:16 composition (Shorts / Reels / TikTok)
scenes/                scene modules, importable by any composition
script.md              researched script; narration lines with stable ids, one section per composition
assets/images|video|fonts/
assets/audio/vo/       narration clips + word timings
assets/audio/music/
.liosvideo/project.json  project settings (don't edit by hand)
out/                   exports (gitignored)
```

## Compositions

Any `*.ts` file at the project root that default-exports `composition(...)` is a renderable output:

```ts
import { composition } from "liosvideo";
import intro from "./scenes/intro";

export default composition({ width: 1920, height: 1080, fps: 30, background: "#0b0d12", scenes: [intro] });
```

Scenes play in order. Scene ids must be unique within a composition.

## Scenes

```ts
import { group, image, rect, scene, text } from "liosvideo";

export default scene("intro", { duration: 3, background: "#0b0d12" }, ({ root, width, height, duration, random }) => {
  const title = root.add(text({ name: "title", text: "Hello", fontSize: 96, x: width / 2, y: height / 2, anchorX: 0.5, anchorY: 0.5, opacity: 0 }));
  title.to({ opacity: 1 }, { at: 0.2, duration: 0.6, ease: "outCubic" });
});
```

- `build` runs once; it describes the whole scene up front. Time is in **seconds from the start of the scene**.
- `root` is a group the size of the frame. Use `width`/`height` so a scene works in both 16:9 and 9:16.
- `random()` is a deterministic random source seeded by the scene id.

### Nodes

Create with `group(init)`, `rect(init)`, `text(init)`, `image(init)`; attach with `parent.add(child)` (returns the child). Groups nest: transforms, opacity, blur and clipping apply to the whole subtree.

Props every node has (defaults in brackets): `x, y` [0] position in the parent; `width, height` [0]; `anchorX, anchorY` [0] pivot as a 0–1 fraction of the size; `scaleX, scaleY` [1]; `rotation` [0] degrees clockwise; `opacity` [1]; `blur` [0] px; `z` [0] stacking order among siblings; `radius` [0] corner radius; `clip` [false] clip children to the rounded bounds.

- `rect`: `fill` ["#ffffff"], `stroke` [""], `strokeWidth` [0].
- `text`: `text`, `fontFamily` ["SF Pro Text"], `fontSize` [48], `fontWeight` [400], `color` ["#ffffff"], `lineHeight` [1.2]. With width and height left at 0, text is sized to its content.
- `image`: `src` (project-relative path, e.g. `"assets/images/wall.jpg"`), `fit` ["fill" | "contain" | "cover"].

### Animation

- `node.to(props, { at, duration, ease? })` animates from the previous value to `props`.
- `node.set(props, at)` changes instantly.
- Eases: `linear`, `inQuad`, `outQuad`, `inOutQuad`, `inCubic`, `outCubic`, `inOutCubic` (default), `outBack`, `inOutExpo`, or a function `(t) => number`.

### Names

Give every meaningful node a `name`. Names form stable paths (`intro/desktop/terminal`) that the timeline shows and that the user selects to ask for revisions. Names must not contain `/`. Keep names stable when editing so selections survive.

## Rules

- Imports: only `liosvideo` and relative paths inside this folder. No npm packages, no `../` outside the project, no dynamic `import()`.
- Scene code runs in a sandbox: no network, file system or storage. Don't use timers, `Date.now()` or `Math.random()`; rendering must be a pure function of the frame. Use `random()` from the scene context.
- Reference assets by project-relative path only.

## Git

The app commits your changes at the end of every turn and shows them in its history panel. Don't run git commands yourself.

## Revisions

When the user's message comes with a timeline selection (composition, scene, node path, time range), change only that scene's file and the selected nodes unless they ask for more. Don't change other scenes as a side effect.

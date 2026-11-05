# PS2 Style

Early-2000s console 3D: low-poly flat-shaded worlds, thick distance fog, a jittery camera and a low-resolution, colour-banded image.

## Look
- Build the world with `ps2World(width, height, build, update)` — a full-frame `three()` node with a fog-coloured sky, hemisphere light and a warm sun.
- Wrap it in a group with `look` (`pixelate: 4, posterize: 12`) — that is the low-res framebuffer.
- Meshes are low-poly (5–8 sided cylinders and cones, coarse grids) with `flatShading: true` and Lambert materials. No textures (the renderer has none) — colour per face or per vertex.
- HUD (`areaCard`) sits on top of the look, crisp: a dark translucent band with bold caps.

## Palette
Fog/sky `#a9b8c9`, grass `#5d7f3b` / `#46632c`, dirt `#8c6b46`, trunk `#5a3b22`, leaves `#2f5e36`, stone `#80838c` / `#5d6068`, HUD `#f1eedf` on `#141626`, accent `#e9b949`. Muted and slightly desaturated.

## Motion
- The camera walks: a slow dolly with a stepped head-bob, positions passed through `snap()` so it jitters like integer vertex maths.
- Call `fog(scene, camera, color, near, far)` at the end of `update` every frame — the renderer has no fog, so this tints meshes (and vertex colours) toward the fog colour by distance.
- HUD cards fade in and out (0.5 s), like an area title.

## Helpers (`styles/ps2-lowpoly.ts`)
- `ps2World(...)`, `fog(...)`, `snap(v, step)`
- `terrain(width, depth, cols, rows, heights, amp)` — vertex-coloured low-poly ground with a flat path
- `tree(x, z, scale)`, `block(w, h, d, color)`
- `areaCard(label, sub, { x, y, size })`

## Do / Don't
- Do draw every random number in the scene builder (`random()`), never inside `setup`/`update`.
- Do keep the poly count low on purpose — facets are the look.
- Don't use smooth shading, high segment counts or glossy materials.
- Don't put HUD text inside the pixelated group.

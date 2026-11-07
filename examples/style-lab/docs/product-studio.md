# Product Studio

A product on a seamless studio sweep with soft three-point lighting and real shadows, a slow orbit camera that settles, and thin callouts naming the parts: the look of the Mac mini review and the mic product demo.

## Look
- `productStage(width, height, build, update)` is a full-frame `three()` with ACES tone mapping, soft shadows, the light rig (`studioRig`: shadow-casting key, cool fill, rim, hemisphere bounce) and a curved sweep with no horizon line.
- Materials: `metal(color, roughness)` for machined parts, `matte(color)` for grills, rubber, plastic. Call `castShadows(model)` on the product.
- Title in `layout().slot("title")`, dark ink on the light sweep.

## Palette
Backdrop `#d9dde3`, sweep `#e7eaee`, ink `#111418`, muted `#5b6472`, one accent `#2563eb` (callout dots, a single trim part).

## Motion
- Move the camera, never the product: pass `orbit({ target, radius, height: [from, to], from, to, start, end, ease: smooth })` as `productStage`'s camera path, a quarter turn that settles about halfway through the scene. (`orbitCamera` is still there for moves written in `update`.)
- Callouts come in after the camera stops: the dot pops, the leader draws out, the label fades in (`callout({ target, label, detail, side, length, size, at })`). Aim them at 3D points, `target: { stage, point: [x, y, z] }`, so the dots stay on the parts even if the camera moves again.

## Helpers (`styles/product-studio.ts`)
- `productStage`, `studioRig(scene)`, `sweep(scene)`, `metal`, `matte`, `castShadows`, `orbitCamera`, `smooth`
- `productStage(width, height, build, update?, cameraPath?)`
- `callout({ target: { stage, point } | { x, y }, label, detail?, side, length, size, at })`

## Do / Don't
- Do swap the stand-in for your model: `const m = await gltf("assets/models/<model>.glb")` in an `async setup`, `castShadows(m.scene)`.
- Do keep labels inside the safe area (pick `side` so the label points into the frame).
- Don't spin the product on its own: a turntable reads as cheap next to a camera move.
- Don't use coloured lights; the product's own materials carry the colour.

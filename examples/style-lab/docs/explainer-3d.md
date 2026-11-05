# 3D Explainer (ZackD Films style)

Short-form 3D explainers: a soft, clay-like close-up of an everyday object, shallow depth of field, a slow push-in, and huge bold captions that pop in a few words at a time. Made for 9:16.

## Look
- Two `three()` layers share one camera move:
  - `background` — blurred with `look` (`blur: 14`): soft bokeh blobs and the table edge.
  - `subject` — sharp: the object the video is about.
- Build each with `layer3d(name, width, height, build, update)` (soft key, rim and warm bounce light).
- Materials: `clay(color, { opacity, roughness })` — matte, warm, slightly waxy. Liquids and glass are low-opacity clay.
- Captions (`captionWords`) in the lower fifth: heavy white caps with a black outline, the key word in yellow.

## Palette
Background `#2a3440`, table `#c98f5a`, water `#9fd8ef`, glass `#dff4ff`, subject accents `#e8553e` / `#f5efe6`, captions `#ffffff` / key `#ffd83d` with `#000000` outline.

## Motion
- `pushIn(camera, progress, from, to, target)` — a slow eased push toward the subject; call it in both layers' `update` so focus and background move together.
- Animate the subject physically (drop, slow down in liquid, tumble, fizz) in `update` from `time`.
- Captions change every 0.4–0.8 s; each chunk pops from 60% to 100% scale in 0.18 s (`outBack`). Wrap the key word in `*stars*`.

## Helpers (`styles/explainer-3d.ts`)
- `layer3d`, `softLights`, `clay`, `pushIn`, `captionWords(chunks, { x, y, size, end })`

## Do / Don't
- Do open with the question as captions ("WHAT HAPPENS WHEN…") and keep each chunk to one to three words.
- Do keep the subject large and centred; the background only hints at a place.
- Don't use glossy or metallic materials — the look is soft and tactile.
- Don't put more than one sentence on screen at once.

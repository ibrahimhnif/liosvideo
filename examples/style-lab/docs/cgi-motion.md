# CGI Motion

Product-film CGI: one glossy, softly lit hero object, a slow orbiting camera, small floating accents and a thin, confident headline over a dark studio.

## Look
- `backdrop(width, height)` — near-black with two big blurred colour pools (violet, teal).
- `studio(width, height, build, update)` — a transparent full-frame `three()` node with a warm key, a cool rim and a soft violet fill (`studioLights`).
- Materials: `gloss(color, { roughness, metalness })` — MeshStandard, low roughness. One hero colour, one metallic accent (gold ring), one light accent.
- Wrap the 3D in a group with `look` (`glow: 14, glowIntensity: 0.3`) for a soft bloom on highlights.
- Headline: light-weight sans (Avenir Next 300), a small spaced kicker above, a short accent rule below.

## Palette
Background `#0d0e13`, pools `#3b2a6b` / `#123a4a`, hero `#8f6cff`, accent `#7ee0ff`, gold `#f2c46d`, text `#f4f4f7`, muted `#9a9aa8`.

## Motion
- Move the camera, not the object: `orbit(camera, angle, radius, height, target)` with `smooth(progress)` — about 70° over the whole shot.
- The hero rotates slowly and floats ±0.08 units; accents orbit it.
- The headline rises in late (around 1.2 s) over 0.9 s, `outCubic`.

## Helpers (`styles/cgi-motion.ts`)
- `backdrop`, `studio`, `studioLights`, `gloss`, `orbit`, `smooth`

## Do / Don't
- Do keep the frame calm: one object, lots of dark space, slow moves.
- Do pull the camera back in 9:16 so the object and its orbit fit the width.
- Don't over-light — the software renderer clips to white quickly; keep the key near 1.
- Don't add fast cuts or bouncy easing.

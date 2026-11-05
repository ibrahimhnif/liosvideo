# Brick Build (LEGO-like)

Generic toy bricks with studs that drop in, bounce and stack into a model on a bright background. Inspired by toy-brick animation — never use real brand names, logos or minifigure designs.

## Look
- `brickStage(width, height, build, update)` — a full-frame `three()` node with soft daylight.
- `brick(w, d, color, { plate })` — a w×d brick measured in studs (`STUD` = 0.5 units, a brick is 1.2 studs tall), slightly glossy plastic, studs on top. A `plate` is a third of the height (use one large green plate as the ground).
- Plan the model as `Placement`s (stud x, z, layer, size, colour, start time) and convert with `place()`.
- A heavy rounded headline (Avenir Next 800) in navy on the sky-blue background.

## Palette
Background `#bfe3ff`, red `#d7263d`, yellow `#f6c90e`, blue `#1b6ec2`, green `#2e9e4f`, white `#f4f4f0`, text `#14213d`. Saturated primaries only.

## Motion
- `dropIn(obj, target, at, time)` in `update`: hidden before `at`, falls with gravity, a small bounce, seated — 0.45 s per brick.
- Stagger bricks ~0.05 s apart within a layer; slower (0.2 s) for big roof pieces.
- Slow camera orbit (about 30° over the shot). Pop the headline in with `outBack` once the build ends.

## Helpers (`styles/brick.ts`)
- `brick`, `brickStage`, `place`, `dropIn`, `DROP`, `STUD`, `Placement`

## Do / Don't
- Do build in running bond (offset each layer by one stud) — it reads as real bricks.
- Do keep the model small enough to frame at both ratios (pull the camera back in 9:16).
- Don't use brand marks or name the style after a brand in on-screen text.
- Don't let bricks pass through each other — time each layer after the one below.

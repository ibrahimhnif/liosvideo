import { scene, text } from "liosvideo";
import * as THREE from "three";
import { brick, brickStage, dropIn, place, theme, type Placement } from "../styles/brick";

export default scene("brick", { duration: 4, background: theme.colors.bg }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const portrait = height > width;

  // a little house: base plate, two walls of running bond with a door, a stepped roof
  const plan: Placement[] = [];
  let at = 0.2;
  const add = (x: number, z: number, layer: number, w: number, d: number, color: string, step = 0.045) => {
    plan.push({ x, z, layer, w, d, color, at });
    at += step;
  };
  for (let layer = 0; layer < 3; layer++) {
    const off = layer % 2;
    // back and front walls (8 studs wide)
    for (let x = off; x < 8 - off; x += 2) {
      add(x - 4, -3, layer, 2, 1, c.red);
      // the front wall faces the camera: leave a door in its two lower layers
      if (!(layer < 2 && x >= 3 && x < 5)) add(x - 4, 2, layer, 2, 1, layer === 1 && (x === 1 || x === 5) ? c.white : c.red);
    }
    // side walls
    for (let z = -2 + off; z < 2; z += 2) {
      add(-4, z, layer, 1, Math.min(2, 2 - z), c.red);
      add(3, z, layer, 1, Math.min(2, 2 - z), c.red);
    }
  }
  for (let r = 0; r < 3; r++) add(-4 + r, -3 + r, 3 + r, 8 - r * 2, 6 - r * 2, c.yellow, 0.18);
  add(-1, -1, 6, 2, 2, c.blue, 0.2);
  const end = at;

  root.add(
    brickStage(
      width,
      height,
      ({ scene }) => {
        const plate = brick(14, 12, c.green, { plate: true });
        plate.position.set(0, -0.2, 0);
        scene.add(plate);
        const bricks = plan.map((p) => {
          const b = brick(p.w, p.d, p.color);
          scene.add(b);
          return { b, p, target: place(p) };
        });
        return { bricks };
      },
      ({ camera, bricks }, progress, time) => {
        const a = 0.7 - progress * 0.5;
        const r = portrait ? 16 : 12;
        camera.position.set(Math.sin(a) * r, portrait ? 7 : 5.5, Math.cos(a) * r);
        camera.lookAt(new THREE.Vector3(0, portrait ? 2.2 : 1.6, 0));
        camera.updateMatrixWorld(true);
        for (const { b, p, target } of bricks) dropIn(b, target, p.at, time);
      },
    ),
  );

  const title = root.add(
    text({
      name: "title", text: "Build anything.", x: width / 2, y: height * (portrait ? 0.12 : 0.1), anchorX: 0.5,
      fontFamily: theme.fonts.heading, fontWeight: 800, fontSize: u * 8, color: c.text,
    }),
  );
  title.set({ scaleX: 0, scaleY: 0 }, 0);
  title.to({ scaleX: 1, scaleY: 1 }, { at: Math.min(end, 3.2), duration: 0.4, ease: theme.ease.pop });
});

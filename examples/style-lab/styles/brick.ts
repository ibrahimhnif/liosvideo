/**
 * Brick Build (LEGO-like) — glossy plastic toy bricks with studs that drop in, bounce
 * and stack into a model, on a bright, clean background.
 *
 * Bricks are measured in studs (`STUD` world units): `brick(w, d, color)` makes a w×d brick
 * with studs on top. Build the model as a list of `Placement`s and let `dropIn` animate
 * each one from above on its own start time. Keep colours saturated and few (red, yellow,
 * blue, green, white). Never use real brand marks: these are generic toy bricks.
 */
import * as THREE from "three";
import { three, type BaseProps, type Ease, type ThreeSetupContext } from "liosvideo";

export const theme = {
  colors: {
    bg: "#bfe3ff",
    floor: "#9fd18b",
    red: "#d7263d",
    yellow: "#f6c90e",
    blue: "#1b6ec2",
    green: "#2e9e4f",
    white: "#f4f4f0",
    text: "#14213d",
  },
  fonts: { heading: "Avenir Next" },
  ease: { pop: "outBack" as Ease },
};

/** Plastic needs no filter. */
export const look: Partial<BaseProps> = {};

/** World units per stud. A brick is 1.2 studs tall. */
export const STUD = 0.5;
const HEIGHT = STUD * 1.2;

/** A w×d brick (in studs), studs on top, origin at the bottom centre. */
export function brick(w: number, d: number, color: string, o: { plate?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const h = o.plate ? HEIGHT / 3 : HEIGHT;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * STUD - 0.01, h - 0.005, d * STUD - 0.01), mat);
  body.position.y = h / 2;
  g.add(body);
  const studGeo = new THREE.CylinderGeometry(STUD * 0.3, STUD * 0.3, STUD * 0.2, 16);
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      const stud = new THREE.Mesh(studGeo, mat);
      stud.position.set((x - (w - 1) / 2) * STUD, h + STUD * 0.1, (z - (d - 1) / 2) * STUD);
      g.add(stud);
    }
  }
  return g;
}

/** Where a brick goes: stud coordinates (x, z), layer, size and colour, plus when it drops. */
export type Placement = { x: number; z: number; layer: number; w: number; d: number; color: string; at: number };

/** Converts stud coordinates to a world position (the brick's bottom centre). */
export function place(p: Pick<Placement, "x" | "z" | "layer" | "w" | "d">): THREE.Vector3 {
  return new THREE.Vector3((p.x + p.w / 2) * STUD, p.layer * HEIGHT, (p.z + p.d / 2) * STUD);
}

/** Drop height (world units) and duration (s) for `dropIn`. */
export const DROP = { height: 3, duration: 0.45 };

/** Positions a brick for time `time`: hidden before `at`, falling, a small bounce, then seated. */
export function dropIn(obj: THREE.Object3D, target: THREE.Vector3, at: number, time: number): void {
  const k = (time - at) / DROP.duration;
  obj.visible = k >= 0;
  if (k < 0) return;
  const t = Math.min(1, k);
  // fall with gravity, then a damped bounce
  const fall = t < 0.7 ? 1 - (t / 0.7) ** 2 : -Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.06;
  obj.position.set(target.x, target.y + fall * DROP.height, target.z);
}

/** A full-frame `three()` node with soft daylight; `build` adds the bricks. */
export function brickStage(width: number, height: number, build: (ctx: ThreeSetupContext) => Record<string, any> | void, update?: (state: any, progress: number, time: number) => void) {
  return three({
    name: "bricks",
    width,
    height,
    fov: 32,
    setup(ctx) {
      ctx.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8);
      sun.position.set(4, 8, 6);
      ctx.scene.add(sun);
      return { ...ctx, ...(build(ctx) ?? {}) };
    },
    update,
  });
}

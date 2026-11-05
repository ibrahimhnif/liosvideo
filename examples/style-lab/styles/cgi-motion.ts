/**
 * CGI Motion — a glossy, softly lit 3D hero object on a slow orbiting camera,
 * floating accents, a dark studio backdrop and a thin, confident headline.
 *
 * Build the object inside `studio(...)` (a transparent `three()` node over a 2D backdrop).
 * Use MeshStandardMaterial with low roughness for the gloss; light it with a warm key, a
 * cool rim and a soft fill (`studioLights`). Wrap the 3D in a group with `look` for a
 * gentle bloom on the highlights. Move the camera, not the object, and move it slowly.
 */
import * as THREE from "three";
import { circle, group, three, type BaseProps, type Ease, type GroupNode, type ThreeSetupContext } from "liosvideo";

export const theme = {
  colors: {
    bg: "#0d0e13",
    glowA: "#3b2a6b",
    glowB: "#123a4a",
    hero: "#8f6cff",
    accent: "#7ee0ff",
    gold: "#f2c46d",
    text: "#f4f4f7",
    muted: "#9a9aa8",
  },
  fonts: { heading: "Avenir Next", label: "Avenir Next" },
  ease: { glide: "inOutCubic" as Ease, rise: "outCubic" as Ease },
};

/** A soft bloom on the 3D highlights. */
export const look: Partial<BaseProps> = { glow: 14, glowIntensity: 0.3 };

/** The dark studio backdrop: two big blurred colour pools. */
export function backdrop(width: number, height: number): GroupNode {
  const g = group({ name: "backdrop", width, height });
  const m = Math.max(width, height);
  g.add(circle({ name: "pool-a", radius: m * 0.38, x: width * 0.3, y: height * 0.35, anchorX: 0.5, anchorY: 0.5, fill: theme.colors.glowA, blur: m * 0.12, opacity: 0.7 }));
  g.add(circle({ name: "pool-b", radius: m * 0.32, x: width * 0.75, y: height * 0.7, anchorX: 0.5, anchorY: 0.5, fill: theme.colors.glowB, blur: m * 0.12, opacity: 0.7 }));
  return g;
}

/** Warm key, cool rim, soft fill. */
export function studioLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7ee0ff, 1.5);
  rim.position.set(-4, 1, -3);
  scene.add(rim);
  const fill = new THREE.PointLight(0xb69cff, 3, 20);
  fill.position.set(-3, -2, 4);
  scene.add(fill);
}

/** A glossy standard material. */
export function gloss(color: string, o: { roughness?: number; metalness?: number } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: o.roughness ?? 0.28, metalness: o.metalness ?? 0.2 });
}

/** Places a camera on a circle around the origin: `angle` in radians, `radius`, `height`. */
export function orbit(camera: THREE.Camera, angle: number, radius: number, height: number, target = new THREE.Vector3(0, 0, 0)): void {
  camera.position.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

/** Smooth 0→1 over the scene, for camera moves. */
export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A transparent full-frame `three()` node with studio lights. */
export function studio(width: number, height: number, build: (ctx: ThreeSetupContext) => Record<string, any> | void, update?: (state: any, progress: number, time: number) => void) {
  return three({
    name: "studio",
    width,
    height,
    fov: 35,
    setup(ctx) {
      studioLights(ctx.scene);
      return { ...ctx, ...(build(ctx) ?? {}) };
    },
    update,
  });
}

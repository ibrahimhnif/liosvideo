/**
 * Product Studio — a product on a seamless studio sweep: soft three-point lighting with real
 * shadows, a slow turntable or orbit camera, and thin callouts naming the parts. The look of the
 * Mac mini review and the mic product demo.
 *
 * Build the product inside `productStage(...)` (a full-frame `three()` node with the lights,
 * floor and backdrop already in place). Move the camera with `orbitCamera`, not the product, and
 * keep it slow (one quarter turn in 4–6 s). Add `callout`s once the camera settles; aim them at
 * the part with `target` in frame coordinates. Swap the stand-in for your model with
 * `gltf("assets/models/<model>.glb")` inside an `async setup`.
 */
import * as THREE from "three";
import { circle, group, rect, text, three, type BaseProps, type Ease, type GroupNode, type ThreeSetupContext } from "liosvideo";

export const theme = {
  colors: {
    bg: "#d9dde3",
    sweep: "#e7eaee",
    product: "#c9ced6",
    accent: "#2563eb",
    ink: "#111418",
    muted: "#5b6472",
    line: "#111418",
  },
  fonts: { heading: "Avenir Next", label: "Avenir Next" },
  ease: { glide: "inOutSine" as Ease, rise: "outCubic" as Ease },
};

/** Studio light needs no 2D filter. */
export const look: Partial<BaseProps> = {};

/** Key (soft, shadow-casting), fill and rim lights plus a hemisphere bounce. */
export function studioRig(scene: THREE.Scene, o: { shadows?: boolean } = {}): { key: THREE.DirectionalLight } {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c0ca, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3.5, 6, 4);
  if (o.shadows !== false) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
  }
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe8f0ff, 0.6);
  fill.position.set(-5, 2.5, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.4);
  rim.position.set(-2, 4, -5);
  scene.add(rim);
  return { key };
}

/**
 * A seamless sweep: the floor curves up into the backdrop (radius `curve`), so there is no
 * horizon line. It receives shadows.
 */
export function sweep(scene: THREE.Scene, color = theme.colors.sweep, o: { back?: number; curve?: number } = {}): THREE.Mesh {
  const back = o.back ?? 7; // where the curve starts, behind the product
  const r = o.curve ?? 4;
  // profile in (z, y): floor from the front to the curve, a quarter circle, then the wall
  const profile: [number, number][] = [[30, 0], [-back, 0]];
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    profile.push([-back - Math.sin(a) * r, r - Math.cos(a) * r]);
  }
  profile.push([-back - r, 30]);
  const positions: number[] = [];
  const index: number[] = [];
  profile.forEach(([z, y], i) => {
    positions.push(-40, y, z, 40, y, z);
    if (i > 0) {
      const k = i * 2;
      index.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/** Brushed aluminium / anodised materials. */
export function metal(color = theme.colors.product, roughness = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.85 });
}

export function matte(color: string, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

/** Marks every mesh under `object` as casting and receiving shadows. */
export function castShadows(object: THREE.Object3D): void {
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

/** Smooth 0→1, for camera moves. */
export function smooth(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/**
 * Puts the camera on a circle around `target`: `angle` in radians (0 = in front), at `radius`
 * and `height`. Call it from `update` with an angle that changes slowly.
 */
export function orbitCamera(camera: THREE.Camera, o: { angle: number; radius: number; height: number; target?: THREE.Vector3 }): void {
  const target = o.target ?? new THREE.Vector3(0, 0.6, 0);
  camera.position.set(target.x + Math.sin(o.angle) * o.radius, o.height, target.z + Math.cos(o.angle) * o.radius);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

/**
 * The stage: a full-frame `three()` node with tone mapping, soft shadows, the light rig and the
 * sweep. `build` adds the product and returns what `update` needs.
 */
export function productStage(
  width: number,
  height: number,
  build: (ctx: ThreeSetupContext) => Record<string, any> | void,
  update?: (state: any, progress: number, time: number) => void,
) {
  return three({
    name: "stage",
    width,
    height,
    fov: 30,
    shadows: true,
    toneMapping: "aces",
    exposure: 1.05,
    setup(ctx) {
      ctx.scene.background = new THREE.Color(theme.colors.bg);
      studioRig(ctx.scene);
      sweep(ctx.scene);
      return { ...ctx, ...(build(ctx) ?? {}) };
    },
    update,
  });
}

/**
 * A callout: a dot on the part (`target`, frame pixels), a thin leader line out to the label
 * (`label` at `at`), drawn on in ~0.5 s. `side` picks where the label goes.
 */
export function callout(o: { target: { x: number; y: number }; label: string; detail?: string; side: "left" | "right"; length: number; size: number; at: number; name?: string }): GroupNode {
  const c = theme.colors;
  const g = group({ name: o.name ?? "callout", x: o.target.x, y: o.target.y });
  const dir = o.side === "right" ? 1 : -1;
  const dot = g.add(circle({ name: "dot", radius: o.size * 0.28, anchorX: 0.5, anchorY: 0.5, fill: c.accent, stroke: "#ffffff", strokeWidth: o.size * 0.08 }));
  const line = g.add(rect({ name: "leader", width: o.length, height: Math.max(1.5, o.size * 0.06), anchorX: o.side === "right" ? 0 : 1, anchorY: 0.5, fill: c.line }));
  const labelX = dir * (o.length + o.size * 0.5);
  const w = Math.max(o.label.length, o.detail?.length ?? 0) * o.size * 0.62;
  const label = g.add(group({ name: "label", x: o.side === "right" ? labelX : labelX - w, y: -o.size * 0.75 }));
  label.add(text({ name: "labelText", text: o.label, fontFamily: theme.fonts.label, fontWeight: 700, fontSize: o.size, color: c.ink, width: w, align: o.side === "right" ? "left" : "right" }));
  if (o.detail) label.add(text({ name: "detailText", text: o.detail, y: o.size * 1.25, fontFamily: theme.fonts.label, fontSize: o.size * 0.72, color: c.muted, width: w, align: o.side === "right" ? "left" : "right" }));

  dot.set({ scaleX: 0, scaleY: 0 }, 0);
  dot.to({ scaleX: 1, scaleY: 1 }, { at: o.at, duration: 0.3, ease: "outBack" });
  line.set({ scaleX: 0 }, 0);
  line.to({ scaleX: 1 }, { at: o.at + 0.15, duration: 0.35, ease: theme.ease.rise });
  label.set({ opacity: 0 }, 0);
  label.to({ opacity: 1 }, { at: o.at + 0.4, duration: 0.3 });
  return g;
}

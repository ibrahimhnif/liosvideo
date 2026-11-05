/**
 * PS2 Style — early-2000s console 3D: low-poly flat-shaded meshes, distance fog,
 * jittery vertex-snapped camera and a low-resolution, colour-banded image.
 *
 * Build the world inside `ps2World(...)` (a `three()` node). Meshes are low-poly with
 * `flatShading`; `fog()` tints them toward the fog colour by distance every frame
 * (there is no GPU fog in the renderer). Wrap the world in a group with `look`
 * (pixelate + posterize) for the low-res framebuffer. HUD text goes on top, outside the look.
 */
import * as THREE from "three";
import { group, rect, text, three, type BaseProps, type Ease, type GroupNode, type ThreeSetupContext } from "liosvideo";

export const theme = {
  colors: {
    fog: "#a9b8c9",
    grass: "#5d7f3b",
    grassDark: "#46632c",
    dirt: "#8c6b46",
    trunk: "#5a3b22",
    leaves: "#2f5e36",
    stone: "#80838c",
    stoneDark: "#5d6068",
    hud: "#f1eedf",
    hudShadow: "#141626",
    accent: "#e9b949",
  },
  fonts: { hud: "Arial" },
  ease: { menu: "outCubic" as Ease },
};

/** A low-resolution, colour-banded framebuffer. */
export const look: Partial<BaseProps> = { pixelate: 4, posterize: 12 };

/** Snaps a value to a grid — the jittery, wobbly feel of integer vertex maths. */
export function snap(v: number, step = 0.04): number {
  return Math.round(v / step) * step;
}

function mix(a: THREE.Color, b: THREE.Color, k: number): THREE.Color {
  return a.clone().lerp(b, Math.min(1, Math.max(0, k)));
}

/**
 * Distance fog for the software renderer: call from `update`. Meshes keep their own
 * colour in `userData.base`; vertex-coloured meshes keep theirs in `userData.baseColors`.
 */
export function fog(scene: THREE.Scene, camera: THREE.Camera, color: string, near: number, far: number): void {
  const fogColor = new THREE.Color(color);
  const cam = camera.position;
  const tmp = new THREE.Vector3();
  scene.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshLambertMaterial;
    const base: Float32Array | undefined = mesh.userData.baseColors;
    if (base) {
      const pos = mesh.geometry.getAttribute("position");
      const col = mesh.geometry.getAttribute("color");
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const k = (tmp.distanceTo(cam) - near) / (far - near);
        const c = mix(new THREE.Color(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]), fogColor, k);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
      return;
    }
    if (!mesh.userData.base) mesh.userData.base = mat.color.clone();
    mesh.getWorldPosition(tmp);
    mat.color.copy(mix(mesh.userData.base, fogColor, (tmp.distanceTo(cam) - near) / (far - near)));
  });
}

/** Low-poly ground: a coarse grid with heights from `heights` (0–1 values, row-major), vertex coloured. */
export function terrain(width: number, depth: number, cols: number, rows: number, heights: number[], amp: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth, cols, rows).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(theme.colors.grass);
  const dark = new THREE.Color(theme.colors.grassDark);
  const dirt = new THREE.Color(theme.colors.dirt);
  for (let i = 0; i < pos.count; i++) {
    const gx = Math.round(((pos.getX(i) + width / 2) / width) * cols);
    const gz = Math.round(((pos.getZ(i) + depth / 2) / depth) * rows);
    const h = heights[(gz * (cols + 1) + gx) % heights.length];
    // keep a flat path down the middle
    const path = Math.abs(pos.getX(i)) < width * 0.03;
    pos.setY(i, path ? 0 : h * amp * Math.min(1, Math.abs(pos.getX(i)) / (width * 0.08)));
    const c = path ? dirt : h > 0.5 ? grass : dark;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors.slice(), 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.userData.baseColors = colors;
  return mesh;
}

/** A low-poly tree: a 5-sided trunk and two stacked cones. */
export function tree(x: number, z: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 5), new THREE.MeshLambertMaterial({ color: theme.colors.trunk, flatShading: true }));
  trunk.position.y = 0.5;
  g.add(trunk);
  for (const [y, r, h] of [[1.3, 0.9, 1.4], [2.1, 0.65, 1.2]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), new THREE.MeshLambertMaterial({ color: theme.colors.leaves, flatShading: true }));
    cone.position.y = y;
    g.add(cone);
  }
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  return g;
}

/** A flat-shaded box in one colour. */
export function block(w: number, h: number, d: number, color: string): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, flatShading: true }));
}

/** The 3D world as a full-frame `three()` node with fog-coloured sky and PS2 lighting. */
export function ps2World(width: number, height: number, build: (ctx: ThreeSetupContext) => Record<string, any> | void, update?: (state: any, progress: number, time: number) => void) {
  return three({
    name: "world",
    width,
    height,
    fov: 60,
    setup(ctx) {
      ctx.scene.background = new THREE.Color(theme.colors.fog);
      ctx.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4030, 1.3));
      const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
      sun.position.set(3, 6, 4);
      ctx.scene.add(sun);
      return { ...ctx, ...(build(ctx) ?? {}) };
    },
    update,
  });
}

/** A PS2-era area title card: a dark band with bold caps and a thin accent rule. */
export function areaCard(label: string, sub: string, o: { x: number; y: number; size: number; name?: string }): GroupNode {
  const g = group({ name: o.name ?? "area-card", x: o.x, y: o.y });
  const w = Math.max(label.length * o.size * 0.75, sub.length * o.size * 0.4) + o.size * 1.5;
  g.add(rect({ name: "band", width: w, height: o.size * 2.4, anchorX: 0.5, fill: theme.colors.hudShadow, opacity: 0.75 }));
  g.add(rect({ name: "rule", y: o.size * 1.45, width: w * 0.8, height: Math.max(2, o.size * 0.06), anchorX: 0.5, fill: theme.colors.accent }));
  g.add(text({ name: "title", text: label, y: o.size * 0.25, fontFamily: theme.fonts.hud, fontWeight: 900, fontSize: o.size, anchorX: 0.5, color: theme.colors.hud }));
  g.add(text({ name: "sub", text: sub, y: o.size * 1.65, fontFamily: theme.fonts.hud, fontWeight: 700, fontSize: o.size * 0.42, anchorX: 0.5, color: theme.colors.accent }));
  return g;
}

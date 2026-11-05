/**
 * 3D Explainer (ZackD Films style) — soft, clay-like 3D close-ups with a shallow depth of
 * field, a slow push-in, and big bold captions that pop in word by word.
 *
 * Split the shot into two `three()` layers that share one camera move: `background`
 * (blurred — the out-of-focus world) and `subject` (sharp). Materials are matte and warm
 * (`clay()`), lighting is soft. Captions (`captionWords`) sit in the lower third: heavy
 * white caps with a black outline, one or two words at a time, the key word in yellow.
 * Built for 9:16; it still frames in 16:9.
 */
import * as THREE from "three";
import { group, text, three, type BaseProps, type Ease, type GroupNode, type ThreeSetupContext } from "liosvideo";

export const theme = {
  colors: {
    bg: "#2a3440",
    water: "#9fd8ef",
    glass: "#dff4ff",
    pillA: "#e8553e",
    pillB: "#f5efe6",
    bubble: "#ffffff",
    table: "#c98f5a",
    caption: "#ffffff",
    key: "#ffd83d",
    outline: "#000000",
  },
  fonts: { caption: "Avenir Next" },
  ease: { pop: "outBack" as Ease, push: "inOutCubic" as Ease },
};

/** The out-of-focus layer: blur the `background` three() node with this. */
export const look: Partial<BaseProps> = { blur: 14 };

/** A matte, slightly waxy material — the soft "clay" look. */
export function clay(color: string, o: { opacity?: number; roughness?: number } = {}): THREE.MeshStandardMaterial {
  const transparent = (o.opacity ?? 1) < 1;
  return new THREE.MeshStandardMaterial({ color, roughness: o.roughness ?? 0.65, metalness: 0, transparent, opacity: o.opacity ?? 1 });
}

/** Soft key + fill + warm bounce. */
export function softLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6a4a30, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe6ff, 0.9);
  rim.position.set(-3, 2, -4);
  scene.add(rim);
}

/** One camera move both layers share: a slow push-in from `from` to `to` distance. */
export function pushIn(camera: THREE.Camera, progress: number, from: number, to: number, target: THREE.Vector3): void {
  const k = progress * progress * (3 - 2 * progress);
  const d = from + (to - from) * k;
  camera.position.set(target.x + d * 0.18, target.y + d * 0.12, target.z + d);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

/** A full-frame three() layer with soft lights. */
export function layer3d(name: string, width: number, height: number, build: (ctx: ThreeSetupContext) => Record<string, any> | void, update?: (state: any, progress: number, time: number) => void) {
  return three({
    name,
    width,
    height,
    fov: 30,
    setup(ctx) {
      softLights(ctx.scene);
      return { ...ctx, ...(build(ctx) ?? {}) };
    },
    update,
  });
}

/**
 * Captions that pop in a few words at a time, ZackD-style: each chunk replaces the last.
 * `chunks` are [words, start time]; a word wrapped in *stars* is the key word (yellow).
 */
export function captionWords(chunks: [string, number][], o: { x: number; y: number; size: number; end: number; name?: string }): GroupNode {
  const g = group({ name: o.name ?? "captions", x: o.x, y: o.y });
  chunks.forEach(([words, at], i) => {
    const next = chunks[i + 1]?.[1] ?? o.end;
    const key = /^\*.*\*$/.test(words);
    const label = words.replace(/\*/g, "").toUpperCase();
    const chunk = g.add(group({ name: `chunk${i}` }));
    const common = { text: label, anchorX: 0.5, anchorY: 0.5, fontFamily: theme.fonts.caption, fontWeight: 900, fontSize: o.size };
    const r = o.size * 0.07;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      chunk.add(text({ name: `ink${k}`, ...common, x: Math.cos(a) * r, y: Math.sin(a) * r, color: theme.colors.outline }));
    }
    chunk.add(text({ name: "face", ...common, color: key ? theme.colors.key : theme.colors.caption }));
    chunk.set({ opacity: 0, scaleX: 0.6, scaleY: 0.6 }, 0);
    chunk.set({ opacity: 1 }, at);
    chunk.to({ scaleX: 1, scaleY: 1 }, { at, duration: 0.18, ease: theme.ease.pop });
    if (i < chunks.length - 1) chunk.set({ opacity: 0 }, next);
  });
  return g;
}

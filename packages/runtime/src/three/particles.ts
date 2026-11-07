// Deterministic particles for three() scenes (dust, sparks, embers). Each particle's place at time t
// comes straight from its seeded start values, so any frame renders the same field in any order, in
// the desktop preview and the CLI. Particles are camera-facing discs merged into one mesh: they work
// in WebGL, WebGPU and the software rasteriser alike (unlike sized Points), shrink with distance, and
// glow softly because the colour falls to black at each rim (added with additive blending).
import * as THREE from "three";
import { seededRandom } from "../math/random";

type Vec3 = [number, number, number];

export interface ParticleOptions {
  /** How many particles are alive at once (default 300). */
  count?: number;
  /** Seed for the field (default 1); the same seed gives the same particles. */
  seed?: number | string;
  /** Centre of the emitter box (default origin). */
  center?: Vec3;
  /** Size of the emitter box particles are born in (default [4, 2, 4]); [0, 0, 0] for a point. */
  area?: Vec3;
  /** Drift every particle shares, world units / s (default [0, 0.15, 0]). */
  velocity?: Vec3;
  /** Random speed added in a random direction (default 0.1). */
  spread?: number;
  /** Constant acceleration, e.g. [0, -9.8, 0] for sparks (default none). */
  gravity?: Vec3;
  /** Gentle wobble amplitude in world units (default 0.05). */
  turbulence?: number;
  /** Disc diameter in world units, or [min, max] (default [0.02, 0.06]). */
  size?: number | [number, number];
  /** Seconds each particle lives before it is reborn (default 4). */
  lifetime?: number;
  /** Fraction of the life spent fading in, and again fading out (default 0.25). */
  fade?: number;
  /** One colour or a palette to pick from (default warm gold). */
  color?: string | string[];
  /** Brightness multiplier (default 1). */
  intensity?: number;
  /** Respond to the scene's lights (lit dust) instead of glowing on its own (default false). */
  lit?: boolean;
  /** Disc smoothness: rim segments per particle (default 8). */
  segments?: number;
}

export interface Particles {
  /** Add this to the scene. */
  object: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Places every particle for scene time `time`, facing `camera`. Call it from update(). */
  update(time: number, camera: THREE.Camera): void;
  /** A scene time at which particle `index` is born (its age is 0). */
  birth(index: number): number;
  readonly verticesPerParticle: number;
}

export function createParticles(o: ParticleOptions = {}): Particles {
  const count = Math.max(0, Math.floor(o.count ?? 300));
  const segments = Math.max(3, Math.floor(o.segments ?? 8));
  const per = segments + 1;
  const life = Math.max(1e-3, o.lifetime ?? 4);
  const fade = Math.min(0.5, Math.max(0, o.fade ?? 0.25));
  const center = o.center ?? [0, 0, 0];
  const area = o.area ?? [4, 2, 4];
  const drift = o.velocity ?? [0, 0.15, 0];
  const spread = o.spread ?? 0.1;
  const gravity = o.gravity ?? [0, 0, 0];
  const turbulence = o.turbulence ?? 0.05;
  const [minSize, maxSize] = Array.isArray(o.size) ? o.size : [o.size ?? 0.02, o.size ?? 0.06];
  const intensity = o.intensity ?? 1;
  const palette = (Array.isArray(o.color) ? o.color : [o.color ?? "#ffd27a"]).map((c) => new THREE.Color(c));

  // start values, drawn once from the seed in a fixed order
  const random = seededRandom(`particles:${o.seed ?? 1}`);
  const start = Array.from({ length: count }, () => {
    const origin: Vec3 = [0, 1, 2].map((k) => center[k] + (random() - 0.5) * area[k]) as Vec3;
    // a random direction (uniform on the sphere) for the spread
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const speed = spread * random();
    const velocity: Vec3 = [drift[0] + r * Math.cos(a) * speed, drift[1] + r * Math.sin(a) * speed, drift[2] + z * speed];
    return {
      origin,
      velocity,
      size: minSize + (maxSize - minSize) * random(),
      phase: random() * life,
      color: palette[Math.floor(random() * palette.length) % palette.length],
      wobble: [random(), random(), random()].map((v) => v * Math.PI * 2) as Vec3,
      rate: 0.6 + random() * 0.8,
    };
  });

  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(count * per * 3), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(count * per * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(count * per * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  color.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setAttribute("color", color);
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const c = i * per;
    for (let k = 0; k < segments; k++) index.push(c, c + 1 + k, c + 1 + ((k + 1) % segments));
  }
  geometry.setIndex(index);

  const settings = {
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  } as const;
  const material = o.lit ? new THREE.MeshLambertMaterial(settings) : new THREE.MeshBasicMaterial(settings);
  const object = new THREE.Mesh(geometry, material);
  object.name = "particles";
  object.frustumCulled = false; // the geometry moves every frame

  const cos = Array.from({ length: segments }, (_, k) => Math.cos((k / segments) * Math.PI * 2));
  const sin = Array.from({ length: segments }, (_, k) => Math.sin((k / segments) * Math.PI * 2));
  const smooth = (x: number) => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
  };

  return {
    object,
    verticesPerParticle: per,
    birth(i) {
      return life - start[i].phase;
    },
    update(time, camera) {
      camera.updateMatrixWorld();
      const m = camera.matrixWorld.elements;
      const right = [m[0], m[1], m[2]];
      const up = [m[4], m[5], m[6]];
      const toward = [m[8], m[9], m[10]]; // towards the camera, world space
      const pos = position.array as Float32Array;
      const nrm = normal.array as Float32Array;
      const col = color.array as Float32Array;
      object.updateMatrixWorld();
      const toLocal = object.matrixWorld.clone().invert().elements;
      const back = [0, 1, 2].map((r) => toLocal[r] * toward[0] + toLocal[4 + r] * toward[1] + toLocal[8 + r] * toward[2]);
      const backLength = Math.hypot(back[0], back[1], back[2]) || 1;
      for (let r = 0; r < 3; r++) back[r] /= backLength;
      const local = (x: number, y: number, z: number, out: Float32Array, at: number) => {
        out[at] = toLocal[0] * x + toLocal[4] * y + toLocal[8] * z + toLocal[12];
        out[at + 1] = toLocal[1] * x + toLocal[5] * y + toLocal[9] * z + toLocal[13];
        out[at + 2] = toLocal[2] * x + toLocal[6] * y + toLocal[10] * z + toLocal[14];
      };
      for (let i = 0; i < count; i++) {
        const s = start[i];
        const age = (((time + s.phase) % life) + life) % life;
        const k = age / life;
        const glow = (fade > 0 ? smooth(k / fade) * smooth((1 - k) / fade) : 1) * intensity;
        const p = [0, 1, 2].map(
          (d) => s.origin[d] + s.velocity[d] * age + 0.5 * gravity[d] * age * age + turbulence * Math.sin(age * s.rate * (1.3 + d * 0.4) + s.wobble[d]),
        );
        const half = s.size / 2;
        const base = i * per;
        local(p[0], p[1], p[2], pos, base * 3);
        col[base * 3] = s.color.r * glow;
        col[base * 3 + 1] = s.color.g * glow;
        col[base * 3 + 2] = s.color.b * glow;
        for (let r = 0; r < segments; r++) {
          const v = (base + 1 + r) * 3;
          const ox = (right[0] * cos[r] + up[0] * sin[r]) * half;
          const oy = (right[1] * cos[r] + up[1] * sin[r]) * half;
          const oz = (right[2] * cos[r] + up[2] * sin[r]) * half;
          local(p[0] + ox, p[1] + oy, p[2] + oz, pos, v);
          col[v] = col[v + 1] = col[v + 2] = 0;
        }
        for (let v = base; v < base + per; v++) {
          nrm[v * 3] = back[0];
          nrm[v * 3 + 1] = back[1];
          nrm[v * 3 + 2] = back[2];
        }
      }
      position.needsUpdate = true;
      normal.needsUpdate = true;
      color.needsUpdate = true;
      geometry.computeBoundingSphere();
    },
  };
}

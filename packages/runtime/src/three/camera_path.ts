import type * as THREE from "three";
import { type Ease, ease } from "../anim/easing";

export type Vec3 = [number, number, number];

/** One camera pose on a path, at scene time `at` (seconds). */
export interface CameraKey {
  at: number;
  position: Vec3;
  /** Point the camera looks at (default: the previous key's target, or the origin). */
  target?: Vec3;
  /** Vertical field of view in degrees for a perspective camera (default: keep the camera's). */
  fov?: number;
}

export type CameraSpline = "catmull" | "linear";

export interface CameraPathOptions {
  /** Easing inside each segment between two keys (default "inOutCubic"). */
  ease?: Ease;
  /** "catmull" (default) curves smoothly through every key; "linear" goes straight from key to key. */
  spline?: CameraSpline;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov?: number;
}

/** A deterministic camera move: the same scene time gives the same pose in the preview and the render. */
export interface CameraPath {
  sample(time: number): CameraPose;
  /** Moves `camera` to the pose at `time`, aims it at the target and applies the fov. */
  apply(camera: THREE.Camera, time: number): void;
}

const SPLINES: readonly CameraSpline[] = ["catmull", "linear"];

function fromSampler(sample: (time: number) => CameraPose): CameraPath {
  return {
    sample,
    apply(camera, time) {
      const pose = sample(time);
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      const persp = camera as THREE.PerspectiveCamera;
      if (pose.fov !== undefined && persp.isPerspectiveCamera) {
        persp.fov = pose.fov;
        persp.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
    },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Uniform Catmull-Rom between p1 and p2; hits p1 at t = 0 and p2 at t = 1.
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}
const catmull3 = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, t: number): Vec3 => [
  catmull(a[0], b[0], c[0], d[0], t),
  catmull(a[1], b[1], c[1], d[1], t),
  catmull(a[2], b[2], c[2], d[2], t),
];

/**
 * A keyframed camera move through `keys` (sorted by `at`). Before the first key and after the last
 * the camera holds still. Pass it to `three({ cameraPath })`, or call `path.apply(camera, time)` in `update`.
 */
export function cameraPath(keys: CameraKey[], options: CameraPathOptions = {}): CameraPath {
  if (!keys.length) throw new Error("cameraPath() needs at least one key");
  const spline = options.spline ?? "catmull";
  if (!SPLINES.includes(spline)) {
    throw new Error(`Unknown spline ${JSON.stringify(spline)}. Use one of: ${SPLINES.join(", ")}`);
  }
  const easing = options.ease ?? "inOutCubic";
  ease(easing, 0.5); // throws on an unknown name, where the path is written

  const sorted = keys.map((k, i) => ({ k, i })).sort((a, b) => a.k.at - b.k.at || a.i - b.i).map((e) => e.k);
  const firstFov = sorted.find((k) => k.fov !== undefined)?.fov;
  let target: Vec3 = [0, 0, 0];
  let fov = firstFov;
  const filled = sorted.map((k) => {
    target = k.target ? [...k.target] : target;
    fov = k.fov ?? fov;
    return { at: k.at, position: [...k.position] as Vec3, target, fov };
  });
  const last = filled.length - 1;

  return fromSampler((time) => {
    if (time <= filled[0].at || last === 0) return pose(filled[0]);
    if (time >= filled[last].at) return pose(filled[last]);
    let i = 0;
    while (time >= filled[i + 1].at) i++;
    const a = filled[i];
    const b = filled[i + 1];
    const u = ease(easing, (time - a.at) / (b.at - a.at));
    const fovAt = a.fov === undefined || b.fov === undefined ? a.fov : lerp(a.fov, b.fov, u);
    if (spline === "linear") return { position: lerp3(a.position, b.position, u), target: lerp3(a.target, b.target, u), fov: fovAt };
    const p = filled[Math.max(0, i - 1)];
    const n = filled[Math.min(last, i + 2)];
    return {
      position: catmull3(p.position, a.position, b.position, n.position, u),
      target: catmull3(p.target, a.target, b.target, n.target, u),
      fov: fovAt,
    };
  });
}

function pose(k: { position: Vec3; target: Vec3; fov?: number }): CameraPose {
  return { position: [...k.position], target: [...k.target], fov: k.fov };
}

type Fov = number | [number, number];
const fovAt = (fov: Fov | undefined, u: number) => (Array.isArray(fov) ? lerp(fov[0], fov[1], u) : fov);

interface Span {
  /** Scene time the move starts (seconds). */
  start: number;
  /** Scene time the move ends (seconds). */
  end: number;
  /** Easing of the whole move (default "inOutCubic"). */
  ease?: Ease;
  /** A fixed fov, or [from, to] to zoom the lens during the move. */
  fov?: Fov;
}

function spanProgress({ start, end, ease: e = "inOutCubic" }: Span): (time: number) => number {
  ease(e, 0.5);
  return (time) => ease(e, end > start ? (time - start) / (end - start) : time >= end ? 1 : 0);
}

/**
 * Circles `target` at `radius`, from angle `from` to `to` (radians, 0 = +z, π/2 = +x), at camera
 * height `height` (world y), or rising / sinking with `height: [from, to]`.
 */
export function orbit(o: Span & { target: Vec3; radius: number; height?: number | [number, number]; from: number; to: number }): CameraPath {
  const progress = spanProgress(o);
  const height = o.height ?? o.target[1];
  return fromSampler((time) => {
    const u = progress(time);
    const a = lerp(o.from, o.to, u);
    const y = Array.isArray(height) ? lerp(height[0], height[1], u) : height;
    return {
      position: [o.target[0] + o.radius * Math.sin(a), y, o.target[2] + o.radius * Math.cos(a)],
      target: [...o.target],
      fov: fovAt(o.fov, u),
    };
  });
}

/** Slides the camera in a straight line from `from` to `to`, aimed at `target` the whole way. */
export function dolly(o: Span & { from: Vec3; to: Vec3; target: Vec3 }): CameraPath {
  const progress = spanProgress(o);
  return fromSampler((time) => {
    const u = progress(time);
    return { position: lerp3(o.from, o.to, u), target: [...o.target], fov: fovAt(o.fov, u) };
  });
}

/** Moves the camera `amount` (0–1) of the way from `from` towards `target`; pair with `fov: [a, b]` for a push-in zoom. */
export function pushIn(o: Span & { from: Vec3; target: Vec3; amount?: number }): CameraPath {
  return dolly({ ...o, to: lerp3(o.from, o.target, o.amount ?? 0.3) });
}

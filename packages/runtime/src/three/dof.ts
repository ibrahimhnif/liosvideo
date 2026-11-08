// Depth of field for three() scenes by camera accumulation: the frame is rendered `samples` times
// from points spread over a lens of radius `aperture`, each frustum sheared so the focal plane
// lands on the same pixels, and the renders are averaged. What sits at the focus distance stays
// sharp; everything nearer or further blurs, with correct occlusion. It needs nothing but a camera
// move per pass, so WebGL (desktop), WebGPU (CLI) and the software rasteriser give the same blur.
import type * as THREE from "three";
import type { Vec3 } from "./camera_path";

export type Focus = number | Vec3;

export interface DepthOfField {
  /** What stays sharp: a distance from the camera (world units), a world point, or either per scene time. */
  focus: Focus | ((time: number) => Focus);
  /** Lens radius in world units: larger blurs more outside the focus (try 0.05–0.2). */
  aperture: number;
  /** Renders averaged per frame (default 16): more is smoother, and slower. */
  samples?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** `n` points spread evenly over the unit disc (a Vogel spiral); the same for the same `n`. */
export function dofOffsets(n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * GOLDEN_ANGLE;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/**
 * The camera moves for one frame: call each pass before a render; it returns the function that
 * puts the camera back. Without depth of field (or for an orthographic camera) there is one pass
 * that changes nothing. `height` is the render height in pixels.
 */
export function depthOfFieldPasses(
  dof: DepthOfField | undefined,
  camera: THREE.Camera,
  time: number,
  height: number,
): (() => () => void)[] {
  const plain = [() => () => {}];
  if (!dof) return plain;
  if (!(dof.aperture >= 0)) throw new Error(`depthOfField: aperture must be 0 or more, got ${dof.aperture}`);
  const samples = dof.samples ?? 16;
  if (!(Number.isInteger(samples) && samples >= 1)) throw new Error(`depthOfField: samples must be a whole number ≥ 1, got ${samples}`);
  const cam = camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera || dof.aperture === 0 || samples === 1) return plain;

  cam.updateMatrixWorld();
  const m = cam.matrixWorld.elements;
  const right: Vec3 = [m[0], m[1], m[2]];
  const up: Vec3 = [m[4], m[5], m[6]];
  const forward: Vec3 = [-m[8], -m[9], -m[10]];
  const eye: Vec3 = [m[12], m[13], m[14]];
  const focus = typeof dof.focus === "function" ? dof.focus(time) : dof.focus;
  const distance = Array.isArray(focus)
    ? (focus[0] - eye[0]) * forward[0] + (focus[1] - eye[1]) * forward[1] + (focus[2] - eye[2]) * forward[2]
    : focus;
  if (!(distance > 0)) throw new Error(`depthOfField: the focus must be in front of the camera (distance ${distance})`);
  // pixels per world unit on the focal plane
  const pxPerUnit = height / 2 / (distance * Math.tan(((cam.fov * Math.PI) / 180) / 2) / cam.zoom);

  return dofOffsets(samples).map(([ox, oy]) => () => {
    const position = cam.position.clone();
    const view = cam.view ? { ...cam.view } : null;
    const sx = ox * dof.aperture;
    const sy = oy * dof.aperture;
    // move on the lens in world space (the parent of a camera is normally the scene)
    const shift = [right[0] * sx + up[0] * sy, right[1] * sx + up[1] * sy, right[2] * sx + up[2] * sy];
    if (cam.parent) {
      const inv = cam.parent.matrixWorld.clone().invert().elements;
      cam.position.set(
        position.x + inv[0] * shift[0] + inv[4] * shift[1] + inv[8] * shift[2],
        position.y + inv[1] * shift[0] + inv[5] * shift[1] + inv[9] * shift[2],
        position.z + inv[2] * shift[0] + inv[6] * shift[1] + inv[10] * shift[2],
      );
    } else {
      cam.position.set(position.x + shift[0], position.y + shift[1], position.z + shift[2]);
    }
    cam.updateMatrixWorld();
    // shear the frustum back so the focal plane does not move
    const fullHeight = height;
    const fullWidth = height * cam.aspect;
    const baseX = view?.enabled ? view.offsetX : 0;
    const baseY = view?.enabled ? view.offsetY : 0;
    cam.setViewOffset(
      view?.enabled ? view.fullWidth : fullWidth,
      view?.enabled ? view.fullHeight : fullHeight,
      baseX - sx * pxPerUnit,
      baseY + sy * pxPerUnit,
      view?.enabled ? view.width : fullWidth,
      view?.enabled ? view.height : fullHeight,
    );
    return () => {
      cam.position.copy(position);
      if (view?.enabled) cam.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
      else cam.clearViewOffset();
      cam.updateMatrixWorld();
    };
  });
}

/** Sums equally sized pixel buffers and gives their rounded average. */
export function pixelAverage(length: number): { add(pixels: ArrayLike<number>): void; result(): Uint8Array } {
  const sum = new Float64Array(length);
  let count = 0;
  return {
    add(pixels) {
      for (let i = 0; i < length; i++) sum[i] += pixels[i];
      count++;
    },
    result() {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = Math.round(sum[i] / Math.max(count, 1));
      return out;
    },
  };
}

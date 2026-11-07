import type * as THREE from "three";
import { apply } from "../math/affine";
import type { CameraPath, Vec3 } from "../three/camera_path";
import { BASE_DEFAULTS, type BaseProps, Node, type NodeInit } from "./node";

const CAMERA = Symbol("liosvideo.threeCamera");

export interface ThreeSetupContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  width: number;
  height: number;
}

export type ThreeToneMapping = "none" | "linear" | "reinhard" | "cineon" | "aces" | "agx" | "neutral";

/** Renderer settings of a three() node; the same in the desktop preview and the CLI render. */
export interface ThreeRenderOptions {
  /** Shadow maps for lights and meshes with castShadow / receiveShadow (default false). */
  shadows?: boolean;
  /** Tone mapping of the lit image (default "none"); "aces" or "agx" for filmic product shots. */
  toneMapping?: ThreeToneMapping;
  /** Exposure for tone mapping (default 1). */
  exposure?: number;
}

export type ThreeSetupResult = Record<string, any> | void | Promise<Record<string, any> | void>;

export interface ThreeProps extends BaseProps, ThreeRenderOptions {
  camera: "perspective" | "orthographic";
  fov: number;
  /** May be async: `await gltf(...)`, `await hdr(...)`, `await texture(...)`. Runs once per node. */
  setup: (ctx: ThreeSetupContext) => ThreeSetupResult;
  update?: (state: any, progress: number, time: number) => void;
  /** Moves the camera at scene time before `update` runs: `cameraPath([...])`, `orbit()`, `dolly()`, `pushIn()`. */
  cameraPath?: CameraPath;
}

export class ThreeNode extends Node<ThreeProps> {
  readonly setupFn: (ctx: ThreeSetupContext) => ThreeSetupResult;
  readonly updateFn?: (state: any, progress: number, time: number) => void;

  constructor(init: NodeInit<ThreeProps> & { setup: (ctx: ThreeSetupContext) => ThreeSetupResult }) {
    super(
      "three",
      {
        ...BASE_DEFAULTS,
        width: 400,
        height: 300,
        camera: "perspective",
        fov: 50,
        setup: init.setup,
        update: init.update,
      },
      init,
    );
    const path = init.cameraPath;
    if (!path) {
      this.setupFn = init.setup;
      this.updateFn = init.update;
      return;
    }
    // Wrap setup/update so every runner (desktop, CLI GPU and software) drives the camera the same way.
    const stash = (ctx: ThreeSetupContext, result: Record<string, any> | void) => {
      const state: Record<string | symbol, any> = result ?? {};
      state[CAMERA] = ctx.camera;
      if (!("camera" in state)) state.camera = ctx.camera;
      path.apply(ctx.camera, 0);
      return state;
    };
    const setup = init.setup;
    this.setupFn = (ctx) => {
      const result = setup(ctx);
      return result instanceof Promise ? result.then((r) => stash(ctx, r)) : stash(ctx, result);
    };
    const update = init.update;
    this.updateFn = (state, progress, time) => {
      const camera = state?.[CAMERA];
      if (camera) path.apply(camera, time);
      update?.(state, progress, time);
    };
  }

  get width(): number {
    return this.propsAt(0).width;
  }

  get height(): number {
    return this.propsAt(0).height;
  }

  get cameraType(): "perspective" | "orthographic" {
    return this.propsAt(0).camera;
  }

  get fov(): number {
    return this.propsAt(0).fov;
  }

  /**
   * Where a world-space point is drawn at scene time `time`, in the coordinates of this node's parent
   * (the same space as its x / y). Exact for the camera that `cameraPath` drives. `depth` is the
   * distance in front of the camera; `visible` is false behind it or outside the node's frame.
   */
  project(point: Vec3 | ((time: number) => Vec3), time: number): { x: number; y: number; depth: number; visible: boolean } {
    const props = this.propsAt(time);
    if (!props.cameraPath) {
      throw new Error(
        `project() on "${this.name}" needs the camera at build time: give three() a cameraPath ` +
          "(a still camera is cameraPath([{ at: 0, position: [x, y, z], target: [0, 0, 0] }]))",
      );
    }
    const [px, py, pz] = typeof point === "function" ? point(time) : point;
    const pose = props.cameraPath.sample(time);
    const [ex, ey, ez] = pose.position;
    // the camera basis of THREE.Matrix4.lookAt(eye, target, up = +y); the camera looks down -z
    let zx = ex - pose.target[0], zy = ey - pose.target[1], zz = ez - pose.target[2];
    let len = Math.hypot(zx, zy, zz);
    if (len === 0) [zx, zy, zz, len] = [0, 0, 1, 1];
    zx /= len; zy /= len; zz /= len;
    let xx = zz, xy = 0, xz = -zx; // up × z with up = (0, 1, 0)
    len = Math.hypot(xx, xy, xz);
    if (len === 0) {
      // looking straight up or down: three nudges z.z (up is +y, so up.z is 0)
      zz += 0.0001;
      len = Math.hypot(zx, zy, zz); zx /= len; zy /= len; zz /= len;
      xx = zz; xy = 0; xz = -zx;
      len = Math.hypot(xx, xy, xz);
    }
    xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const dx = px - ex, dy = py - ey, dz = pz - ez;
    const vx = dx * xx + dy * xy + dz * xz;
    const vy = dx * yx + dy * yy + dz * yz;
    const depth = -(dx * zx + dy * zy + dz * zz);
    const { width, height } = this;
    let nx: number;
    let ny: number;
    if (props.camera === "orthographic") {
      nx = vx / (width / 2);
      ny = vy / (height / 2);
    } else {
      const f = Math.tan((((pose.fov ?? props.fov) * Math.PI) / 180) / 2);
      nx = vx / (depth * f * (width / height));
      ny = vy / (depth * f);
    }
    const [x, y] = apply(this.localMatrix(time), ((nx + 1) / 2) * width, ((1 - ny) / 2) * height);
    return { x, y, depth, visible: depth > 0.1 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1 };
  }

  get renderOptions(): Required<ThreeRenderOptions> {
    const p = this.propsAt(0);
    return { shadows: !!p.shadows, toneMapping: p.toneMapping ?? "none", exposure: p.exposure ?? 1 };
  }
}

export function three(
  init: NodeInit<ThreeProps> & { setup: (ctx: ThreeSetupContext) => ThreeSetupResult },
): ThreeNode {
  return new ThreeNode(init);
}

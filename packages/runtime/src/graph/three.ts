import type * as THREE from "three";
import { BASE_DEFAULTS, type BaseProps, Node, type NodeInit } from "./node";

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
    this.setupFn = init.setup;
    this.updateFn = init.update;
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

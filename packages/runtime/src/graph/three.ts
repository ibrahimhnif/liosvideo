import type * as THREE from "three";
import { BASE_DEFAULTS, type BaseProps, Node, type NodeInit } from "./node";

export interface ThreeSetupContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  width: number;
  height: number;
}

export interface ThreeProps extends BaseProps {
  camera: "perspective" | "orthographic";
  fov: number;
  setup: (ctx: ThreeSetupContext) => Record<string, any> | void;
  update?: (state: any, progress: number, time: number) => void;
}

export class ThreeNode extends Node<ThreeProps> {
  readonly setupFn: (ctx: ThreeSetupContext) => Record<string, any> | void;
  readonly updateFn?: (state: any, progress: number, time: number) => void;

  constructor(init: NodeInit<ThreeProps> & { setup: (ctx: ThreeSetupContext) => Record<string, any> | void }) {
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
}

export function three(
  init: NodeInit<ThreeProps> & { setup: (ctx: ThreeSetupContext) => Record<string, any> | void },
): ThreeNode {
  return new ThreeNode(init);
}

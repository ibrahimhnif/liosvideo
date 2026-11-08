import * as THREE from "three";
import { ThreeNode, type ThreeRenderOptions } from "../graph/three";
import { pixelAverage } from "../three/dof";

const TONE_MAPPING: Record<string, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

/** Applies a three() node's renderer settings (shared by the desktop runner and the CLI GPU host). */
export function applyRenderOptions(
  renderer: {
    shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
    toneMapping: THREE.ToneMapping;
    toneMappingExposure: number;
    localClippingEnabled: boolean;
  },
  opts: Required<ThreeRenderOptions>,
): void {
  // material.clippingPlanes cut meshes (cutaways); the CLI GPU host maps them to ClippingGroups.
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = TONE_MAPPING[opts.toneMapping] ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = opts.exposure;
}

interface NodeSession {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  userState: any;
  canvas?: OffscreenCanvas | HTMLCanvasElement;
  renderer?: THREE.WebGLRenderer;
  lastWidth: number;
  lastHeight: number;
  /** 2D canvas holding the averaged depth-of-field frame */
  lens?: OffscreenCanvas | HTMLCanvasElement;
}

export class ThreeRunner {
  private sessions = new Map<string, NodeSession>();

  /** Whether this environment can create a WebGL context for offscreen three rendering. */
  static isSupported(): boolean {
    try {
      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(1, 1);
        return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
      }
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
      }
    } catch {
      // ignore and report unsupported
    }
    return false;
  }

  private pending = new Map<string, Promise<void>>();

  /** Scene, camera and renderer for a node, and whatever its setup returned (maybe a promise). */
  private build(node: ThreeNode): { session: NodeSession; setup: unknown } {
    const width = Math.max(1, Math.round(node.width));
    const height = Math.max(1, Math.round(node.height));
    const scene = new THREE.Scene();
    const aspect = width / height;

    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    if (node.cameraType === "orthographic") {
      camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 2000);
      camera.position.z = 500;
    } else {
      camera = new THREE.PerspectiveCamera(node.fov, aspect, 0.1, 1000);
      camera.position.z = 5;
    }

    let canvas: OffscreenCanvas | HTMLCanvasElement | undefined;
    let renderer: THREE.WebGLRenderer | undefined;

    try {
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(width, height);
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(width, height, false);
      } else if (typeof document !== "undefined") {
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(width, height, false);
      }
    } catch {
      // Fallback for headless environments without WebGL context
    }

    if (renderer) applyRenderOptions(renderer, node.renderOptions);
    const setup = node.setupFn({ scene, camera, width, height });
    return { session: { scene, camera, userState: {}, canvas, renderer, lastWidth: width, lastHeight: height }, setup };
  }

  /** Runs the node's setup, awaiting it when it is async (gltf / hdr / texture loads). */
  async prepare(node: ThreeNode): Promise<void> {
    const key = node.path();
    if (this.sessions.has(key)) return;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = (async () => {
        const { session, setup } = this.build(node);
        session.userState = (await setup) ?? {};
        this.sessions.set(key, session);
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    await pending;
  }

  step(node: ThreeNode, time: number, duration: number): { scene: THREE.Scene; camera: THREE.Camera; canvas?: OffscreenCanvas | HTMLCanvasElement } {
    const key = node.path();
    let session = this.sessions.get(key);

    const width = Math.max(1, Math.round(node.width));
    const height = Math.max(1, Math.round(node.height));

    if (!session) {
      const built = this.build(node);
      if (built.setup instanceof Promise) throw new Error(`three(): "${node.name}" has an async setup; await prepare(node) before step()`);
      session = built.session;
      session.userState = built.setup ?? {};
      this.sessions.set(key, session);
    }

    if (session.lastWidth !== width || session.lastHeight !== height) {
      session.lastWidth = width;
      session.lastHeight = height;
      if (session.camera instanceof THREE.PerspectiveCamera) {
        session.camera.aspect = width / height;
        session.camera.updateProjectionMatrix();
      }
      session.renderer?.setSize(width, height, false);
    }

    const progress = duration > 0 ? time / duration : 0;
    node.updateFn?.(session.userState, progress, time);

    let canvas = session.canvas;
    if (session.renderer && session.canvas) {
      const passes = node.lensPasses(session.camera, time, height);
      if (passes.length === 1) {
        session.renderer.render(session.scene, session.camera);
      } else {
        canvas = this.renderLens(session, passes, width, height);
      }
    }

    return {
      scene: session.scene,
      camera: session.camera,
      canvas,
    };
  }

  /** Renders every depth-of-field pass, averages them and returns a canvas holding the result. */
  private renderLens(session: NodeSession, passes: (() => () => void)[], width: number, height: number) {
    const renderer = session.renderer!;
    const gl = renderer.getContext();
    const frame = new Uint8Array(width * height * 4);
    const average = pixelAverage(frame.length);
    for (const pass of passes) {
      const restore = pass();
      try {
        renderer.render(session.scene, session.camera);
      } finally {
        restore();
      }
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      average.add(frame);
    }
    // WebGL rows run bottom-up and hold premultiplied colour; ImageData is top-down and straight
    const sum = average.result();
    const image = new ImageData(width, height);
    const out = image.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = ((height - 1 - y) * width + x) * 4;
        const d = (y * width + x) * 4;
        const a = sum[s + 3];
        const k = a > 0 && a < 255 ? 255 / a : 1;
        out[d] = Math.min(255, Math.round(sum[s] * k));
        out[d + 1] = Math.min(255, Math.round(sum[s + 1] * k));
        out[d + 2] = Math.min(255, Math.round(sum[s + 2] * k));
        out[d + 3] = a;
      }
    }
    if (!session.lens || session.lens.width !== width || session.lens.height !== height) {
      if (typeof OffscreenCanvas !== "undefined") session.lens = new OffscreenCanvas(width, height);
      else {
        session.lens = document.createElement("canvas");
        session.lens.width = width;
        session.lens.height = height;
      }
    }
    (session.lens.getContext("2d") as OffscreenCanvasRenderingContext2D).putImageData(image, 0, 0);
    return session.lens;
  }

  async renderBitmap(node: ThreeNode, time: number, duration: number): Promise<ImageBitmap | null> {
    await this.prepare(node);
    const { canvas } = this.step(node, time, duration);
    if (!canvas || typeof createImageBitmap === "undefined") return null;
    try {
      return await createImageBitmap(canvas);
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.renderer?.dispose();
      session.renderer?.forceContextLoss();
      // Clean up geometries and materials
      session.scene.traverse((obj) => {
        if ((obj as any).geometry?.dispose) (obj as any).geometry.dispose();
        if ((obj as any).material) {
          const mat = (obj as any).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
          else mat.dispose?.();
        }
      });
    }
    this.sessions.clear();
  }
}

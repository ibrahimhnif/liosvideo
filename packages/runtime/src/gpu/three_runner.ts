import * as THREE from "three";
import { ThreeNode } from "../graph/three";

interface NodeSession {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  userState: any;
  canvas?: OffscreenCanvas | HTMLCanvasElement;
  renderer?: THREE.WebGLRenderer;
  lastWidth: number;
  lastHeight: number;
}

export class ThreeRunner {
  private sessions = new Map<string, NodeSession>();

  step(node: ThreeNode, time: number, duration: number): { scene: THREE.Scene; camera: THREE.Camera; canvas?: OffscreenCanvas | HTMLCanvasElement } {
    const key = node.path();
    let session = this.sessions.get(key);

    const width = Math.max(1, Math.round(node.width));
    const height = Math.max(1, Math.round(node.height));

    if (!session) {
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

      const userState = node.setupFn({ scene, camera, width, height }) ?? {};
      session = { scene, camera, userState, canvas, renderer, lastWidth: width, lastHeight: height };
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

    if (session.renderer && session.canvas) {
      session.renderer.render(session.scene, session.camera);
    }

    return {
      scene: session.scene,
      camera: session.camera,
      canvas: session.canvas,
    };
  }

  async renderBitmap(node: ThreeNode, time: number, duration: number): Promise<ImageBitmap | null> {
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

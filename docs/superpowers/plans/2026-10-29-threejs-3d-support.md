# Three.js 3D Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable declarative, deterministic 3D scenes in Liosvideo compositions using Three.js, with full support for custom 3D meshes, materials, lighting, cameras, and keyframed animations.

**Architecture:** A new `ThreeNode` graph primitive (`three(props)`) encapsulates Three.js scene setup and a deterministic per-frame update function. During frame evaluation, each `ThreeNode` renders offscreen into a canvas texture at the exact timestamp `t`, which is then composited into Liosvideo's native WebGPU render pass alongside 2D nodes, text, and effects.

**Tech Stack:** Three.js (`three`, `@types/three`), WebGPU, OffscreenCanvas, esbuild-wasm, TypeScript, Svelte 5.

**Spec:** Integrated into Liosvideo declarative scene graph specification.

## Global Constraints

- **Pure & Deterministic:** No non-deterministic animation loops (`requestAnimationFrame`). Scene evaluation at timestamp `t` must always yield the exact same frame.
- **Strict Import Scope:** Compositions import `three` or `liosvideo` via esbuild runtime aliases mapped to bundled globals in the sandbox worker.
- **Resource Cleanup:** WebGL/WebGPU contexts and Three.js geometries/materials created by `setup()` must be disposed when scenes change to prevent GPU memory leaks.
- **Zero Regressions:** All existing 96 vitest unit tests, 63 browser tests, and 139 Rust tests must continue passing.

---

### Task 1: Add Three.js Dependency & Graph Node Definition

**Files:**
- Modify: `packages/runtime/package.json`
- Modify: `package.json`
- Create: `packages/runtime/src/graph/three.ts`
- Modify: `packages/runtime/src/graph/kinds.ts`
- Modify: `packages/runtime/src/renderlist.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/graph/three.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ThreeSetupContext {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    width: number;
    height: number;
  }

  export interface ThreeProps extends BaseProps {
    width?: number;
    height?: number;
    camera?: "perspective" | "orthographic";
    fov?: number;
    setup: (ctx: ThreeSetupContext) => Record<string, any> | void;
    update?: (state: any, progress: number, time: number) => void;
  }

  export class ThreeNode extends Node<ThreeProps> { ... }
  export function three(props: ThreeProps): ThreeNode;
  ```

- [ ] **Step 1: Write failing test for ThreeNode creation and properties**

Create `packages/runtime/src/graph/three.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { three, ThreeNode } from "./three";

describe("ThreeNode", () => {
  it("creates a ThreeNode with default dimensions and camera settings", () => {
    const node = three({
      name: "cube",
      width: 400,
      height: 300,
      setup: () => {},
    });

    expect(node).toBeInstanceOf(ThreeNode);
    expect(node.name).toBe("cube");
    expect(node.width).toBe(400);
    expect(node.height).toBe(300);
    expect(node.cameraType).toBe("perspective");
    expect(node.fov).toBe(50);
  });

  it("supports keyframed properties via node.to()", () => {
    const node = three({
      width: 500,
      height: 500,
      setup: () => {},
    });
    node.to({ opacity: 0 }, { at: 1, duration: 1 });
    expect(node.tracks.opacity).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test packages/runtime/src/graph/three.test.ts`
Expected: FAIL with "Cannot find module './three'".

- [ ] **Step 3: Install three and @types/three in packages/runtime**

In `packages/runtime/package.json`:
Add `"three": "^0.174.0"` to dependencies and `"@types/three": "^0.174.0"` to devDependencies.
Run: `pnpm install`

- [ ] **Step 4: Implement ThreeNode in packages/runtime/src/graph/three.ts**

Create `packages/runtime/src/graph/three.ts`:
```ts
import type * as THREE from "three";
import { Node, type BaseProps } from "./node";

export interface ThreeSetupContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  width: number;
  height: number;
}

export interface ThreeProps extends BaseProps {
  width?: number;
  height?: number;
  camera?: "perspective" | "orthographic";
  fov?: number;
  setup: (ctx: ThreeSetupContext) => Record<string, any> | void;
  update?: (state: any, progress: number, time: number) => void;
}

export class ThreeNode extends Node<ThreeProps> {
  readonly width: number;
  readonly height: number;
  readonly cameraType: "perspective" | "orthographic";
  readonly fov: number;
  readonly setupFn: (ctx: ThreeSetupContext) => Record<string, any> | void;
  readonly updateFn?: (state: any, progress: number, time: number) => void;

  constructor(props: ThreeProps) {
    super(props);
    this.width = props.width ?? 400;
    this.height = props.height ?? 300;
    this.cameraType = props.camera ?? "perspective";
    this.fov = props.fov ?? 50;
    this.setupFn = props.setup;
    this.updateFn = props.update;
  }
}

export function three(props: ThreeProps): ThreeNode {
  return new ThreeNode(props);
}
```

Update `packages/runtime/src/graph/kinds.ts`, `packages/runtime/src/renderlist.ts` (adding `ThreeItem`), and `packages/runtime/src/index.ts` to export `three`, `ThreeNode`, and types.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter liosvideo test packages/runtime/src/graph/three.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/package.json package.json pnpm-lock.yaml packages/runtime/src/graph/ packages/runtime/src/renderlist.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add ThreeNode graph primitive and types"
```

---

### Task 2: Deterministic Three.js Offscreen Evaluation & Renderer Stepper

**Files:**
- Create: `packages/runtime/src/gpu/three_runner.ts`
- Modify: `packages/runtime/src/evaluate.ts`
- Test: `packages/runtime/src/gpu/three_runner.test.ts`

**Interfaces:**
- Consumes: `ThreeNode` from `packages/runtime/src/graph/three.ts`
- Produces:
  ```ts
  export class ThreeRunner {
    renderFrame(node: ThreeNode, time: number, duration: number): ImageBitmap | null;
    dispose(): void;
  }
  ```

- [ ] **Step 1: Write test for deterministic ThreeRunner execution**

Create `packages/runtime/src/gpu/three_runner.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { three } from "../graph/three";
import { ThreeRunner } from "./three_runner";

describe("ThreeRunner", () => {
  it("initializes scene and invokes update at timestamp t", () => {
    let rotation = 0;
    const node = three({
      width: 200,
      height: 200,
      setup({ scene }) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        scene.add(mesh);
        return { mesh };
      },
      update({ mesh }, progress, t) {
        mesh.rotation.y = t * 2;
        rotation = mesh.rotation.y;
      },
    });

    const runner = new ThreeRunner();
    runner.step(node, 1.5, 3.0);
    expect(rotation).toBe(3.0);
    runner.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test packages/runtime/src/gpu/three_runner.test.ts`
Expected: FAIL with "Cannot find module './three_runner'".

- [ ] **Step 3: Implement ThreeRunner**

Create `packages/runtime/src/gpu/three_runner.ts`:
Manage an `OffscreenCanvas` and `THREE.WebGLRenderer` (with fallback to software / null in pure Node environments), instantiate `scene` and `camera`, execute `setup()`, and on each `step(node, time, duration)` call `update(state, progress, time)` and render to offscreen bitmap.

- [ ] **Step 4: Update evaluate.ts to evaluate ThreeNode into RenderList**

In `packages/runtime/src/evaluate.ts`:
When evaluating nodes in the graph, if `child instanceof ThreeNode`, produce a `ThreeItem` in `RenderItem` with the computed affine matrix, dimensions, opacity, and generated bitmap.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter liosvideo test packages/runtime/src/gpu/three_runner.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/gpu/three_runner.ts packages/runtime/src/gpu/three_runner.test.ts packages/runtime/src/evaluate.ts
git commit -m "feat(runtime): add deterministic ThreeRunner offscreen execution"
```

---

### Task 3: WebGPU Compositor Texture Integration for ThreeItem

**Files:**
- Modify: `packages/runtime/src/gpu/renderer.ts`
- Test: `packages/runtime/test/gpu_three.browser.test.ts`

**Interfaces:**
- Consumes: `ThreeItem` from `renderlist.ts`
- Produces: Composited 3D texture inside WebGPU quad pipeline.

- [ ] **Step 1: Write browser test for WebGPU rendering with Three.js item**

Create `packages/runtime/test/gpu_three.browser.test.ts`:
Render a `ThreeNode` with a colored cube into a WebGPU canvas, call `renderer.readPixels()`, and assert non-empty color values in the center of the rendered frame.

- [ ] **Step 2: Run test to verify failure / unsupported item**

Run: `pnpm --filter liosvideo test:gpu`

- [ ] **Step 3: Update packages/runtime/src/gpu/renderer.ts**

Add handling for `item.kind === "three"`:
Upload the `ThreeItem.bitmap` into a GPU texture (reusing the existing cached quad texture pipeline) and draw it with full support for transforms, opacity, and clipping.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test:gpu`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/gpu/renderer.ts packages/runtime/test/gpu_three.browser.test.ts
git commit -m "feat(runtime): composite ThreeItem into WebGPU renderer"
```

---

### Task 4: Desktop Bundler & Sandbox Environment Wiring

**Files:**
- Modify: `apps/desktop/src/lib/bundle/bundler.ts`
- Modify: `apps/desktop/src/lib/preview/sandbox.ts`
- Modify: `apps/desktop/src/lib/export/export_engine.ts`
- Test: `apps/desktop/src/lib/bundle/bundler.test.ts`

**Interfaces:**
- Bundler allows `import * as THREE from "three"` mapping to `globalThis.THREE`.
- Sandboxed worker injects `THREE` into `globalThis`.

- [ ] **Step 1: Write failing test in bundler.test.ts**

In `apps/desktop/src/lib/bundle/bundler.test.ts`:
Add test: `bundles import * as THREE from 'three' and maps to global runtime`.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter desktop test src/lib/bundle/bundler.test.ts`
Expected: FAIL with "Only 'liosvideo' and relative imports are allowed".

- [ ] **Step 3: Update bundler.ts, sandbox.ts, and export_engine.ts**

1. In `bundler.ts`: Allow `args.path === "three" || args.path.startsWith("three/")`, returning namespace `"three-runtime"`.
   Serve `module.exports = globalThis.THREE`.
2. In `sandbox.ts` and `export_engine.ts`:
   Import `* as THREE from "three"` and assign `(globalThis as any).THREE = THREE`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter desktop test src/lib/bundle/bundler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/bundle/bundler.ts apps/desktop/src/lib/preview/sandbox.ts apps/desktop/src/lib/export/export_engine.ts apps/desktop/src/lib/bundle/bundler.test.ts
git commit -m "feat(desktop): expose THREE in esbuild bundler and sandbox globals"
```

---

### Task 5: End-to-End Verification, Documentation & Agent Guidelines

**Files:**
- Create: `examples/3d-cube/` or sample scene in `apps/desktop/`
- Modify: `AGENTS.md`
- Test: All suites (`pnpm -r test`, `pnpm test:browser`, `cargo test`)

- [ ] **Step 1: Update AGENTS.md**

Document the new `three(props)` node primitive in the Node Primitives table in `AGENTS.md` with usage examples and rules for deterministic Three.js authoring.

- [ ] **Step 2: Run full regression test suite**

Run:
```bash
pnpm check
pnpm test
pnpm test:browser
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
Expected: All tests pass with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document three() node primitive in AGENTS.md"
```

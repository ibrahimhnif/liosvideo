# Spike: three() on the GPU in the CLI (issue #11)

**Decision: adopt.** The CLI now renders `three()` nodes with three.js `WebGPURenderer` on
deno_webgpu (wgpu), and keeps the software rasteriser as the fallback.

## What was built

- `deno_core` 0.334 → 0.338, plus `deno_webgpu` 0.158 (the last release on wgpu-core 24, the
  same wgpu the compositor uses), `deno_webidl` 0.192 and `deno_console` 0.192. All 210 CLI
  tests passed on 0.338 before any WebGPU code went in.
- `deno_web` is not pulled in (it brings permissions, timers, fetch …). deno_webgpu only needs
  `Event`, `EventTarget`, `DOMException` from it; `apps/cli/src/runtime/webgpu/*.js` provides
  those.
- WebGPU is initialised lazily (`__liosEnableWebGPU`) the first time a three node renders.
- `apps/cli/src/runtime/three_gpu.js`: one `WebGPURenderer` per three node, all on one device,
  rendering into a texture behind a stand-in canvas; the texture is copied to a buffer, mapped,
  converted to straight-alpha RGBA and handed to the compositor through the existing
  `op_three_frame`. `render_three_nodes` became async; `render` and `snapshot` now run their JS
  runtime on a current-thread tokio runtime (deno_webgpu spawns with `deno_unsync`, which
  requires one; the MCP render tools already did this).
- `three()` gained `shadows`, `toneMapping` and `exposure` props: `setup` gets no renderer, so
  these were impossible before in either renderer. The desktop `ThreeRunner` applies the same
  settings to its WebGLRenderer.
- `LIOSVIDEO_THREE=software` forces the old path.

## Workarounds needed (all in `three_gpu.js`)

| Problem | Workaround |
| :--- | :--- |
| deno_webgpu 0.158 reads `queue.writeBuffer(buf, off, typedArray, dataOffset, size)` offsets as bytes; the spec counts elements. three's uniform uploads failed `COPY_BUFFER_ALIGNMENT`. | Wrap `GPUQueue.prototype.writeBuffer` to pass a byte view. |
| naga 24 rejects `textureLoad(t, coords, u32(0))` ("level-of-detail index … not an integer scalar"); only signed levels pass. three emits `u32( 0 )` for DataTextures and the shadow material. Reproduced with `naga-cli 24.0.0` alone. | Rewrite the level to `0i` in `createShaderModule`. |
| naga 24 cannot convert an abstract float literal to an integer; three emits `u32( 0.0 )` for equirect sizes (8-bit environment maps), which broke PMREM. | Rewrite `u32( N.0 )` / `i32( N.0 )` to `Nu` / `Ni`. |
| `GPUDevice.lost` is undefined. | Give the device a never-settling promise. |
| The device does not report `core-features-and-limits`, so three drops to compatibility mode (no MSAA). | Report it (wgpu provides core features). |
| `getCompilationInfo` is missing (three calls it after a pipeline error). | Stub it. |
| three starts a `requestAnimationFrame` loop in `init()`. | Stop the renderer's animation loop; `requestAnimationFrame` is a no-op in the CLI. |
| `performance.now()` drives TSL `time`. | Pin it to the video clock while a frame renders. |
| WebGPURenderer tone-maps a colour `scene.background`; WebGL does not. | Render without it and composite the colour behind the image. |

## Measurements (M-series Mac, release build)

Reference scene: textured box + metal sphere with emissive + floor, PCF shadows, ACES.

| | 960×540, 60 frames | 1920×1080, 60 frames |
| :--- | :--- | :--- |
| GPU (three.js WebGPURenderer) | 1.53 s (with textures + shadows) | 2.11 s |
| Software rasteriser | 1.86 s (no texture, no shadow) | 6.69 s |
| Flat 2D scene, same size (encode + compositor baseline) | 0.20 s | — |

So about 22 ms vs 28 ms of 3D work per frame at 540p and ≈ 3.2× faster at 1080p, while drawing
what the software path cannot. The per-pixel JS readback (BGRA swap, un-premultiply) is now the
largest GPU cost and could move to a compute pass or Rust.

Pixel difference against WebGLRenderer (headless Chromium, same scene, same settings):
PSNR 48 dB over the objects and floor before the background fix, 46.6 dB full frame after it.

## Risks and follow-ups

- Two renderers (WebGL in the desktop, WebGPU in the CLI) can still diverge on details
  (shadow filtering, MSAA edges). A WebGPU path in the desktop would remove that, when WKWebView
  ships WebGPU.
- Each workaround is tied to deno_webgpu 0.158 / naga 24. Moving to a newer deno_webgpu means a
  newer deno_core and wgpu together; re-check the table above then.
- Scenes tuned on the old CLI output may change: the software rasteriser called
  `camera.updateProjectionMatrix()` every frame, WebGL and WebGPU do not (they match each other).
- Image textures, GLTF and HDR environments load through `gltf()` / `texture()` / `hdr()` (#13): one loader for both apps, with file reads and image decoding done by the host (Rust in the CLI).

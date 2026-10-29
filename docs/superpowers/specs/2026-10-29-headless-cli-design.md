# Headless CLI Engine Design Specification (`apps/cli`)

**Date**: 2026-10-29  
**Status**: Approved / In Design  
**Target Path**: `apps/cli`  

---

## 1. Executive Summary

Liosvideo is a declarative TypeScript video creation engine rendered via WebGPU. While the desktop application (`apps/desktop`) provides a rich GUI with live hot-reloading and timeline editing via Tauri, automated batch video generation, server-side render farms, CI pipelines, and autonomous AI agents require a lightweight, standalone, headless CLI capable of rendering compositions directly to `.mp4` and `.png` without any display server, Chromium browser, or external system dependencies (such as system FFmpeg).

This specification details the architecture of **`apps/cli`**, a standalone Rust binary crate powered by `deno_core` (V8), `wgpu` (WebGPU), and in-binary media codecs (`openh264`, `symphonia`, and `mp4`).

---

## 2. Requirements & Goals

### 2.1 Functional Requirements
1. **Headless Execution**: Render declarative TypeScript compositions (`long.ts`, `short.ts`, custom entries) to video without a display server (X11/Wayland/Quartz) or WebKit/WebView window.
2. **100% Standalone Single Binary**: The generated binary executable (`liosvideo`) must be self-contained:
   - No external Node.js, Deno runtime, or Chromium installation required.
   - No system FFmpeg installation required for video/audio encoding or decoding.
3. **Full Feature Parity**:
   - 2D Primitives: Group, Rect, Circle, SVG Path, Text, WGSL Shader, Images.
   - Built-in transitions: Fade, Slide, Zoom, Wipe.
   - Full Audio: Narration voice-over clips (`assets/audio/vo`), background music tracks (`assets/audio/music`), audio mixdown, timing offsets, and volume keyframes.
   - 3D Scenes: Three.js mesh rendering via embedded WebGPU canvas and browser environment shims.
   - Video clips: Decode external video assets frame-by-frame as GPU textures.
4. **CLI Commands**:
   - `liosvideo render <entry.ts> [options]`: Render full composition or frame slice to MP4.
   - `liosvideo snapshot <entry.ts> [options]`: Render a single deterministic frame to PNG.
   - `liosvideo info <entry.ts> [options]`: Inspect composition metadata (dimensions, fps, duration, scene breakdown, audio tracks) as human-readable text or JSON.
5. **Deterministic Rendering**: Render output must be frame-accurate and deterministic regardless of host CPU speed or system load.
6. **Error Reporting**: TypeScript runtime exceptions must be mapped back to their original project file and line number using embedded source maps.

### 2.2 Non-Functional Requirements
- **Startup Latency**: < 100ms cold startup time.
- **Memory Footprint**: < 150MB RSS during 1080p rendering.
- **Binary Footprint**: Target standalone binary size between ~35MB – 50MB.
- **Cross-Platform**: Support macOS (Universal Apple Silicon & Intel), Linux (x86_64), and Windows (x86_64).

---

## 3. Architecture & Subsystems

```
                                  +------------------------------------+
                                  |         CLI Entry (clap)           |
                                  |   render | snapshot | info         |
                                  +-----------------+------------------+
                                                    |
                                                    v
+-------------------------------------------------------------------------------------------------------+
|                                     apps/cli Execution Subsystems                                      |
|                                                                                                       |
|  +------------------------+      +---------------------------+      +------------------------------+  |
|  |     runtime Subsystem  |      |       gpu Subsystem       |      |       media Subsystem        |  |
|  |                        |      |                           |      |                              |  |
|  |  * deno_core (V8)      |      |  * Headless wgpu Device   |      |  * symphonia (Audio decode)  |  |
|  |  * SWC / deno_ast TS   | ---> |  * Offscreen RenderTarget | ---> |  * Software PCM Mixer        |  |
|  |  * Browser Shims:      |      |  * StagingBuffer Readback |      |  * OpenH264 (Video encode)   |  |
|  |    - window / document |      |  * 2D & WGSL Pipelines    |      |  * AAC Encoder               |  |
|  |    - Mock Canvas (GPU) |      |  * Three.js Texture Hub   |      |  * mp4 Muxer (File writer)   |  |
|  |    - Clock / RAF       |      |                           |      |                              |  |
|  +------------------------+      +---------------------------+      +------------------------------+  |
|                                                                                                       |
+-------------------------------------------------------------------------------------------------------+
                                                    |
                                                    v
                                    +----------------------------------+
                                    | Output Artifacts (out/*.mp4/.png)|
                                    +----------------------------------+
```

---

## 4. Detailed Component Design

### 4.1 Crate & Workspace Layout (`apps/cli`)
`apps/cli` is configured as a Rust member in the root Cargo workspace:

```
apps/cli/
├── Cargo.toml
├── src/
│   ├── main.rs                   # Entry point, clap subcommands parsing
│   ├── cli/
│   │   ├── mod.rs                # CLI routing: render, snapshot, info
│   │   └── progress.rs           # Multi-progress bar via indicatif
│   ├── runtime/
│   │   ├── mod.rs                # JsRuntime lifecycle and ops registration
│   │   ├── loader.rs             # Module loader resolving project-relative TS imports
│   │   ├── bundler.rs            # On-the-fly TS transpilation via deno_ast / SWC
│   │   └── shims/
│   │       ├── mod.rs            # Inject globals (globalThis.window, document, console)
│   │       ├── canvas.rs         # HTMLCanvasElement & OffscreenCanvas shim
│   │       └── console.rs        # Format console log/warn/error to stdout/stderr
│   ├── gpu/
│   │   ├── context.rs            # Headless wgpu Device, Queue, and Adapter
│   │   ├── target.rs             # Offscreen Rgba8Unorm render target & staging readback buffer
│   │   └── renderer.rs           # 2D layer compositor matching packages/runtime/src/gpu
│   ├── media/
│   │   ├── audio.rs              # Symphonia audio decoding & software stereo PCM mixer
│   │   ├── video_decoder.rs      # MP4 b-roll clip frame reader & texture uploader
│   │   └── encoder.rs            # Standalone MP4 video & audio encoder (OpenH264 + AAC + mp4 muxer)
│   └── pipeline/
│       ├── render_job.rs         # Orchestrator: seek -> evaluate -> GPU render -> encode
│       └── snapshot.rs           # Single frame PNG capture
```

---

### 4.2 JavaScript Runtime & Browser Shims (`runtime/`)
1. **Engine**: Uses `deno_core::JsRuntime`.
2. **TypeScript Support**:
   - Project entry file (`long.ts`) and imported scene modules (`./scenes/intro.ts`) are transpiled on the fly using `deno_ast` (SWC).
   - Source maps are generated in memory to accurately map runtime errors back to TypeScript sources.
3. **Embedded Runtime**:
   - The compiled JavaScript bundle of `packages/runtime` is embedded into the binary using `include_str!()`.
   - Any module import matching `"liosvideo"` or `"liosvideo/gpu"` is automatically resolved to this embedded code.
4. **Browser Shims for Three.js**:
   - `globalThis.window = globalThis`: Standard self-reference.
   - `globalThis.document`: Provides `createElement("canvas")` and `createElementNS(..., "canvas")` returning `MockCanvas`.
   - `MockCanvas`:
     - Exposes `width`, `height`, and `getContext("webgpu")`.
     - Returns a `GPUCanvasContext` wired to `deno_webgpu` / `wgpu`.
   - `requestAnimationFrame`: Hooked to the deterministic engine clock (`t = frame / fps`).
   - `ImageBitmap`: Handled via Rust `image` crate decoding, transferred as an internal GPU texture identifier.

---

### 4.3 GPU Rendering Subsystem (`gpu/`)
1. **Headless Context (`context.rs`)**:
   - Initializes `wgpu::Instance` with `wgpu::Backends::all()` (Metal on macOS, Vulkan on Linux, DirectX 12 on Windows, with fallback to software Vulkan/Lavapipe).
   - Requests a high-performance adapter and headless device without an active OS window or surface.
2. **Render Target & Readback (`target.rs`)**:
   - Allocates an offscreen `wgpu::Texture` with dimensions matching the composition resolution (`width x height`) and format `wgpu::TextureFormat::Rgba8UnormSrgb`.
   - Allocates a corresponding `wgpu::Buffer` with usage `COPY_DST | MAP_READ` aligned to `wgpu::COPY_BYTES_PER_ROW_ALIGNMENT` (256 bytes).
3. **Execution Loop**:
   - Evaluates node properties and Three.js state for the target frame.
   - Records draw calls and submits command buffers to `wgpu::Queue`.
   - Copies texture contents to the staging buffer and maps memory asynchronously to produce raw RGBA bytes on host RAM.

---

### 4.4 Standalone Media & Encoding Subsystem (`media/`)
1. **Audio Mixing (`media/audio.rs`)**:
   - Reads composition manifest audio tracks (`src`, `startAt`, `volume`, `loop`).
   - Decodes audio files (MP3/WAV) using `symphonia`.
   - Resamples audio to 48,000 Hz 32-bit float stereo PCM.
   - Pre-mixes all audio tracks into a master PCM buffer matching composition duration with accurate keyframe volume and fade curves.
2. **Video Encoding (`media/encoder.rs`)**:
   - Converts host RGBA frame pixels to YUV420p.
   - Feeds YUV frames into an embedded `openh264` encoder (H.264 Baseline/High Profile, rate control configured per `--quality`).
   - Encodes mixed audio PCM slices into AAC packets.
   - Muxes H.264 video NAL units and AAC audio packets into standard MP4 atoms (`ftyp`, `moov`, `mdat`) using the `mp4` crate.
   - Emits fast-start MP4 with `moov` atom placed at the beginning of the file for immediate streaming playback.

---

### 4.5 CLI Command Interface & Terminal UX (`cli/`)

#### Commands
```bash
# Render video to MP4
liosvideo render <path/to/composition.ts> [options]
  -o, --out <path>         Output file path (default: "out/output.mp4")
  --fps <number>           Override framerate (e.g. 30, 60)
  --frames <start..end>    Render only a subset of frames (e.g. 0..120)
  --quality <preset>       Video quality preset: low | medium | high (default: medium)
  --quiet                  Suppress terminal progress indicators

# Capture snapshot frame to PNG
liosvideo snapshot <path/to/composition.ts> [options]
  -o, --out <path>         Output image path (default: "out/snapshot.png")
  --frame <number>         Frame number to capture (default: 0)

# Display composition metadata
liosvideo info <path/to/composition.ts> [options]
  --json                   Output structured JSON metadata
```

#### Terminal Progress Output (`indicatif`)
When attached to a TTY, `render` displays an animated multi-line progress bar:
```text
Rendering: long.ts (1920x1080 @ 30fps)
[Render]   ████████████████████░░░░░░░░░░  360/600 frames (60%) [38.2 fps, ETA: 00:06]
[Encoding] H.264 + AAC | Current scene: "intro" (Scene 1/3)
[Audio]    Mixed 2 tracks (vo:intro-1, bgm:ambient)
```
When non-TTY is detected (CI or redirection), progress falls back to periodic summary logs (e.g. every 10%).

---

## 5. Error Handling & Diagnostics

1. **Scene Exceptions**:
   - Caught at the JS boundary.
   - Mapped back to the exact project file and line number using the source map (e.g., `Error at scenes/intro.ts:42:15: cannot read property 'foo' of undefined`).
2. **Missing Assets**:
   - Missing images: Rendered as a distinct placeholder (consistent with desktop app preview) with a warning log, avoiding hard pipeline panics.
   - Missing audio: Treated as silence with an explicit warning log.
3. **Exit Codes**:
   - `0`: Success.
   - `1`: Syntax/compilation or runtime execution error.
   - `2`: Invalid CLI arguments or missing input files.

---

## 6. Verification & Testing Strategy

1. **Unit Tests**:
   - `loader_test`: Validates relative import resolution and TS-to-JS transpilation.
   - `audio_mixer_test`: Validates PCM mixing math, volume curves, and looping.
   - `shims_test`: Validates DOM mock globals and `MockCanvas` context retrieval.
2. **Integration Tests (`cargo test -p liosvideo-cli`)**:
   - `snapshot_test`: Renders sample composition frame 0 to PNG; verifies PNG magic bytes and expected pixel colors.
   - `render_mp4_test`: Renders a 30-frame synthetic composition; verifies MP4 container valid structure and audio/video stream sync.
3. **CI Matrix Integration**:
   - Add `cargo test -p liosvideo-cli` to GitHub Actions workflow across macOS, Ubuntu, and Windows.

---

## 7. Delivery Plan & Phases

- **Phase 1: Foundation & Runtime (`runtime/` & `gpu/`)**:
  - Scaffold `apps/cli/Cargo.toml`.
  - Wire `deno_core` runtime, SWC transpilation, and embedded `liosvideo` package bundle.
  - Wire headless `wgpu` device and offscreen render target.
- **Phase 2: Snapshot & Shims (`pipeline/snapshot.rs` & `shims/`)**:
  - Implement canvas/DOM mock shims for Three.js compatibility.
  - Implement `snapshot` command exporting headless frames to PNG.
- **Phase 3: Media & Standalone MP4 Encoding (`media/` & `pipeline/render_job.rs`)**:
  - Integrate `symphonia` audio decoding & PCM mixer.
  - Integrate in-binary `openh264` and `mp4` muxer.
  - Wire full frame render loop to output MP4.
- **Phase 4: CLI UX & CI Release Integration**:
  - Integrate `indicatif` terminal progress bars.
  - Add `apps/cli` to Cargo workspace and GitHub Actions release artifact matrix.

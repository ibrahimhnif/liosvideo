---
name: liosvideo-cli
description: Use when running, automating, batch rendering, inspecting, or capturing snapshot frames of declarative TypeScript videos from terminal/CI using the standalone liosvideo headless CLI engine without a GUI.
---

# liosvideo CLI Skill

The `liosvideo` CLI is a high-performance, standalone, headless video rendering engine for liosvideo declarative TypeScript compositions. It executes entirely in-binary with embedded V8 (`deno_core`), on-the-fly TypeScript transpilation (`deno_ast`), headless WebGPU (`wgpu`), OpenH264 video encoding, and pure-Rust AAC audio encoding—**requiring zero external dependencies on Node.js, Deno, Chromium, or system FFmpeg**.

Use this skill whenever:
- Rendering `.ts` compositions (`long.ts`, `short.ts`) to MP4 video files headlessly or in CI.
- Capturing deterministic PNG frame snapshots for visual testing, inspection, or thumbnails.
- Extracting composition metadata (resolution, FPS, scene lists, audio tracks) programmatically.
- Automating batch rendering or headless video generation pipelines.

---

## 1. Quick Start & Execution

### One-Line CLI Installation (macOS / Linux)
```sh
curl -fsSL https://raw.githubusercontent.com/ibrahimhnif/liosvideo/main/install.sh | sh
```

### Global / Installed Binary
```bash
liosvideo --help
```

### From Local Workspace (Development)
```bash
cargo run -p liosvideo-cli -- <SUBCOMMAND> [OPTIONS]
```

### Release Binary Build
```bash
cargo build --release -p liosvideo-cli
./target/release/liosvideo <SUBCOMMAND> [OPTIONS]
```

---

## 2. CLI Subcommands & Reference

### A. `render` (Full MP4 Video Rendering)

Renders a TypeScript composition into an H.264/AAC MP4 video container.

```bash
liosvideo render <ENTRY> [OPTIONS]
```

#### Options:
| Flag | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `<ENTRY>` | Path to composition entry TypeScript file | *Required* | `long.ts` or `short.ts` |
| `-o, --out <PATH>` | Output destination path for the `.mp4` file | `out/output.mp4` | `-o out/promo.mp4` |
| `--fps <FPS>` | Override composition framerate | From composition | `--fps 60` |
| `--frames <RANGE>` | Slice a subset of frames to render | Full video | `--frames 0..120` |
| `--quality <PRESET>`| Encoding quality preset (`low`=4 Mbps, `medium`=10, `high`=30) | Preset default | `--quality high` |
| `--preset <NAME>` | Output resolution: `native`, `1080p`, `4k`, `shorts` | `native` | `--preset shorts` |
| `--bitrate <BPS>` | H.264 bitrate override | Preset default | `--bitrate 20000000` |
| `--audio-bitrate <BPS>` | AAC bitrate | `192000` | `--audio-bitrate 256000` |
| `--quiet` | Disable interactive terminal progress bar (clean CI logs) | `false` | `--quiet` |

#### Supported Frame Range Syntax:
- `0..120` or `0-120`: From frame 0 to frame 120 (exclusive).
- `0..=120`: From frame 0 to frame 120 (inclusive).
- `..90`: From frame 0 to frame 90.
- `60..`: From frame 60 to the end of the composition.
- `45`: Render only frame 45.

#### Example Commands:
```bash
# Standard 16:9 render
liosvideo render long.ts -o out/final.mp4

# Quick preview of first 5 seconds at 30 fps (150 frames)
liosvideo render long.ts --frames 0..150 -o out/preview.mp4

# CI headless render without progress bar artifacts
liosvideo render short.ts -o out/short.mp4 --quiet
```

---

### B. `snapshot` (Instant Frame PNG Export)

Evaluates the composition graph at a specific frame and renders an offscreen WebGPU frame directly to a PNG image.

```bash
liosvideo snapshot <ENTRY> [OPTIONS]
```

#### Options:
| Flag | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `<ENTRY>` | Path to composition entry TypeScript file | *Required* | `long.ts` |
| `-o, --out <PATH>` | Output destination PNG path | `out/snapshot.png` | `-o out/frame-0.png` |
| `--frame <N>` | Target frame number to capture (0-indexed) | `0` | `--frame 45` |
| `--preset <NAME>` | Output resolution: `native`, `1080p`, `4k`, `shorts` | `native` | `--preset 1080p` |

#### Visual Verification Workflow:
Use `snapshot` to verify visual layout, text wrapping, and colors before launching long video renders:
```bash
# Capture first frame
liosvideo snapshot long.ts --frame 0 -o out/thumb-start.png

# Capture mid-scene transition (e.g. at 2 seconds @ 30fps = frame 60)
liosvideo snapshot long.ts --frame 60 -o out/thumb-scene2.png
```

---

### C. `info` (Composition Inspection & Metadata)

Loads and evaluates the entry module, parsing composition layout, scenes, and audio tracks.

```bash
liosvideo info <ENTRY> [OPTIONS]
```

#### Options:
| Flag | Description | Default |
| :--- | :--- | :--- |
| `<ENTRY>` | Path to composition entry TypeScript file | *Required* |
| `--json` | Output full structured JSON for scripting and pipelines | `false` |

#### Human-Readable Output:
```bash
liosvideo info long.ts
```
```text
Composition Info:
  Resolution: 1920x1080
  FPS: 30
  Duration: 12.50s (375 frames)
  Background: #0b0d12
  Scenes (3):
    - intro: 4.50s (frames 0..135)
    - features: 5.00s (frames 135..285)
    - outro: 3.00s (frames 285..375)
  Audio Tracks (2):
    - Track 'bgm': assets/audio/music/ambient.mp3 (start: 0.00s, volume: 0.25, loop: true)
    - Track 'vo-1': assets/audio/vo/intro.mp3 (start: 0.50s, volume: 1.00, loop: false)
```

#### Structured JSON Output (`--json`):
```bash
liosvideo info long.ts --json | jq '.scenes[].id'
```

---

## 3. Automation & CI/CD Recipes

### GitHub Actions Workflow Integration
In `.github/workflows`:
```yaml
- name: Build Video with liosvideo CLI
  run: |
    # Render with quiet flag for clean log output
    liosvideo render long.ts -o out/release-video.mp4 --quiet

- name: Upload Video Artifact
  uses: actions/upload-artifact@v4
  with:
    name: release-video
    path: out/release-video.mp4
```

### Automated Multi-Ratio Export Script
```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Rendering 16:9 Landscape (YouTube / Desktop)..."
liosvideo render long.ts -o out/long.mp4 --quality high

echo "==> Rendering 9:16 Portrait (Shorts / Reels / TikTok)..."
liosvideo render short.ts -o out/short.mp4 --quality high

echo "==> Generating Thumbnail..."
liosvideo snapshot long.ts --frame 30 -o out/thumbnail.png

echo "==> Export complete!"
```

---

## 4. Best Practices & Troubleshooting

1. **Even Dimensions Requirement**:
   - H.264 encoding requires even width and height (e.g. `1920x1080` or `1080x1920`). Compositions with odd dimensions (like `1921x1081`) will be rejected with a descriptive error.
2. **Deterministic Time**:
   - Frames are evaluated strictly at $t = \text{frame} / \text{fps}$.
   - Never rely on system wall-clock time (`Date.now()`) or unseeded random values.
3. **Audio Asset Paths**:
   - Audio paths in `audio: [{ src: "assets/audio/..." }]` are resolved relative to the composition's parent directory / project root.
4. **Scene Relative Imports**:
   - Relative imports (`import intro from "./scenes/intro";` or `./scenes/intro.ts`) are transpiled on the fly via SWC and resolved deterministically without bundling.
5. **Renderer parity**:
   - The CLI uses the same WGSL shaders and instance layout as the desktop preview, including
     layers, opacity, gaussian blur and rounded-rect clips.
   - `path` nodes render as solid quads (same as desktop).
   - `shader` nodes execute real WGSL in both the CLI and the desktop preview/export.
   - `three` nodes execute real `setup` / `update` callbacks in both. The CLI uses a deterministic
     software rasteriser; the desktop prefers WebGL and falls back to the same rasteriser.
   - Text is measured/rasterised with cosmic-text rather than Canvas2D, so text boxes can differ
     by a few pixels.
   - Video nodes (`video({ src: "assets/video/clip.mp4" })`) decode H.264/MP4 frame-accurately.

### Custom WGSL contract

```ts
shader({
  width: 640,
  height: 360,
  uniforms: { speed: 1.5, tint: [1, 0.5, 0.25] },
  code: `
    @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
      let t = u_globals.time.x;         // seconds
      let p = u_globals.time.y;         // 0..1 scene progress
      let r = u_globals.resolution.xy;  // pixel size
      let s = u.speed.x;
      let c = u.tint.xyz;
      return vec4f(uv.x, uv.y, 0.5 + 0.5 * sin(t * s), 1.0);
    }
  `,
})
```

- The CLI prepends the fullscreen vertex shader and the `u_globals` / `u` bindings.
- Do not declare your own `@group` / `@binding`; the node falls back to a white box if you do.
- Uniform keys must be valid WGSL identifiers. Scalars fill `.x`; arrays fill `.xyzw`.
- Output is composited as a textured quad, so transforms, `opacity`, blur and clips apply.
- Shaders are validated with `naga`; invalid code prints one warning and falls back to a white box.

### three.js contract

```ts
three({
  width: 560,
  height: 340,
  camera: "perspective", // or "orthographic"
  fov: 50,
  setup({ scene, camera, width, height }) {
    camera.position.set(3, 3.5, 5);
    camera.lookAt(0, 0, 0);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshStandardMaterial({ color: "#38bdf8", roughness: 0.25 }),
    );
    scene.add(mesh);
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(4, 6, 3);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    return { mesh };
  },
  update({ mesh }, progress, time) {
    mesh.rotation.y = time * 0.9;
  },
})
```

- Supported: Mesh, Line, LineSegments, LineLoop, Points; BufferGeometry (indexed or not, groups,
  multi-material); MeshBasic / Lambert / Phong / Standard / Toon / Normal; Ambient / Hemisphere /
  Directional / Point / Spot lights; vertex colours, flat shading, side modes, transparency;
  perspective and orthographic cameras.
- Not supported (ignored): textures, shadows, skinning, morph targets, instancing,
  post-processing and custom `ShaderMaterial`.
- Rendering is deterministic and happens in V8; output is composited like a normal textured node.
- The desktop renderer prefers WebGL (so textures/shadows work there) and automatically uses the
  same software rasteriser when WebGL is unavailable (for example inside a WKWebView worker).

---

## 5. Project & Backend Commands

All project-scoped commands accept `--project <DIR>` (defaults to the current directory).

```bash
# Composition + timeline inspection
liosvideo info long.ts --json

# Scene validation (exit code 1 on errors)
liosvideo validate --project .
liosvideo validate scenes/intro.ts --json

# Project scaffolding (blank, minimal-dev, product-3d, kinetic-short, saas-launch)
liosvideo project new ~/Labs promo --template minimal-dev
liosvideo project info --project ~/Labs/promo
liosvideo project recent
liosvideo project stats --json
liosvideo project token-usage --input 12000 --output 3000 --model claude-opus
liosvideo project conversation get --project ~/Labs/promo

# Git history / checkpoints
liosvideo history status --project ~/Labs/promo
liosvideo history checkpoint -m "before intro rework" --project ~/Labs/promo
liosvideo history log --limit 10 --project ~/Labs/promo
liosvideo history diff <commit> --project ~/Labs/promo
liosvideo history restore <commit> --project ~/Labs/promo
liosvideo history revert-files <commit> scenes/intro.ts --project ~/Labs/promo

# Narration (writes assets/audio/vo/<id>.mp3 + .timing.json)
liosvideo tts voices
liosvideo tts generate --line-id intro-1 --text "Halo dunia" --voice mock-id-male
liosvideo tts timings

# Assets
liosvideo asset import logo assets/brand/logo.svg
liosvideo asset save-image logo.png ./Downloads/logo.png
liosvideo asset save-video demo ./Downloads/demo.mp4
liosvideo asset record-voice intro-1 1.8 ./take.mp3

# Secrets (env → macOS Keychain → ~/.config/liosvideo/credentials.json)
liosvideo key get ELEVENLABS_API_KEY
liosvideo key set ELEVENLABS_API_KEY sk-...
liosvideo key delete ELEVENLABS_API_KEY

# ACP coding agents
liosvideo agent list
liosvideo agent install-adapter claude
liosvideo agent set-default claude
liosvideo agent prompt "add a title card to the intro" --project ~/Labs/promo
liosvideo agent chat --project ~/Labs/promo     # /cancel, /exit

# Embedded MCP server (headless; render_frame works without a webview)
liosvideo mcp tools --project ~/Labs/promo
liosvideo mcp call validate_scene '{}' --project ~/Labs/promo
liosvideo mcp call render_frame '{"frame":30}' --project ~/Labs/promo
liosvideo mcp serve --stdio --project ~/Labs/promo
liosvideo mcp serve --tcp 127.0.0.1:7333 --project ~/Labs/promo

# Watch + re-render on change
liosvideo watch --project ~/Labs/promo --exec "liosvideo render long.ts -o out/preview.mp4 --frames 0..60"
```

CLI agent sessions auto-approve tool permissions (there is no permission UI).
`request_asset` returns `skipped` unless `LIOSVIDEO_ASSET_PATH` points at a file to copy.


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
| `--quality <PRESET>`| Encoding quality preset (`low`, `medium`, `high`) | `medium` | `--quality high` |
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

# Headless CLI Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, headless CLI tool (`apps/cli`) in Rust that executes TypeScript compositions via `deno_core` and renders them to MP4 video and PNG snapshots via `wgpu` with in-binary media encoding.

**Architecture:** A Rust crate (`apps/cli`) leveraging `deno_core` (V8) with SWC on-the-fly transpilation for project TypeScript files. Global browser shims provide Three.js/DOM compatibility. Headless `wgpu` renders offscreen RGBA textures, while `symphonia` handles audio decoding/mixing, `openh264` encodes video frames, and `mp4` muxes them into a self-contained MP4 file.

**Tech Stack:** Rust 2021, `deno_core`, `wgpu`, `openh264`, `symphonia`, `mp4`, `image`, `clap`, `indicatif`, `swc_core` / `deno_ast`.

**Spec:** `docs/superpowers/specs/2026-10-29-headless-cli-design.md`

## Global Constraints
- Standalone single binary output (`liosvideo` executable): zero external dependencies on Node.js, Deno CLI, Chromium, or system FFmpeg.
- Deterministic frame evaluation: frame $N$ rendered strictly at timestamp $t = N / \text{fps}$.
- Output resolution and framerate derived from composition or overridden via CLI flags.
- Cross-platform support for macOS, Linux, and Windows.

---

### Task 1: Cargo Workspace & CLI Scaffold

**Files:**
- Create: `/Users/hanif/Labs/personal/liosvideo/Cargo.toml`
- Create: `/Users/hanif/Labs/personal/liosvideo/apps/cli/Cargo.toml`
- Create: `/Users/hanif/Labs/personal/liosvideo/apps/cli/src/main.rs`
- Create: `/Users/hanif/Labs/personal/liosvideo/apps/cli/src/cli/mod.rs`
- Test: `/Users/hanif/Labs/personal/liosvideo/apps/cli/src/cli/mod.rs` (inline test)

**Interfaces:**
- Produces: `CliArgs` struct and `Commands` enum (`Render`, `Snapshot`, `Info`) parsed by `clap`.

- [ ] **Step 1: Create root Cargo workspace**
Configure `/Users/hanif/Labs/personal/liosvideo/Cargo.toml`:
```toml
[workspace]
members = [
    "apps/desktop/src-tauri",
    "apps/cli",
]
resolver = "2"
```

- [ ] **Step 2: Create apps/cli/Cargo.toml**
Add dependencies: `clap`, `tokio`, `anyhow`, `serde`, `serde_json`, `image`.
```toml
[package]
name = "liosvideo-cli"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "liosvideo"
path = "src/main.rs"

[dependencies]
clap = { version = "4.5", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
anyhow = "1.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }
indicatif = "0.17"
```

- [ ] **Step 3: Write CLI argument definitions and tests**
In `apps/cli/src/cli/mod.rs`:
```rust
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "liosvideo", version, about = "Deterministic declarative video renderer")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum Commands {
    Render {
        entry: PathBuf,
        #[arg(short, long, default_value = "out/output.mp4")]
        out: PathBuf,
        #[arg(long)]
        fps: Option<f64>,
        #[arg(long)]
        frames: Option<String>,
        #[arg(long, default_value = "medium")]
        quality: String,
        #[arg(long)]
        quiet: bool,
    },
    Snapshot {
        entry: PathBuf,
        #[arg(short, long, default_value = "out/snapshot.png")]
        out: PathBuf,
        #[arg(long, default_value_t = 0)]
        frame: usize,
    },
    Info {
        entry: PathBuf,
        #[arg(long)]
        json: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_render_command() {
        let cli = Cli::parse_from(["liosvideo", "render", "long.ts", "-o", "video.mp4"]);
        assert_eq!(
            cli.command,
            Commands::Render {
                entry: PathBuf::from("long.ts"),
                out: PathBuf::from("video.mp4"),
                fps: None,
                frames: None,
                quality: "medium".into(),
                quiet: false,
            }
        );
    }
}
```

- [ ] **Step 4: Write main.rs entry point**
In `apps/cli/src/main.rs`:
```rust
mod cli;

use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = cli::Cli::parse();
    match args.command {
        cli::Commands::Render { entry, out, .. } => {
            println!("Rendering {} to {}", entry.display(), out.display());
        }
        cli::Commands::Snapshot { entry, out, frame } => {
            println!("Snapshot frame {} of {} to {}", frame, entry.display(), out.display());
        }
        cli::Commands::Info { entry, .. } => {
            println!("Inspecting {}", entry.display());
        }
    }
    Ok(())
}
```

- [ ] **Step 5: Verify tests and build**
Run: `cargo test -p liosvideo-cli`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add Cargo.toml apps/cli
git commit -m "feat(cli): scaffold liosvideo-cli crate with clap subcommands

Co-authored-by: Antigravity <antigravity@deepmind.google>"
```

---

### Task 2: Deno Core Runtime & TypeScript Loader

**Files:**
- Modify: `apps/cli/Cargo.toml`
- Create: `apps/cli/src/runtime/mod.rs`
- Create: `apps/cli/src/runtime/loader.rs`
- Create: `apps/cli/src/runtime/shims/mod.rs`
- Test: `apps/cli/src/runtime/mod.rs` (inline test)

**Interfaces:**
- Produces: `RuntimeHost::new(project_root: PathBuf) -> Result<RuntimeHost>`
- Produces: `RuntimeHost::load_composition(entry_file: &str) -> Result<CompositionInfo>`

- [ ] **Step 1: Add deno_core and deno_ast dependencies to apps/cli/Cargo.toml**
```toml
deno_core = "0.334"
deno_ast = { version = "0.45", features = ["transpiling"] }
```

- [ ] **Step 2: Implement TypeScript transpiling module loader**
In `apps/cli/src/runtime/loader.rs`:
Implement `deno_core::ModuleLoader` that:
- Reads local `.ts` files, transpiles them using `deno_ast::parse_module` and `transpile()`.
- Resolves `"liosvideo"` to an in-memory virtual module containing the runtime library code.

- [ ] **Step 3: Implement browser environment shims**
In `apps/cli/src/runtime/shims/mod.rs`:
Inject initial JS code into `JsRuntime`:
```javascript
globalThis.window = globalThis;
globalThis.document = {
  createElement: (tag) => ({ tag, width: 0, height: 0 }),
  createElementNS: (ns, tag) => ({ tag, width: 0, height: 0 })
};
globalThis.requestAnimationFrame = (cb) => { /* clock hook */ };
```

- [ ] **Step 4: Implement RuntimeHost and composition evaluator**
In `apps/cli/src/runtime/mod.rs`:
Load user entry module, extract composition metadata (`width`, `height`, `fps`, `duration`, `scenes`).

- [ ] **Step 5: Write test for RuntimeHost**
Test loading a minimal TypeScript composition string and reading back total frames.
Run: `cargo test -p liosvideo-cli runtime::`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add apps/cli/src/runtime
git commit -m "feat(cli): integrate deno_core runtime with TS transpilation and shims

Co-authored-by: Antigravity <antigravity@deepmind.google>"
```

---

### Task 3: Headless wgpu Offscreen Target & Snapshot PNG

**Files:**
- Modify: `apps/cli/Cargo.toml`
- Create: `apps/cli/src/gpu/mod.rs`
- Create: `apps/cli/src/gpu/context.rs`
- Create: `apps/cli/src/gpu/target.rs`
- Create: `apps/cli/src/pipeline/snapshot.rs`
- Test: `apps/cli/tests/snapshot_test.rs`

**Interfaces:**
- Produces: `GpuContext::new_headless() -> Result<GpuContext>`
- Produces: `RenderTarget::read_rgba() -> Result<Vec<u8>>`
- Produces: `render_snapshot(entry: &Path, frame: usize, out_png: &Path) -> Result<()>`

- [ ] **Step 1: Add wgpu dependency to apps/cli/Cargo.toml**
```toml
wgpu = "24.0"
bytemuck = { version = "1.21", features = ["derive"] }
```

- [ ] **Step 2: Implement GpuContext and RenderTarget**
In `apps/cli/src/gpu/context.rs` & `target.rs`:
- Headless `wgpu::Instance`, `Adapter`, `Device`, `Queue`.
- Allocate offscreen texture (`Rgba8UnormSrgb`) and copy-aligned staging buffer.
- Map buffer asynchronously and extract raw RGBA pixel slice.

- [ ] **Step 3: Implement snapshot pipeline**
In `apps/cli/src/pipeline/snapshot.rs`:
- Given a project file and frame number:
  1. Boot `RuntimeHost`.
  2. Evaluate composition tree at frame.
  3. Render frame to `RenderTarget`.
  4. Save pixel buffer as PNG using `image::save_buffer(...)`.

- [ ] **Step 4: Write integration test for snapshot**
In `apps/cli/tests/snapshot_test.rs`:
Render a test composition with red background at frame 0, verify PNG header and red pixel values.
Run: `cargo test -p liosvideo-cli --test snapshot_test`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/src/gpu apps/cli/src/pipeline/snapshot.rs apps/cli/tests
git commit -m "feat(cli): implement headless wgpu offscreen target and snapshot pipeline

Co-authored-by: Antigravity <antigravity@deepmind.google>"
```

---

### Task 4: Audio Decoding & Standalone Software PCM Mixer

**Files:**
- Modify: `apps/cli/Cargo.toml`
- Create: `apps/cli/src/media/mod.rs`
- Create: `apps/cli/src/media/audio.rs`
- Test: `apps/cli/src/media/audio.rs` (unit tests)

**Interfaces:**
- Produces: `AudioTrackInfo { src: PathBuf, start_at: f64, volume: f64, loop_track: bool }`
- Produces: `mix_audio_tracks(tracks: &[AudioTrackInfo], total_seconds: f64, sample_rate: u32) -> Result<Vec<f32>>` (Interleaved stereo PCM)

- [ ] **Step 1: Add symphonia to apps/cli/Cargo.toml**
```toml
symphonia = { version = "0.5", features = ["mp3", "wav", "isomp4", "alac", "flac"] }
```

- [ ] **Step 2: Implement audio file decoder**
In `apps/cli/src/media/audio.rs`:
Read MP3/WAV from disk using `symphonia::default::get_probe()`, decode packets into raw float32 samples.

- [ ] **Step 3: Implement stereo PCM mixer**
In `apps/cli/src/media/audio.rs`:
Mix decoded track buffers into target master buffer at specified `start_at` offset, apply volume scaling, handle looping.

- [ ] **Step 4: Write unit tests for audio mixer**
Verify audio sample alignment, volume attenuation, and duration clipping.
Run: `cargo test -p liosvideo-cli media::audio`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/src/media/audio.rs
git commit -m "feat(cli): add symphonia audio decoder and software PCM mixer

Co-authored-by: Antigravity <antigravity@deepmind.google>"
```

---

### Task 5: In-Binary Video Encoding & MP4 Muxer

**Files:**
- Modify: `apps/cli/Cargo.toml`
- Create: `apps/cli/src/media/encoder.rs`
- Test: `apps/cli/src/media/encoder.rs` (unit test)

**Interfaces:**
- Produces: `Mp4Encoder::new(out_path: &Path, width: u32, height: u32, fps: f64, sample_rate: u32) -> Result<Mp4Encoder>`
- Produces: `Mp4Encoder::push_frame(rgba_pixels: &[u8]) -> Result<()>`
- Produces: `Mp4Encoder::push_audio(pcm_samples: &[f32]) -> Result<()>`
- Produces: `Mp4Encoder::finish() -> Result<()>`

- [ ] **Step 1: Add openh264 and mp4 dependencies to apps/cli/Cargo.toml**
```toml
openh264 = "0.6"
mp4 = "0.14"
```

- [ ] **Step 2: Implement RGBA to YUV420p converter**
In `apps/cli/src/media/encoder.rs`:
Fast color conversion from 8-bit RGBA to planar YUV420p for H.264 ingestion.

- [ ] **Step 3: Implement Mp4Encoder using OpenH264 & mp4 crate**
In `apps/cli/src/media/encoder.rs`:
- Initialize OpenH264 encoder context.
- Write video track NAL units into MP4 writer.
- Write audio track AAC samples into MP4 writer.
- Finalize MP4 with fast-start moov atom header.

- [ ] **Step 4: Write unit test for video encoder**
Encode 10 synthetic solid-color frames to an in-memory MP4 buffer and verify MP4 header.
Run: `cargo test -p liosvideo-cli media::encoder`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/src/media/encoder.rs
git commit -m "feat(cli): add in-binary OpenH264 video encoder and MP4 muxer

Co-authored-by: Antigravity <antigravity@deepmind.google>"
```

---

### Task 6: Full Render Loop & Terminal Progress Bar

**Files:**
- Create: `apps/cli/src/cli/progress.rs`
- Create: `apps/cli/src/pipeline/render_job.rs`
- Modify: `apps/cli/src/main.rs`
- Test: `apps/cli/tests/render_e2e_test.rs`

**Interfaces:**
- Produces: `run_render_job(config: RenderConfig) -> Result<()>`

- [ ] **Step 1: Implement terminal progress bar**
In `apps/cli/src/cli/progress.rs`:
Use `indicatif::ProgressBar` showing frames completed, total frames, current fps, ETA, and active scene ID.

- [ ] **Step 2: Implement render_job pipeline**
In `apps/cli/src/pipeline/render_job.rs`:
- Step 1: Evaluate composition and pre-mix audio tracks.
- Step 2: Loop from frame 0 to total frames.
- Step 3: For each frame: render wgpu -> readback RGBA -> push to `Mp4Encoder`.
- Step 4: Finalize encoder and display success summary.

- [ ] **Step 3: Wire render_job into main.rs**
Connect `cli::Commands::Render` to `pipeline::render_job::run_render_job`.

- [ ] **Step 4: Write end-to-end integration test**
In `apps/cli/tests/render_e2e_test.rs`:
Render a 30-frame TS composition with audio track, outputting a valid `.mp4` file.
Run: `cargo test -p liosvideo-cli --test render_e2e_test`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/src/cli/progress.rs apps/cli/src/pipeline/render_job.rs apps/cli/src/main.rs apps/cli/tests
git commit -m "feat(cli): implement deterministic video render loop and progress reporting

Co-authored-by: Antigravity <antigravity@deepmind.google>"
```

---

### Task 7: CI Matrix Integration & Verification

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add apps/cli test step to CI & Release workflow**
In `.github/workflows/ci.yml`:
Add `cargo test -p liosvideo-cli` under `Rust tests` step.

- [ ] **Step 2: Verify all workspace tests pass locally**
Run: `cargo test`
Expected: All tests pass across both `apps/desktop/src-tauri` and `apps/cli`.

- [ ] **Step 3: Commit and push**
```bash
git add .github/workflows/ci.yml
git commit -m "ci: integrate liosvideo-cli into test and release pipeline

Co-authored-by: Antigravity <antigravity@deepmind.google>"
```

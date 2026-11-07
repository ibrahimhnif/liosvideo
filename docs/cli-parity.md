# CLI ↔ Desktop parity

The standalone `liosvideo` CLI (`apps/cli`) now ships the same rendering engine and the same
backend feature set as the desktop app, with no Node.js, Chromium, or FFmpeg dependency.

## What is identical

| Area | Notes |
| :--- | :--- |
| Scene evaluation | Same `@liosvideo/runtime` bundle, same `evaluateFrame` output, same deterministic seeded random. |
| Transitions / keyframes / z-sorting | Evaluated inside V8, identical render lists. |
| Rect / circle | Same SDF quad shader, rounded corners and inside stroke. |
| Text | Same layout rules (hard `\n` breaks, `fontSize * lineHeight`, per-line vertical centring, left aligned). Metrics come from cosmic-text instead of Canvas2D, so glyph widths can differ slightly. |
| Image / SVG | `image` + `resvg` decode, premultiplied upload, identical `fill`/`contain`/`cover` math. |
| Video | MP4/H.264 decoded frame-accurately at `VideoItem.time` (desktop currently shows frame 0 only). |
| Layers | Same recursive layer targets, opacity, gaussian blur (`sigma = blur*sx/2`, radius ≤ 64) and rounded-rect clip with identical inverse-matrix uniforms. |
| Colour pipeline | `rgba8unorm`, premultiplied alpha, no sRGB linearisation — matching the desktop renderer byte-for-byte. |
| Shaders | `common.wgsl`, `quad.wgsl`, `blur.wgsl`, `composite.wgsl` are copied from `packages/runtime` and guarded by a unit test. |
| Custom WGSL (`shader()`) | Both compile and run `code` for real with the same preamble, bindings and uniform contract. |
| three.js (`three()`) | Both execute `setup` / `update` and apply the node's `shadows` / `toneMapping` / `exposure`. Desktop renders with WebGLRenderer; the CLI with three.js WebGPURenderer on the GPU (deno_webgpu over wgpu), falling back to the software rasteriser when no GPU is usable. `gltf()` / `texture()` / `hdr()` share one loader (`packages/runtime/src/three/loaders.ts`): the desktop worker reads files through the host and decodes with `createImageBitmap`; the CLI reads and decodes in Rust (`op_read_asset`, `op_decode_image`). An async `setup` is awaited in both. |
| Audio mixdown | Manifest audio clips: `startFrame`, `startOffset`, `duration`, `volume`; no looping, no ducking (same as desktop `audio_mixdown.ts`). |
| Export | H.264 + AAC (48 kHz) in MP4, 2-second keyframe interval. Presets `native`, `1080p`, `4k`, `shorts`, `preview` (720p, 0.6 Mbps + 96 kbps), `tiktok`, `reels` (1080×1920, 10 Mbps), `youtube` (1920×1080 or 1080×1920 vertical, 12 Mbps + 320 kbps); others 10 Mbps (4K 30 Mbps) + 192 kbps. One table: `apps/cli/src/pipeline/preset.rs` and `apps/desktop/src/lib/export/presets.ts`. Presets keep the composition's frame rate. Encoder: the CLI uses VideoToolbox on macOS (High profile, BT.709 tags, its own thread; `--encoder software` for OpenH264), the desktop uses WebCodecs (also hardware on macOS). |
| Validation | Same text-based scene validator (`scene_validator.rs`). |
| History | Same git2 implementation (`checkpoint`, `log`, `diff`, `restore`, `revert-files`). |
| Scaffolding | Same templates (`blank`, `minimal-dev`, `product-3d`, `kinetic-short`, `saas-launch`). |
| TTS | Same providers and word-level timing files (ElevenLabs, Google Cloud TTS, mock). |
| Secrets | Same keychain chain: env → macOS Keychain → `~/.config/liosvideo/credentials.json`. |
| ACP agents | Same registry, adapter install, session lifecycle, git checkpoints per turn. |
| MCP | Same 11 tools over stdio/TCP; render tools now run server-side. |
| Watch | Same 100 ms debounced watcher; prints changes (and can run a command). |

## Known deltas

1. **Text metrics** — cosmic-text instead of Canvas2D, so text boxes may be a few pixels wider/narrower.
2. **`path` nodes** — still drawn as a solid quad in both renderers (the desktop never tessellates `d`).
3. **Custom WGSL** — identical on both. The shader preamble exposes
   `u_globals.time` (`x` = seconds, `y` = progress), `u_globals.resolution`, and
   `u.<key>` (`vec4f` per `uniforms` entry). User code must define
   `@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f` and must not declare its own
   `@group` / `@binding`.
4. **three.js fidelity** — the CLI renders `three()` nodes with three.js `WebGPURenderer`
   (textures, shadows, tone mapping, emissive, PBR — the same three build as the desktop) and the
   desktop with `WebGLRenderer`; a textured, shadowed MeshStandardMaterial scene differs by
   ~46 dB PSNR. A colour `scene.background` is composited behind the GPU image untouched, as
   WebGL does. Without a usable GPU (or with `LIOSVIDEO_THREE=software`) the CLI falls back to the
   deterministic software rasteriser, which supports Mesh / Line / LineSegments / LineLoop /
   Points, BufferGeometry (indexed or not, groups, multi-material), MeshBasic / Lambert / Phong /
   Standard / Toon / Normal materials, Ambient / Hemisphere / Directional / Point / Spot lights,
   vertex colours, flat shading, side modes and transparency, but no textures, shadows, tone
   mapping, skinning, morph targets, instancing, post-processing or custom `ShaderMaterial`.
   Decision record: `docs/spikes/2026-11-08-cli-webgpu-three.md`.
5. **Video codecs** — MP4/H.264 only. WebM/VP9 falls back to the first frame with a warning.
6. **GUI-only features** — timeline selection, preview playback, visual diff overlays and chat UI
   have no CLI equivalent; their stateful MCP siblings (`set_selection`, `seek`) are kept in memory.
7. **Duplicated backend code** — `apps/cli/src/{project,tts,agents,acp,mcp}` are copies of the
   desktop modules with Tauri removed. Run `scripts/check-sync.sh` to see drift.
8. **Agent permissions** — CLI sessions auto-approve tool permissions (no interactive UI).

## Command map

| Desktop action | CLI |
| :--- | :--- |
| Export video | `liosvideo render <entry> [-o out.mp4] [--preset …]` |
| Capture frame | `liosvideo snapshot <entry> --frame N` or `--time S` |
| Contact sheet | `liosvideo contact-sheet <entry> [--per-scene \| --every 2s] [--cols 4] [--width 480] -o sheet.png` (MCP: `render_contact_sheet`) |
| Inspector / timeline | `liosvideo info <entry> --json` |
| Scene validation | `liosvideo validate [path] [--json]` |
| History | `liosvideo history status|enable|log|diff|checkpoint|restore|revert-files` |
| New project | `liosvideo project new <parent> <name> --template …` |
| Recent projects | `liosvideo project recent` |
| Stats / conversation | `liosvideo project stats`, `liosvideo project token-usage`, `liosvideo project conversation get|set` |
| TTS | `liosvideo tts voices|generate|timings` |
| Asset import | `liosvideo asset import <id> <file>`, `save-image`, `save-video`, `record-voice` |
| Free archival B-roll | `liosvideo asset search <query> [--page N] [--json]`, `asset download <film> <shot> [--name f] [--force]` (Destockd) |
| Licensed photos | `liosvideo asset commons search <query> [--page N] [--limit N] [--json]`, `asset commons download <File:…> [--name f] [--width px] [--force]` (Wikimedia Commons; MCP `commons_search` / `commons_download` in both apps) |
| API keys | `liosvideo key get|set|delete <service>` |
| ACP agent | `liosvideo agent list|prompt|chat|auth|set-config|install-adapter|…`; `--handoff <file|auto>` continues on another agent ([details](./acp-handoff.md)) |
| MCP server | `liosvideo mcp serve [--stdio|--tcp addr]`, `mcp tools`, `mcp call <tool>` |
| File watcher | `liosvideo watch [--exec <command>]` |

All project-scoped commands accept `--project <dir>` (defaults to the current directory).

# Capability probe — 2026-10-27

Run inside `pnpm --filter desktop tauri dev` (Tauri 2, system WKWebView).

- macOS 27.0.1 (build 26A434), Apple Silicon
- UA: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)`

| Capability | Result |
|---|---|
| webgpu | yes |
| webgpuInWorker | yes |
| offscreen2dInWorker | yes |
| systemFontInWorker | yes |
| videoEncoderH264 | yes |
| videoDecoderH264 | yes |
| audioEncoderAAC | yes |

No blocking failures. Render worker uses the Web Worker path (no iframe fallback needed).

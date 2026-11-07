#!/usr/bin/env bash
# Reports drift between the desktop backend modules and their CLI copies.
# Non-failing by default; pass --strict to exit 1 when anything differs.
set -euo pipefail

cd "$(dirname "$0")/.."
strict=0
[[ "${1:-}" == "--strict" ]] && strict=1

pairs=(
  "apps/desktop/src-tauri/src/git.rs|apps/cli/src/project/git.rs"
  "apps/desktop/src-tauri/src/scene_validator.rs|apps/cli/src/project/scene_validator.rs"
  "apps/desktop/src-tauri/src/keychain.rs|apps/cli/src/project/keychain.rs"
  "apps/desktop/src-tauri/src/recent.rs|apps/cli/src/project/recent.rs"
  "apps/desktop/src-tauri/src/scaffold.rs|apps/cli/src/project/scaffold.rs"
  "apps/desktop/src-tauri/src/audio/tts.rs|apps/cli/src/tts/tts.rs"
  "apps/desktop/src-tauri/src/audio/elevenlabs.rs|apps/cli/src/tts/elevenlabs.rs"
  "apps/desktop/src-tauri/src/audio/google_tts.rs|apps/cli/src/tts/google_tts.rs"
  "apps/desktop/src-tauri/src/audio/cache.rs|apps/cli/src/tts/cache.rs"
  "apps/desktop/src-tauri/src/agents/mod.rs|apps/cli/src/agents/mod.rs"
  "apps/desktop/src-tauri/src/agents/install.rs|apps/cli/src/agents/install.rs"
  "apps/desktop/src-tauri/src/agents/settings.rs|apps/cli/src/agents/settings.rs"
  "apps/desktop/src-tauri/src/agents/shell_path.rs|apps/cli/src/agents/shell_path.rs"
  "apps/desktop/src-tauri/src/acp/rpc.rs|apps/cli/src/acp/rpc.rs"
  "apps/desktop/src-tauri/src/acp/limits.rs|apps/cli/src/acp/limits.rs"
  "apps/desktop/src-tauri/src/destockd.rs|apps/cli/src/destockd.rs"
  "apps/desktop/src-tauri/src/commons.rs|apps/cli/src/commons.rs"
  "apps/desktop/src-tauri/src/acp/client.rs|apps/cli/src/acp/client.rs"
  "apps/desktop/src-tauri/src/acp/session.rs|apps/cli/src/acp/session.rs"
  "apps/desktop/src-tauri/src/mcp/tools.rs|apps/cli/src/mcp/tools.rs"
  "apps/desktop/src-tauri/src/mcp/protocol.rs|apps/cli/src/mcp/protocol.rs"
  "apps/desktop/src-tauri/src/mcp/server.rs|apps/cli/src/mcp/server.rs"
  "apps/desktop/src-tauri/src/mcp/bridge.rs|apps/cli/src/mcp/bridge.rs"
  "packages/runtime/src/gpu/shaders/common.wgsl|apps/cli/src/gpu/shaders/common.wgsl"
  "packages/runtime/src/gpu/shaders/quad.wgsl|apps/cli/src/gpu/shaders/quad.wgsl"
  "packages/runtime/src/gpu/shaders/blur.wgsl|apps/cli/src/gpu/shaders/blur.wgsl"
  "packages/runtime/src/gpu/shaders/composite.wgsl|apps/cli/src/gpu/shaders/composite.wgsl"
  "packages/runtime/src/gpu/shaders/filter.wgsl|apps/cli/src/gpu/shaders/filter.wgsl"
)

drift=0
for pair in "${pairs[@]}"; do
  src="${pair%%|*}"
  dst="${pair##*|}"
  if [[ ! -f "$src" || ! -f "$dst" ]]; then
    echo "missing: $src or $dst"
    drift=1
    continue
  fi
  if ! diff -q "$src" "$dst" >/dev/null; then
    echo "drift: $dst"
    drift=1
  fi
done

if [[ $drift -eq 0 ]]; then
  echo "all copied modules match their desktop sources"
else
  echo
  echo "Copied modules intentionally diverge where Tauri APIs were removed."
  echo "Review the diffs above; run this script with --strict in CI to enforce."
  [[ $strict -eq 1 ]] && exit 1
fi

# ACP chat — manual verification (2026-10-27)

## Agent detection (tauri dev, `LIOSVIDEO_PROJECT=<scratch>/verify/demo`)

The webview logged, after the composition loaded:

```
loaded long.ts 1920x1080 frames=90 rendered=0
agents claude:enable codex:enable gemini:ready opencode:not_installed goose:not_installed cursor:not_installed qwen:not_installed
```

- `claude` / `codex`: CLI found, adapter not yet installed → "Enable".
- `gemini`: native ACP mode → ready.
- The rest are not on the login-shell PATH.

## Real agent smoke (`cargo test real_agent_smoke -- --ignored`, gemini)

- `initialize` succeeded (protocol v1).
- `session/new` returned auth required (-32000), surfaced as `auth_required` with methods
  `oauth-personal`, `gemini-api-key`, `vertex-ai`. The chat pane renders one button per method.

## Left to the user (needs an interactive login / clicks)

- Pick a method in the chat pane, finish the agent's login, then send a prompt with a timeline
  selection and confirm the turn commit appears in History.
- Enable the claude adapter from the Agents panel and watch the streamed npm log.

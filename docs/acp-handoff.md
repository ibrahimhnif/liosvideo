# ACP context handoff

When an agent hits a usage limit, loses auth, or cannot use the selected model, liosvideo keeps the
conversation usable: it detects the failure, offers another agent or model, and sends a **portable text
handoff** of the app-side conversation.

This mirrors T3 Code's portable handoffs: a budgeted selection of history, not an agent-written summary.
It never claims provider-native context parity.

## What triggers it

`apps/desktop/src-tauri/src/acp/limits.rs` classifies failures (RPC errors, `prompt` errors, and the
agent's stderr tail on exit) into:

| Kind | Examples |
| :--- | :--- |
| `usage_limit` | `rate limit`, `429`, `quota`, `out of credits`, `hit your … limit`, `limit reached` |
| `auth` | `authentication required`, `401`, `unauthorized`, `invalid api key`, `log in again` |
| `model_unavailable` | `model not found`, `no access to model`, `unsupported model` |

The raw message is always shown; matching is conservative and never hides the failure.

Each match emits `agent://limit` with `{ kind, message, resetHint, agentId }`. The chat shows a
`LimitCard` with the message, a parsed reset hint (`resets 5pm`, `retry in 20 minutes`), and:

- **Switch model** — same agent, via `agent_set_config_option("model", …)`. No handoff is needed
  because the provider session survives.
- **Continue on another agent** — starts the selected agent and sends the handoff with the next request.

## What the handoff contains

`apps/desktop/src/lib/chat/handoff.ts` ports T3 Code's selection rules:

- Eligible items: user messages, agent messages, tool/command results, error notices, plans.
  Skipped: thoughts, permission prompts, asset requests, voice rows, and the `limit`/`handoff` rows.
- Each item renders as `[Historical <role>; <kind>; item=<id>; status=<status>]` followed by its text.
- Selection order: last user message, last assistant message, first user message, then newest → oldest.
- The header states how many items were selected and omitted, that historical material is context (not
  a new request), that attachments and native tool/reasoning state are not replayed, and that omitted
  history stays in `.liosvideo/conversation.json`.
- The next user request is sent **separately** and is never shortened.

### Budget

liosvideo has no provider token telemetry, so one UTF-8 byte is charged as one token (pessimistic):

```
default cap        16,000 bytes   (`DEFAULT_HANDOFF_BYTE_CAP`)
ceiling            64,000 bytes
floor               1,024 bytes
reserve            max(4,000, window / 10)   with a 128,000-token default window
budget = max(1_024, min(cap, 64_000) - bytes(request) - reserve)
```

`buildHandoff(items, { cap, window })` accepts overrides for tests or a future settings UI.

## Transport

`agent_switch_prompt` (Tauri command) takes `{ agentId?, configId?, value?, handoff, text, selection?, images? }`:

1. If `agentId` differs from the active agent, it reuses `agent_connect`'s internals (new process, MCP
   port, inherited auto-approve), then waits for `session/start`.
2. Else, if `configId`/`value` are set, it applies the config option in-session.
3. Sends `handoff + "\n\n---\n\n" + text` as one prompt, so the new agent sees the history as context.

The chat records a `handoff` row (`from`, `to`, selected, omitted) before the request and a `limit` row
when the failure arrived. Both serialize with the rest of `ChatItem[]` into
`.liosvideo/conversation.json`, so they survive reloads.

## CLI

```bash
# One-shot continuation with a handoff file (or `auto` = .liosvideo/handoff.md)
liosvideo agent prompt "finish the intro scene" --agent codex --handoff .liosvideo/handoff.md
liosvideo agent chat --agent gemini --handoff auto
```

On a limit the CLI appends a recovery hint (including the `--handoff` usage) to the error and keeps
going in `agent chat`. It does **not** generate a handoff itself: the CLI has no persisted structured
history, so build the file from the desktop chat (or any tool) and pass it in.

## Limits

- Textual only: no reasoning, tool-call state, approvals or attachments carry over.
- The new agent starts a fresh provider session and can re-read the project files; omitted history is
  still in `.liosvideo/conversation.json`.
- The budget is a conservative byte estimate, not a provider context guarantee.
- Auto-resume after a limit resets is not implemented; the UI offers the manual switch.

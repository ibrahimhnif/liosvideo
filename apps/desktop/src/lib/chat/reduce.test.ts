import { describe, expect, it } from "vitest";
import { applyEvent, initialChat, type ChatState } from "./reduce";

const chunk = (text: string, kind = "agent_message_chunk", messageId?: string) => ({
  type: "update" as const, update: { sessionUpdate: kind, content: { type: "text", text }, ...(messageId ? { messageId } : {}) },
});
const run = (events: Parameters<typeof applyEvent>[1][], s: ChatState = initialChat()) => events.reduce(applyEvent, s);

describe("applyEvent", () => {
  it("coalesces 1000 chunks of one message into one item", () => {
    const s = run(Array.from({ length: 1000 }, (_, i) => chunk(`${i},`, "agent_message_chunk", "m1")));
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "agent", text: Array.from({ length: 1000 }, (_, i) => `${i},`).join("") });
  });

  it("starts new items when the kind or message id changes", () => {
    const s = run([chunk("a", "agent_thought_chunk"), chunk("b"), chunk("c", "agent_thought_chunk"), chunk("d", "agent_message_chunk", "x"), chunk("e", "agent_message_chunk", "y")]);
    expect(s.items.map((i) => i.kind)).toEqual(["thought", "agent", "thought", "agent", "agent"]);
  });

  it("merges tool call updates field by field", () => {
    const s = run([
      { type: "update", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit intro", kind: "edit", status: "pending", locations: [{ path: "/p/scenes/intro.ts" }] } },
      { type: "update", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "diff", path: "scenes/intro.ts", oldText: "a", newText: "b" }, { type: "content", content: { type: "text", text: "ok" } }] } },
    ]);
    expect(s.items).toEqual([
      { kind: "tool", id: "k1", toolCallId: "t1", gen: 0, title: "Edit intro", toolKind: "edit", status: "completed", locations: ["/p/scenes/intro.ts"], content: ["Edited scenes/intro.ts", "ok"] },
    ]);
  });

  it("replaces the plan instead of stacking plans", () => {
    const plan = (content: string) => ({ type: "update" as const, update: { sessionUpdate: "plan", entries: [{ content, status: "pending", priority: "high" }] } });
    const s = run([plan("one"), chunk("hi"), plan("two")]);
    expect(s.items.filter((i) => i.kind === "plan")).toHaveLength(1);
    expect(s.items.find((i) => i.kind === "plan")).toMatchObject({ entries: [{ content: "two" }] });
  });

  it("tracks turns and marks unanswered permissions cancelled when a turn ends", () => {
    let s = run([
      { type: "user", text: "do it", selection: "long.ts › intro" },
      { type: "turn", state: "started" },
      { type: "permission", requestId: "p1", toolCall: { title: "Run rm" }, options: [{ optionId: "ok", name: "Allow once", kind: "allow_once" }] },
    ]);
    expect(s.turn).toBe("running");
    expect(s.items[0]).toMatchObject({ kind: "user", text: "do it", selection: "long.ts › intro" });
    expect(s.items[1]).toMatchObject({ kind: "permission", requestId: "p1", title: "Run rm" });
    s = run([{ type: "turn", state: "ended", stopReason: "cancelled" }], s);
    expect(s.turn).toBe("idle");
    expect(s.items[1]).toMatchObject({ answer: "cancelled" });
  });

  it("records permission answers", () => {
    const s = run([
      { type: "permission", requestId: "p1", toolCall: { title: "Write" }, options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }] },
      { type: "answered", requestId: "p1", optionId: "ok" },
    ]);
    expect(s.items[0]).toMatchObject({ answer: "ok" });
  });

  it("turns errors and exits into notices and keeps the connection state", () => {
    const s = run([
      { type: "status", state: "ready", agentId: "gemini" },
      { type: "turn", state: "started" },
      { type: "status", state: "exited", agentId: "gemini", message: "segfault" },
    ]);
    expect(s.connection).toMatchObject({ state: "exited", agentId: "gemini" });
    expect(s.turn).toBe("idle");
    expect(s.items.at(-1)).toMatchObject({ kind: "notice", level: "error", text: "segfault" });
    const t = run([{ type: "turn", state: "ended", error: "Agent exited" }]);
    expect(t.items.at(-1)).toMatchObject({ kind: "notice", level: "error", text: "Agent exited" });
  });

  it("keeps item keys unique when a reconnected agent reuses its ids", () => {
    const perm = { type: "permission" as const, requestId: "perm-1", toolCall: { title: "Write" }, options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }] };
    const tool = (title: string) => ({ type: "update" as const, update: { sessionUpdate: "tool_call", toolCallId: "1", title } });
    const s = run([
      { type: "status", state: "ready", agentId: "gemini" },
      perm,
      tool("first"),
      { type: "turn", state: "ended", stopReason: "end_turn" },
      { type: "status", state: "connecting", agentId: "gemini" },
      { type: "status", state: "ready", agentId: "gemini" },
      perm,
      tool("second"),
      { type: "answered", requestId: "perm-1", optionId: "ok" },
    ]);
    const ids = s.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const perms = s.items.filter((i) => i.kind === "permission");
    expect(perms.map((p) => p.answer)).toEqual(["cancelled", "ok"]);
    expect(s.items.filter((i) => i.kind === "tool").map((t) => t.title)).toEqual(["first", "second"]);
  });

  it("ignores unknown update variants", () => {
    expect(run([{ type: "update", update: { sessionUpdate: "available_commands_update", availableCommands: [] } }]).items).toEqual([]);
  });

  it("updates config option when config_option_update is received", () => {
    const s = run([
      {
        type: "status",
        state: "ready",
        agentId: "codex",
        configOptions: [
          {
            id: "model",
            name: "Model",
            currentValue: "gpt-6-sol",
            options: [
              { value: "gpt-6-sol", name: "GPT-6 Sol" },
              { value: "gpt-5-codex", name: "GPT-5 Codex" },
            ],
          },
        ],
      },
      {
        type: "update",
        update: {
          sessionUpdate: "config_option_update",
          configId: "model",
          value: "gpt-5-codex",
        },
      },
    ]);
    expect(s.connection?.configOptions?.[0].currentValue).toBe("gpt-5-codex");
  });

  it("handles asset_request and asset_resolved events", () => {
    let s = run([
      {
        type: "asset_request" as any,
        requestId: "req-1",
        id: "logo",
        kind: "image",
        description: "Company logo PNG",
      },
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      kind: "asset",
      requestId: "req-1",
      assetId: "logo",
      assetKind: "image",
      description: "Company logo PNG",
      answer: undefined,
    });

    s = run(
      [
        {
          type: "asset_resolved" as any,
          requestId: "req-1",
          answer: "provided",
          filePath: "assets/logo.png",
        },
      ],
      s,
    );
    expect(s.items[0]).toMatchObject({
      kind: "asset",
      answer: "provided",
      filePath: "assets/logo.png",
    });
  });

  it("cancels unanswered asset requests when a turn ends", () => {
    let s = run([
      { type: "turn", state: "started" },
      {
        type: "asset_request" as any,
        requestId: "req-2",
        id: "bg-audio",
        kind: "audio",
        description: "Background music",
      },
    ]);
    expect(s.items[0]).toMatchObject({ kind: "asset", answer: undefined });
    s = run([{ type: "turn", state: "ended", stopReason: "cancelled" }], s);
    expect(s.items[0]).toMatchObject({ kind: "asset", answer: "cancelled" });
  });
});

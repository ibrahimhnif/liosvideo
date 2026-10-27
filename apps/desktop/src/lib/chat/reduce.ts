import type { AgentEvent, AuthMethod, ConnectionState, PermissionOption } from "./api";

export type ChatItem =
  | { kind: "user"; id: string; text: string; selection?: string }
  | { kind: "agent"; id: string; text: string; messageId?: string }
  | { kind: "thought"; id: string; text: string; messageId?: string }
  | { kind: "tool"; id: string; title: string; toolKind: string; status: string; locations: string[]; content: string[] }
  | { kind: "plan"; id: string; entries: { content: string; status: string; priority: string }[] }
  | { kind: "permission"; id: string; title: string; options: PermissionOption[]; answer?: string }
  | { kind: "notice"; id: string; level: "info" | "error"; text: string };

export type Connection = {
  state: ConnectionState; agentId: string; message?: string; authMethods?: AuthMethod[];
  agentInfo?: { name?: string; title?: string; version?: string } | null;
};

export type ChatState = { items: ChatItem[]; turn: "idle" | "running"; connection?: Connection; nextId: number };

/** Events the UI adds on its own, next to the agent's. */
export type ChatEvent = AgentEvent | { type: "user"; text: string; selection?: string } | { type: "answered"; requestId: string; optionId: string | null };

export const initialChat = (): ChatState => ({ items: [], turn: "idle", nextId: 1 });

const textOf = (block: any): string => (block?.type === "text" ? String(block.text ?? "") : "");

function toolContent(content: any[] | undefined): string[] | undefined {
  if (!Array.isArray(content)) return undefined;
  return content.flatMap((c) => {
    if (c?.type === "diff") return [`Edited ${c.path}`];
    if (c?.type === "content") return textOf(c.content) ? [textOf(c.content)] : [];
    if (c?.type === "terminal") return [`Terminal ${c.terminalId}`];
    return [];
  });
}

function notice(s: ChatState, level: "info" | "error", text: string): ChatState {
  return { ...s, items: [...s.items, { kind: "notice", id: `n${s.nextId}`, level, text }], nextId: s.nextId + 1 };
}

function applyUpdate(s: ChatState, u: any): ChatState {
  switch (u?.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const kind = u.sessionUpdate === "agent_message_chunk" ? "agent" : "thought";
      const text = textOf(u.content);
      const last = s.items.at(-1);
      if (last && last.kind === kind && last.messageId === u.messageId) {
        return { ...s, items: [...s.items.slice(0, -1), { ...last, text: last.text + text }] };
      }
      return { ...s, items: [...s.items, { kind, id: `m${s.nextId}`, text, messageId: u.messageId }], nextId: s.nextId + 1 };
    }
    case "tool_call":
    case "tool_call_update": {
      const i = s.items.findIndex((x) => x.kind === "tool" && x.id === u.toolCallId);
      const prev = i >= 0 ? (s.items[i] as Extract<ChatItem, { kind: "tool" }>) : undefined;
      const item: ChatItem = {
        kind: "tool",
        id: u.toolCallId,
        title: u.title ?? prev?.title ?? "Tool call",
        toolKind: u.kind ?? prev?.toolKind ?? "other",
        status: u.status ?? prev?.status ?? "pending",
        locations: Array.isArray(u.locations) ? u.locations.map((l: any) => String(l.path)) : (prev?.locations ?? []),
        content: toolContent(u.content) ?? prev?.content ?? [],
      };
      if (i < 0) return { ...s, items: [...s.items, item] };
      return { ...s, items: s.items.map((x, j) => (j === i ? item : x)) };
    }
    case "plan": {
      const entries = (u.entries ?? []).map((e: any) => ({ content: String(e.content ?? ""), status: String(e.status ?? "pending"), priority: String(e.priority ?? "medium") }));
      const items = s.items.filter((x) => x.kind !== "plan");
      return { ...s, items: [...items, { kind: "plan", id: "plan", entries }] };
    }
    default:
      return s;
  }
}

/** Folds one event into the chat. Pure, so the UI is a function of the event log. */
export function applyEvent(s: ChatState, e: ChatEvent): ChatState {
  switch (e.type) {
    case "update":
      return applyUpdate(s, e.update);
    case "user":
      return { ...s, items: [...s.items, { kind: "user", id: `u${s.nextId}`, text: e.text, selection: e.selection }], nextId: s.nextId + 1 };
    case "permission":
      return {
        ...s,
        items: [...s.items, { kind: "permission", id: e.requestId, title: e.toolCall?.title ?? "The agent asks for permission", options: e.options }],
      };
    case "answered":
      return { ...s, items: s.items.map((x) => (x.kind === "permission" && x.id === e.requestId ? { ...x, answer: e.optionId ?? "cancelled" } : x)) };
    case "turn": {
      if (e.state === "started") return { ...s, turn: "running" };
      const items = s.items.map((x) => (x.kind === "permission" && x.answer === undefined ? { ...x, answer: "cancelled" } : x));
      const ended = { ...s, items, turn: "idle" as const };
      return e.error ? notice(ended, "error", e.error) : ended;
    }
    case "status": {
      const { type: _, ...connection } = e;
      const next = { ...s, connection, turn: e.state === "ready" || e.state === "connecting" ? s.turn : ("idle" as const) };
      if (e.state === "error" || e.state === "exited") return notice(next, "error", e.message ?? `The agent ${e.state === "exited" ? "exited" : "failed"}`);
      return next;
    }
  }
}

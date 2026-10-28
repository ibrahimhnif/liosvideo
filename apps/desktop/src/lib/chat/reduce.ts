import type { AgentEvent, AuthMethod, ConfigOption, ConnectionState, PermissionOption } from "./api";

export type AttachedImage = {
  dataUrl?: string;
  relPath: string;
  filename: string;
  data?: string;
  mimeType: string;
};

export type ChatItem =
  | { kind: "user"; id: string; text: string; selection?: string; images?: AttachedImage[] }
  | { kind: "agent"; id: string; text: string; messageId?: string }
  | { kind: "thought"; id: string; text: string; messageId?: string }
  | { kind: "tool"; id: string; toolCallId: string; gen: number; title: string; toolKind: string; status: string; locations: string[]; content: string[] }
  | { kind: "plan"; id: string; entries: { content: string; status: string; priority: string }[] }
  | { kind: "permission"; id: string; requestId: string; gen: number; title: string; options: PermissionOption[]; answer?: string; autoApproved?: boolean }
  | { kind: "asset"; id: string; requestId: string; assetId: string; assetKind: string; description: string; answer?: "provided" | "skipped" | "cancelled"; filePath?: string }
  | { kind: "voice"; id: string; lineId: string; text?: string; audioPath?: string }
  | { kind: "notice"; id: string; level: "info" | "error"; text: string };

export type Connection = {
  state: ConnectionState; agentId: string; message?: string; authMethods?: AuthMethod[];
  agentInfo?: { name?: string; title?: string; version?: string } | null;
  configOptions?: ConfigOption[];
  models?: any;
};

/** `id` keys an item in the list and is never reused; agents' own ids (tool calls, permission
 * requests) restart with each connection, so they are matched within the current `gen` only. */
export type ChatState = { items: ChatItem[]; turn: "idle" | "running"; connection?: Connection; nextId: number; gen: number };

/** Events the UI adds on its own, next to the agent's. */
export type ChatEvent =
  | AgentEvent
  | { type: "user"; text: string; selection?: string; images?: AttachedImage[] }
  | { type: "answered"; requestId: string; optionId: string | null }
  | { type: "asset_resolved"; requestId: string; answer: "provided" | "skipped" | "cancelled"; filePath?: string };

export const initialChat = (): ChatState => ({ items: [], turn: "idle", nextId: 1, gen: 0 });

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

const cancelOpen = (items: ChatItem[]): ChatItem[] =>
  items.map((x) => {
    if (x.kind === "permission" && x.answer === undefined) return { ...x, answer: "cancelled" };
    if (x.kind === "asset" && x.answer === undefined) return { ...x, answer: "cancelled" };
    return x;
  });

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
      const i = s.items.findIndex((x) => x.kind === "tool" && x.toolCallId === u.toolCallId && x.gen === s.gen);
      const prev = i >= 0 ? (s.items[i] as Extract<ChatItem, { kind: "tool" }>) : undefined;
      const item: ChatItem = {
        kind: "tool",
        id: prev?.id ?? `k${s.nextId}`,
        toolCallId: u.toolCallId,
        gen: s.gen,
        title: u.title ?? prev?.title ?? "Tool call",
        toolKind: u.kind ?? prev?.toolKind ?? "other",
        status: u.status ?? prev?.status ?? "pending",
        locations: Array.isArray(u.locations) ? u.locations.map((l: any) => String(l.path)) : (prev?.locations ?? []),
        content: toolContent(u.content) ?? prev?.content ?? [],
      };
      if (i < 0) return { ...s, items: [...s.items, item], nextId: s.nextId + 1 };
      return { ...s, items: s.items.map((x, j) => (j === i ? item : x)) };
    }
    case "plan": {
      const entries = (u.entries ?? []).map((e: any) => ({ content: String(e.content ?? ""), status: String(e.status ?? "pending"), priority: String(e.priority ?? "medium") }));
      const items = s.items.filter((x) => x.kind !== "plan");
      return { ...s, items: [...items, { kind: "plan", id: "plan", entries }] };
    }
    case "config_option_update": {
      if (!s.connection?.configOptions) return s;
      const updated = s.connection.configOptions.map((opt) => {
        if (opt.id === u.configId || opt.id === u.configOption?.id) {
          return {
            ...opt,
            ...(u.configOption ?? {}),
            currentValue: u.value !== undefined ? u.value : (u.configOption?.currentValue ?? opt.currentValue),
          };
        }
        return opt;
      });
      return { ...s, connection: { ...s.connection, configOptions: updated } };
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
      return {
        ...s,
        items: [
          ...s.items,
          { kind: "user", id: `u${s.nextId}`, text: e.text, selection: e.selection, images: e.images },
        ],
        nextId: s.nextId + 1,
      };
    case "permission":
      return {
        ...s,
        items: [
          ...s.items,
          {
            kind: "permission",
            id: `k${s.nextId}`,
            requestId: e.requestId,
            gen: s.gen,
            title: e.toolCall?.title ?? "The agent asks for permission",
            options: e.options,
            answer: e.autoApproved && e.selectedOptionId ? e.selectedOptionId : undefined,
            autoApproved: e.autoApproved ?? false,
          },
        ],
        nextId: s.nextId + 1,
      };
    case "asset_request":
      return {
        ...s,
        items: [
          ...s.items,
          {
            kind: "asset",
            id: `a${s.nextId}`,
            requestId: e.requestId,
            assetId: e.id,
            assetKind: e.kind,
            description: e.description,
            answer: undefined,
          },
        ],
        nextId: s.nextId + 1,
      };
    case "asset_resolved":
      return {
        ...s,
        items: s.items.map((x) =>
          x.kind === "asset" && x.requestId === e.requestId
            ? { ...x, answer: e.answer, filePath: e.filePath }
            : x,
        ),
      };
    case "answered":
      return { ...s, items: s.items.map((x) => (x.kind === "permission" && x.requestId === e.requestId && x.gen === s.gen ? { ...x, answer: e.optionId ?? "cancelled" } : x)) };
    case "turn": {
      if (e.state === "started") return { ...s, turn: "running" };
      const ended = { ...s, items: cancelOpen(s.items), turn: "idle" as const };
      return e.error ? notice(ended, "error", e.error) : ended;
    }
    case "status": {
      const { type: _, ...connection } = e;
      // a new connection: the agent's ids start over and old permission requests can't be answered
      const fresh = e.state === "connecting" ? { ...s, items: cancelOpen(s.items), gen: s.gen + 1 } : s;
      const next = { ...fresh, connection, turn: e.state === "ready" || e.state === "connecting" ? fresh.turn : ("idle" as const) };
      if (e.state === "error" || e.state === "exited") return notice(next, "error", e.message ?? `The agent ${e.state === "exited" ? "exited" : "failed"}`);
      return next;
    }
  }
}

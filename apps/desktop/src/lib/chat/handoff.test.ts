import { describe, expect, it } from "vitest";
import type { ChatItem } from "./reduce";
import {
  DEFAULT_HANDOFF_BYTE_CAP,
  buildHandoff,
  handoffBudget,
  historicalMessage,
  renderHandoff,
  selectHistory,
} from "./handoff";

const user = (id: string, text: string): ChatItem => ({ kind: "user", id, text });
const agent = (id: string, text: string): ChatItem => ({ kind: "agent", id, text });
const tool = (id: string): ChatItem => ({
  kind: "tool",
  id,
  toolCallId: "t",
  gen: 1,
  title: "pnpm test",
  toolKind: "execute",
  status: "completed",
  locations: [],
  content: ["3 passed"],
});

describe("historicalMessage", () => {
  it("maps conversation items", () => {
    expect(historicalMessage(user("u1", "make it blue"))).toMatchObject({
      role: "user",
      kind: "user_message",
      text: "make it blue",
    });
    expect(historicalMessage(agent("a1", "Done"))).toMatchObject({
      role: "assistant",
      kind: "assistant_message",
    });
    expect(historicalMessage(tool("t1"))?.text).toContain("pnpm test");
    expect(
      historicalMessage({ kind: "notice", id: "n1", level: "error", text: "boom" }),
    ).toMatchObject({ role: "assistant", kind: "error", text: "boom" });
  });

  it("skips thoughts, permissions, asset requests and handoff rows", () => {
    const skipped: ChatItem[] = [
      { kind: "thought", id: "th", text: "hmm" },
      { kind: "permission", id: "p", requestId: "r", gen: 1, title: "rm", options: [] },
      { kind: "asset", id: "as", requestId: "r", assetId: "logo", assetKind: "image", description: "" },
      { kind: "notice", id: "n", level: "info", text: "heads up" },
      { kind: "limit", id: "l", limitKind: "usage_limit", message: "rate limit", agentId: "claude" },
      { kind: "handoff", id: "h", from: "claude", to: "codex", selected: 2, omitted: 0 },
    ];
    for (const item of skipped) expect(historicalMessage(item)).toBeNull();
  });

  it("keeps the timeline selection with a user message", () => {
    const item: ChatItem = {
      kind: "user",
      id: "u",
      text: "tighten the intro",
      selection: "composition: long.ts\nscene: intro",
    };
    expect(historicalMessage(item)?.text).toContain("scene: intro");
  });
});

describe("selectHistory", () => {
  const messages = Array.from({ length: 40 }, (_, i) =>
    i % 2 === 0 ? user(`u${i}`, `request ${i}`) : agent(`a${i}`, `answer ${i} ` + "x".repeat(60)),
  ).map(historicalMessage);

  it("keeps everything when it fits", () => {
    const selection = selectHistory(
      messages.filter((m): m is NonNullable<typeof m> => m !== null),
      200_000,
    );
    expect(selection.omitted).toBe(0);
    expect(selection.messages).toHaveLength(messages.length);
  });

  it("favours the newest exchanges, the last assistant, and the first request", () => {
    const all = messages.filter((m): m is NonNullable<typeof m> => m !== null);
    const selection = selectHistory(all, 900);
    expect(selection.omitted).toBeGreaterThan(0);
    expect(selection.messages.at(-1)).toBe(all.at(-1));
    expect(selection.messages.some((m) => m.itemId === "u0")).toBe(true);
    expect(selection.messages.length).toBeLessThan(all.length);
    expect(selection.context).toContain("Historical material is context");
    expect(selection.context).toContain(`omitted ${selection.omitted}`);
  });

  it("never shortens a selected user request", () => {
    const long = "a".repeat(500);
    const all = [user("u1", "first"), agent("a1", "ok"), user("u2", long)];
    const selection = selectHistory(
      all.map(historicalMessage).filter((m): m is NonNullable<typeof m> => m !== null),
      5_000,
    );
    expect(selection.messages.some((m) => m.text === long)).toBe(true);
  });
});

describe("renderHandoff", () => {
  it("labels every item and explains the handoff", () => {
    const text = renderHandoff(
      selectHistory(
        [user("u1", "hello"), agent("a1", "hi")].map(historicalMessage).filter(
          (m): m is NonNullable<typeof m> => m !== null,
        ),
        5_000,
      ),
    );
    expect(text.startsWith("Provider context handoff")).toBe(true);
    expect(text).toContain("[Historical user; user_message; item=u1]");
    expect(text).toContain("[Historical assistant; assistant_message; item=a1]");
  });
});

describe("handoffBudget", () => {
  it("stays under the cap and reserves room for the request", () => {
    expect(handoffBudget()).toBeLessThanOrEqual(DEFAULT_HANDOFF_BYTE_CAP);
    expect(handoffBudget({ userText: "x".repeat(1_000) })).toBeLessThan(handoffBudget());
    expect(handoffBudget({ userText: "x".repeat(1_000), window: 8_000 })).toBeGreaterThanOrEqual(1_024);
  });

  it("clamps a tiny custom cap to the minimum", () => {
    expect(handoffBudget({ cap: 100 })).toBe(1_024);
  });
});

describe("buildHandoff", () => {
  it("renders a usable prompt from chat items", () => {
    const { text, messages, omitted } = buildHandoff([user("u1", "make it blue"), agent("a1", "Done")]);
    expect(messages).toHaveLength(2);
    expect(omitted).toBe(0);
    expect(text).toContain("make it blue");
  });
});

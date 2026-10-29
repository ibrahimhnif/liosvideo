import { vi } from "vitest";
import type { AgentApi, AgentEvent, AgentSettings, AgentStatus } from "./api";

/** An AgentApi for component tests: records calls, lets the test push events. */
export function fakeAgentApi(agents: AgentStatus[] = []) {
  let handler: ((e: AgentEvent) => void) | undefined;
  const settings: AgentSettings = { projectAgents: {}, custom: [] };
  const api = {
    listAgents: vi.fn(async () => agents),
    rescan: vi.fn(async () => agents),
    install: vi.fn(async (_id: string, onLine: (l: string) => void) => {
      onLine("fetching adapter");
      onLine("added 12 packages");
    }),
    settings: vi.fn(async () => settings),
    setDefault: vi.fn(async (id: string) => ({ ...settings, defaultAgent: id })),
    setProjectAgent: vi.fn(async () => settings),
    addCustom: vi.fn(async () => settings),
    removeCustom: vi.fn(async () => settings),
    connect: vi.fn(async () => {}),
    authenticate: vi.fn(async () => {}),
    prompt: vi.fn(async () => "end_turn"),
    cancel: vi.fn(async () => {}),
    respond: vi.fn(async () => {}),
    resolveAssetRequest: vi.fn(async () => {}),
    setConfigOption: vi.fn(async () => {}),
    setAutoApprove: vi.fn(async () => {}),
    getAutoApprove: vi.fn(async () => false),
    loadConversation: vi.fn(async (_root?: string): Promise<string | null> => null),
    saveConversation: vi.fn(async (_content: string, _root?: string) => {}),
    saveImageAsset: vi.fn(async (name: string) => ({ relPath: `assets/images/${name}`, filename: name })),
    getProjectStats: vi.fn(async (_root?: string) => ({
      tts: { totalCharacters: 0, totalCostUsd: 0, items: [] },
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCostUsd: 0 },
      totalCostUsd: 0,
    })),
    recordTokenUsage: vi.fn(async () => ({
      tts: { totalCharacters: 0, totalCostUsd: 0, items: [] },
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCostUsd: 0 },
      totalCostUsd: 0,
    })),
    openTerminal: vi.fn(async () => {}),
    on: (h: (e: AgentEvent) => void) => {
      handler = h;
      return () => (handler = undefined);
    },
  } satisfies AgentApi;
  return { api, emit: (e: AgentEvent) => handler?.(e) };
}

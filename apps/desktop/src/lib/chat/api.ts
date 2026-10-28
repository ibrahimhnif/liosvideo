import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CommitInfo } from "$lib/history/api";

export type AgentStatusState = "ready" | "enable" | "not_installed";
export type AgentStatus = {
  id: string; name: string; state: AgentStatusState; binary?: string; version?: string;
  installUrl?: string; authNote?: string; custom: boolean;
};
export type CustomAgent = { id: string; name: string; command: string; args: string[]; env: Record<string, string> };
export type AgentSettings = { defaultAgent?: string; projectAgents: Record<string, string>; custom: CustomAgent[] };

export type AuthMethod = { id: string; name: string; description?: string | null };
export type PermissionOption = { optionId: string; name: string; kind: string };
export type TtsItemStat = {
  lineId: string;
  provider: string;
  voice: string;
  characters: number;
  costUsd: number;
  timestamp: number;
};

export type TtsStats = {
  totalCharacters: number;
  totalCostUsd: number;
  items: TtsItemStat[];
};

export type TokenStats = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
};

export type ProjectStats = {
  tts: TtsStats;
  tokens: TokenStats;
  totalCostUsd: number;
};

export type ConnectionState = "connecting" | "ready" | "auth_required" | "error" | "exited";

/** Mirrors the Rust `SelectionContext`. */
export type SelectionContext = {
  composition: string; sceneId: string; sceneFile?: string; path?: string;
  startFrame: number; endFrame: number; fps: number; playheadFrame?: number;
};

export type ImageInput = {
  data: string;
  mimeType: string;
  relPath?: string;
};

export type ConfigOptionValue = { value: string; name?: string; description?: string };
export type ConfigOption = {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: any;
  options?: ConfigOptionValue[];
};

export type AgentEvent =
  | {
      type: "status";
      state: ConnectionState;
      agentId: string;
      message?: string;
      authMethods?: AuthMethod[];
      agentInfo?: { name?: string; title?: string; version?: string } | null;
      configOptions?: ConfigOption[];
      models?: any;
    }
  | { type: "update"; update: any }
  | { type: "permission"; requestId: string; toolCall: any; options: PermissionOption[]; autoApproved?: boolean; selectedOptionId?: string }
  | { type: "asset_request"; requestId: string; id: string; kind: string; description: string }
  | { type: "turn"; state: "started" | "ended"; stopReason?: string; error?: string; commit?: CommitInfo | null };

export interface AgentApi {
  listAgents(): Promise<AgentStatus[]>;
  rescan(): Promise<AgentStatus[]>;
  /** Installs an adapter; `onLine` receives npm's output as it streams. */
  install(id: string, onLine: (line: string) => void): Promise<void>;
  settings(): Promise<AgentSettings>;
  setDefault(id: string): Promise<AgentSettings>;
  setProjectAgent(id: string): Promise<AgentSettings>;
  addCustom(agent: CustomAgent): Promise<AgentSettings>;
  removeCustom(id: string): Promise<AgentSettings>;
  connect(id?: string): Promise<void>;
  authenticate(methodId: string): Promise<void>;
  prompt(text: string, selection?: SelectionContext, images?: ImageInput[]): Promise<string>;
  cancel(): Promise<void>;
  respond(requestId: string, optionId: string | null): Promise<void>;
  resolveAssetRequest(requestId: string, filePath?: string | null): Promise<void>;
  setConfigOption(configId: string, value: any): Promise<void>;
  setAutoApprove(enabled: boolean): Promise<void>;
  getAutoApprove(): Promise<boolean>;
  loadConversation(root?: string): Promise<string | null>;
  saveConversation(content: string, root?: string): Promise<void>;
  saveImageAsset(name: string, base64Data: string): Promise<{ relPath: string; filename: string }>;
  getProjectStats(root?: string): Promise<ProjectStats>;
  recordTokenUsage(inputTokens: number, outputTokens: number, model?: string): Promise<ProjectStats>;
  /** Subscribes to agent events; returns an unsubscribe function. */
  on(handler: (e: AgentEvent) => void): () => void;
}

export const tauriAgentApi: AgentApi = {
  listAgents: () => invoke("list_agents"),
  rescan: () => invoke("rescan_agents"),
  async install(id, onLine) {
    const off = await listen<{ id: string; line?: string }>("agents://install", (e) => {
      if (e.payload.id === id && e.payload.line != null) onLine(e.payload.line);
    });
    try {
      await invoke("install_agent_adapter", { id });
    } finally {
      off();
    }
  },
  settings: () => invoke("get_agent_settings"),
  setDefault: (id) => invoke("set_default_agent", { id }),
  setProjectAgent: (id) => invoke("set_project_agent", { id }),
  addCustom: (agent) => invoke("add_custom_agent", { agent }),
  removeCustom: (id) => invoke("remove_custom_agent", { id }),
  connect: (id) => invoke("agent_connect", { agentId: id ?? null }),
  authenticate: (methodId) => invoke("agent_authenticate", { methodId }),
  prompt: (text, selection, images) =>
    invoke("agent_prompt", { text, selection: selection ?? null, images: images ?? null }),
  cancel: () => invoke("agent_cancel"),
  respond: (requestId, optionId) => invoke("agent_permission_respond", { requestId, optionId }),
  resolveAssetRequest: (requestId, filePath) =>
    invoke("resolve_asset_request", { requestId, filePath: filePath ?? null }),
  setConfigOption: (configId, value) => invoke("agent_set_config_option", { configId, value }),
  setAutoApprove: (enabled) => invoke("agent_set_auto_approve", { enabled }),
  getAutoApprove: () => invoke<boolean>("agent_get_auto_approve"),
  loadConversation: (root) => invoke<string | null>("load_conversation", { root: root ?? null }),
  saveConversation: (content, root) => invoke("save_conversation", { content, root: root ?? null }),
  saveImageAsset: (name, base64Data) =>
    invoke<{ relPath: string; filename: string }>("save_image_asset", { name, base64Data }),
  getProjectStats: (root) => invoke<ProjectStats>("get_project_stats", { root: root ?? null }),
  recordTokenUsage: (inputTokens, outputTokens, model) =>
    invoke<ProjectStats>("record_token_usage", { inputTokens, outputTokens, model }),
  on(handler) {
    const offs = (["status", "update", "permission", "turn", "asset_request"] as const).map((type) =>
      listen<any>(`agent://${type}`, (e) => handler({ type, ...e.payload })),
    );
    return () => offs.forEach((off) => void off.then((f) => f()));
  },
};

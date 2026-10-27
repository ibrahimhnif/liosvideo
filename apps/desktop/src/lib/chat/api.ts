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
export type ConnectionState = "connecting" | "ready" | "auth_required" | "error" | "exited";

/** Mirrors the Rust `SelectionContext`. */
export type SelectionContext = {
  composition: string; sceneId: string; sceneFile?: string; path?: string;
  startFrame: number; endFrame: number; fps: number; playheadFrame?: number;
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
  | { type: "permission"; requestId: string; toolCall: any; options: PermissionOption[] }
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
  prompt(text: string, selection?: SelectionContext): Promise<string>;
  cancel(): Promise<void>;
  respond(requestId: string, optionId: string | null): Promise<void>;
  setConfigOption(configId: string, value: any): Promise<void>;
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
  prompt: (text, selection) => invoke("agent_prompt", { text, selection: selection ?? null }),
  cancel: () => invoke("agent_cancel"),
  respond: (requestId, optionId) => invoke("agent_permission_respond", { requestId, optionId }),
  setConfigOption: (configId, value) => invoke("agent_set_config_option", { configId, value }),
  on(handler) {
    const offs = (["status", "update", "permission", "turn"] as const).map((type) =>
      listen<any>(`agent://${type}`, (e) => handler({ type, ...e.payload })),
    );
    return () => offs.forEach((off) => void off.then((f) => f()));
  },
};

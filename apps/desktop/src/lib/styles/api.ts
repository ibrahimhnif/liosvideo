import { invoke } from "@tauri-apps/api/core";

/** One of the animation styles (`STYLES` in scaffold.rs). */
export type StyleInfo = { id: string; title: string };

/** The styles, in catalog order. */
export const listStyles = (): Promise<StyleInfo[]> => invoke<StyleInfo[]>("list_styles");

/** Installs a style's module and doc into the open project; returns the paths written. */
export const installStyle = (id: string): Promise<string[]> => invoke<string[]>("install_style", { id });

/** The chat prompt that asks the agent to restyle the selection (or the whole video). */
export function stylePrompt(title: string, id: string, selectionLabel?: string): string {
  return `Restyle ${selectionLabel ?? "this video"} in the ${title} style — follow .agents/skills/liosvideo/styles/${id}.md and use styles/${id}.ts.`;
}

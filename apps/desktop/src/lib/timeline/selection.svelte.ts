import type { Selection } from "./model";

/** The current timeline selection, shared by the timeline, the preview and the chat pane. */
export const selection = $state<{ current: Selection | undefined }>({ current: undefined });

export function select(s: Selection | undefined): void {
  selection.current = s;
}

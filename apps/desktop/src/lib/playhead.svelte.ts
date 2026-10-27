/** The frame the preview is showing, shared with the chat pane for selection context. */
export const playhead = $state<{ frame: number; fps: number }>({ frame: 0, fps: 30 });

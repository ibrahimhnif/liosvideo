# Timeline verification — 2026-10-27

`tauri dev` with the sample project (`LIOSVIDEO_PROJECT`). Dev log of the manifest rows that reach the timeline (scenes expanded):

```
timeline long.ts intro |   title |   subtitle |   underline | focus-demo |   desktop | outro |   thanks
```

Clicking and selecting aren't driven here (no UI automation permission). They are covered by the `Timeline.browser.test.ts` component tests (select scene, expand, select a child bar, empty state) and the model tests (rename fallback, clamping, collapsed large trees).

# Foundation verification — 2026-10-27

App run with `LIOSVIDEO_PROJECT=<copy of examples/php2shell-sample> LIOSVIDEO_SNAPSHOT_DIR=<dir> pnpm --filter desktop tauri dev`
(macOS 27.0.1, system WKWebView). Frames were checked from in-app PNG snapshots, because screen capture isn't permitted in this environment.

| Check | Result |
|---|---|
| `long.ts` renders (1920×1080, 330 frames) | ✅ intro, focus-demo, outro frames correct |
| `short.ts` renders (1080×1920, 270 frames), aspect changes | ✅ switched by removing `long.ts`, which also exercises root-file refresh |
| Seek directly vs play-to gives identical pixels | ✅ GPU test `renders a frame identically whether seeked directly or played up to` |
| Focus swap animates with visible blur | ✅ front window sharp/raised, back window lower, dimmed, blurred; reverses at 3.5 s |
| Edit `scenes/focus-demo.ts` → visible ≤ 2 s | ✅ 307 ms from file write to re-rendered frame |
| Syntax error → overlay with file:line, last frame kept | ✅ `scenes/outro.ts:3:12 Unexpected ";"`; fixing it reloads |
| `while(true){}` → "Scene code timed out", recovers | ⚠️ timeout + recovery work, but fired after ~22 s, not 5 s. The window was hidden (`document.hidden = true`) and WebKit throttles long timers on hidden pages (a plain 5 s timer fired on time, a 15 s one never fired). Re-check with the window visible. The 5 s logic is covered by the fake-timer unit test. |

Found and fixed during verification: anchored text wasn't centered because text nodes had no size. Fixed with `setTextMeasurer` (Canvas2D in the worker).

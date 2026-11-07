# UI mockups

One scene per UI mockup component, in 16:9 (`long.ts`) and 9:16 (`short.ts`):

| Scene | Component |
| :--- | :--- |
| `scenes/browser.ts` | `browserWindow({ url, tabs, content, theme })`, `.typeUrl()`, `.switchTab()` |
| `scenes/explorer.ts` | `fileExplorer({ items, selected, title, theme })`, `.select()` |
| `scenes/chat.ts` | `chatThread({ messages, reveal, typing, theme })`, `.times` |
| `scenes/notification.ts` | `notification({ app, title, body, variant })`, `.show()` |

```bash
liosvideo contact-sheet long.ts --every 1s --cols 6 -o out/long.png
liosvideo contact-sheet short.ts --every 1s --cols 8 -o out/short.png
```

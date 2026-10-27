# Realistic Mockups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build realistic macOS mockup components (`desktop`, `chrome`, `terminal`, `editor`, `cursor`, and `focus()`) in `@liosvideo/runtime` so AI agents can write technical walkthrough scenes that look identical to real macOS screenshots.

**Architecture:** Each mockup component extends the existing `Node` / `GroupNode` scene graph in `@liosvideo/runtime`, constructing hierarchical sub-nodes (`titleBar`, `trafficLights`, `tabs`, `urlbar`, `buffer`, `cursor`) with deterministic property animations (`.set()`, `.to()`) and stable hierarchical paths for timeline selection and ACP targeted revisions.

**Tech Stack:** TypeScript, `@liosvideo/runtime` scene graph (`GroupNode`, `RectNode`, `TextNode`, `ImageNode`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-liosvideo-design.md` (Sections 9.1 & 9.2).

## Global Constraints

- Must run deterministically: rendering is a pure function of (composition, frame).
- Must compose directly with existing `Node` tree and evaluate cleanly in `evaluateFrame`.
- Window corner radius: 10px on macOS, with rounded clipping for window contents.
- Traffic lights standard colors: Close `#ff5f56`, Minimize `#ffbd2e`, Maximize `#27c93f`.
- Text nodes must default to system font families: `SF Pro Display`, `SF Pro Text`, `SF Mono`, `Menlo`.
- All methods must support keyframe animation (`at`, `duration`, `ease`).

---

### Task 1: Base Window Container & Traffic Lights

**Files:**
- Create: `packages/runtime/src/mockups/window.ts`
- Create: `packages/runtime/test/mockups/window.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces:
  - `WindowNode`: Extends `GroupNode`. Props: `title?: string`, `width?: number`, `height?: number`, `theme?: "dark" | "light"`.
  - Properties & Children:
    - `frame`: `RectNode` for window background and shadow.
    - `titleBar`: `RectNode` for title bar header.
    - `trafficLights`: `GroupNode` containing `closeBtn`, `minBtn`, `maxBtn` (`RectNode` with radius 6).
    - `titleText`: `TextNode` for window title.
    - `contentArea`: `GroupNode` with `clip: true` for window body content.

- [x] **Step 1: Write failing unit test for `WindowNode`**

Create `packages/runtime/test/mockups/window.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { WindowNode } from "../../src/mockups/window";

describe("WindowNode", () => {
  it("creates window hierarchy with title bar, traffic lights and content area", () => {
    const win = new WindowNode({ title: "My Window", width: 800, height: 600 });
    expect(win.width).toBe(800);
    expect(win.height).toBe(600);
    expect(win.titleBar).toBeDefined();
    expect(win.trafficLights).toBeDefined();
    expect(win.titleText.propsAt(0).text).toBe("My Window");
    expect(win.contentArea).toBeDefined();
    expect(win.contentArea.propsAt(0).clip).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test test/mockups/window.test.ts`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `WindowNode`**

Create `packages/runtime/src/mockups/window.ts` with:
- Standard macOS styling (light/dark colors, 10px radius, 38px titlebar height, 12px traffic light buttons spaced 8px apart starting at x=12, y=13).
- Expose `contentArea` for adding child nodes.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test test/mockups/window.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/runtime/src/mockups/window.ts packages/runtime/test/mockups/window.test.ts
git commit -m "feat(runtime): base macOS WindowNode with titlebar and traffic lights"
```

---

### Task 2: Desktop Environment Component

**Files:**
- Create: `packages/runtime/src/mockups/desktop.ts`
- Create: `packages/runtime/test/mockups/desktop.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces:
  - `DesktopNode`: Extends `GroupNode`.
  - `desktop(init?: DesktopInit): DesktopNode`
  - Elements:
    - Wallpaper background: `RectNode` (gradient default) or `ImageNode` (if `wallpaper` path provided).
    - Menu bar: `RectNode` (height 28px) with Apple icon ``, active app menu title, system status/clock.
    - Windows root container: `GroupNode`.
    - Methods: `.add(node)`, `.window(...)`.

- [x] **Step 1: Write failing unit test for `DesktopNode`**

Create `packages/runtime/test/mockups/desktop.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { desktop, DesktopNode } from "../../src/mockups/desktop";
import { WindowNode } from "../../src/mockups/window";

describe("desktop", () => {
  it("creates desktop with wallpaper, menu bar, and windows container", () => {
    const d = desktop({ width: 1920, height: 1080 });
    expect(d).toBeInstanceOf(DesktopNode);
    expect(d.width).toBe(1920);
    expect(d.height).toBe(1080);
    expect(d.menuBar).toBeDefined();
    expect(d.wallpaper).toBeDefined();

    const win = d.add(new WindowNode({ title: "Test", width: 600, height: 400 }));
    expect(win.parent).toBe(d);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test test/mockups/desktop.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `DesktopNode` and `desktop()` helper**

Create `packages/runtime/src/mockups/desktop.ts`.
- Support Monterey/Sonoma dark wallpaper styling.
- Menu bar with translucent blur and clock.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test test/mockups/desktop.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/runtime/src/mockups/desktop.ts packages/runtime/test/mockups/desktop.test.ts
git commit -m "feat(runtime): desktop mockup with wallpaper and menu bar"
```

---

### Task 3: Realistic Terminal Component

**Files:**
- Create: `packages/runtime/src/mockups/terminal.ts`
- Create: `packages/runtime/test/mockups/terminal.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces:
  - `TerminalNode`: Extends `WindowNode`.
  - `terminal(init?: TerminalInit): TerminalNode`
  - Elements & Methods:
    - Prompt text (e.g. `user@macbook ~/projects %`).
    - Buffer lines: manages lines of terminal text with monospace font (`SF Mono, Menlo, monospace`).
    - Cursor: `RectNode` for block cursor.
    - `.type(cmd: string, opts: { at: number; duration: number }): this`: Animates typing characters with natural keystroke timing.
    - `.writeln(text: string, at: number): this`: Appends an output line at time `at`.
    - `.clear(at: number): this`: Clears the terminal screen at time `at`.

- [x] **Step 1: Write failing unit test for `TerminalNode`**

Create `packages/runtime/test/mockups/terminal.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { terminal, TerminalNode } from "../../src/mockups/terminal";

describe("terminal", () => {
  it("creates a terminal with shell prompt and typing animation", () => {
    const term = terminal({ cwd: "~/projects", width: 800, height: 500 });
    expect(term).toBeInstanceOf(TerminalNode);
    expect(term.promptText).toContain("~/projects");

    term.type("npm install", { at: 1.0, duration: 1.0 });
    term.writeln("added 14 packages in 1s", 2.0);

    const mid = term.propsAtTime(1.5);
    expect(mid.text).toContain("npm");
    const end = term.propsAtTime(2.5);
    expect(end.text).toContain("added 14 packages");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test test/mockups/terminal.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `TerminalNode` and `terminal()`**

Create `packages/runtime/src/mockups/terminal.ts` with typing interpolation and text buffer rendering.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test test/mockups/terminal.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/runtime/src/mockups/terminal.ts packages/runtime/test/mockups/terminal.test.ts
git commit -m "feat(runtime): realistic terminal mockup with command typing and buffer output"
```

---

### Task 4: Chrome Browser Component

**Files:**
- Create: `packages/runtime/src/mockups/chrome.ts`
- Create: `packages/runtime/test/mockups/chrome.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces:
  - `ChromeNode`: Extends `WindowNode`.
  - `chrome(init?: ChromeInit): ChromeNode`
  - Elements:
    - Tab bar with active tab and new tab icon `+`.
    - Navigation toolbar: back/forward buttons, refresh button, omnibox / URL bar.
    - Omnibox object with `.type(url: string, opts: { at: number; duration: number })`.
    - Page content area: slot for rendering page mockups, screenshots (`ImageNode`), or child nodes.

- [x] **Step 1: Write failing unit test for `ChromeNode`**

Create `packages/runtime/test/mockups/chrome.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { chrome, ChromeNode } from "../../src/mockups/chrome";

describe("chrome", () => {
  it("creates a Chrome browser with tab strip and omnibox typing", () => {
    const web = chrome({ url: "https://example.com", title: "Example Domain" });
    expect(web).toBeInstanceOf(ChromeNode);
    expect(web.tabTitle.propsAt(0).text).toBe("Example Domain");

    web.urlbar.type("https://github.com", { at: 1.0, duration: 1.0 });
    const mid = web.urlbar.textAt(1.5);
    expect(mid.length).toBeGreaterThan(0);
    expect(web.urlbar.textAt(2.0)).toBe("https://github.com");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test test/mockups/chrome.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `ChromeNode` and `chrome()`**

Create `packages/runtime/src/mockups/chrome.ts`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test test/mockups/chrome.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/runtime/src/mockups/chrome.ts packages/runtime/test/mockups/chrome.test.ts
git commit -m "feat(runtime): chrome browser mockup with tabs and omnibox typing"
```

---

### Task 5: Code Editor Component

**Files:**
- Create: `packages/runtime/src/mockups/editor.ts`
- Create: `packages/runtime/test/mockups/editor.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces:
  - `EditorNode`: Extends `WindowNode`.
  - `editor(init?: EditorInit): EditorNode`
  - Elements:
    - Tab bar showing filename (e.g. `index.ts`) with code icon.
    - Sidebar or line numbers gutter.
    - Code editor text buffer with syntax color tokens.
    - Methods:
      - `.typeCode(code: string, opts: { at: number; duration: number }): this`
      - `.highlightLine(line: number, opts: { at: number; duration?: number }): this`

- [x] **Step 1: Write failing unit test for `EditorNode`**

Create `packages/runtime/test/mockups/editor.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { editor, EditorNode } from "../../src/mockups/editor";

describe("editor", () => {
  it("creates a code editor with tabs, line numbers and highlight", () => {
    const ed = editor({ filename: "server.ts", code: "const app = express();", width: 900, height: 600 });
    expect(ed).toBeInstanceOf(EditorNode);
    expect(ed.tabTitle.propsAt(0).text).toBe("server.ts");

    ed.highlightLine(1, { at: 1.0 });
    expect(ed.isLineHighlighted(1, 1.0)).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test test/mockups/editor.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `EditorNode` and `editor()`**

Create `packages/runtime/src/mockups/editor.ts`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test test/mockups/editor.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/runtime/src/mockups/editor.ts packages/runtime/test/mockups/editor.test.ts
git commit -m "feat(runtime): code editor mockup with tabs, line numbers and highlighting"
```

---

### Task 6: Cursor & Focus Helper Animation

**Files:**
- Create: `packages/runtime/src/mockups/cursor.ts`
- Create: `packages/runtime/src/mockups/focus.ts`
- Create: `packages/runtime/test/mockups/cursor_focus.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces:
  - `CursorNode`: Extends `GroupNode`.
  - `cursor(init?: CursorInit): CursorNode`
    - Methods: `.moveTo(x: number, y: number, opts: { at: number; duration: number; ease?: Ease })`, `.click(opts: { at: number })`.
  - `focus(node: Node, opts: { at: number; duration?: number; scale?: number; dimOthers?: number; blurOthers?: number })`:
    - Brings `node` to front (`z`), scales up to `scale` (default 1.02), sharpens (`blur: 0`).
    - Dims and blurs sibling windows on the same desktop.

- [x] **Step 1: Write failing unit test for `cursor` and `focus`**

Create `packages/runtime/test/mockups/cursor_focus.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { cursor, CursorNode } from "../../src/mockups/cursor";
import { focus } from "../../src/mockups/focus";
import { desktop } from "../../src/mockups/desktop";
import { WindowNode } from "../../src/mockups/window";

describe("cursor & focus", () => {
  it("animates cursor movement and click", () => {
    const c = cursor({ x: 100, y: 100 });
    expect(c).toBeInstanceOf(CursorNode);
    c.moveTo(500, 300, { at: 1.0, duration: 1.0 });
    expect(c.propsAt(1.0).x).toBe(100);
    expect(c.propsAt(2.0).x).toBe(500);
  });

  it("focuses a window while dimming and blurring siblings", () => {
    const d = desktop({ width: 1920, height: 1080 });
    const win1 = d.add(new WindowNode({ title: "Win 1", width: 600, height: 400 }));
    const win2 = d.add(new WindowNode({ title: "Win 2", width: 600, height: 400 }));

    focus(win1, { at: 1.0, duration: 0.5 });
    expect(win1.propsAt(1.5).z).toBeGreaterThan(win2.propsAt(1.5).z);
    expect(win2.propsAt(1.5).opacity).toBeLessThan(1.0);
    expect(win2.propsAt(1.5).blur).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test test/mockups/cursor_focus.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `CursorNode`, `cursor()`, and `focus()`**

Create `packages/runtime/src/mockups/cursor.ts` and `packages/runtime/src/mockups/focus.ts`.
Export all from `packages/runtime/src/index.ts`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test test/mockups/cursor_focus.test.ts`
Run all tests: `pnpm --filter liosvideo test`
Expected: PASS with 100% green.

- [x] **Step 5: Commit**

```bash
git add packages/runtime/src/mockups/cursor.ts packages/runtime/src/mockups/focus.ts packages/runtime/src/index.ts packages/runtime/test/mockups
git commit -m "feat(runtime): cursor component and focus helper with sibling dim/blur"
```

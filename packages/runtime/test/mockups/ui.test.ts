import { describe, expect, it } from "vitest";
import { GroupNode, rect, TextNode } from "../../src/graph/kinds";
import type { Node } from "../../src/graph/node";
import { layout } from "../../src/layout/grid";
import { browserWindow } from "../../src/mockups/browser";
import { chatThread } from "../../src/mockups/chat";
import { fileExplorer } from "../../src/mockups/explorer";
import { notification } from "../../src/mockups/notification";

/** Every visible descendant's box at time t, relative to `root` (components only translate). */
function boxes(root: Node<any>, t: number) {
  const out: { name: string; x: number; y: number; w: number; h: number }[] = [];
  const walk = (n: Node<any>, ox: number, oy: number) => {
    const p = n.propsAt(t);
    const x = ox + p.x - p.anchorX * p.width;
    const y = oy + p.y - p.anchorY * p.height;
    if (n !== root && p.opacity > 0 && (p.width > 0 || p.height > 0)) out.push({ name: n.name, x, y, w: p.width, h: p.height });
    // a clipping group hides what overflows it, so its children need not fit
    if (n === root || !p.clip) for (const c of n.children) walk(c, n === root ? 0 : x, n === root ? 0 : y);
  };
  walk(root, 0, 0);
  return out;
}

function fitsInside(root: Node<any>, t: number) {
  const { width, height } = root.propsAt(t);
  const slack = 1;
  return boxes(root, t).filter((b) => b.x < -slack || b.y < -slack || b.x + b.w > width + slack || b.y + b.h > height + slack);
}

const FRAMES = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
];

describe("browserWindow", () => {
  it("draws tabs, an address bar and a page slot, light or dark", () => {
    const page = rect({ name: "hero", width: 200, height: 100, fill: "#f00" });
    const b = browserWindow({ width: 1200, height: 800, url: "https://liosvideo.dev", tabs: ["Docs", "GitHub"], activeTab: 1, theme: "light", content: page });
    expect(b.tabs.map((t) => t.label.propsAt(0).text)).toEqual(["Docs", "GitHub"]);
    expect(b.tabs[1].background.propsAt(0).fill).not.toBe(b.tabs[0].background.propsAt(0).fill);
    expect(page.parent).toBe(b.page);
    expect(b.page.propsAt(0).height).toBeCloseTo(800 - b.page.propsAt(0).y);
    const dark = browserWindow({ width: 1200, height: 800, theme: "dark" });
    expect(dark.frame.propsAt(0).fill).not.toBe(b.frame.propsAt(0).fill);
  });

  it("types a URL and switches tabs over time", () => {
    const b = browserWindow({ width: 1000, height: 700, url: "about:blank", tabs: ["A", "B"] });
    b.typeUrl("https://github.com", { at: 1, duration: 1 });
    b.switchTab(1, { at: 2 });
    expect(b.urlText.propsAt(0.5).text).toContain("about:blank");
    expect(b.urlText.propsAt(1.5).text.length).toBeLessThan(b.urlText.propsAt(2).text.length);
    expect(b.urlText.propsAt(2).text).toContain("https://github.com");
    expect(b.tabs[1].background.propsAt(2.1).fill).toBe(b.tabs[0].background.propsAt(1).fill);
  });

  it("scales its chrome with its size", () => {
    const small = browserWindow({ width: 600, height: 400 });
    const big = browserWindow({ width: 1800, height: 1200 });
    expect(big.page.propsAt(0).y).toBeGreaterThan(small.page.propsAt(0).y * 2);
  });
});

describe("fileExplorer", () => {
  const items = [
    { name: "src", children: [{ name: "scenes", children: ["intro.ts", "outro.ts"] }, "index.ts"] },
    { name: "assets", open: false, children: ["logo.png"] },
    "package.json",
  ];

  it("lists open folders as indented rows", () => {
    const e = fileExplorer({ width: 400, height: 600, items, selected: "index.ts" });
    expect(e.rows.map((r) => [r.name, r.depth])).toEqual([
      ["src", 0],
      ["scenes", 1],
      ["intro.ts", 2],
      ["outro.ts", 2],
      ["index.ts", 1],
      ["assets", 0],
      ["package.json", 0],
    ]);
    expect(e.row("intro.ts").group.propsAt(0).x).toBeGreaterThan(e.row("scenes").group.propsAt(0).x);
    expect(e.highlight.propsAt(0).y).toBeCloseTo(e.row("index.ts").group.propsAt(0).y);
  });

  it("moves the selection over time, and names the rows on a typo", () => {
    const e = fileExplorer({ width: 400, height: 600, items, selected: "src" });
    e.select("outro.ts", { at: 1, duration: 0.2 });
    expect(e.highlight.propsAt(0.5).y).toBeCloseTo(e.row("src").group.propsAt(0).y);
    expect(e.highlight.propsAt(1.3).y).toBeCloseTo(e.row("outro.ts").group.propsAt(0).y);
    expect(() => e.select("main.rs", { at: 2 })).toThrow(/no row "main.rs".*intro\.ts/);
  });
});

describe("chatThread", () => {
  const messages = [
    { from: "user" as const, text: "Make me a 30 second short about Bukele" },
    { from: "assistant" as const, text: "Here is a plan with five scenes, narration and captions. I will start with the hook." },
    { from: "user" as const, text: "Go" },
    { from: "assistant" as const, text: "Rendering now." },
  ];

  it("reveals messages one by one, with typing dots before assistant replies", () => {
    const c = chatThread({ width: 700, height: 900, messages, reveal: { start: 0.5, gap: 1.2 }, typing: 0.6 });
    expect(c.times).toHaveLength(4);
    for (let i = 1; i < 4; i++) expect(c.times[i]).toBeGreaterThan(c.times[i - 1]);
    expect(c.bubbles[1].group.propsAt(c.times[1] - 0.05).opacity).toBe(0);
    expect(c.bubbles[1].group.propsAt(c.times[1] + 0.5).opacity).toBe(1);
    expect(c.typingDots.propsAt(c.times[1] - 0.3).opacity).toBeGreaterThan(0);
    expect(c.typingDots.propsAt(c.times[1] + 0.5).opacity).toBe(0);
    // user bubbles sit right, assistant bubbles left
    expect(c.bubbles[0].group.propsAt(9).x).toBeGreaterThan(c.bubbles[1].group.propsAt(9).x);
  });

  it("scrolls so the newest message stays in view", () => {
    const long = Array.from({ length: 12 }, (_, i) => ({ from: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `Message number ${i} with a few words in it` }));
    const c = chatThread({ width: 600, height: 500, messages: long });
    const end = c.times[11] + 1;
    const last = c.bubbles[11].group.propsAt(end);
    const scroll = c.thread.propsAt(end).y;
    expect(scroll).toBeLessThan(0);
    expect(scroll + last.y + last.height).toBeLessThanOrEqual(500);
  });
});

describe("notification", () => {
  it("slides in, holds, and leaves", () => {
    const n = notification({ width: 800, app: "Mail", title: "Render finished", body: "short.mp4 is ready (5.4 MB)" });
    n.show({ at: 1, hold: 2 });
    expect(n.propsAt(0.5).opacity).toBe(0);
    expect(n.propsAt(1.6).opacity).toBe(1);
    expect(n.propsAt(2.5).y).toBeCloseTo(n.propsAt(1.6).y);
    expect(n.propsAt(4).opacity).toBe(0);
    expect(n.titleText.propsAt(0).text).toBe("Render finished");
  });
});

describe("UI mockups fit their layout box in 16:9 and 9:16", () => {
  for (const frame of FRAMES) {
    it(`${frame.width}x${frame.height}`, () => {
      const L = layout(frame);
      const box = L.slot("center");
      const parts: [string, GroupNode, number][] = [];
      const b = browserWindow({ ...box, url: "https://example.com/a/very/long/path/that/keeps/going", tabs: ["Docs", "GitHub", "A tab with a long title"] });
      parts.push(["browser", b, 0]);
      const e = fileExplorer({ ...box, items: ["a.ts", { name: "dir", children: ["b.ts", "c.ts"] }] });
      parts.push(["explorer", e, 0]);
      const c = chatThread({ ...box, messages: [{ from: "user", text: "Hello there, how are you doing today?" }, { from: "assistant", text: "Great. ".repeat(30) }] });
      parts.push(["chat", c, c.times[1] + 1]);
      const n = notification({ width: box.width, app: "Slack", title: "Hanif", body: "Can you send the preview? ".repeat(4) });
      n.show({ at: 0, hold: 3 });
      parts.push(["notification", n, 1]);
      for (const [name, g, t] of parts) {
        expect(fitsInside(g, t), name).toEqual([]);
        for (const tx of boxes(g, t).filter((x) => x.name.endsWith("Text"))) expect(tx.h, `${name}/${tx.name}`).toBeGreaterThan(0);
      }
      expect(TextNode).toBeDefined();
    });
  }
});

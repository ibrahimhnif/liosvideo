// browserWindow(): a browser with tabs, an address bar that can type, and a page slot.
import { circle, group, GroupNode, rect, RectNode, TextNode } from "../graph/kinds";
import type { BaseProps, Node, NodeInit } from "../graph/node";
import { ellipsize, palette, UI_FONT, unit, type UiTheme } from "./ui_kit";

export interface BrowserWindowInit extends NodeInit<BaseProps> {
  url?: string;
  /** Tab titles; the first is active unless `activeTab` says otherwise */
  tabs?: string[];
  activeTab?: number;
  theme?: UiTheme;
  /** Nodes to put on the page (positions are relative to the page's top-left) */
  content?: Node<any> | Node<any>[];
}

export interface BrowserTab {
  group: GroupNode;
  background: RectNode;
  label: TextNode;
}

interface Typing {
  url: string;
  at: number;
  duration: number;
}

export class BrowserWindowNode extends GroupNode {
  readonly frame: RectNode;
  readonly tabs: BrowserTab[];
  readonly urlField: RectNode;
  readonly urlText: TextNode;
  /** The web page: add your content here (clipped to the page) */
  readonly page: GroupNode;
  private readonly typing: Typing[] = [];
  private readonly colors: ReturnType<typeof palette>;

  constructor(init: BrowserWindowInit = {}) {
    const { url = "https://example.com", tabs = ["New Tab"], activeTab = 0, theme = "dark", content, width = 1200, height = 760, name = "browser", ...rest } = init;
    super({ ...rest, name, width, height });
    const c = (this.colors = palette(theme));
    const k = unit(width, height);
    const tabBarH = 40 * k;
    const toolbarH = 44 * k;
    const font = 13 * k;

    this.frame = this.add(rect({ name: "frame", width, height, radius: 12 * k, fill: c.window, stroke: c.chromeBorder, strokeWidth: Math.max(1, k) }));
    this.add(rect({ name: "tabStrip", width, height: tabBarH + 12 * k, radius: 12 * k, fill: c.chrome }));
    this.add(rect({ name: "toolbar", y: tabBarH, width, height: toolbarH, fill: c.tabActive }));
    this.add(rect({ name: "toolbarBorder", y: tabBarH + toolbarH - Math.max(1, k), width, height: Math.max(1, k), fill: c.chromeBorder }));

    const lights = this.add(group({ name: "trafficLights", x: 16 * k, y: tabBarH / 2 - 6 * k, width: 52 * k, height: 12 * k }));
    ["#ff5f57", "#febc2e", "#28c840"].forEach((fill, i) => lights.add(circle({ name: `light${i}`, x: i * 20 * k, radius: 6 * k, fill })));

    const tabsX = 84 * k;
    const tabW = Math.min(220 * k, (width - tabsX - 16 * k) / Math.max(1, tabs.length));
    this.tabs = tabs.map((title, i) => {
      const g = this.add(group({ name: `tab${i}`, x: tabsX + i * tabW, y: 6 * k, width: tabW - 4 * k, height: tabBarH - 6 * k }));
      const background = g.add(rect({ name: "background", width: tabW - 4 * k, height: tabBarH - 6 * k, radius: 8 * k, fill: i === activeTab ? c.tabActive : c.tab }));
      const label = g.add(
        new TextNode({
          name: "labelText",
          text: ellipsize(title, { fontSize: font, maxWidth: tabW - 28 * k }),
          x: 12 * k,
          y: (tabBarH - 6 * k - font * 1.2) / 2,
          width: tabW - 28 * k,
          height: font * 1.2,
          fontSize: font,
          fontFamily: UI_FONT,
          color: i === activeTab ? c.text : c.muted,
        }),
      );
      return { group: g, background, label };
    });

    this.add(
      new TextNode({
        name: "navText",
        text: "‹  ›  ↻",
        x: 16 * k,
        y: tabBarH + (toolbarH - 16 * k * 1.2) / 2,
        width: 80 * k,
        height: 16 * k * 1.2,
        fontSize: 16 * k,
        fontFamily: UI_FONT,
        color: c.muted,
      }),
    );
    const fieldX = 100 * k;
    const fieldW = Math.max(40 * k, width - fieldX - 16 * k);
    const fieldH = 28 * k;
    this.urlField = this.add(rect({ name: "urlField", x: fieldX, y: tabBarH + (toolbarH - fieldH) / 2, width: fieldW, height: fieldH, radius: fieldH / 2, fill: c.field }));

    const typing = this.typing;
    const urlFont = font;
    const urlMax = fieldW - 28 * k;
    class UrlText extends TextNode {
      override propsAt(t: number) {
        const p = super.propsAt(t);
        let shown = url;
        for (const a of typing) {
          if (a.at > t) break;
          const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
          shown = a.url.slice(0, Math.floor(progress * a.url.length));
        }
        p.text = ellipsize(shown, { fontSize: urlFont, maxWidth: urlMax });
        return p;
      }
    }
    this.urlText = this.add(
      new UrlText({
        name: "urlText",
        text: url,
        x: fieldX + 14 * k,
        y: tabBarH + (toolbarH - urlFont * 1.2) / 2,
        width: urlMax,
        height: urlFont * 1.2,
        fontSize: urlFont,
        fontFamily: UI_FONT,
        color: c.text,
      }),
    );

    const pageY = tabBarH + toolbarH;
    this.page = this.add(group({ name: "page", y: pageY, width, height: Math.max(0, height - pageY), clip: true, radius: 12 * k }));
    this.page.add(rect({ name: "pageBackground", width, height: Math.max(0, height - pageY), fill: c.window }));
    for (const node of content === undefined ? [] : Array.isArray(content) ? content : [content]) this.page.add(node);
  }

  /** Types `url` into the address bar, a character at a time over `duration` seconds. */
  typeUrl(url: string, opts: { at: number; duration?: number }): this {
    this.typing.push({ url, at: opts.at, duration: Math.max(0.01, opts.duration ?? Math.min(1.5, url.length * 0.05)) });
    this.typing.sort((a, b) => a.at - b.at);
    return this;
  }

  /** Makes tab `index` the active one at `at`. */
  switchTab(index: number, opts: { at: number }): this {
    if (!this.tabs[index]) throw new Error(`browserWindow: no tab ${index} (it has ${this.tabs.length})`);
    this.tabs.forEach((tab, i) => {
      tab.background.set({ fill: i === index ? this.colors.tabActive : this.colors.tab }, opts.at);
      tab.label.set({ color: i === index ? this.colors.text : this.colors.muted }, opts.at);
    });
    return this;
  }
}

export const browserWindow = (init?: BrowserWindowInit) => new BrowserWindowNode(init);

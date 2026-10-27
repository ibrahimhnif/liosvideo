import { group, GroupNode, rect, RectNode, text, TextNode } from "../graph/kinds";
import { WindowNode, type WindowInit } from "./window";

export interface ChromeInit extends WindowInit {
  url?: string;
  tabTitle?: string;
}

interface UrlTypeAction {
  targetUrl: string;
  at: number;
  duration: number;
}

export class ChromeOmnibox {
  private readonly actions: UrlTypeAction[] = [];
  initialUrl: string;

  constructor(initialUrl: string = "about:blank") {
    this.initialUrl = initialUrl;
  }

  type(url: string, opts: { at: number; duration: number }): this {
    this.actions.push({
      targetUrl: url,
      at: opts.at,
      duration: Math.max(0.01, opts.duration),
    });
    this.actions.sort((a, b) => a.at - b.at);
    return this;
  }

  textAt(t: number): string {
    let current = this.initialUrl;
    for (const a of this.actions) {
      if (a.at > t) break;
      const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
      const chars = Math.floor(progress * a.targetUrl.length);
      current = a.targetUrl.slice(0, chars);
    }
    return current;
  }
}

export class ChromeNode extends WindowNode {
  readonly tabTitle: TextNode;
  readonly tabRect: RectNode;
  readonly navBar: RectNode;
  readonly urlbarRect: RectNode;
  readonly urlbarText: TextNode;
  readonly urlbar: ChromeOmnibox;
  readonly pageArea: GroupNode;

  constructor(init: ChromeInit = {}) {
    const { url = "https://example.com", title, tabTitle = title ?? "New Tab", width = 1000, height = 700, ...rest } = init;
    super({ ...rest, title: "", width, height, theme: "dark" });

    const chrome = this;
    this.urlbar = new ChromeOmnibox(url);

    // Remove window title text since tabs are used in Chrome
    this.titleText.set({ opacity: 0 }, 0);

    // 1. Tab strip: Active Tab
    this.tabRect = this.add(
      rect({
        name: "activeTab",
        x: 80,
        y: 6,
        width: 190,
        height: 32,
        radius: 8,
        fill: "#35363a",
      }),
    );

    this.tabTitle = this.add(
      text({
        name: "tabTitle",
        text: tabTitle,
        x: 96,
        y: 14,
        fontSize: 12,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: "#e8eaed",
      }),
    );

    // 2. Navigation toolbar background
    this.navBar = this.add(
      rect({
        name: "navBar",
        y: 38,
        width,
        height: 42,
        fill: "#35363a",
      }),
    );

    // Nav icons: back, forward, reload
    this.add(
      text({
        name: "navIcons",
        text: "‹   ›   ↻",
        x: 16,
        y: 48,
        fontSize: 16,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: "#9aa0a6",
      }),
    );

    // 3. Omnibox / URL bar
    const omniboxWidth = Math.max(200, width - 120);
    this.urlbarRect = this.add(
      rect({
        name: "urlbarRect",
        x: 96,
        y: 45,
        width: omniboxWidth,
        height: 28,
        radius: 14,
        fill: "#202124",
      }),
    );

    class DynamicUrlTextNode extends TextNode {
      override propsAt(t: number) {
        const p = super.propsAt(t);
        p.text = `🔒  ${chrome.urlbar.textAt(t)}`;
        return p;
      }
    }

    this.urlbarText = this.add(
      new DynamicUrlTextNode({
        name: "urlbarText",
        text: `🔒  ${url}`,
        x: 112,
        y: 51,
        fontSize: 12,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: "#e8eaed",
      }),
    );

    // 4. Web page content area slot
    this.pageArea = this.contentArea.add(
      group({
        name: "pageArea",
        y: 42, // relative to contentArea (which starts at y=38, so pageArea is at y=80 overall)
        width,
        height: Math.max(0, height - 80),
        clip: true,
      }),
    );
  }
}

export const chrome = (init?: ChromeInit) => new ChromeNode(init);

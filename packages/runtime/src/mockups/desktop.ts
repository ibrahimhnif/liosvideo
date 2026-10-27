import { group, GroupNode, image, ImageNode, rect, RectNode, text, TextNode } from "../graph/kinds";
import type { BaseProps, Node, NodeInit } from "../graph/node";

export interface DesktopInit extends NodeInit<BaseProps> {
  wallpaper?: string;
  appName?: string;
  theme?: "dark" | "light";
}

export class DesktopNode extends GroupNode {
  readonly wallpaper: RectNode | ImageNode;
  readonly menuBar: RectNode;
  readonly appleIcon: TextNode;
  readonly appTitle: TextNode;
  readonly menuItems: TextNode;
  readonly clock: TextNode;

  constructor(init: DesktopInit = {}) {
    const { wallpaper: wallSrc, appName = "Desktop", theme = "dark", width = 1920, height = 1080, ...rest } = init;
    super({ ...rest, width, height });

    const isDark = theme === "dark";
    const barBg = isDark ? "#18181fb3" : "#f5f5f7cc";
    const textCol = isDark ? "#f0f0f5" : "#1d1d1f";

    // 1. Wallpaper background
    if (wallSrc) {
      this.wallpaper = this.add(
        image({
          name: "wallpaper",
          src: wallSrc,
          width,
          height,
          fit: "cover",
        }),
      );
    } else {
      // Default macOS dark indigo wallpaper feel
      this.wallpaper = this.add(
        rect({
          name: "wallpaper",
          width,
          height,
          fill: isDark ? "#1b192e" : "#8ab4f8",
        }),
      );
    }

    // 2. Menu bar container & background
    this.menuBar = this.add(
      rect({
        name: "menuBar",
        width,
        height: 28,
        fill: barBg,
      }),
    );

    // Apple logo
    this.appleIcon = this.add(
      text({
        name: "appleIcon",
        text: "",
        x: 16,
        y: 6,
        fontSize: 14,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: textCol,
      }),
    );

    // Active App title
    this.appTitle = this.add(
      text({
        name: "appTitle",
        text: appName,
        x: 38,
        y: 7,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: textCol,
      }),
    );

    // Menu bar items
    this.menuItems = this.add(
      text({
        name: "menuItems",
        text: "File   Edit   View   Go   Window   Help",
        x: 104,
        y: 7,
        fontSize: 13,
        fontWeight: 400,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: isDark ? "#b0b0b8" : "#55555c",
      }),
    );

    // Menu bar clock
    this.clock = this.add(
      text({
        name: "clock",
        text: "Sun 10:24 AM",
        x: width - 16,
        y: 7,
        anchorX: 1,
        fontSize: 13,
        fontWeight: 400,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: textCol,
      }),
    );
  }

  get width(): number {
    return this.propsAt(0).width;
  }

  get height(): number {
    return this.propsAt(0).height;
  }
}

export const desktop = (init?: DesktopInit) => new DesktopNode(init);

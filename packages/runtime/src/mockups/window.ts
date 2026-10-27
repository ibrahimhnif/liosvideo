import { group, GroupNode, rect, RectNode, text, TextNode } from "../graph/kinds";
import { BASE_DEFAULTS, type BaseProps, type NodeInit } from "../graph/node";

export interface WindowInit extends NodeInit<BaseProps> {
  title?: string;
  theme?: "dark" | "light";
}

export class WindowNode extends GroupNode {
  readonly frame: RectNode;
  readonly titleBar: RectNode;
  readonly titleBorder: RectNode;
  readonly trafficLights: GroupNode;
  readonly closeBtn: RectNode;
  readonly minBtn: RectNode;
  readonly maxBtn: RectNode;
  readonly titleText: TextNode;
  readonly contentArea: GroupNode;

  constructor(init: WindowInit = {}) {
    const { title = "Window", theme = "dark", width = 800, height = 600, ...rest } = init;
    super({ ...rest, width, height });

    const isDark = theme === "dark";
    const bgFill = isDark ? "#1e1e1e" : "#f6f6f6";
    const barFill = isDark ? "#2d2d2d" : "#e8e8e8";
    const barBorder = isDark ? "#1f1f1f" : "#d8d8d8";
    const titleColor = isDark ? "#d0d0d0" : "#4a4a4a";

    // 1. Base window background frame
    this.frame = this.add(
      rect({
        name: "frame",
        width,
        height,
        radius: 10,
        fill: bgFill,
        stroke: isDark ? "#383838" : "#d0d0d0",
        strokeWidth: 1,
      }),
    );

    // 2. Title bar background
    this.titleBar = this.add(
      rect({
        name: "titleBar",
        width,
        height: 38,
        radius: 10,
        fill: barFill,
      }),
    );

    // Bottom border of titlebar
    this.titleBorder = this.add(
      rect({
        name: "titleBorder",
        y: 37,
        width,
        height: 1,
        fill: barBorder,
      }),
    );

    // 3. Traffic lights group
    this.trafficLights = this.add(
      group({
        name: "trafficLights",
        x: 14,
        y: 13,
        width: 52,
        height: 12,
      }),
    );

    this.closeBtn = this.trafficLights.add(
      rect({ name: "close", x: 0, width: 12, height: 12, radius: 6, fill: "#ff5f56" }),
    );
    this.minBtn = this.trafficLights.add(
      rect({ name: "minimize", x: 20, width: 12, height: 12, radius: 6, fill: "#ffbd2e" }),
    );
    this.maxBtn = this.trafficLights.add(
      rect({ name: "maximize", x: 40, width: 12, height: 12, radius: 6, fill: "#27c93f" }),
    );

    // 4. Centered Title text
    this.titleText = this.add(
      text({
        name: "titleText",
        text: title,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        fontSize: 13,
        fontWeight: 500,
        color: titleColor,
        anchorX: 0.5,
        anchorY: 0.5,
        x: width / 2,
        y: 19,
      }),
    );

    // 5. Window content area (clipped)
    this.contentArea = this.add(
      group({
        name: "content",
        y: 38,
        width,
        height: Math.max(0, height - 38),
        clip: true,
        radius: 10,
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

export const windowNode = (init?: WindowInit) => new WindowNode(init);

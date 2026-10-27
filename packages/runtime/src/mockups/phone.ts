import { group, GroupNode, rect, RectNode, text, TextNode } from "../graph/kinds";
import { type BaseProps, type NodeInit } from "../graph/node";

export interface PhoneInit extends NodeInit<BaseProps> {
  theme?: "dark" | "light";
  time?: string;
  showIsland?: boolean;
  showHomeIndicator?: boolean;
}

export class PhoneNode extends GroupNode {
  readonly bezel: RectNode;
  readonly screen: RectNode;
  readonly contentArea: GroupNode;
  readonly dynamicIsland: RectNode;
  readonly timeText: TextNode;
  readonly homeIndicator: RectNode;

  constructor(init: PhoneInit = {}) {
    const {
      theme = "dark",
      time = "9:41",
      showIsland = true,
      showHomeIndicator = true,
      width = 400,
      height = 820,
      ...rest
    } = init;
    super({ ...rest, width, height });

    const isDark = theme === "dark";
    const bezelColor = isDark ? "#1a1a1e" : "#e2e2e8";
    const bezelBorder = isDark ? "#2e2e36" : "#c4c4cc";
    const screenBg = isDark ? "#000000" : "#ffffff";
    const textColor = isDark ? "#ffffff" : "#000000";

    const outerRadius = 50;
    const innerRadius = 42;
    const bezelWidth = 8;

    // 1. Outer Chassis / Bezel
    this.bezel = this.add(
      rect({
        name: "bezel",
        width,
        height,
        radius: outerRadius,
        fill: bezelColor,
        stroke: bezelBorder,
        strokeWidth: 2,
      })
    );

    // 2. Screen background & clipping container
    const screenW = width - bezelWidth * 2;
    const screenH = height - bezelWidth * 2;
    this.screen = this.add(
      rect({
        name: "screen",
        x: bezelWidth,
        y: bezelWidth,
        width: screenW,
        height: screenH,
        radius: innerRadius,
        fill: screenBg,
        clip: true,
      })
    );

    // 3. User content area inside screen
    this.contentArea = this.screen.add(
      group({
        name: "contentArea",
        width: screenW,
        height: screenH,
      })
    );

    // 4. Status Bar: Time
    this.timeText = this.screen.add(
      text({
        name: "timeText",
        text: time,
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "SF Pro Text",
        color: textColor,
        x: 32,
        y: 14,
        z: 99,
      })
    );

    // 5. Dynamic Island / Pill
    const islandWidth = Math.min(screenW * 0.32, 126);
    const islandHeight = 32;
    this.dynamicIsland = this.screen.add(
      rect({
        name: "dynamicIsland",
        width: islandWidth,
        height: islandHeight,
        x: (screenW - islandWidth) / 2,
        y: 11,
        radius: 16,
        fill: "#000000",
        opacity: showIsland ? 1 : 0,
        z: 100,
      })
    );

    // 6. Home indicator bar at bottom
    const homeW = Math.min(screenW * 0.36, 140);
    const homeH = 5;
    this.homeIndicator = this.screen.add(
      rect({
        name: "homeIndicator",
        width: homeW,
        height: homeH,
        x: (screenW - homeW) / 2,
        y: screenH - 12,
        radius: 2.5,
        fill: isDark ? "#ffffff" : "#000000",
        opacity: showHomeIndicator ? 0.8 : 0,
        z: 100,
      })
    );
  }

  get width(): number {
    return this.propsAt(0).width;
  }

  get height(): number {
    return this.propsAt(0).height;
  }
}

export function phone(init: PhoneInit = {}): PhoneNode {
  return new PhoneNode(init);
}

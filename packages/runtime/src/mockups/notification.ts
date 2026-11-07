// notification(): a phone or desktop notification card that slides in, holds and leaves.
import { group, GroupNode, rect, RectNode, TextNode } from "../graph/kinds";
import type { BaseProps, NodeInit } from "../graph/node";
import { ellipsize, palette, textWidth, UI_FONT, unit, wrapText, type UiTheme } from "./ui_kit";

export interface NotificationInit extends NodeInit<BaseProps> {
  app: string;
  title: string;
  body?: string;
  /** Right of the app name, e.g. "now", "2m ago" */
  time?: string;
  /** App icon colour (the icon shows the app's first letter) */
  color?: string;
  theme?: UiTheme;
  /** "phone" (rounded, translucent) or "desktop" */
  variant?: "phone" | "desktop";
  /** Lines of body text before it is cut with an ellipsis */
  maxLines?: number;
}

export class NotificationNode extends GroupNode {
  readonly card: RectNode;
  readonly titleText: TextNode;
  readonly bodyText: TextNode;
  private readonly variant: "phone" | "desktop";

  constructor(init: NotificationInit) {
    const { app, title, body = "", time = "now", color = "#2563eb", theme = "dark", variant = "phone", maxLines = 3, width = 720, name = "notification", ...rest } = init;
    const c = palette(theme);
    // 1 at a 360 px card, the width of a phone notification
    const k = unit(width * 2.8, 2000);
    const pad = 16 * k;
    const icon = 40 * k;
    const textX = pad + icon + 12 * k;
    const textW = Math.max(20 * k, width - textX - pad);
    const small = 13 * k;
    const titleFont = 16 * k;
    const bodyFont = 15 * k;

    const wrapped = wrapText(body, { fontSize: bodyFont, maxWidth: textW, lineHeight: 1.3 });
    let lines = wrapped.text.split("\n");
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]}…`, { fontSize: bodyFont, maxWidth: textW });
      if (!lines[maxLines - 1].endsWith("…")) lines[maxLines - 1] += "…";
    }
    const bodyH = body ? lines.length * bodyFont * 1.3 : 0;
    const headH = small * 1.3;
    const height = pad + headH + 4 * k + titleFont * 1.25 + (body ? 2 * k + bodyH : 0) + pad;
    super({ ...rest, name, width, height, opacity: 0 });
    this.variant = variant;

    this.add(rect({ name: "shadow", x: 0, y: 4 * k, width, height: height - 4 * k, radius: (variant === "phone" ? 22 : 12) * k, fill: c.shadow, blur: 12 * k }));
    this.card = this.add(rect({ name: "card", width, height, radius: (variant === "phone" ? 22 : 12) * k, fill: c.card, stroke: c.cardBorder, strokeWidth: Math.max(1, k) }));
    const iconG = this.add(group({ name: "icon", x: pad, y: pad, width: icon, height: icon }));
    iconG.add(rect({ name: "background", width: icon, height: icon, radius: 10 * k, fill: color }));
    const letter = (app.trim()[0] ?? "?").toUpperCase();
    iconG.add(
      new TextNode({
        name: "letterText",
        text: letter,
        x: (icon - textWidth(letter, { fontSize: 20 * k, fontWeight: 700 })) / 2,
        y: (icon - 20 * k * 1.2) / 2,
        width: Math.min(icon, textWidth(letter, { fontSize: 20 * k, fontWeight: 700 })),
        height: 20 * k * 1.2,
        fontSize: 20 * k,
        fontWeight: 700,
        fontFamily: UI_FONT,
        color: "#ffffff",
      }),
    );

    const timeW = Math.min(textW * 0.4, textWidth(time, { fontSize: small }));
    this.add(
      new TextNode({
        name: "appText",
        text: ellipsize(app.toUpperCase(), { fontSize: small, maxWidth: textW - timeW - 8 * k, fontWeight: 600 }),
        x: textX,
        y: pad,
        width: Math.max(0, textW - timeW - 8 * k),
        height: headH,
        fontSize: small,
        fontWeight: 600,
        fontFamily: UI_FONT,
        color: c.muted,
      }),
    );
    this.add(
      new TextNode({
        name: "timeText",
        text: ellipsize(time, { fontSize: small, maxWidth: timeW }),
        x: textX + textW - timeW,
        y: pad,
        width: timeW,
        height: headH,
        fontSize: small,
        fontFamily: UI_FONT,
        color: c.muted,
      }),
    );
    const titleY = pad + headH + 4 * k;
    this.titleText = this.add(
      new TextNode({
        name: "titleText",
        text: ellipsize(title, { fontSize: titleFont, maxWidth: textW, fontWeight: 600 }),
        x: textX,
        y: titleY,
        width: textW,
        height: titleFont * 1.25,
        fontSize: titleFont,
        fontWeight: 600,
        lineHeight: 1.25,
        fontFamily: UI_FONT,
        color: c.text,
      }),
    );
    this.bodyText = this.add(
      new TextNode({
        name: "bodyText",
        text: lines.join("\n"),
        x: textX,
        y: titleY + titleFont * 1.25 + 2 * k,
        width: textW,
        height: bodyH,
        fontSize: bodyFont,
        lineHeight: 1.3,
        fontFamily: UI_FONT,
        color: c.text,
        opacity: body ? 0.85 : 0,
      }),
    );
  }

  /**
   * Slides the card in at `at` (from the top on a phone, from the right on a desktop), keeps it for
   * `hold` seconds and fades it out. The card ends where you placed it.
   */
  show(opts: { at: number; hold?: number; duration?: number }): this {
    const { at, hold = 3, duration = 0.4 } = opts;
    const p = this.propsAt(at);
    const from = this.variant === "phone" ? { y: p.y - p.height * 0.6 } : { x: p.x + p.width * 0.3 };
    this.set({ ...from, opacity: 0 }, at);
    this.to({ x: p.x, y: p.y, opacity: 1 }, { at, duration, ease: "outCubic" });
    this.to({ opacity: 0 }, { at: at + duration + hold, duration: 0.3, ease: "inCubic" });
    return this;
  }
}

export const notification = (init: NotificationInit) => new NotificationNode(init);

// chatThread(): an AI / messaging chat that reveals messages one by one, shows typing dots before
// replies, and scrolls so the newest message stays in view.
import { circle, group, GroupNode, rect, RectNode, TextNode } from "../graph/kinds";
import type { BaseProps, NodeInit } from "../graph/node";
import { ellipsize, palette, UI_FONT, unit, wrapText, type UiTheme } from "./ui_kit";

export interface ChatMessage {
  /** "user" bubbles sit right; anything else ("assistant", a name) sits left */
  from: "user" | "assistant" | (string & {});
  text: string;
  /** Scene time this message appears (overrides the reveal rhythm from here on) */
  at?: number;
}

export interface ChatThreadInit extends NodeInit<BaseProps> {
  messages: ChatMessage[];
  /** Header title, e.g. "Claude" */
  title?: string;
  theme?: UiTheme;
  /** When messages appear: the first at `start`, then one every `gap` s. false shows them all at once. */
  reveal?: { start?: number; gap?: number } | false;
  /** Seconds of typing dots before each reply (not before "user" messages); 0 turns them off */
  typing?: number;
  /** Placeholder in the input field */
  placeholder?: string;
}

export interface ChatBubble {
  message: ChatMessage;
  group: GroupNode;
  background: RectNode;
  label: TextNode;
}

export class ChatThreadNode extends GroupNode {
  readonly panel: RectNode;
  /** The scrolling column of bubbles */
  readonly thread: GroupNode;
  readonly bubbles: ChatBubble[];
  /** When each message appears (scene seconds), e.g. to time narration or a cursor */
  readonly times: number[];
  readonly typingDots: GroupNode;

  constructor(init: ChatThreadInit) {
    const {
      messages,
      title = "Assistant",
      theme = "dark",
      reveal = {},
      typing = 0.6,
      placeholder = "Message…",
      width = 720,
      height = 900,
      name = "chat",
      ...rest
    } = init;
    super({ ...rest, name, width, height });
    const c = palette(theme);
    const k = unit(width * 1.5, height);
    const pad = 16 * k;
    const headerH = 52 * k;
    const inputH = 60 * k;
    const font = 16 * k;
    const lineHeight = 1.35;

    this.panel = this.add(rect({ name: "panel", width, height, radius: 16 * k, fill: c.window, stroke: c.chromeBorder, strokeWidth: Math.max(1, k) }));
    this.add(rect({ name: "header", width, height: headerH, radius: 16 * k, fill: c.chrome }));
    this.add(rect({ name: "headerBorder", y: headerH - Math.max(1, k), width, height: Math.max(1, k), fill: c.chromeBorder }));
    this.add(
      new TextNode({
        name: "titleText",
        text: ellipsize(title, { fontSize: 17 * k, maxWidth: width - 2 * pad, fontWeight: 600 }),
        x: pad,
        y: (headerH - 17 * k * 1.2) / 2,
        width: width - 2 * pad,
        height: 17 * k * 1.2,
        fontSize: 17 * k,
        fontWeight: 600,
        fontFamily: UI_FONT,
        color: c.text,
      }),
    );

    const viewportH = Math.max(0, height - headerH - inputH);
    const viewport = this.add(group({ name: "viewport", y: headerH, width, height: viewportH, clip: true }));
    this.thread = viewport.add(group({ name: "thread", width, height: viewportH }));

    const fieldH = 40 * k;
    this.add(rect({ name: "inputField", x: pad, y: height - inputH + (inputH - fieldH) / 2, width: width - 2 * pad, height: fieldH, radius: fieldH / 2, fill: c.field, stroke: c.chromeBorder, strokeWidth: Math.max(1, k) }));
    this.add(
      new TextNode({
        name: "placeholderText",
        text: ellipsize(placeholder, { fontSize: 15 * k, maxWidth: width - 4 * pad }),
        x: pad + 16 * k,
        y: height - inputH + (inputH - 15 * k * 1.2) / 2,
        width: width - 4 * pad,
        height: 15 * k * 1.2,
        fontSize: 15 * k,
        fontFamily: UI_FONT,
        color: c.muted,
      }),
    );

    // timing
    const start = reveal === false ? 0 : (reveal.start ?? 0.3);
    const gap = reveal === false ? 0 : (reveal.gap ?? 1.0);
    const isReply = (m: ChatMessage) => m.from !== "user";
    const times: number[] = [];
    messages.forEach((m, i) => {
      const lead = reveal !== false && isReply(m) ? typing : 0;
      const auto = i === 0 ? start + lead : times[i - 1] + gap + lead;
      times.push(m.at ?? auto);
    });
    this.times = times;

    // bubbles
    const maxBubble = width * 0.78;
    const bubblePadX = 14 * k;
    const bubblePadY = 10 * k;
    let y = pad;
    this.bubbles = messages.map((m, i) => {
      const wrapped = wrapText(m.text, { fontSize: font, maxWidth: maxBubble - 2 * bubblePadX, lineHeight });
      const w = wrapped.width + 2 * bubblePadX;
      const h = wrapped.height + 2 * bubblePadY;
      const mine = !isReply(m);
      const x = mine ? width - pad - w : pad;
      const g = this.thread.add(group({ name: `message${i}`, x, y, width: w, height: h, opacity: reveal === false ? 1 : 0 }));
      const background = g.add(rect({ name: "background", width: w, height: h, radius: 18 * k, fill: mine ? c.bubbleUser : c.bubbleOther }));
      const label = g.add(
        new TextNode({
          name: "labelText",
          text: wrapped.text,
          x: bubblePadX,
          y: bubblePadY,
          width: wrapped.width,
          height: wrapped.height,
          fontSize: font,
          lineHeight,
          fontFamily: UI_FONT,
          color: mine ? c.bubbleUserText : c.bubbleOtherText,
        }),
      );
      if (reveal !== false) {
        g.assign({ y: y + 12 * k });
        g.to({ opacity: 1, y }, { at: times[i], duration: 0.3, ease: "outCubic" });
      }
      y += h + 10 * k;
      return { message: m, group: g, background, label };
    });

    // typing dots, shown where the next reply will appear
    const dotsW = 64 * k;
    const dotsH = 38 * k;
    this.typingDots = this.thread.add(group({ name: "typingDots", x: pad, y: pad, width: dotsW, height: dotsH, opacity: 0 }));
    this.typingDots.add(rect({ name: "background", width: dotsW, height: dotsH, radius: 18 * k, fill: c.bubbleOther }));
    for (let d = 0; d < 3; d++) {
      const dot = this.typingDots.add(circle({ name: `dot${d}`, x: 14 * k + d * 13 * k, y: dotsH / 2 - 4 * k, radius: 4 * k, fill: c.muted }));
      // a gentle pulse, offset per dot
      for (let t = 0; t < (times[times.length - 1] ?? 0) + 1; t += 0.6) dot.to({ opacity: 0.35 }, { at: t + d * 0.15, duration: 0.3 }).to({ opacity: 1 }, { at: t + d * 0.15 + 0.3, duration: 0.3 });
    }

    // scroll so each new bubble (and the dots before it) stays in view
    let scrolled = 0;
    this.bubbles.forEach((b, i) => {
      const p = b.group.propsAt(times[i] + 10);
      const bottom = p.y + p.height + pad;
      const showAt = reveal !== false && isReply(b.message) && typing > 0 ? times[i] - typing : times[i];
      if (reveal !== false && isReply(b.message) && typing > 0) {
        this.typingDots.set({ y: p.y, opacity: 1 }, showAt);
        this.typingDots.set({ opacity: 0 }, times[i]);
      }
      const need = Math.max(0, bottom - viewportH);
      if (need > scrolled) {
        this.thread.to({ y: -need }, { at: Math.max(0, showAt - 0.05), duration: 0.3, ease: "outCubic" });
        scrolled = need;
      }
    });
  }
}

export const chatThread = (init: ChatThreadInit) => new ChatThreadNode(init);

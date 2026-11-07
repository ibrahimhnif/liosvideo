import { attribution } from "../assets/attributions";
import { GroupNode, measureText, RectNode, TextNode } from "../graph/kinds";
import type { Node } from "../graph/node";
import { layout } from "../layout";

export interface CreditOptions {
  /** Where the facts come from: one outlet or several (joined with " • "). */
  source?: string | string[];
  /** Photographer / creator of the image on screen. */
  photo?: string;
  /** Licence of that image, e.g. "CC BY-SA 4.0". */
  license?: string;
  /** Fill photo + licence from this asset's row in assets/ATTRIBUTIONS.md. */
  asset?: string;
  /** Replace the generated line entirely. */
  text?: string;
  /** Label language: "en" (Source / Photo, default) or "id" (Sumber / Foto). */
  lang?: "en" | "id";
  /** Fade in at this scene time (default: shown from the start). */
  at?: number;
  /** Fade out at this scene time. */
  until?: number;
  color?: string;
  /** Backdrop behind the text so it reads on bright footage (default "#0000008c"); false for none. */
  background?: string | false;
  fontFamily?: string;
  name?: string;
}

const LABELS = {
  en: { source: "Source", photo: "Photo", ai: "AI illustration" },
  id: { source: "Sumber", photo: "Foto", ai: "Ilustrasi AI" },
} as const;

/** "https://www.unsplash.com/photos/x" -> "unsplash.com"; anything else is returned as written. */
function siteOf(source: string): string {
  const host = /^https?:\/\/([^/]+)/i.exec(source.trim())?.[1];
  return host ? host.replace(/^www\./i, "") : source;
}

/** The credit line for these options, e.g. "Source: ANTARA • Photo: Jane Doe, CC BY-SA 4.0". */
export function creditText(opts: CreditOptions): string {
  if (opts.text) return opts.text;
  const L = LABELS[opts.lang ?? "en"];
  const parts: string[] = [];
  const sources = (Array.isArray(opts.source) ? opts.source : opts.source ? [opts.source] : []).filter(Boolean);
  if (sources.length) parts.push(`${L.source}: ${sources.join(" • ")}`);

  let photo = opts.photo;
  let license = opts.license;
  if (opts.asset) {
    const row = attribution(opts.asset);
    if (!row) {
      throw new Error(`credit(): "${opts.asset}" has no row in assets/ATTRIBUTIONS.md; add one (Asset | Source | Author | License | Notes) first`);
    }
    if (/ai-generated/i.test(row.author)) {
      const tool = /generated with ([^(]+)/i.exec(row.source)?.[1]?.trim();
      parts.push(tool ? `${L.ai} (${tool})` : L.ai);
      return parts.join(" • ");
    }
    photo ??= row.author || siteOf(row.source);
    license ??= row.license;
  }
  if (photo) parts.push(`${L.photo}: ${photo}${license ? `, ${license}` : ""}`);
  else if (license) parts.push(license);
  return parts.join(" • ");
}

/**
 * A one-line source / photo credit in a fixed spot, right-aligned: in the bottom margin under the
 * caption slot in 16:9 and 1:1; at the top of the safe area in 9:16, where the bottom belongs to
 * captions and the platform UI. It never meets the caption slot; long credits shrink to fit.
 */
export function credit(root: Node<any>, opts: CreditOptions): GroupNode {
  const { width, height } = root.propsAt(0);
  if (!(width > 0 && height > 0)) throw new Error("credit(): add it to the scene root (it needs a width and height)");
  const L = layout({ width, height });
  const text = creditText(opts);
  const fontFamily = opts.fontFamily ?? "SF Mono";
  const { lineHeight, fontWeight } = L.type.label;
  const background = opts.background === undefined ? "#0000008c" : opts.background;
  const padX = background ? L.u : 0;
  const padY = background ? L.u * 0.4 : 0;
  const room = L.safe.width - padX * 2;
  let fontSize = L.type.label.fontSize;
  const measured = measureText({ text, fontSize, fontFamily, fontWeight, lineHeight });
  if (measured.width > room) fontSize *= room / measured.width;
  const textW = Math.min(measureText({ text, fontSize, fontFamily, fontWeight, lineHeight }).width, room);
  const textH = fontSize * lineHeight;

  // right edge and vertical centre of the credit line
  const portrait = L.orientation === "portrait";
  const right = L.safe.x + L.safe.width - padX;
  const cy = portrait ? L.safe.y + padY + textH / 2 : height - (L.u * 6) / 2;

  const group = new GroupNode({ name: (opts.name ?? "credit").replaceAll("/", "-") });
  if (background) {
    group.add(
      new RectNode({
        name: "backdrop",
        x: right + padX,
        y: cy,
        anchorX: 1,
        anchorY: 0.5,
        width: textW + padX * 2,
        height: textH + padY * 2,
        radius: L.u * 0.6,
        fill: background,
      }),
    );
  }
  group.add(
    new TextNode({
      name: "text",
      text,
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight,
      color: opts.color ?? "#ffffffd9",
      align: "right",
      x: right,
      y: cy,
      anchorX: 1,
      anchorY: 0.5,
      width: textW,
      height: textH,
    }),
  );
  if (opts.at !== undefined && opts.at > 0) {
    group.assign({ opacity: 0 });
    group.to({ opacity: 1 }, { at: opts.at, duration: 0.4, ease: "outCubic" });
  }
  if (opts.until !== undefined) group.to({ opacity: 0 }, { at: opts.until, duration: 0.3, ease: "inOutCubic" });
  return root.add(group);
}

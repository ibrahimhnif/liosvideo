import { afterEach, describe, expect, it } from "vitest";
import { attribution, registerAttributions } from "../src/assets/attributions";
import { credit } from "../src/components/credit";
import { group, setTextMeasurer, type TextProps } from "../src/graph/kinds";
import { layout } from "../src/layout";

const ATTRIBUTIONS = `# Project Asset Attributions

| Asset | Source / URL | Author / Creator | License | Notes / Usage |
| :--- | :--- | :--- | :--- | :--- |
| \`assets/images/habibie.jpg\` | https://commons.wikimedia.org/wiki/File:Habibie.jpg | Kantor Wapres RI | Public domain | Scene 1 |
| \`assets/images/n250.jpg\` | https://commons.wikimedia.org/wiki/File:N250.jpg | Jane Doe | CC BY-SA 4.0 | Scene 4 |
| \`assets/images/lab.png\` | Generated with Google Gemini (\`gemini-nano-banana-2.1\`) | AI-generated | AI-generated image (Google Gemini terms) | v1 · Prompt: a lab |
`;

const measure = (p: TextProps) => ({ width: p.text.length * p.fontSize * 0.55, height: p.fontSize * p.lineHeight });

const layer = (root: ReturnType<typeof group>) => root.children[0] as any;
const textNode = (root: ReturnType<typeof group>) => layer(root).children.find((c: any) => c.kind === "text");

function textOf(root: ReturnType<typeof group>) {
  return textNode(root).propsAt(0).text as string;
}

/** box of a direct child of the credit layer (the layer itself sits at 0,0) */
function absBox(node: any, t = 0) {
  const p = node.propsAt(t);
  return { x: p.x - p.anchorX * p.width, y: p.y - p.anchorY * p.height, width: p.width, height: p.height };
}

describe("attribution()", () => {
  afterEach(() => registerAttributions(""));

  it("reads a row of assets/ATTRIBUTIONS.md by asset path", () => {
    registerAttributions(ATTRIBUTIONS);
    expect(attribution("assets/images/n250.jpg")).toEqual({
      asset: "assets/images/n250.jpg",
      source: "https://commons.wikimedia.org/wiki/File:N250.jpg",
      author: "Jane Doe",
      license: "CC BY-SA 4.0",
      notes: "Scene 4",
    });
    expect(attribution("./assets/images/habibie.jpg")?.author).toBe("Kantor Wapres RI");
    expect(attribution("assets/images/missing.jpg")).toBeUndefined();
  });

  it("reads tables with other columns, Indonesian headers and bare file names", () => {
    registerAttributions(`| file | scene | sumber URL | lisensi |
|---|---|---|---|
| s1-gas-queue.jpg | 1 | https://unsplash.com/photos/people-UhPLbQ78Rlk | Unsplash License |
`);
    expect(attribution("assets/images/s1-gas-queue.jpg")).toMatchObject({
      source: "https://unsplash.com/photos/people-UhPLbQ78Rlk",
      author: "",
      license: "Unsplash License",
      notes: "1",
    });
  });
});

describe("credit()", () => {
  afterEach(() => {
    setTextMeasurer(undefined);
    registerAttributions("");
  });

  it("formats sources, photo and licence in one line", () => {
    const root = group({ name: "s", width: 1920, height: 1080 });
    credit(root, { source: ["ANTARA", "CNBC Indonesia"], photo: "Jane Doe", license: "CC BY-SA 4.0" });
    expect(textOf(root)).toBe("Source: ANTARA • CNBC Indonesia • Photo: Jane Doe, CC BY-SA 4.0");
  });

  it("speaks Indonesian when asked", () => {
    const root = group({ name: "s", width: 1080, height: 1920 });
    credit(root, { source: "Wikipedia", photo: "Kantor Wapres RI", license: "domain publik", lang: "id" });
    expect(textOf(root)).toBe("Sumber: Wikipedia • Foto: Kantor Wapres RI, domain publik");
  });

  it("fills the photo credit from the asset's attribution row", () => {
    registerAttributions(ATTRIBUTIONS);
    const root = group({ name: "s", width: 1920, height: 1080 });
    credit(root, { source: "Wikipedia", asset: "assets/images/n250.jpg" });
    expect(textOf(root)).toBe("Source: Wikipedia • Photo: Jane Doe, CC BY-SA 4.0");
  });

  it("credits the source site when the row has no author", () => {
    registerAttributions(`| file | sumber URL | lisensi |
|---|---|---|
| s1.jpg | https://www.unsplash.com/photos/x | Unsplash License |
`);
    const root = group({ name: "s", width: 1920, height: 1080 });
    credit(root, { asset: "assets/images/s1.jpg", lang: "id" });
    expect(textOf(root)).toBe("Foto: unsplash.com, Unsplash License");
  });

  it("labels AI-generated images as illustrations", () => {
    registerAttributions(ATTRIBUTIONS);
    const root = group({ name: "s", width: 1920, height: 1080 });
    credit(root, { asset: "assets/images/lab.png", lang: "id" });
    expect(textOf(root)).toBe("Ilustrasi AI (Google Gemini)");
  });

  it("refuses an asset that has no attribution row", () => {
    registerAttributions(ATTRIBUTIONS);
    const root = group({ name: "s", width: 1920, height: 1080 });
    expect(() => credit(root, { asset: "assets/images/nope.jpg" })).toThrow(/assets\/images\/nope\.jpg.*ATTRIBUTIONS\.md/);
  });

  for (const [w, h] of [
    [1920, 1080],
    [1080, 1920],
    [1080, 1080],
  ]) {
    it(`stays in the frame and clear of the caption slot at ${w}x${h}`, () => {
      setTextMeasurer(measure);
      const root = group({ name: "s", width: w, height: h });
      credit(root, {
        source: ["A very long source name that keeps going", "Another outlet with a long name", "A third one"],
        photo: "Someone With A Long Name",
        license: "CC BY-SA 4.0",
      });
      const L = layout({ width: w, height: h });
      const cap = L.slot("caption");
      expect(layer(root).children.length).toBe(2); // backdrop + text
      for (const child of layer(root).children) {
        const b = absBox(child);
        expect(b.x).toBeGreaterThanOrEqual(L.safe.x - L.u * 2);
        expect(b.x + b.width).toBeLessThanOrEqual(L.safe.x + L.safe.width + L.u * 2);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height).toBeLessThanOrEqual(h - (h > w ? h * 0.12 : 0) + 0.5);
        const overlaps = b.x < cap.x + cap.width && cap.x < b.x + b.width && b.y < cap.y + cap.height && cap.y < b.y + b.height;
        expect(overlaps).toBe(false);
      }
    });
  }

  it("leaves the backdrop out when background is false", () => {
    const root = group({ name: "s", width: 1920, height: 1080 });
    credit(root, { source: "ANTARA", background: false });
    expect(layer(root).children.map((c: any) => c.kind)).toEqual(["text"]);
  });

  it("fades in at the given time", () => {
    const root = group({ name: "s", width: 1920, height: 1080 });
    credit(root, { source: "ANTARA", at: 1 });
    const node = layer(root);
    expect(node.propsAt(0.5).opacity).toBe(0);
    expect(node.propsAt(2).opacity).toBeGreaterThan(0.8);
  });
});

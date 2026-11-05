import { group, rect, scene, text } from "liosvideo";
import { STYLES } from "../styles/catalog";

/** The reel's title card: the ten styles, listed in catalog order. */
export default scene("title", { duration: 3, background: "#0e0f13" }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const portrait = height > width;
  const x = width * (portrait ? 0.1 : 0.08);

  const head = root.add(group({ name: "head", x, y: height * (portrait ? 0.1 : 0.12) }));
  head.add(text({ name: "kicker", text: "LIOSVIDEO STYLE LAB", fontFamily: "Avenir Next", fontWeight: 600, fontSize: u * 2.6, color: "#8b8d98" }));
  head.add(text({ name: "title", text: "10 animation styles", y: u * 4, fontFamily: "Avenir Next", fontWeight: 800, fontSize: u * 8, color: "#ffffff" }));
  head.set({ opacity: 0 }, 0);
  head.to({ opacity: 1 }, { at: 0.1, duration: 0.4, ease: "outCubic" });

  // one column in 9:16, two in 16:9
  const cols = portrait ? 1 : 2;
  const rows = Math.ceil(STYLES.length / cols);
  const top = height * (portrait ? 0.27 : 0.4);
  const rowH = portrait ? u * 10 : u * 9.5;
  STYLES.forEach((s, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const item = root.add(group({ name: `item-${s.id}`, x: x + col * width * 0.45, y: top + row * rowH }));
    item.add(rect({ name: "dot", y: u * 1.2, width: u * 1.2, height: u * 1.2, radius: u * 0.6, fill: s.three ? "#7ee0ff" : "#ffbf3c" }));
    item.add(text({ name: "num", text: String(i + 1).padStart(2, "0"), x: u * (portrait ? 3.5 : 3), fontFamily: "Menlo", fontSize: u * (portrait ? 3.6 : 2.6), color: "#5d606c" }));
    item.add(text({ name: "label", text: s.title, x: u * (portrait ? 10 : 8), fontFamily: "Avenir Next", fontWeight: 600, fontSize: u * (portrait ? 4.8 : 3.4), color: "#e9eaf0" }));
    item.set({ opacity: 0, x: x + col * width * 0.45 - u * 3 }, 0);
    item.to({ opacity: 1, x: x + col * width * 0.45 }, { at: 0.4 + i * 0.12, duration: 0.35, ease: "outCubic" });
  });
});

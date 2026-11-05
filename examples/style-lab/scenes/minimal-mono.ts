import { text, scene } from "liosvideo";
import { fadeUp, handUnderline, measure, statement, theme } from "../styles/minimal-mono";

export default scene("minimal-mono", { duration: 4, background: theme.colors.bg }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const portrait = height > width;
  const size = u * (portrait ? 8.5 : 7);
  const x = width * (portrait ? 0.1 : 0.14);

  // one idea per screen: the setup, then the turn
  const lines = portrait
    ? ["You don't need", "more time.", "You need fewer", "priorities."]
    : ["You don't need more time.", "You need fewer priorities."];
  const blockH = lines.length * size * 1.3;
  const top = height * 0.46 - blockH / 2;
  const block = root.add(statement(lines, { x, y: top, size, at: 0.3, stagger: 0.45 }));

  // the key word gets a hand-drawn underline when it lands
  const row = lines.findIndex((l) => l.includes("fewer"));
  const line = lines[row];
  const before = measure(line.slice(0, line.indexOf("fewer")), size);
  const word = measure("fewer", size);
  block.add(handUnderline(before, row * size * 1.3 + size * 1.15, word * 0.96, { at: 0.3 + row * 0.45 + 0.6, thickness: size * 0.07 }));

  // a quiet caption at the bottom
  fadeUp(
    root.add(text({ name: "caption", text: "— on focus", x, y: top + blockH + size * 1.2, fontFamily: theme.fonts.caption, fontSize: size * 0.32, color: c.muted })),
    2.4,
    u * 1.5,
  );
});

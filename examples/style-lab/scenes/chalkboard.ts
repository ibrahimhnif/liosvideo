import { circle, scene } from "liosvideo";
import { board, chalkArrow, chalkCircle, chalkLayer, chalkLine, chalkWrite, theme } from "../styles/chalkboard";

export default scene("chalkboard", { duration: 4, background: theme.colors.board }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const portrait = height > width;
  root.add(board(width, height));
  const chalk = root.add(chalkLayer(width, height));

  // title, written then underlined
  const titleSize = u * (portrait ? 8 : 7);
  const titleX = width * 0.08;
  const titleY = height * (portrait ? 0.1 : 0.08);
  chalk.add(chalkWrite("How orbits work", { size: titleSize, x: titleX, y: titleY, at: 0.1, duration: 1.0 }));
  chalk.add(chalkLine([[titleX, titleY + titleSize * 1.5], [titleX + titleSize * 8.6, titleY + titleSize * 1.45]], { width: u * 0.8, color: c.yellow, at: 1.1, duration: 0.3 }));

  // planet, orbit and moon
  const cx = width * (portrait ? 0.5 : 0.38);
  const cy = height * (portrait ? 0.48 : 0.58);
  const r = u * (portrait ? 14 : 12);
  chalk.add(chalkCircle(cx, cy, r, { width: u * 0.9, at: 1.0, duration: 0.6 }));
  // shading: diagonal hatching clipped to the lower-right of the planet
  for (let k = 0; k < 6; k++) {
    const t = 0.15 + k * 0.13;
    const hx = cx + r * (t - 0.1);
    const half = Math.sqrt(Math.max(0, 1 - t * t)) * r * 0.9;
    chalk.add(chalkLine([[hx - half * 0.4, cy + half * 0.6], [hx + half * 0.4, cy - half * 0.6]], { name: `hatch${k}`, width: u * 0.4, at: 1.6 + k * 0.05, duration: 0.1 }));
  }
  const orbit: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    orbit.push([cx + Math.cos(a) * r * 2.6, cy + Math.sin(a) * r * 1.2]);
  }
  chalk.add(chalkLine(orbit, { name: "orbit", width: u * 0.5, color: c.blue, at: 1.5, duration: 0.8 }));
  const moon = chalk.add(circle({ name: "moon", radius: u * 2.6, anchorX: 0.5, anchorY: 0.5, x: cx + r * 2.6, y: cy, fill: c.chalk, opacity: 0 }));
  moon.set({ opacity: 1 }, 2.3);
  for (let k = 1; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 0.9;
    moon.to({ x: cx + Math.cos(a) * r * 2.6, y: cy + Math.sin(a) * r * 1.2 }, { at: 2.3 + (k - 1) * 0.28, duration: 0.28, ease: "linear" });
  }

  // label with an arrow
  const labelX = portrait ? width * 0.12 : width * 0.68;
  const labelY = portrait ? height * 0.72 : height * 0.3;
  chalk.add(chalkWrite("gravity pulls", { size: u * 5, x: labelX, y: labelY, at: 2.0, duration: 0.7, color: c.pink }));
  chalk.add(chalkArrow([labelX + u * 10, labelY + (portrait ? -u * 2 : u * 9)], [cx + r * 0.8, cy - r * (portrait ? -0.6 : 0.6)], { width: u * 0.7, color: c.pink, at: 2.6, duration: 0.5 }));

  // formula
  chalk.add(chalkWrite("F = G·m₁m₂ / r²", { size: u * 6, x: width * 0.08, y: height * (portrait ? 0.84 : 0.82), at: 2.9, duration: 0.9, color: c.yellow }));
});

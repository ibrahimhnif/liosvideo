import { circle, group, rect, scene, text } from "liosvideo";
import { coin, grow, person, pop, stat, theme } from "../styles/flat-vector";

export default scene("flat-vector", { duration: 4, background: theme.colors.bg }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const portrait = height > width;

  // soft background blobs
  pop(root.add(circle({ name: "blob1", radius: u * 38, x: width * 0.85, y: height * 0.18, anchorX: 0.5, anchorY: 0.5, fill: "#ffe3d8" })), 0, 0.6);
  pop(root.add(circle({ name: "blob2", radius: u * 30, x: width * 0.1, y: height * 0.9, anchorX: 0.5, anchorY: 0.5, fill: "#d7f3ef" })), 0.1, 0.6);

  // headline
  const title = root.add(group({ name: "headline", x: width * 0.08, y: height * (portrait ? 0.08 : 0.1) }));
  title.add(text({ name: "line1", text: "Grow", fontFamily: theme.fonts.heading, fontWeight: 800, fontSize: u * 11, color: c.navy }));
  title.add(text({ name: "line2", text: "3× faster", y: u * 12, fontFamily: theme.fonts.heading, fontWeight: 800, fontSize: u * 11, color: c.coral }));
  title.set({ opacity: 0, y: title.propsAt(0).y + u * 4 }, 0);
  title.to({ opacity: 1, y: height * (portrait ? 0.08 : 0.1) }, { at: 0.15, duration: 0.5, ease: theme.ease.glide });

  // the chart: four bars on a baseline
  const chartX = portrait ? width * 0.12 : width * 0.5;
  const chartY = portrait ? height * 0.62 : height * 0.82;
  const barW = u * (portrait ? 10 : 9);
  root.add(rect({ name: "baseline", x: chartX - u * 2, y: chartY, width: barW * 5.6, height: u * 0.8, radius: u * 0.4, fill: c.navy }));
  [0.25, 0.42, 0.6, 0.95].forEach((k, i) => {
    const bar = root.add(
      rect({ name: `bar${i}`, x: chartX + i * barW * 1.4, y: chartY, width: barW, height: u * 40 * k, radius: u * 2, anchorY: 1, fill: [c.teal, c.lavender, c.yellow, c.coral][i] }),
    );
    grow(bar, 0.6 + i * 0.12);
  });

  // the character beside the chart, waving
  const who = root.add(person(portrait ? width * 0.84 : width * 0.4, portrait ? height * 0.62 : height * 0.82, u * 22, { shirt: c.lavender }));
  pop(who, 0.4);
  who.to({ rotation: 4 }, { at: 1.4, duration: 0.3, ease: "inOutCubic" });
  who.to({ rotation: -4 }, { at: 1.7, duration: 0.3, ease: "inOutCubic" });
  who.to({ rotation: 0 }, { at: 2.0, duration: 0.3, ease: "inOutCubic" });

  // coins bounce up out of the tallest bar
  for (let i = 0; i < 3; i++) {
    const cx = chartX + 3 * barW * 1.4 + barW / 2 + (i - 1) * u * 7;
    const piece = root.add(coin(cx, chartY - u * 40, u * 4, { opacity: 0 }));
    piece.set({ opacity: 1 }, 1.3 + i * 0.12);
    piece.to({ y: chartY - u * (52 + i * 4) }, { at: 1.3 + i * 0.12, duration: 0.5, ease: theme.ease.pop });
  }

  // stat cards
  // two cards side by side under the chart (9:16), stacked under the headline (16:9)
  const cards = portrait
    ? [[width * 0.3, height * 0.8], [width * 0.7, height * 0.8]]
    : [[width * 0.18, height * 0.52], [width * 0.18, height * 0.76]];
  const cardW = u * (portrait ? 36 : 26);
  pop(root.add(stat("+312%", "monthly revenue", { x: cards[0][0], y: cards[0][1], width: cardW, color: c.teal })), 2.0);
  pop(root.add(stat("48k", "new customers", { x: cards[1][0], y: cards[1][1], width: cardW, color: c.coral })), 2.15);
});

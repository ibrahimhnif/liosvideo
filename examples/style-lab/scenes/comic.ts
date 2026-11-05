import { circle, rect, scene } from "liosvideo";
import { actionWord, caption, panel, shake, speechBubble, speedLines, theme } from "../styles/comic";

export default scene("comic", { duration: 4, background: theme.colors.paper }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const portrait = height > width;
  const gap = u * 2.5;

  // page layout: three stacked panels in 9:16, three side by side in 16:9
  const boxes = portrait
    ? [[gap, gap, width - gap * 2, height * 0.3], [gap, height * 0.3 + gap * 2, width - gap * 2, height * 0.28], [gap, height * 0.58 + gap * 3, width - gap * 2, height * 0.42 - gap * 4]]
    : [[gap, gap, width * 0.3, height - gap * 2], [width * 0.3 + gap * 2, gap, width * 0.3, height - gap * 2], [width * 0.6 + gap * 3, gap, width * 0.4 - gap * 4, height - gap * 2]];
  const panels = boxes.map(([x, y, w, h], i) => {
    const p = root.add(panel(x, y, w, h, { name: `panel${i}`, bg: [c.sky, c.purple, c.red][i] }));
    p.set({ opacity: 0, scaleX: 0.9, scaleY: 0.9 }, 0);
    p.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: i * 0.7, duration: 0.25, ease: theme.ease.pop });
    return p;
  });

  // 1 — the hero on a rooftop, wondering
  {
    const [, , w, h] = boxes[0];
    const a = panels[0].art;
    a.add(rect({ name: "roof", y: h * 0.78, width: w, height: h * 0.3, fill: "#4a4e69" }));
    const m = Math.min(w, h);
    a.add(circle({ name: "moon", radius: m * 0.12, x: w * 0.82, y: h * 0.22, anchorX: 0.5, anchorY: 0.5, fill: c.yellow }));
    const headY = h * 0.78 - m * 0.42;
    const hero = a.add(circle({ name: "head", radius: m * 0.13, x: w * 0.25, y: headY, anchorX: 0.5, anchorY: 0.5, fill: c.skin }));
    a.add(rect({ name: "cape", x: w * 0.25, y: headY + m * 0.1, width: m * 0.32, height: m * 0.34, anchorX: 0.5, radius: m * 0.05, fill: c.red }));
    hero.to({ rotation: -6 }, { at: 0.3, duration: 0.6 });
    panels[0].add(caption("Meanwhile, downtown…", { x: u * 2, y: u * 2, size: u * 3 }));
    const b = panels[0].add(
      speechBubble("What was\nthat sound?", {
        x: portrait ? w * 0.62 : w * 0.5, y: portrait ? h * 0.48 : headY - m * 0.45, width: w * 0.38, size: u * 3.6, tailX: w * 0.3, tailY: headY,
      }),
    );
    b.set({ scaleX: 0, scaleY: 0 }, 0);
    b.to({ scaleX: 1, scaleY: 1 }, { at: 0.35, duration: 0.25, ease: theme.ease.pop });
  }

  // 2 — close-up: wide eyes and speed lines
  {
    const [, , w, h] = boxes[1];
    const a = panels[1].art;
    a.add(speedLines(w, h, 20, "#c8b6ff"));
    a.add(circle({ name: "face", radius: Math.min(w, h) * 0.42, x: w / 2, y: h * 0.62, anchorX: 0.5, anchorY: 0.5, fill: c.skin }));
    for (const side of [-1, 1]) {
      a.add(circle({ name: `eye${side}`, radius: Math.min(w, h) * 0.1, x: w / 2 + side * Math.min(w, h) * 0.16, y: h * 0.52, anchorX: 0.5, anchorY: 0.5, fill: "#ffffff" }));
      const pupil = a.add(circle({ name: `pupil${side}`, radius: Math.min(w, h) * 0.04, x: w / 2 + side * Math.min(w, h) * 0.16, y: h * 0.52, anchorX: 0.5, anchorY: 0.5, fill: c.ink }));
      pupil.to({ scaleX: 0.5, scaleY: 0.5 }, { at: 1.0, duration: 0.15 });
    }
  }

  // 3 — the explosion
  {
    const [, , w, h] = boxes[2];
    const a = panels[2].art;
    a.add(speedLines(w, h, 24, c.yellow));
    const boom = panels[2].add(actionWord("KA-BOOM!", { x: w / 2, y: h / 2, size: Math.min(w, h) * 0.2 }));
    boom.set({ scaleX: 0, scaleY: 0 }, 0);
    boom.to({ scaleX: 1, scaleY: 1 }, { at: 1.6, duration: 0.3, ease: theme.ease.pop });
    shake(panels[2], 1.9, u * 1.2, 0.4);
  }
});

import { group, scene } from "liosvideo";
import { boil, flicker, neonCircle, neonLayer, neonLine, neonText, spark, theme } from "../styles/glow-sketch";

export default scene("glow-sketch", { duration: 4, background: theme.colors.bg }, ({ root, width, height, random }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const neon = root.add(neonLayer(width, height));

  // stars twinkle in
  for (let i = 0; i < 26; i++) {
    const s = neon.add(spark(random() * width, random() * height * 0.9, u * (0.25 + random() * 0.4), i % 3 ? c.white : c.cyan, { opacity: 0 }));
    s.to({ opacity: 0.9 }, { at: random() * 1.2, duration: 0.3 });
  }

  // a rocket, drawn line by line
  const cx = width / 2;
  const cy = height * 0.5;
  const s = u * 1.1; // drawing unit
  const rocket = neon.add(group({ name: "rocket", x: cx, y: cy }));
  const w = u * 0.7;
  rocket.add(neonLine([[0, -30 * s], [9 * s, -14 * s], [9 * s, 14 * s], [-9 * s, 14 * s], [-9 * s, -14 * s], [0, -30 * s]], { name: "body", width: w, color: c.cyan, at: 0.2, duration: 1.0 }));
  rocket.add(neonCircle(0, -6 * s, 4 * s, { width: w, color: c.magenta, at: 0.9, duration: 0.4 }));
  rocket.add(neonLine([[9 * s, 4 * s], [17 * s, 18 * s], [9 * s, 14 * s]], { name: "finR", width: w, color: c.magenta, at: 1.2, duration: 0.3 }));
  rocket.add(neonLine([[-9 * s, 4 * s], [-17 * s, 18 * s], [-9 * s, 14 * s]], { name: "finL", width: w, color: c.magenta, at: 1.3, duration: 0.3 }));
  boil(rocket, random, u * 0.35, 0, 2.4, 8);

  // flame flickers, then the rocket lifts off
  const flame = rocket.add(group({ name: "flame", opacity: 0 }));
  flame.add(neonLine([[-5 * s, 15 * s], [0, 30 * s], [5 * s, 15 * s]], { name: "outer", width: w, color: c.amber }));
  flame.add(neonLine([[-2.5 * s, 15 * s], [0, 23 * s], [2.5 * s, 15 * s]], { name: "inner", width: w * 0.8, color: c.lime }));
  flame.set({ opacity: 1 }, 1.7);
  for (let t = 1.7; t < 4; t += 1 / 12) flame.set({ scaleY: 0.8 + random() * 0.5 }, t);
  rocket.to({ y: cy - height * 0.62 }, { at: 2.4, duration: 1.5, ease: "inCubic" });

  // neon sign
  const sign = neon.add(neonText("LIFT OFF", u * 11, c.magenta, { x: cx, y: height * (height > width ? 0.82 : 0.86), opacity: 0 }));
  sign.set({ opacity: 1 }, 2.0);
  flicker(sign, random, 2.0, 2.7);
});

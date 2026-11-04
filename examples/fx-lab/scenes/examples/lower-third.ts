import { circle, rect, scene, text } from "liosvideo";
import { chip, fonts, lowerThird, palette, ticker } from "../../fx";

export default scene("ex-lower-third", { duration: 3, background: "#0D1319" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0D1319" }));
  root.add(
    circle({
      name: "glow",
      radius: 360,
      x: width * 0.78,
      y: height * 0.3,
      anchorX: 0.5,
      anchorY: 0.5,
      fill: "#12202A",
    }),
  );

  const card = lowerThird(root, {
    name: "FERRY IRWANDI",
    role: "VIDEO ESSAYIST · TIM MALAKA",
    x: 140,
    y: 660,
    width: 620,
    at: 0.3,
    accent: palette.amber,
  });
  card.set({ scaleX: 2.3, scaleY: 2.3 }, 0);

  ticker(root, {
    text: "SUMBER: ARSIP NASIONAL · DATA BPS 2024 · METODOLOGI TERBUKA · ",
    x: 140,
    y: 880,
    startX: 120,
    width: 1640,
    at: 0.35,
    speed: 95,
    fontSize: 15,
    height: 32,
    bg: "#0A0F15",
    color: palette.muted,
  });

  chip(root, { label: "LIVE", x: width - 200, y: 80, at: 0.2, color: palette.rose, size: 14 });

  root.add(
    text({
      name: "watermark",
      text: "LOWER THIRD + TICKER",
      x: 140,
      y: 660,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.dim,
    }),
  );
});

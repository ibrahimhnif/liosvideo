import { rect, scene, text } from "liosvideo";
import { confetti, fonts, palette, pillBadge } from "../../fx";

export default scene("ex-confetti", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0A0C10" }));

  confetti(root, { width, height, count: 64, at: 0.15, duration: 2.2, seed: 9 });

  const title = root.add(
    text({
      name: "title",
      text: "1 JUTA",
      x: width / 2,
      y: height / 2 - 140,
      anchorX: 0.5,
      fontFamily: fonts.display,
      fontSize: 220,
      fontWeight: 700,
      color: "#FFFFFF",
      opacity: 0,
    }),
  );
  title.to({ opacity: 1, y: height / 2 - 150 }, { at: 0.2, duration: 0.45, ease: "outBack" });

  const sub = root.add(
    text({
      name: "sub",
      text: "SUBSCRIBER",
      x: width / 2,
      y: height / 2 + 40,
      anchorX: 0.5,
      fontFamily: fonts.mono,
      fontSize: 30,
      fontWeight: 700,
      color: palette.amber,
      opacity: 0,
    }),
  );
  sub.to({ opacity: 1 }, { at: 0.55, duration: 0.4 });

  pillBadge(root, {
    label: "TERIMA KASIH",
    x: width / 2 - 130,
    y: height / 2 + 130,
    at: 0.9,
    size: 18,
    height: 46,
    paddingX: 26,
    color: palette.emerald,
    bg: "#0F2A22",
  });
});

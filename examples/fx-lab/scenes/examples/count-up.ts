import { rect, scene, text } from "liosvideo";
import { countUp, fonts, palette, pillBadge, progressBar } from "../../fx";

export default scene("ex-count-up", { duration: 3, background: "#0E131A" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0E131A" }));

  root.add(
    text({
      name: "label",
      text: "PENONTON BARU · 30 HARI",
      x: 190,
      y: 300,
      fontFamily: fonts.mono,
      fontSize: 18,
      color: palette.dim,
    }),
  );

  countUp(root, {
    from: 0,
    to: 128,
    x: 184,
    y: 352,
    size: 190,
    color: palette.text,
    at: 0.2,
    duration: 1.4,
  });

  root.add(
    text({
      name: "unit",
      text: "RIBU",
      x: 700,
      y: 470,
      fontFamily: fonts.mono,
      fontSize: 28,
      fontWeight: 700,
      color: palette.muted,
    }),
  );

  pillBadge(root, {
    label: "+312%",
    x: 1240,
    y: 372,
    at: 1.35,
    size: 20,
    height: 44,
    paddingX: 18,
    color: palette.emerald,
    bg: "#0F2A22",
  });

  progressBar(root, {
    x: 190,
    y: 620,
    width: 900,
    height: 8,
    at: 0.4,
    duration: 1.2,
    progress: 0.78,
    color: palette.emerald,
  });
});

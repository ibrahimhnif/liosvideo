import { rect, scene, text } from "liosvideo";
import { fonts, karaokeCaption, palette } from "../../fx";

export default scene("ex-karaoke-caption", { duration: 3, background: "#08080A" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#08080A" }));

  root.add(
    text({
      name: "label",
      text: "KARAOKE CAPTION",
      x: 80,
      y: 80,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.dim,
    }),
  );

  karaokeCaption(root, {
    words: [
      { text: "INI", start: 0.45, end: 0.85 },
      { text: "BUKAN", start: 0.85, end: 1.3 },
      { text: "MITOS,", start: 1.3, end: 1.75 },
      { text: "TAPI", start: 1.75, end: 2.05 },
      { text: "DATA.", start: 2.05, end: 2.55 },
    ],
    x: width / 2,
    y: height / 2,
    size: 84,
    activeColor: palette.amber,
    color: "#FFFFFF",
    dimColor: "#3E4757",
  });
});

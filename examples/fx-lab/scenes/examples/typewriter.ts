import { rect, scene, text } from "liosvideo";
import { fadeIn, fonts, highlighter, palette, typewriter } from "../../fx";

export default scene("ex-typewriter", { duration: 3, background: "#0B0E13" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0B0E13" }));

  const line = "Data tidak pernah berbohong.";
  const size = 54;
  const at = 0.15;

  const typed = typewriter(root, {
    text: line,
    x: 208,
    y: 468,
    fontSize: size,
    at,
    duration: 1.25,
    cursorColor: palette.amber,
  });

  highlighter(root, {
    textNode: typed.text,
    at: at + 1.35,
    opacity: 0.26,
    color: palette.amber,
    padding: 12,
  });

  const sig = root.add(
    text({
      name: "sig",
      text: "— catatan riset, 03",
      x: 210,
      y: 604,
      fontFamily: fonts.mono,
      fontSize: 20,
      color: palette.dim,
      opacity: 0,
    }),
  );
  fadeIn(sig, { at: 1.55, duration: 0.4 });

  root.add(
    text({
      name: "label",
      text: "TYPEWRITER · STABILO",
      x: 210,
      y: 320,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.dim,
    }),
  );
});

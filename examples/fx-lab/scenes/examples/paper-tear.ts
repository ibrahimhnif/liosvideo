import { scene, text } from "liosvideo";
import { fadeIn, fonts, palette, tornPaper } from "../../fx";

export default scene("ex-paper-tear", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  tornPaper(root, { width, height, at: 0.05, accent: palette.amber, speed: 1.0 });

  const head = root.add(
    text({
      name: "head",
      text: "FAKTA",
      x: 320,
      y: 372,
      fontFamily: fonts.sans,
      fontSize: 150,
      fontWeight: 700,
      color: palette.amber,
      opacity: 0,
    }),
  );
  fadeIn(head, { at: 0.5, duration: 0.32 });

  const sub = root.add(
    text({
      name: "sub",
      text: "BUKAN OPINI",
      x: 324,
      y: 556,
      fontFamily: fonts.mono,
      fontSize: 22,
      fontWeight: 700,
      color: "#A9B2C2",
      opacity: 0,
    }),
  );
  fadeIn(sub, { at: 0.75, duration: 0.35 });

  root.add(
    text({
      name: "tag",
      text: "ARSIP · 1998",
      x: 60,
      y: 60,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: "#5A6577",
    }),
  );
});

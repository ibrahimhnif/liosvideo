import { rect, scene, text } from "liosvideo";
import { fonts, palette, waveform } from "../../fx";

export default scene("ex-waveform", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0A0C10" }));

  const title = root.add(
    text({
      name: "title",
      text: "SUARA DARI TEPI",
      x: 200,
      y: 320,
      fontFamily: fonts.serif,
      fontSize: 72,
      fontWeight: 700,
      color: "#EFE6D2",
      opacity: 0,
    }),
  );
  title.to({ opacity: 1 }, { at: 0.25, duration: 0.5 });

  root.add(
    text({
      name: "meta",
      text: "EPISODE 04 · 32:18",
      x: 204,
      y: 420,
      fontFamily: fonts.mono,
      fontSize: 16,
      color: palette.dim,
    }),
  );

  waveform(root, {
    x: 200,
    y: 600,
    width: 1520,
    height: 220,
    bars: 44,
    at: 0.1,
    step: 0.13,
    color: palette.cyan,
  });

  root.add(rect({ name: "baseline", x: 200, y: 822, width: 1520, height: 1, fill: palette.border }));
});

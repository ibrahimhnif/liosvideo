import { image, rect, scene, text } from "liosvideo";
import { dustMotes, fadeIn, fonts, grainOverlay, palette, scanlines, vignette } from "../../fx";

export default scene("ex-film-grain", { duration: 3, background: "#07080B" }, ({ root, width, height }) => {
  root.add(
    image({
      name: "photo",
      width,
      height,
      src: "assets/images/old-newspaper.jpg",
      fit: "cover",
    }),
  );
  root.add(rect({ name: "grade", width, height, fill: "#0A0C10", opacity: 0.46 }));
  grainOverlay(root, { width, height, amount: 0.26, at: 0 });
  scanlines(root, { width, height, at: 0, strength: 0.12, pitch: 4 });
  dustMotes(root, { width, height, count: 24, seed: 4, at: 0.1, duration: 2.4 });

  const kicker = root.add(
    text({
      name: "kicker",
      text: "ARSIP / EPISODE 04",
      x: 164,
      y: 330,
      fontFamily: fonts.mono,
      fontSize: 15,
      color: palette.amber,
      opacity: 0,
    }),
  );
  fadeIn(kicker, { at: 0.2, duration: 0.45 });

  const title = root.add(
    text({
      name: "title",
      text: "Kebenaran yang Tertunda",
      x: 160,
      y: 372,
      fontFamily: fonts.serif,
      fontSize: 84,
      fontWeight: 700,
      color: "#EFE6D2",
      opacity: 0,
    }),
  );
  fadeIn(title, { at: 0.4, duration: 0.6 });
  title.to({ y: 360 }, { at: 0.4, duration: 0.8, ease: "outCubic" });

  const rule = root.add(rect({ name: "rule", x: 164, y: 500, width: 0, height: 2, fill: palette.amber }));
  rule.to({ width: 460 }, { at: 0.85, duration: 0.8, ease: "outCubic" });

  vignette(root, { width, height, strength: 0.9 });
});

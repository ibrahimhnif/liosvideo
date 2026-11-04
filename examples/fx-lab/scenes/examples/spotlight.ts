import { image, rect, scene, text } from "liosvideo";
import { dustMotes, fadeIn, fonts, lightPool, palette, spotlight } from "../../fx";

export default scene("ex-spotlight", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(
    image({
      name: "photo",
      width,
      height,
      src: "assets/images/library-books.jpg",
      fit: "cover",
    }),
  );
  root.add(rect({ name: "grade", width, height, fill: "#07090C", opacity: 0.58 }));

  lightPool(root, {
    width,
    height,
    at: 0,
    center: [0.5, 0.55],
    radius: 0.52,
    drift: 0.06,
    strength: 0.45,
  });

  dustMotes(root, { width, height, count: 28, seed: 21, at: 0.1, duration: 2.2 });

  spotlight(root, {
    width,
    height,
    at: 0,
    center: [0.5, 0.55],
    radius: 0.58,
    drift: 0.06,
    strength: 0.82,
  });

  const label = root.add(
    text({
      name: "focus-label",
      text: "FOKUS",
      x: width / 2,
      y: height - 120,
      anchorX: 0.5,
      fontFamily: fonts.mono,
      fontSize: 18,
      fontWeight: 700,
      color: palette.amber,
      opacity: 0,
    }),
  );
  fadeIn(label, { at: 0.6, duration: 0.4 });
});

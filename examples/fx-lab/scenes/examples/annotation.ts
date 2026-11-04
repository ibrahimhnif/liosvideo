import { image, rect, scene, text } from "liosvideo";
import { annotationCircle, arrowPointer, fonts, palette } from "../../fx";

export default scene("ex-annotation", { duration: 3, background: "#0B0E13" }, ({ root, width, height }) => {
  root.add(
    image({
      name: "photo",
      width,
      height,
      src: "assets/images/smartphone.jpg",
      fit: "cover",
    }),
  );
  root.add(rect({ name: "grade", width, height, fill: "#07090C", opacity: 0.32 }));

  annotationCircle(root, {
    x: 100,
    y: 520,
    width: 820,
    height: 480,
    at: 0.35,
    duration: 0.6,
    color: palette.rose,
    thickness: 0.016,
  });

  arrowPointer(root, {
    from: { x: 1240, y: 860 },
    to: { x: 930, y: 790 },
    at: 0.7,
    color: palette.rose,
    headLength: 34,
  });

  const label = root.add(
    text({
      name: "annotation-label",
      text: "TAMPILAN UTAMA",
      x: 1180,
      y: 790,
      fontFamily: fonts.mono,
      fontSize: 20,
      fontWeight: 700,
      color: palette.rose,
      opacity: 0,
    }),
  );
  label.to({ opacity: 1 }, { at: 0.9, duration: 0.3 });

  const tag = root.add(
    text({
      name: "tag",
      text: "ANNOTATION",
      x: 80,
      y: 80,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.text,
      opacity: 0.7,
    }),
  );
  tag.set({ opacity: 0.7 }, 0);
});

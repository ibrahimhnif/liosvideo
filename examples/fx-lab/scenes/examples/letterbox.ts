import { image, rect, scene, text } from "liosvideo";
import { fonts, letterbox, lightLeak, palette } from "../../fx";

export default scene("ex-letterbox", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(
    image({
      name: "photo",
      width,
      height,
      src: "assets/images/misty-mountains.jpg",
      fit: "cover",
    }),
  );
  root.add(rect({ name: "grade", width, height, fill: "#0A0C10", opacity: 0.34 }));

  letterbox(root, { width, height, ratio: 0.115, at: 0.15, duration: 0.6 });
  lightLeak(root, { width, height, at: 0.6, strength: 0.45 });

  const title = root.add(
    text({
      name: "title",
      text: "SUARA DARI TEPI",
      x: width / 2,
      y: height * 0.44,
      anchorX: 0.5,
      fontFamily: fonts.serif,
      fontSize: 72,
      fontWeight: 700,
      color: "#EFE6D2",
      opacity: 0,
    }),
  );
  title.to({ opacity: 1 }, { at: 0.7, duration: 0.5 });

  const ratio = root.add(
    text({
      name: "ratio",
      text: "2.39 : 1",
      x: width - 80,
      y: height - 56,
      anchorX: 1,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.amber,
      opacity: 0,
    }),
  );
  ratio.to({ opacity: 1 }, { at: 0.8, duration: 0.35 });
});

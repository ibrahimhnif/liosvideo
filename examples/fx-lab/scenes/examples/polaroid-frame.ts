import { rect, scene, text } from "liosvideo";
import { fonts, halftone, palette, polaroidFrame } from "../../fx";

export default scene("ex-polaroid-frame", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0A0C10" }));
  halftone(root, { width, height, size: 7, strength: 0.16 });

  polaroidFrame(root, {
    x: 250,
    y: 310,
    width: 380,
    height: 450,
    rotation: -7,
    at: 0.15,
    caption: "JAKARTA · 1998",
    imageSrc: "assets/images/old-newspaper.jpg",
  });
  polaroidFrame(root, {
    x: 720,
    y: 270,
    width: 380,
    height: 450,
    rotation: 4,
    at: 0.3,
    caption: "ARSIP · BPS",
    imageSrc: "assets/images/road-cycling.jpg",
  });
  polaroidFrame(root, {
    x: 1190,
    y: 330,
    width: 380,
    height: 450,
    rotation: -3,
    at: 0.45,
    caption: "SUMBER · NO. 12",
    imageSrc: "assets/images/smartphone.jpg",
  });

  root.add(
    text({
      name: "tag",
      text: "POLAROID COLLAGE · HALFTONE",
      x: 80,
      y: 90,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.dim,
    }),
  );
});

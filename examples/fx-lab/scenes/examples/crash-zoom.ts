import { group, image, rect, scene, text } from "liosvideo";
import { crashZoom, fonts, palette, shake } from "../../fx";

export default scene("ex-crash-zoom", { duration: 3, background: "#0C1219" }, ({ root, width, height }) => {
  const subject = root.add(
    group({
      name: "subject",
      x: width / 2,
      y: height / 2,
      width,
      height,
      anchorX: 0.5,
      anchorY: 0.5,
    }),
  );

  subject.add(
    image({
      name: "photo",
      width,
      height,
      src: "assets/images/road-cycling.jpg",
      fit: "cover",
    }),
  );
  subject.add(rect({ name: "grade", width, height, fill: "#0A0C10", opacity: 0.22 }));

  crashZoom(subject, { at: 0.2, from: 1, to: 1.28, duration: 0.28 });
  shake(subject, { at: 0.5, intensity: 14, duration: 0.42 });

  const flash = root.add(rect({ name: "flash", width, height, fill: "#FFFFFF", opacity: 0 }));
  flash.to({ opacity: 0.16 }, { at: 0.49, duration: 0.05 });
  flash.to({ opacity: 0 }, { at: 0.54, duration: 0.3 });

  const label = root.add(
    text({
      name: "label",
      text: "CRASH ZOOM 1.28×",
      x: width - 120,
      y: 100,
      anchorX: 1,
      fontFamily: fonts.mono,
      fontSize: 16,
      fontWeight: 700,
      color: palette.amber,
    }),
  );
  label.set({ opacity: 0 }, 0);
  label.to({ opacity: 1 }, { at: 0.5, duration: 0.2 });
});

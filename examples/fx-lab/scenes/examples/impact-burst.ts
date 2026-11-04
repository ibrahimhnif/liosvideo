import { circle, rect, scene, text } from "liosvideo";
import { fonts, palette, speedLines, stampText } from "../../fx";

export default scene("ex-impact-burst", { duration: 3, background: "#0B0E13" }, ({ root, width, height }) => {
  speedLines(root, {
    width,
    height,
    at: 0.2,
    color: palette.rose,
    strength: 0.85,
    count: 30,
  });

  const ring = root.add(
    circle({
      name: "shock-ring",
      radius: 90,
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      fill: "#0B0E13",
      stroke: palette.rose,
      strokeWidth: 4,
      opacity: 0,
    }),
  );
  ring.set({ scaleX: 0.4, scaleY: 0.4 }, 0);
  ring.set({ opacity: 0 }, 0.34);
  ring.to({ opacity: 0.95 }, { at: 0.35, duration: 0.02 });
  ring.to({ scaleX: 3.2, scaleY: 3.2, opacity: 0 }, { at: 0.37, duration: 0.6, ease: "outCubic" });

  const flash = root.add(rect({ name: "flash", width, height, fill: "#FFFFFF", opacity: 0 }));
  flash.to({ opacity: 0.8 }, { at: 0.35, duration: 0.03 });
  flash.to({ opacity: 0 }, { at: 0.39, duration: 0.32 });

  const label = root.add(
    text({
      name: "impact-label",
      text: "BUKTI",
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      fontFamily: fonts.display,
      fontSize: 180,
      fontWeight: 700,
      color: "#FFFFFF",
    }),
  );
  stampText(label, { at: 0.35, from: 2.0, rotation: -8 });

  root.add(
    text({
      name: "tag",
      text: "IMPACT BURST",
      x: 60,
      y: 60,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.muted,
    }),
  );
});

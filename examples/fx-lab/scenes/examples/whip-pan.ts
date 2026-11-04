import { group, rect, scene, text } from "liosvideo";
import { fonts, palette } from "../../fx";

export default scene("ex-whip-pan", { duration: 3, background: "#0B0E13" }, ({ root, width, height }) => {
  const panelA = root.add(group({ name: "panel-a", x: 0, y: 0, width, height }));
  panelA.add(rect({ name: "a-bg", width, height, fill: "#13202E" }));
  panelA.add(
    text({
      name: "a-label",
      text: "SHOT A",
      x: width / 2,
      y: height / 2 - 40,
      anchorX: 0.5,
      fontFamily: fonts.sans,
      fontSize: 96,
      fontWeight: 700,
      color: "#5D7086",
    }),
  );

  const panelB = root.add(group({ name: "panel-b", x: width, y: 0, width, height }));
  panelB.add(rect({ name: "b-bg", width, height, fill: "#2A1C10" }));
  panelB.add(
    text({
      name: "b-label",
      text: "SHOT B",
      x: width / 2,
      y: height / 2 - 40,
      anchorX: 0.5,
      fontFamily: fonts.sans,
      fontSize: 96,
      fontWeight: 700,
      color: palette.amber,
    }),
  );

  for (let i = 0; i < 7; i++) {
    const streak = root.add(
      rect({
        name: `streak-${i}`,
        x: 0,
        y: 90 + i * 130,
        width: 220 + i * 60,
        height: 3,
        fill: palette.amber,
        rotation: -8,
        opacity: 0,
      }),
    );
    streak.to({ opacity: 0.5 }, { at: 0.34, duration: 0.05 });
    streak.to({ opacity: 0 }, { at: 0.4, duration: 0.2 });
  }

  const pans: Array<[number, number, number]> = [
    [0.35, -width, 0],
    [1.7, 0, width],
  ];
  for (const [at, a, b] of pans) {
    panelA.to({ x: a }, { at, duration: 0.3, ease: "outCubic" });
    panelB.to({ x: b }, { at, duration: 0.3, ease: "outCubic" });
  }

  root.add(
    text({
      name: "label",
      text: "WHIP PAN",
      x: 60,
      y: 60,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.muted,
    }),
  );
});

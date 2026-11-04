import { rect, scene, text } from "liosvideo";
import { barChart, fonts, palette } from "../../fx";

export default scene("ex-bar-chart", { duration: 3, background: "#0E131A" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0E131A" }));

  root.add(
    text({
      name: "title",
      text: "PERTUMBUHAN PENGGUNA (JUTA)",
      x: 220,
      y: 180,
      fontFamily: fonts.mono,
      fontSize: 18,
      fontWeight: 700,
      color: palette.muted,
    }),
  );

  barChart(root, {
    x: 220,
    y: 280,
    width: 1440,
    height: 460,
    at: 0.15,
    values: [
      { label: "2020", value: 38 },
      { label: "2021", value: 52 },
      { label: "2022", value: 61 },
      { label: "2023", value: 74 },
      { label: "2024", value: 89 },
    ],
    color: "#2B3A4E",
    highlightColor: palette.amber,
  });

  root.add(
    text({
      name: "source",
      text: "SUMBER: BPS · 2024",
      x: 220,
      y: 940,
      fontFamily: fonts.mono,
      fontSize: 12,
      color: palette.dim,
    }),
  );
});

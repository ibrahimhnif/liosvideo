import { rect, scene, text } from "liosvideo";
import { chapterCard, fonts, palette } from "../../fx";

export default scene("ex-chapter-card", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#0A0C10" }));

  chapterCard(root, {
    index: 2,
    total: 5,
    kicker: "BAGIAN KEDUA",
    title: "Politik Pangan",
    x: 200,
    y: 280,
  });

  root.add(
    text({
      name: "tag",
      text: "CHAPTER CARD",
      x: 200,
      y: 160,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.dim,
    }),
  );
});

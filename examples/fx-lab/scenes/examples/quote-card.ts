import { image, rect, scene, text } from "liosvideo";
import { fonts, palette, quoteCard } from "../../fx";

export default scene("ex-quote-card", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(
    image({
      name: "photo",
      width,
      height,
      src: "assets/images/library-books.jpg",
      fit: "cover",
    }),
  );
  root.add(rect({ name: "grade", width, height, fill: "#07090C", opacity: 0.62 }));
  root.add(rect({ name: "bar", x: 0, y: 0, width: 14, height, fill: palette.amber, opacity: 0.85 }));

  quoteCard(root, {
    lines: ["Kebenaran tidak butuh", "sorotan, hanya bukti."],
    author: "FERRY IRWANDI",
    role: "TIM MALAKA · EPISODE 04",
    x: 210,
    y: 360,
    size: 58,
  });

  root.add(
    text({
      name: "tag",
      text: "EDITORIAL QUOTE",
      x: 214,
      y: 180,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.dim,
    }),
  );
});

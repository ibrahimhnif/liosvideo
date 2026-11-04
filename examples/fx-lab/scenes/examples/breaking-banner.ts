import { image, rect, scene, text } from "liosvideo";
import { breakingBanner, fonts, palette } from "../../fx";

export default scene("ex-breaking-banner", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  root.add(
    image({
      name: "photo",
      width,
      height,
      src: "assets/images/jakarta-skyline.jpg",
      fit: "cover",
    }),
  );
  root.add(rect({ name: "grade", width, height, fill: "#07090C", opacity: 0.62 }));

  breakingBanner(root, {
    width,
    y: 140,
    headline: "BANJIR JAKARTA: 12 KECAMATAN TERDAMPAK",
    at: 0.15,
  });

  const title = root.add(
    text({
      name: "title",
      text: "Krisis Air Tanah",
      x: 120,
      y: 420,
      fontFamily: fonts.serif,
      fontSize: 96,
      fontWeight: 700,
      color: "#EFE6D2",
      opacity: 0,
    }),
  );
  title.to({ opacity: 1 }, { at: 0.45, duration: 0.5 });

  const body = root.add(
    text({
      name: "body",
      text: "Sumur warga menyusut 4 meter dalam 10 tahun.",
      x: 124,
      y: 560,
      fontFamily: fonts.mono,
      fontSize: 22,
      color: palette.muted,
      opacity: 0,
    }),
  );
  body.to({ opacity: 1 }, { at: 0.7, duration: 0.5 });

  root.add(rect({ name: "rule", x: 124, y: 620, width: 620, height: 2, fill: palette.rose, opacity: 0.7 }));
});

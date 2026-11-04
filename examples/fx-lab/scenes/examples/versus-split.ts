import { scene } from "liosvideo";
import { versusSplit } from "../../fx";

export default scene("ex-versus-split", { duration: 3, background: "#0B0E13" }, ({ root, width, height }) => {
  versusSplit(root, {
    width,
    height,
    at: 0.1,
    top: {
      label: "LARI",
      sub: "5 KM · PAGI",
      score: 42,
      color: "#C2410C",
      imageSrc: "assets/images/road-cycling.jpg",
    },
    bottom: {
      label: "SEPEDA",
      sub: "20 KM · PAGI",
      score: 58,
      color: "#0E7490",
      imageSrc: "assets/images/jakarta-skyline.jpg",
    },
  });
});

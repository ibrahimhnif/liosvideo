import { scene, text } from "liosvideo";

export default scene("intro", { duration: 3 }, ({ root, width, height }) => {
  root
    .add(text({ name: "title", text: "New video", fontSize: Math.min(width, height) * 0.1, fontWeight: 700, x: width / 2, y: height / 2, anchorX: 0.5, anchorY: 0.5, opacity: 0 }))
    .to({ opacity: 1 }, { at: 0.2, duration: 0.6 });
});

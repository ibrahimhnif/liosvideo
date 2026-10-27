import { scene, text } from "liosvideo";

export default scene("outro", { duration: 2 }, ({ root, width, height }) => {
  root
    .add(text({ name: "thanks", text: "Patch your upload handlers.", fontSize: Math.min(width, height) * 0.06, fontWeight: 600, x: width / 2, y: height / 2, anchorX: 0.5, anchorY: 0.5, opacity: 0 }))
    .to({ opacity: 1 }, { at: 0.2, duration: 0.6 });
});

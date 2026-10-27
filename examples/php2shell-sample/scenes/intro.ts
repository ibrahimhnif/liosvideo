import { rect, scene, text } from "liosvideo";

export default scene("intro", { duration: 3, background: "#0b0d12" }, ({ root, width, height }) => {
  const size = Math.min(width, height);
  const title = root.add(
    text({ name: "title", text: "php2shell", fontSize: size * 0.12, fontWeight: 700, x: width / 2, y: height / 2, anchorX: 0.5, anchorY: 0.5, opacity: 0, blur: 12 }),
  );
  title.to({ opacity: 1, blur: 0 }, { at: 0.2, duration: 0.8, ease: "outCubic" });

  const subtitle = root.add(
    text({ name: "subtitle", text: "from file upload to remote shell", fontSize: size * 0.035, color: "#8fa3c8", x: width / 2, y: height / 2 + size * 0.11, anchorX: 0.5, anchorY: 0.5, opacity: 0 }),
  );
  subtitle.to({ opacity: 1 }, { at: 0.8, duration: 0.6 });

  const bar = root.add(rect({ name: "underline", width: 0, height: 6, radius: 3, fill: "#4f8cff", x: width / 2, y: height / 2 + size * 0.07, anchorX: 0.5 }));
  bar.to({ width: size * 0.4 }, { at: 0.6, duration: 0.8, ease: "outCubic" });
});

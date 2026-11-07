// notification(): a phone notification, then a desktop one.
import { layout, notification, phone, scene } from "liosvideo";

export default scene("notification", { duration: 5, background: "#0b0d12" }, ({ root, width, height }) => {
  const L = layout({ width, height });
  const box = L.slot("center");
  const deviceH = box.height;
  const deviceW = Math.min(box.width, deviceH * 0.49);
  const device = root.add(phone({ name: "device", x: box.x + (box.width - deviceW) / 2, y: box.y, width: deviceW, height: deviceH }));
  const card = device.contentArea.add(
    notification({ x: 12, y: deviceH * 0.08, width: deviceW - 40, app: "liosvideo", title: "Render finished", body: "short.mp4 is ready: 62 s, 5.4 MB. Tap to share the preview.", time: "now", color: "#7c3aed" }),
  );
  card.show({ at: 0.5, hold: 2.5 });
});

import { group, image, rect, scene, text, type GroupNode } from "liosvideo";

/** A simple window: rounded body, title bar with traffic lights and a title. Real mockups come in the mockups plan. */
function window(name: string, title: string, w: number, h: number, body: string): GroupNode {
  const win = group({ name, width: w, height: h, anchorX: 0.5, anchorY: 0.5, clip: true, radius: 14 });
  win.add(rect({ name: "body", width: w, height: h, fill: body }));
  win.add(rect({ name: "titlebar", width: w, height: 44, fill: "#2a2c33" }));
  ["#ff5f57", "#febc2e", "#28c840"].forEach((fill, i) => win.add(rect({ name: `light${i}`, x: 20 + i * 22, y: 16, width: 12, height: 12, radius: 6, fill })));
  win.add(text({ name: "title", text: title, fontSize: 15, fontFamily: "SF Pro Text", color: "#c9ccd6", x: w / 2, y: 22, anchorX: 0.5, anchorY: 0.5 }));
  return win;
}

export default scene("focus-demo", { duration: 6 }, ({ root, width, height }) => {
  const desktop = root.add(group({ name: "desktop", width, height }));
  desktop.add(image({ name: "wallpaper", src: "assets/images/wall.jpg", width, height, fit: "cover" }));

  const w = Math.min(width * 0.62, 1200);
  const h = Math.min(height * 0.5, 640);
  const chrome = desktop.add(window("chrome", "Chrome Web Store", w, h, "#f4f5f7"));
  const terminal = desktop.add(window("terminal", "zsh — ~/projects", w, h, "#16181d"));
  terminal.add(text({ name: "prompt", text: "~/projects $ npm install -g php2shell", fontFamily: "SF Mono", fontSize: 22, color: "#9be28f", x: 24, y: 72 }));

  const front = { x: width / 2, y: height * 0.42, scaleX: 1, scaleY: 1, blur: 0, opacity: 1, z: 2 };
  const back = { x: width / 2, y: height * 0.62, scaleX: 0.92, scaleY: 0.92, blur: 12, opacity: 0.6, z: 1 };
  chrome.set(back, 0);
  terminal.set(front, 0);

  // focus Chrome: it rises and sharpens, the terminal sinks and blurs — then the reverse.
  // Both share one ease, so at the midpoint they're identical (same y, scale, blur, opacity):
  // swapping z there is invisible, instead of the blurred window popping on top at the start.
  const duration = 0.8;
  const swap = (up: GroupNode, down: GroupNode, at: number) => {
    const { z: _zf, ...frontPose } = front;
    const { z: _zb, ...backPose } = back;
    up.to(frontPose, { at, duration, ease: "inOutCubic" });
    down.to(backPose, { at, duration, ease: "inOutCubic" });
    up.set({ z: 2 }, at + duration / 2);
    down.set({ z: 1 }, at + duration / 2);
  };
  swap(chrome, terminal, 1);
  swap(terminal, chrome, 3.5);
});

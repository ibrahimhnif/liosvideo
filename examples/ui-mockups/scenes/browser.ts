// browserWindow(): tabs, an address bar that types, and a page you fill.
import { browserWindow, layout, rect, scene, text } from "liosvideo";

export default scene("browser", { duration: 5, background: "#0b0d12" }, ({ root, width, height }) => {
  const L = layout({ width, height });
  const box = width > height ? L.cell(2, 10, 1, 6) : L.slot("center");
  const page = [
    rect({ name: "hero", x: 40, y: 40, width: box.width - 80, height: box.height * 0.3, radius: 16, fill: "#1f6feb" }),
    text({ name: "headline", text: "Ship videos as code", x: 40, y: box.height * 0.3 + 80, ...L.type.h2, color: "#e8eaed", maxWidth: box.width - 80 }),
  ];
  const b = root.add(browserWindow({ ...box, url: "about:blank", tabs: ["liosvideo", "GitHub", "Docs"], theme: "dark", content: page }));
  b.typeUrl("https://github.com/ibrahimhnif/liosvideo", { at: 0.6, duration: 1.4 });
  b.switchTab(1, { at: 2.4 });
  b.set({ opacity: 0 }, 0).to({ opacity: 1 }, { at: 0, duration: 0.4 });
});

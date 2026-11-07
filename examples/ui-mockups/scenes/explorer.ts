// fileExplorer(): a project tree with a moving selection.
import { fileExplorer, layout, scene } from "liosvideo";

export default scene("explorer", { duration: 4, background: "#0b0d12" }, ({ root, width, height }) => {
  const L = layout({ width, height });
  const box = width > height ? L.cell(4, 6, 1, 6) : L.slot("center");
  const e = root.add(
    fileExplorer({
      ...box,
      title: "MY-VIDEO",
      theme: "light",
      selected: "short.ts",
      items: [
        { name: "scenes", children: ["hook.ts", "demo.ts", "outro.ts"] },
        { name: "assets", children: [{ name: "images", children: ["bukele.jpg"] }, { name: "audio", open: false, children: [] }] },
        "long.ts",
        "short.ts",
        "script.md",
      ],
    }),
  );
  e.select("hook.ts", { at: 1 });
  e.select("bukele.jpg", { at: 2.2 });
});

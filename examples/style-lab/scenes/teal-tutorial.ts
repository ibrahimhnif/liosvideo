import { browserWindow, layout, rect, scene, text } from "liosvideo";
import { codePane, stepCard, theme } from "../styles/teal-tutorial";

export default scene("teal-tutorial", { duration: 6, background: theme.colors.bg }, ({ root, width, height }) => {
  const L = layout({ width, height });
  const c = theme.colors;

  root.add(stepCard(L.slot("title"), { step: 2, title: "Fetch the weather", summary: "One request, then show the result in the page.", at: 0.2, size: L.type.h2.fontSize }));

  // code on the left (top in 9:16), the running page on the right (bottom in 9:16)
  const left = L.slot("left");
  const right = L.slot("right");
  const code = root.add(
    codePane(left, {
      file: "weather.ts",
      fontSize: L.type.caption.fontSize,
      at: 0.6,
      code: [
        "// ask the API for today in Jakarta",
        'const res = await fetch("/api/weather?city=jakarta");',
        "const { temp, sky } = await res.json();",
        "",
        "show(`${temp}° and ${sky}`);",
      ].join("\n"),
    }),
  );
  code.focus(1, 1.8).focus(4, 3.2);

  const k = Math.min(right.width, right.height * 1.6) / 1000;
  const card = [
    rect({ name: "card", x: 40 * k, y: 40 * k, width: right.width - 80 * k, height: 220 * k, radius: 24 * k, fill: c.panel }),
    text({ name: "temp", text: "31°", x: 80 * k, y: 70 * k, fontFamily: theme.fonts.heading, fontWeight: 700, fontSize: 96 * k, color: c.teal }),
    text({ name: "sky", text: "Cerah berawan · Jakarta", x: 80 * k, y: 190 * k, fontFamily: theme.fonts.body, fontSize: 32 * k, color: c.ink }),
  ];
  const page = root.add(browserWindow({ ...right, url: "localhost:5173", tabs: ["Weather"], theme: "dark", content: card, opacity: 0 }));
  page.to({ opacity: 1 }, { at: 3.4, duration: 0.4 });
  card.forEach((n, i) => {
    n.set({ opacity: 0 }, 0);
    n.to({ opacity: 1 }, { at: 3.7 + i * 0.15, duration: 0.3 });
  });
});

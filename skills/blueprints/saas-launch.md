# Blueprint: SaaS Feature Launch

- **Target Aspect**: 16:9 Landscape (`1920x1080`), responsive down to 9:16
- **Aesthetic**: Stripe / Linear Modern SaaS with glassmorphism & metric cards
- **Use Cases**: Product launches, new feature releases, changelog updates

---

## 1. Scene Structure

```text
Scene 1: intro.ts   (00:00 - 00:03) -> "Introducing" badge pill + gradient announcement card
Scene 2: main.ts    (00:03 - 00:09) -> Chrome browser window (`chrome()`) + metric popup chips
Scene 3: outro.ts   (00:09 - 00:12) -> Call-to-action banner & primary "Get Started" button
```

---

## 2. Browser Window Showcase & Metric Chips

```ts
import { chrome, group, rect, scene, text, vo } from "liosvideo";

export default scene("main", { duration: 6, background: "#0b0f19" }, ({ root, width, height }) => {
  // macOS Chrome Browser Window
  const browser = root.add(
    chrome({
      name: "app-browser",
      width: Math.min(width * 0.82, 1140),
      height: Math.min(height * 0.68, 620),
      x: width / 2,
      y: height / 2 - 20,
      anchorX: 0.5,
      anchorY: 0.5,
      url: "https://app.liosvideo.com",
      opacity: 0,
      scaleX: 0.95,
      scaleY: 0.95
    })
  );

  browser.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: "outBack" });

  // Metric card floating bottom right
  const metric = root.add(
    rect({
      name: "metric-card",
      width: 240,
      height: 90,
      x: width / 2 + browser.width * 0.35,
      y: height / 2 + browser.height * 0.32,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 14,
      fill: "#111827",
      stroke: "#1f2937",
      strokeWidth: 2,
      opacity: 0,
      scaleX: 0.8,
      scaleY: 0.8
    })
  );

  metric.add(
    text({
      name: "stat",
      text: "+85% Speed",
      fontSize: 22,
      fontWeight: 700,
      color: "#10b981",
      x: metric.width / 2,
      y: metric.height / 2 - 12,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  metric.add(
    text({
      name: "stat-label",
      text: "Render throughput",
      fontSize: 13,
      fontWeight: 500,
      color: "#9ca3af",
      x: metric.width / 2,
      y: metric.height / 2 + 16,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  metric.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 1.2, duration: 0.4, ease: "outBack" });
});
```

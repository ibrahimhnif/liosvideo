# Blueprint: Minimal Dev Screencast

- **Target Aspect**: 16:9 Landscape (`1920x1080`), responsive down to 9:16
- **Aesthetic**: Tokyo Night / Minimal Engineer Dark
- **Use Cases**: Terminal tool breakdowns, developer tutorials, GitHub repo highlights

---

## 1. Scene Structure

```text
Scene 1: intro.ts   (00:00 - 00:03) -> Title card with prompt pill and typing effect
Scene 2: main.ts    (00:03 - 00:09) -> Terminal window with code spotlight & micro pan-zoom
Scene 3: outro.ts   (00:09 - 00:12) -> Checklist recap card & repository link CTA
```

---

## 2. Terminal Spotlight Pattern

Use a semi-transparent dark backdrop overlay with a highlight cutout or an active pill surrounding the active line:

```ts
import { group, rect, scene, text, vo } from "liosvideo";

export default scene("main", { duration: 6, background: "#0b0d12" }, ({ root, width, height }) => {
  const terminal = root.add(
    rect({
      name: "terminal-window",
      width: Math.min(width * 0.85, 1100),
      height: Math.min(height * 0.72, 640),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 14,
      fill: "#161b22",
      stroke: "#30363d",
      strokeWidth: 1.5,
      opacity: 0,
      scaleX: 0.95,
      scaleY: 0.95
    })
  );

  terminal.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: "outCubic" });

  // Code line spotlight box
  const spotlight = terminal.add(
    rect({
      name: "code-spotlight",
      width: terminal.width * 0.92,
      height: 38,
      x: terminal.width / 2,
      y: 180,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 6,
      fill: "#7aa2f7",
      opacity: 0
    })
  );

  // Animate spotlight when keyword is spoken
  const voice = vo("main-1");
  const keywordTime = voice.wordTime("execute") ?? 2.0;
  spotlight.to({ opacity: 0.15 }, { at: keywordTime, duration: 0.3 });
});
```

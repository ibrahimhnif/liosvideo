# Blueprint: Kinetic Short (9:16)

- **Target Aspect**: 9:16 Portrait (`1080x1920`)
- **Aesthetic**: Punchy Social Media, bold kinetic typography, phone mockup
- **Use Cases**: TikTok, Instagram Reels, YouTube Shorts, product teasers

---

## 1. Scene Structure

```text
Scene 1: intro.ts   (00:00 - 00:02.5) -> Bold kinetic pop title card & emoji/fire badge
Scene 2: main.ts    (00:02.5 - 00:07) -> Smartphone frame (`phone()`) + synchronized word highlights
Scene 3: outro.ts   (00:07 - 00:09.5) -> Follow CTA card with animated cursor click
```

---

## 2. Phone Frame Demo & Word-by-Word Highlighting

```ts
import { phone, rect, scene, text, vo } from "liosvideo";

export default scene("main", { duration: 5, background: "#08080a" }, ({ root, width, height }) => {
  // Mobile smartphone mockup
  const device = root.add(
    phone({
      name: "mobile-frame",
      width: Math.min(width * 0.78, 640),
      height: Math.min(height * 0.65, 1100),
      x: width / 2,
      y: height * 0.45,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 0,
      scaleX: 0.9,
      scaleY: 0.9
    })
  );

  device.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: "outBack" });

  // Big kinetic subtitle bar below phone
  const captionBar = root.add(
    rect({
      name: "caption-bar",
      width: width * 0.88,
      height: 72,
      x: width / 2,
      y: height * 0.86,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 16,
      fill: "#18181b",
      stroke: "#27272a",
      strokeWidth: 2,
      opacity: 0
    })
  );
  captionBar.to({ opacity: 1 }, { at: 0.4, duration: 0.3 });

  const captionText = captionBar.add(
    text({
      name: "caption-text",
      text: "Turn Code Into Instant Video",
      fontSize: 26,
      fontWeight: 800,
      color: "#ffffff",
      x: captionBar.width / 2,
      y: captionBar.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  // VO word sync
  const voice = vo("main-1");
  const keywordTime = voice.wordTime("instant");
  if (keywordTime !== undefined) {
    captionText.to({ color: "#f43f5e" }, { at: keywordTime, duration: 0.2 });
    captionBar.to({ scaleX: 1.05, scaleY: 1.05 }, { at: keywordTime, duration: 0.2, ease: "outBack" });
    captionBar.to({ scaleX: 1.0, scaleY: 1.0 }, { at: keywordTime + 0.25, duration: 0.2 });
  }
});
```

import { rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("outro", { duration: 3.5, background: theme.colors.bg }, ({ root, width, height }) => {
  const card = root.add(
    rect({
      name: "cta-banner",
      width: Math.min(width * 0.78, 960),
      height: Math.min(height * 0.48, 360),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 18,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: 1.5,
      opacity: 0,
      scaleX: 0.95,
      scaleY: 0.95
    })
  );
  card.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: theme.easing.pop });

  card.add(
    text({
      name: "cta-title",
      text: "Start Building with Liosvideo",
      fontSize: Math.min(width * 0.038, 42),
      fontWeight: 800,
      color: theme.colors.text,
      x: card.width / 2,
      y: card.height * 0.4,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const startBtn = card.add(
    rect({
      name: "start-button",
      width: 220,
      height: 48,
      x: card.width / 2,
      y: card.height * 0.68,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 10,
      fill: theme.colors.primary
    })
  );
  startBtn.add(
    text({
      name: "btn-text",
      text: "Get Started Free →",
      fontSize: 16,
      fontWeight: 700,
      color: "#ffffff",
      x: startBtn.width / 2,
      y: startBtn.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const voice = vo("outro-1");
  if (voice.isReady) {
    const freeHit = voice.wordTime("free");
    if (freeHit !== undefined) {
      startBtn.to({ scaleX: 1.06, scaleY: 1.06 }, { at: freeHit, duration: 0.15, ease: theme.easing.pop });
      startBtn.to({ scaleX: 1.0, scaleY: 1.0 }, { at: freeHit + 0.2, duration: 0.2 });
    }
  }
});

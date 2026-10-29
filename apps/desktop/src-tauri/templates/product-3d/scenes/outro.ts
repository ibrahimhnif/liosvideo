import { rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("outro", { duration: 3.5, background: theme.colors.bg }, ({ root, width, height }) => {
  const card = root.add(
    rect({
      name: "cta-card",
      width: Math.min(width * 0.75, 920),
      height: Math.min(height * 0.48, 360),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 16,
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
      name: "title",
      text: "Experience Real-Time 3D Today",
      fontSize: Math.min(width * 0.036, 40),
      fontWeight: 700,
      color: theme.colors.text,
      x: card.width / 2,
      y: card.height * 0.4,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const button = card.add(
    rect({
      name: "launch-btn",
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
  button.add(
    text({
      name: "btn-text",
      text: "Start Creating →",
      fontSize: 16,
      fontWeight: 700,
      color: "#07090e",
      x: button.width / 2,
      y: button.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const voice = vo("outro-1");
  if (voice.isReady) {
    const clickHit = voice.wordTime("today");
    if (clickHit !== undefined) {
      button.to({ scaleX: 1.06, scaleY: 1.06 }, { at: clickHit, duration: 0.2, ease: theme.easing.pop });
      button.to({ scaleX: 1.0, scaleY: 1.0 }, { at: clickHit + 0.25, duration: 0.2 });
    }
  }
});

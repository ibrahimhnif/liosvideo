import { rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("intro", { duration: 3.5, background: theme.colors.bg }, ({ root, width, height }) => {
  const card = root.add(
    rect({
      name: "intro-card",
      width: Math.min(width * 0.85, 1080),
      height: Math.min(height * 0.52, 420),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 20,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: 1.5,
      opacity: 0,
      scaleX: 0.95,
      scaleY: 0.95
    })
  );
  card.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: theme.easing.pop });

  // Announcement Pill
  const pill = card.add(
    rect({
      name: "announcement-pill",
      width: 170,
      height: 34,
      x: card.width / 2,
      y: card.height * 0.28,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 9999,
      fill: theme.colors.bg,
      stroke: theme.colors.primary,
      strokeWidth: 1
    })
  );
  pill.add(
    text({
      name: "pill-label",
      text: "🚀 INTRODUCING 2.0",
      fontSize: 12,
      fontWeight: 700,
      color: theme.colors.accent,
      x: pill.width / 2,
      y: pill.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  // Main Headline
  const title = card.add(
    text({
      name: "headline",
      text: "The Autonomous Video Suite",
      fontSize: Math.min(width * 0.045, 52),
      fontWeight: 800,
      color: theme.colors.text,
      x: card.width / 2,
      y: card.height * 0.56,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 0
    })
  );
  title.to({ opacity: 1, y: card.height * 0.54 }, { at: 0.4, duration: 0.5, ease: theme.easing.smooth });

  const voice = vo("intro-1");
  if (voice.isReady) {
    const wordHit = voice.wordTime("autonomous");
    if (wordHit !== undefined) {
      title.to({ color: theme.colors.primary }, { at: wordHit, duration: 0.2 });
    }
  }
});

import { rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("intro", { duration: 3, background: theme.colors.bg }, ({ root, width, height }) => {
  const card = root.add(
    rect({
      name: "hook-card",
      width: Math.min(width * 0.88, 800),
      height: Math.min(height * 0.45, 480),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 24,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: 2,
      opacity: 0,
      scaleX: 0.8,
      scaleY: 0.8
    })
  );
  card.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.15, duration: 0.5, ease: theme.easing.pop });

  const pill = card.add(
    rect({
      name: "fire-pill",
      width: 140,
      height: 38,
      x: card.width / 2,
      y: card.height * 0.28,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 9999,
      fill: theme.colors.primary
    })
  );
  pill.add(
    text({
      name: "fire-text",
      text: "🔥 GAME CHANGER",
      fontSize: 13,
      fontWeight: 800,
      color: "#ffffff",
      x: pill.width / 2,
      y: pill.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const title = card.add(
    text({
      name: "hook-title",
      text: "AI Video Creation\nIs Finally Pure Code",
      fontSize: Math.min(width * 0.055, 48),
      fontWeight: 800,
      color: theme.colors.text,
      lineHeight: 1.25,
      x: card.width / 2,
      y: card.height * 0.62,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 0
    })
  );
  title.to({ opacity: 1 }, { at: 0.35, duration: 0.4, ease: theme.easing.smooth });

  const voice = vo("intro-1");
  if (voice.isReady) {
    const codeHit = voice.wordTime("code");
    if (codeHit !== undefined) {
      title.to({ color: theme.colors.accent }, { at: codeHit, duration: 0.2 });
    }
  }
});

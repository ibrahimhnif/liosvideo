import { rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("outro", { duration: 3.5, background: theme.colors.bg }, ({ root, width, height }) => {
  const card = root.add(
    rect({
      name: "summary-card",
      width: Math.min(width * 0.75, 900),
      height: Math.min(height * 0.5, 360),
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
      name: "headline",
      text: "Get the Code on GitHub",
      fontSize: Math.min(width * 0.035, 38),
      fontWeight: 700,
      color: theme.colors.text,
      x: card.width / 2,
      y: card.height * 0.38,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const linkPill = card.add(
    rect({
      name: "link-pill",
      width: 320,
      height: 48,
      x: card.width / 2,
      y: card.height * 0.65,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 8,
      fill: theme.colors.bg,
      stroke: theme.colors.primary,
      strokeWidth: 1.5
    })
  );
  linkPill.add(
    text({
      name: "url",
      text: "github.com/developer/cli-engine",
      fontFamily: theme.fonts.mono,
      fontSize: 15,
      color: theme.colors.primary,
      x: linkPill.width / 2,
      y: linkPill.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const voice = vo("outro-1");
  if (voice.isReady) {
    const starHit = voice.wordTime("github");
    if (starHit !== undefined) {
      linkPill.to({ scaleX: 1.05, scaleY: 1.05 }, { at: starHit, duration: 0.2, ease: theme.easing.pop });
      linkPill.to({ scaleX: 1.0, scaleY: 1.0 }, { at: starHit + 0.25, duration: 0.2 });
    }
  }
});

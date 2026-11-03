import { circle, rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("outro", { duration: 3, background: theme.colors.bg }, ({ root, width, height }) => {
  const card = root.add(
    rect({
      name: "follow-card",
      width: Math.min(width * 0.88, 760),
      height: Math.min(height * 0.44, 420),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 20,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: 2,
      opacity: 0,
      scaleX: 0.9,
      scaleY: 0.9
    })
  );
  card.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.15, duration: 0.5, ease: theme.easing.pop });

  // Avatar circle
  const avatar = card.add(
    circle({
      name: "avatar",
      radius: 36,
      x: card.width / 2,
      y: card.height * 0.32,
      fill: theme.colors.border
    })
  );
  avatar.add(
    text({
      name: "avatar-initial",
      text: "⚡",
      fontSize: 28,
      x: 0,
      y: 0,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  card.add(
    text({
      name: "channel-name",
      text: "Follow For Daily Dev Tips",
      fontSize: Math.min(width * 0.042, 28),
      fontWeight: 700,
      color: theme.colors.text,
      x: card.width / 2,
      y: card.height * 0.58,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const followBtn = card.add(
    rect({
      name: "subscribe-button",
      width: 180,
      height: 44,
      x: card.width / 2,
      y: card.height * 0.8,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 9999,
      fill: theme.colors.primary
    })
  );
  followBtn.add(
    text({
      name: "btn-text",
      text: "Subscribe +",
      fontSize: 15,
      fontWeight: 800,
      color: "#ffffff",
      x: followBtn.width / 2,
      y: followBtn.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const voice = vo("outro-1");
  if (voice.isReady) {
    const subHit = voice.wordTime("subscribe");
    if (subHit !== undefined) {
      followBtn.to({ scaleX: 1.1, scaleY: 1.1 }, { at: subHit, duration: 0.15, ease: theme.easing.pop });
      followBtn.to({ scaleX: 1.0, scaleY: 1.0 }, { at: subHit + 0.2, duration: 0.2 });
    }
  }
});

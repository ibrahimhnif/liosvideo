import { phone, rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("main", { duration: 4.5, background: theme.colors.bg }, ({ root, width, height }) => {
  const device = root.add(
    phone({
      name: "phone-mockup",
      width: Math.min(width * 0.75, 600),
      height: Math.min(height * 0.62, 1050),
      x: width / 2,
      y: height * 0.44,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 0,
      scaleX: 0.88,
      scaleY: 0.88
    })
  );
  device.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: theme.easing.pop });

  // Subtitle card below phone
  const subBar = root.add(
    rect({
      name: "sub-bar",
      width: Math.min(width * 0.88, 700),
      height: 64,
      x: width / 2,
      y: height * 0.84,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 14,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: 2,
      opacity: 0
    })
  );
  subBar.to({ opacity: 1 }, { at: 0.35, duration: 0.3 });

  const subText = subBar.add(
    text({
      name: "caption",
      text: "Turn Prompts Into Videos Fast",
      fontSize: Math.min(width * 0.038, 24),
      fontWeight: 800,
      color: theme.colors.text,
      x: subBar.width / 2,
      y: subBar.height / 2,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  const voice = vo("main-1");
  const fastHit = voice.wordTime("fast") ?? 1.5;
  subText.to({ color: theme.colors.primary }, { at: fastHit, duration: 0.2 });
  subBar.to({ scaleX: 1.05, scaleY: 1.05 }, { at: fastHit, duration: 0.2, ease: theme.easing.pop });
  subBar.to({ scaleX: 1.0, scaleY: 1.0 }, { at: fastHit + 0.25, duration: 0.2 });
});

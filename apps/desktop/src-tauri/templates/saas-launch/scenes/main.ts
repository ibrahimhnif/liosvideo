import { chrome, rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("main", { duration: 5.5, background: theme.colors.bg }, ({ root, width, height }) => {
  // Chrome Browser Mockup
  const browser = root.add(
    chrome({
      name: "saas-browser",
      width: Math.min(width * 0.84, 1140),
      height: Math.min(height * 0.68, 620),
      x: width / 2,
      y: height / 2 - 15,
      anchorX: 0.5,
      anchorY: 0.5,
      url: "https://studio.liosvideo.com",
      opacity: 0,
      scaleX: 0.95,
      scaleY: 0.95
    })
  );
  browser.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: theme.easing.pop });

  // Floating metric card
  const metric = root.add(
    rect({
      name: "metric-badge",
      width: 240,
      height: 84,
      x: width / 2 + browser.width * 0.36,
      y: height / 2 + browser.height * 0.32,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 14,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: 2,
      opacity: 0,
      scaleX: 0.85,
      scaleY: 0.85
    })
  );

  metric.add(
    text({
      name: "metric-value",
      text: "+85% Faster",
      fontSize: 22,
      fontWeight: 800,
      color: theme.colors.success,
      x: metric.width / 2,
      y: metric.height * 0.38,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );
  metric.add(
    text({
      name: "metric-sub",
      text: "Render throughput",
      fontSize: 12,
      fontWeight: 500,
      color: theme.colors.muted,
      x: metric.width / 2,
      y: metric.height * 0.68,
      anchorX: 0.5,
      anchorY: 0.5
    })
  );

  metric.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 1.2, duration: 0.4, ease: theme.easing.pop });
});

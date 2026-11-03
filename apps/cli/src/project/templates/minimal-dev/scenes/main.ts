import { rect, scene, text, vo } from "liosvideo";
import { theme } from "../theme";

export default scene("main", { duration: 5.5, background: theme.colors.bg }, ({ root, width, height }) => {
  const terminal = root.add(
    rect({
      name: "terminal-window",
      width: Math.min(width * 0.88, 1140),
      height: Math.min(height * 0.72, 620),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 14,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: 1.5,
      opacity: 0,
      scaleX: 0.95,
      scaleY: 0.95
    })
  );
  terminal.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.5, ease: theme.easing.pop });

  // Terminal titlebar dots
  const colors = ["#ff5f56", "#ffbd2e", "#27c93f"];
  colors.forEach((col, i) => {
    terminal.add(
      rect({
        name: `dot-${i}`,
        width: 10,
        height: 10,
        x: 24 + i * 16,
        y: 20,
        radius: 9999,
        fill: col
      })
    );
  });

  // Prompt Line
  terminal.add(
    text({
      name: "prompt",
      text: "➜ ~ cargo run --release -- --bench",
      fontFamily: theme.fonts.mono,
      fontSize: Math.min(width * 0.02, 20),
      color: theme.colors.primary,
      x: 32,
      y: 65
    })
  );

  // Spotlight Box
  const spotlight = terminal.add(
    rect({
      name: "code-spotlight",
      width: terminal.width - 64,
      height: 42,
      x: terminal.width / 2,
      y: 135,
      anchorX: 0.5,
      anchorY: 0.5,
      radius: 6,
      fill: theme.colors.primary,
      opacity: 0
    })
  );

  terminal.add(
    text({
      name: "output-line",
      text: "✔ Benchmark complete: 1,420,000 ops/sec [0.07ms latency]",
      fontFamily: theme.fonts.mono,
      fontSize: Math.min(width * 0.018, 18),
      color: theme.colors.success,
      x: 32,
      y: 135,
      anchorY: 0.5
    })
  );

  const voice = vo("main-1");
  const spotHit = voice.wordTime("latency") ?? 1.8;
  spotlight.to({ opacity: 0.15 }, { at: spotHit, duration: 0.3 });
});

import { scene, text } from "liosvideo";
import { fonts, glitchRGB, palette, scanlines } from "../../fx";

export default scene("ex-glitch-rgb", { duration: 3, background: "#0A0C10" }, ({ root, width, height }) => {
  glitchRGB(root, { width, height, at: 0, amount: 0.7 });
  scanlines(root, { width, height, at: 0, strength: 0.2, pitch: 4 });

  const msg = root.add(
    text({
      name: "msg",
      text: "TRANSMISI TERPUTUS",
      x: width / 2,
      y: height / 2 - 40,
      anchorX: 0.5,
      fontFamily: fonts.mono,
      fontSize: 56,
      fontWeight: 700,
      color: "#FFFFFF",
    }),
  );
  for (let i = 0; i < 8; i++) {
    msg.set({ x: width / 2 + (i % 2 === 0 ? 18 : -18) }, 0.05 + i * 0.09);
  }
  msg.set({ x: width / 2 }, 0.85);

  const code = root.add(
    text({
      name: "code",
      text: "ERR 0x1F",
      x: 60,
      y: height - 80,
      fontFamily: fonts.mono,
      fontSize: 16,
      color: palette.rose,
    }),
  );
  code.set({ opacity: 0.3 }, 0);
  code.set({ opacity: 1 }, 0.6);
});

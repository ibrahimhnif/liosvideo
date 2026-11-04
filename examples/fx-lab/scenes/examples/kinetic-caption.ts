import { rect, scene, text } from "liosvideo";
import { fonts, kineticWord, palette } from "../../fx";

export default scene("ex-kinetic-caption", { duration: 3, background: "#08080A" }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: "#08080A" }));

  root.add(
    text({
      name: "label",
      text: "KINETIC WORD SYNC",
      x: 160,
      y: 300,
      fontFamily: fonts.mono,
      fontSize: 14,
      color: palette.dim,
    }),
  );

  const words: Array<[string, number]> = [
    ["INI", 420],
    ["BUKAN", 900],
    ["MITOS", 1390],
  ];
  words.forEach(([word, x], i) => {
    kineticWord(root, {
      word,
      x,
      y: 540,
      at: 0.25 + i * 0.42,
      size: 84,
      accent: palette.rose,
    });
  });

  const bar = root.add(rect({ name: "beat-bar", x: 160, y: 660, width: 0, height: 3, fill: palette.rose }));
  bar.to({ width: 1600 }, { at: 0.25, duration: 1.6, ease: "linear" });
});

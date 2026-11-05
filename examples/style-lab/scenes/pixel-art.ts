import { rect, scene } from "liosvideo";
import { pixelStage, pixelText, sprite, spriteColors, sprites, stepped, theme } from "../styles/pixel-art";

export default scene("pixel-art", { duration: 4, background: theme.colors.night }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const stage = root.add(pixelStage(width, height));

  // ground line; grass and dirt are added after the hills
  const ground = height * 0.72;
  // sunset sky in bands
  [c.night, c.plum, c.red, c.orange].forEach((fill, i) => {
    stage.add(rect({ name: `sky${i}`, y: (ground / 4) * i, width, height: ground / 4 + 1, fill }));
  });
  // the sun sinks a step at a time
  const sun = stage.add(
    sprite(["..yyyy..", ".yyyyyy.", "yyyyyyyy", "yyyyyyyy", "yyyyyyyy", "yyyyyyyy", ".yyyyyy.", "..yyyy.."], spriteColors, u * 3, {
      name: "sun", x: width * 0.62, y: ground * 0.48,
    }),
  );
  sun.to({ y: ground * 0.56 }, { at: 0, duration: 4, ease: stepped(4) });
  // stepped hills
  for (let i = 0; i < 7; i++) {
    const w = u * (18 + (i % 3) * 8);
    const h = u * (8 + ((i * 5) % 4) * 5);
    stage.add(rect({ name: `hill${i}`, x: i * width / 6 - w / 2, y: ground - h, width: w, height: h, fill: "#008751" }));
    stage.add(rect({ name: `hilltop${i}`, x: i * width / 6 - w / 4, y: ground - h - u * 4, width: w / 2, height: u * 4, fill: "#008751" }));
  }
  stage.add(rect({ name: "grass", y: ground, width, height: u * 4, fill: c.grass }));
  stage.add(rect({ name: "dirt", y: ground + u * 4, width, height: height - ground, fill: c.dirt }));
  for (let i = 0; i * u * 12 < width; i++) {
    stage.add(rect({ name: `brick${i}`, x: i * u * 12 + (i % 2) * u * 3, y: ground + u * 9, width: u * 5, height: u * 3, fill: c.plum }));
  }

  // drifting clouds
  [0.15, 0.62].forEach((fx, i) => {
    const cloud = stage.add(sprite(sprites.cloud, spriteColors, u * 2, { name: `cloud${i}`, x: width * fx, y: height * (0.1 + i * 0.12) }));
    cloud.to({ x: width * fx + u * 12 }, { at: 0, duration: 4, ease: stepped(8) });
  });

  // the hero walks in, hopping each step
  const heroCell = u * 2.4;
  const hero = stage.add(sprite(sprites.hero, spriteColors, heroCell, { name: "hero", x: -heroCell * 8, y: ground - heroCell * 8 }));
  hero.to({ x: width * 0.42 }, { at: 0.2, duration: 1.6, ease: stepped(10) });
  for (let i = 0; i < 4; i++) {
    hero.to({ y: ground - heroCell * 11 }, { at: 0.2 + i * 0.4, duration: 0.2, ease: stepped(2) });
    hero.to({ y: ground - heroCell * 8 }, { at: 0.4 + i * 0.4, duration: 0.2, ease: stepped(2) });
  }

  // coins pop out above the hero and spin (squash on x)
  for (let i = 0; i < 3; i++) {
    const coin = stage.add(
      sprite(sprites.coin, spriteColors, u * 2, { name: `coin${i}`, x: width * (0.35 + i * 0.12), y: ground - u * 30, opacity: 0, anchorX: 0.5 }),
    );
    const at = 1.9 + i * 0.2;
    coin.set({ opacity: 1 }, at);
    coin.to({ y: ground - u * 42 }, { at, duration: 0.3, ease: stepped(3) });
    for (let k = 0; k < 4; k++) coin.to({ scaleX: k % 2 ? 1 : 0.25 }, { at: at + 0.3 + k * 0.25, duration: 0.25, ease: stepped(2) });
  }

  // title card
  const title = stage.add(pixelText("LEVEL 1", u * 12, { name: "title", x: width / 2, y: height * 0.3, scaleX: 0, scaleY: 0, color: c.gold }));
  title.to({ scaleX: 1, scaleY: 1 }, { at: 1.2, duration: 0.4, ease: stepped(4) });

  // blinking prompt
  const prompt = stage.add(pixelText("PRESS START", u * 5, { name: "prompt", x: width / 2, y: height * 0.88, opacity: 0 }));
  for (let k = 0; k < 6; k++) prompt.set({ opacity: k % 2 ? 0 : 1 }, 2.4 + k * 0.25);

  // lives
  for (let i = 0; i < 3; i++) stage.add(sprite(sprites.heart, spriteColors, u * 1.6, { name: `life${i}`, x: u * 4 + i * u * 10, y: u * 4 }));
});

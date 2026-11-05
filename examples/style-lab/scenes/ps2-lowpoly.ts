import { group, scene } from "liosvideo";
import { areaCard, block, fog, look, ps2World, snap, terrain, theme, tree } from "../styles/ps2-lowpoly";

export default scene("ps2-lowpoly", { duration: 4, background: theme.colors.fog }, ({ root, width, height, duration, random }) => {
  const u = Math.min(width, height) / 100;
  // all randomness is drawn here, in the builder, so setup() stays deterministic
  const heights = Array.from({ length: 21 * 31 }, () => random());
  const trees = Array.from({ length: 40 }, () => [random(), random(), random()]);

  const stage = root.add(group({ name: "stage", width, height, ...look }));
  stage.add(
    ps2World(
      width,
      height,
      ({ scene }) => {
        scene.add(terrain(40, 60, 20, 30, heights, 2.2));
        trees.forEach(([a, b, c], i) => {
          const side = i % 2 ? 1 : -1;
          scene.add(tree(side * (1.6 + a * 8), -26 + b * 42, 0.8 + c * 0.6));
        });
        // a ruined gate at the end of the path
        for (const x of [-1.6, 1.6]) {
          const pillar = block(0.8, 3.4, 0.8, theme.colors.stone);
          pillar.position.set(x, 1.7, -6);
          scene.add(pillar);
        }
        const lintel = block(4.4, 0.6, 1, theme.colors.stoneDark);
        lintel.position.set(0, 3.6, -6);
        lintel.rotation.z = 0.06;
        scene.add(lintel);
      },
      ({ scene, camera }, progress) => {
        // a slow walk toward the gate, with a stepped head-bob and snapped (jittery) camera
        const z = 14 - progress * 10;
        const bob = Math.abs(Math.sin(progress * duration * 5)) * 0.12;
        camera.position.set(snap(Math.sin(progress * 2) * 0.3), snap(1.7 + bob), snap(z));
        camera.lookAt(0, 1.6, -8);
        camera.updateMatrixWorld(true);
        fog(scene, camera, theme.colors.fog, 8, 34);
      },
    ),
  );

  // HUD on top, outside the look
  const card = root.add(areaCard("FOREST RUINS", "AREA 01", { x: width / 2, y: height * 0.72, size: u * 6 }));
  card.set({ opacity: 0 }, 0);
  card.to({ opacity: 1 }, { at: 0.8, duration: 0.5, ease: theme.ease.menu });
  card.to({ opacity: 0 }, { at: 3.2, duration: 0.5, ease: theme.ease.menu });
});

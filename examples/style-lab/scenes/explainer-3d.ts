import { group, scene } from "liosvideo";
import * as THREE from "three";
import { captionWords, clay, layer3d, look, pushIn, theme } from "../styles/explainer-3d";

export default scene("explainer-3d", { duration: 4, background: theme.colors.bg }, ({ root, width, height, duration, random }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const portrait = height > width;
  const target = new THREE.Vector3(0, 0.2, 0);
  const from = portrait ? 13 : 9.5;
  const to = portrait ? 9.5 : 7;
  // drawn in the builder so setup() stays deterministic
  const bokeh = Array.from({ length: 14 }, () => [random(), random(), random()]);
  const bubbles = Array.from({ length: 18 }, () => [random(), random(), random()]);

  // out of focus: a kitchen-ish backdrop of soft blobs and the table edge
  const back = root.add(group({ name: "background", width, height, ...look }));
  back.add(
    layer3d(
      "back3d",
      width,
      height,
      ({ scene }) => {
        bokeh.forEach(([a, b, k], i) => {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.4 + k * 0.8, 24, 12), clay(i % 3 ? "#5d7a8c" : "#d9a066"));
          s.position.set((a - 0.5) * 14, (b - 0.3) * 8, -6 - k * 4);
          scene.add(s);
        });
        const table = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 12), clay(c.table));
        table.position.set(0, -1.7, -2);
        scene.add(table);
      },
      ({ camera }, progress) => pushIn(camera, progress, from, to, target),
    ),
  );

  // in focus: a glass of water and a pill sinking, fizzing
  root.add(
    layer3d(
      "subject3d",
      width,
      height,
      ({ scene }) => {
        const water = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.95, 2.4, 48), clay(c.water, { opacity: 0.3, roughness: 0.2 }));
        water.position.y = -0.3;
        scene.add(water);
        const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.0, 3.0, 48, 1, true), clay(c.glass, { opacity: 0.15, roughness: 0.1 }));
        glass.position.y = 0;
        scene.add(glass);
        const pill = new THREE.Group();
        const halfA = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.32, 8, 16), clay(c.pillA, { roughness: 0.4 }));
        halfA.position.y = 0.16;
        const halfB = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.32, 8, 16), clay(c.pillB, { roughness: 0.4 }));
        halfB.position.y = -0.16;
        pill.add(halfA, halfB);
        scene.add(pill);
        const fizz = bubbles.map(([a, b, k]) => {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.035 + k * 0.05, 12, 8), clay(c.bubble, { opacity: 0.8, roughness: 0.1 }));
          scene.add(m);
          return { m, a, b, k };
        });
        return { pill, fizz };
      },
      ({ camera, pill, fizz }, progress, time) => {
        pushIn(camera, progress, from, to, target);
        // the pill drops in, slows in the water and tumbles to the bottom
        const t = Math.min(1, time / (duration * 0.7));
        const y = t < 0.25 ? 2.6 - (t / 0.25) ** 2 * 2.0 : 0.6 - ((t - 0.25) / 0.75) * 1.7;
        pill.position.set(0.15, Math.max(-1.15, y), 0.1);
        pill.rotation.set(0.4 + t * 2.2, 0, 0.9 + t * 1.4);
        // bubbles stream up from the pill once it is under water
        for (const { m, a, b, k } of fizz) {
          const start = 0.6 + b * 1.6;
          const age = time - start;
          m.visible = age > 0 && t > 0.25;
          const rise = ((age * (0.6 + k)) % 2.2) + 0;
          m.position.set(pill.position.x + (a - 0.5) * 0.5, pill.position.y + rise, 0.1 + (k - 0.5) * 0.4);
          if (m.position.y > 0.85) m.visible = false;
        }
      },
    ),
  );

  root.add(
    captionWords(
      [["what happens", 0.2], ["when a *pill*", 0.9], ["hits", 1.6], ["*water?*", 2.0], ["let's zoom in", 3.0]],
      { x: width / 2, y: height * (portrait ? 0.8 : 0.84), size: u * (portrait ? 9 : 7.5), end: duration },
    ),
  );
});

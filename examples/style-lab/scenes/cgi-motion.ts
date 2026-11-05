import { group, rect, scene, text } from "liosvideo";
import * as THREE from "three";
import { backdrop, gloss, look, orbit, smooth, studio, theme } from "../styles/cgi-motion";

export default scene("cgi-motion", { duration: 4, background: theme.colors.bg }, ({ root, width, height }) => {
  const u = Math.min(width, height) / 100;
  const c = theme.colors;
  const portrait = height > width;

  root.add(backdrop(width, height));

  const stage = root.add(group({ name: "stage", width, height, ...look }));
  stage.add(
    studio(
      width,
      height,
      ({ scene }) => {
        const hero = new THREE.Mesh(new THREE.TorusKnotGeometry(0.75, 0.24, 160, 24), gloss(c.hero));
        scene.add(hero);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.035, 12, 120), gloss(c.gold, { roughness: 0.15, metalness: 0.9 }));
        ring.rotation.x = Math.PI / 2.3;
        scene.add(ring);
        const orbs = [0, 1, 2].map((i) => {
          const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16 + i * 0.05, 32, 16), gloss(i === 1 ? c.accent : c.hero, { roughness: 0.1 }));
          scene.add(orb);
          return orb;
        });
        return { hero, ring, orbs };
      },
      ({ camera, hero, ring, orbs }, progress, time) => {
        const k = smooth(progress);
        orbit(camera, -0.6 + k * 1.2, portrait ? 13 : 8, 0.8 - k * 0.6, new THREE.Vector3(0, portrait ? -0.9 : -0.35, 0));
        hero.rotation.set(time * 0.25, time * 0.4, 0);
        hero.position.y = Math.sin(time * 1.6) * 0.08;
        ring.rotation.z = time * 0.3;
        orbs.forEach((orb: THREE.Mesh, i: number) => {
          const a = time * (0.7 + i * 0.2) + (i * Math.PI * 2) / 3;
          orb.position.set(Math.cos(a) * 1.9, Math.sin(a * 1.3) * 0.5, Math.sin(a) * 1.9);
        });
      },
    ),
  );

  // headline: thin, wide-tracked, low in the frame
  const head = root.add(group({ name: "headline", x: width / 2, y: height * (portrait ? 0.8 : 0.82) }));
  head.add(text({ name: "kicker", text: "INTRODUCING", anchorX: 0.5, fontFamily: theme.fonts.label, fontWeight: 500, fontSize: u * 2.4, color: c.muted }));
  head.add(text({ name: "title", text: "Made to move.", y: u * 3.6, anchorX: 0.5, fontFamily: theme.fonts.heading, fontWeight: 300, fontSize: u * 7, color: c.text }));
  head.add(rect({ name: "rule", y: u * 12.6, width: u * 8, height: Math.max(2, u * 0.25), anchorX: 0.5, fill: c.accent }));
  head.set({ opacity: 0, y: height * (portrait ? 0.8 : 0.82) + u * 3 }, 0);
  head.to({ opacity: 1, y: height * (portrait ? 0.8 : 0.82) }, { at: 1.2, duration: 0.9, ease: theme.ease.rise });
});

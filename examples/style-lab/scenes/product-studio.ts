import { layout, orbit, scene, stack, text } from "liosvideo";
import * as THREE from "three";
import { callout, castShadows, matte, metal, productStage, smooth, theme } from "../styles/product-studio";

export default scene("product-studio", { duration: 6, background: theme.colors.bg }, ({ root, width, height }) => {
  const L = layout({ width, height });
  const portrait = height > width;

  const stage = root.add(
    productStage(
      width,
      height,
      ({ scene }) => {
        // a stand-in product (a desk mic): swap for gltf("assets/models/<model>.glb")
        const mic = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.18, 64), metal("#2b2f36", 0.4));
        base.position.y = 0.09;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 32), metal("#2b2f36", 0.3));
        stem.position.y = 0.7;
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 12, 48), metal());
        body.position.y = 1.75;
        const grill = new THREE.Mesh(new THREE.SphereGeometry(0.44, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), matte("#3a3f47", 0.8));
        grill.position.y = 2.2;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.025, 12, 64), metal(theme.colors.accent, 0.25));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 2.2;
        mic.add(base, stem, body, grill, ring);
        castShadows(mic);
        scene.add(mic);
        return { mic };
      },
      undefined,
      // a slow quarter turn that settles at 3.3 s, then holds for the callouts
      orbit({ target: [0, portrait ? 1.0 : 1.3, 0], radius: portrait ? 14 : 9, height: [2.6, 2.0], from: -0.9, to: 0, start: 0, end: 3.3, ease: smooth }),
    ),
  );

  const title = text({ name: "title", text: "Studio Mic One", ...L.type.h1, fontFamily: theme.fonts.heading, color: theme.colors.ink });
  const sub = text({ name: "subtitle", text: "Machined aluminium. Zero fuss.", ...L.type.body, fontFamily: theme.fonts.heading, color: theme.colors.muted });
  const heading = root.add(stack(L.slot("title"), [title, sub], { name: "heading", gap: L.gap(1) }));
  heading.set({ opacity: 0 }, 0);
  heading.to({ opacity: 1 }, { at: 0.3, duration: 0.6 });

  // the dots sit on the parts (3D points on the stage) and stay there wherever the camera is
  const size = L.type.label.fontSize * 1.2;
  const reach = width * (portrait ? 0.14 : 0.1);
  root.add(callout({ target: { stage, point: [0.3, 2.42, 0.25] }, label: "Mesh grill", detail: "Pop filter built in", side: "right", length: reach, size, at: 3.4 }));
  root.add(
    portrait
      ? callout({ target: { stage, point: [0.75, 0.14, 0.45] }, label: "Weighted base", detail: "1.2 kg, rubber feet", side: "right", length: reach * 0.2, size, at: 3.9 })
      : callout({ target: { stage, point: [-0.75, 0.14, 0.45] }, label: "Weighted base", detail: "1.2 kg, rubber feet", side: "left", length: reach, size, at: 3.9 }),
  );
});

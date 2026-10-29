# Blueprint: 3D Product Showcase

- **Target Aspect**: 16:9 Landscape (`1920x1080`)
- **Aesthetic**: Futuristic Dark Tech with Three.js WebGPU compositing
- **Use Cases**: AI models, hardware devices, 3D tech products, interactive geometry

---

## 1. Scene Structure

```text
Scene 1: intro.ts   (00:00 - 00:03) -> Background glow & camera push-in to 3D hero
Scene 2: main.ts    (00:03 - 00:10) -> 3D model slow spin with 3 staggered floating spec chips
Scene 3: outro.ts   (00:10 - 00:13) -> Centered 3D lock, headline & launch date badge
```

---

## 2. Three.js Hero Pattern with Staggered Spec Chips

```ts
import { group, rect, scene, text, three, vo } from "liosvideo";
import * as THREE from "three";

export default scene("main", { duration: 7, background: "#07090e" }, ({ root, width, height }) => {
  // 3D Canvas Node
  const hero3d = root.add(
    three({
      name: "hero-mesh",
      width: Math.min(width * 0.48, 620),
      height: Math.min(width * 0.48, 620),
      x: width * 0.35,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      camera: "perspective",
      fov: 45,
      setup({ scene, camera }) {
        camera.position.set(0, 0, 4.5);
        const group = new THREE.Group();

        const geom = new THREE.TorusKnotGeometry(1.2, 0.36, 128, 32);
        const mat = new THREE.MeshStandardMaterial({
          color: "#38bdf8",
          roughness: 0.15,
          metalness: 0.85
        });
        const mesh = new THREE.Mesh(geom, mat);
        group.add(mesh);
        scene.add(group);

        const light1 = new THREE.DirectionalLight(0xffffff, 2.5);
        light1.position.set(3, 4, 5);
        scene.add(light1);

        const light2 = new THREE.DirectionalLight(0x818cf8, 1.8);
        light2.position.set(-3, -2, 2);
        scene.add(light2);

        scene.add(new THREE.AmbientLight(0x0f172a, 1.2));
        return { group };
      },
      update({ group }, progress, time) {
        group.rotation.x = time * 0.6;
        group.rotation.y = time * 0.9;
      }
    })
  );

  // Floating spec chips on the right
  const specs = ["Ultra Low Latency", "Deterministic Render", "WebGPU Compositor"];
  specs.forEach((label, i) => {
    const chip = root.add(
      rect({
        name: `spec-chip-${i}`,
        width: 260,
        height: 52,
        x: width * 0.72,
        y: height * 0.36 + i * 72,
        anchorX: 0.5,
        anchorY: 0.5,
        radius: 12,
        fill: "#0f172a",
        stroke: "#1e293b",
        strokeWidth: 1.5,
        opacity: 0,
        scaleX: 0.9,
        scaleY: 0.9
      })
    );

    chip.add(
      text({
        name: "text",
        text: label,
        fontSize: 16,
        fontWeight: 600,
        color: "#f8fafc",
        x: chip.width / 2,
        y: chip.height / 2,
        anchorX: 0.5,
        anchorY: 0.5
      })
    );

    // Staggered entrance
    chip.to(
      { opacity: 1, scaleX: 1, scaleY: 1 },
      { at: 0.8 + i * 0.25, duration: 0.5, ease: "outBack" }
    );
  });
});
```

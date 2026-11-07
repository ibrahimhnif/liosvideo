import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { particles, registerThreeLoaders } from "../src/three/assets";
import { createParticles } from "../src/three/particles";
import { three } from "../src/graph/three";
import { renderThreeNode, resetThreeSoftware } from "../src/gpu/three_soft";
import { createThreeLoaders } from "../src/three/loaders";

function cameraAt(position: [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(...position);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

const attr = (p: ReturnType<typeof createParticles>, name: string) =>
  Array.from((p.object.geometry.getAttribute(name) as THREE.BufferAttribute).array as Float32Array);

describe("createParticles", () => {
  const opts = { count: 40, seed: 7, area: [4, 2, 4] as [number, number, number], velocity: [0, 0.3, 0] as [number, number, number], spread: 0.2, size: [0.05, 0.12] as [number, number], lifetime: 3, color: ["#ffd27a", "#fff2c4"] };

  it("is the same field for the same seed and a different one for another", () => {
    const camera = cameraAt([0, 1, 6]);
    const a = createParticles(opts);
    const b = createParticles(opts);
    const c = createParticles({ ...opts, seed: 8 });
    a.update(1.7, camera);
    b.update(1.7, camera);
    c.update(1.7, camera);
    expect(attr(a, "position")).toEqual(attr(b, "position"));
    expect(attr(a, "color")).toEqual(attr(b, "color"));
    expect(attr(a, "position")).not.toEqual(attr(c, "position"));
  });

  it("depends only on the time asked for, not on the frames before it", () => {
    const camera = cameraAt([0, 1, 6]);
    const direct = createParticles(opts);
    direct.update(2.4, camera);
    const stepped = createParticles(opts);
    for (const t of [0, 0.5, 9, 1.1, 2.4]) stepped.update(t, camera);
    expect(attr(stepped, "position")).toEqual(attr(direct, "position"));
  });

  it("turns every particle to face the camera", () => {
    const camera = cameraAt([3, 2, 5]);
    const p = createParticles(opts);
    p.update(1, camera);
    const pos = attr(p, "position");
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const per = p.verticesPerParticle;
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Vector3(pos[i * per * 3], pos[i * per * 3 + 1], pos[i * per * 3 + 2]);
      for (let k = 1; k < per; k++) {
        const v = new THREE.Vector3(pos[(i * per + k) * 3], pos[(i * per + k) * 3 + 1], pos[(i * per + k) * 3 + 2]);
        expect(v.sub(c).dot(forward)).toBeCloseTo(0, 6);
      }
    }
  });

  it("fades in at birth and out before death, with dark rims for a soft glow", () => {
    const p = createParticles({ count: 1, seed: 1, lifetime: 2, fade: 0.25, color: "#ffffff", intensity: 1, size: 0.1 });
    const camera = cameraAt([0, 0, 5]);
    const centre = (t: number) => {
      p.update(t, camera);
      return attr(p, "color").slice(0, 3);
    };
    const birth = p.birth(0); // a time when particle 0 is born
    expect(centre(birth)[0]).toBeCloseTo(0, 6);
    expect(centre(birth + 1)[0]).toBeCloseTo(1, 6);
    expect(centre(birth + 1.999)[0]).toBeLessThan(0.01);
    expect(attr(p, "color").slice(3, 6)).toEqual([0, 0, 0]);
  });

  it("uses additive blending without depth writes; lit dust uses a lit material", () => {
    expect(createParticles({ count: 1 }).object.material).toMatchObject({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    expect((createParticles({ count: 1, lit: true }).object.material as THREE.Material).type).toBe("MeshLambertMaterial");
  });
});

describe("particles() in a scene", () => {
  afterEach(() => {
    registerThreeLoaders(undefined);
    resetThreeSoftware();
  });

  it("asks to be called inside three({ setup })", () => {
    registerThreeLoaders(undefined);
    expect(() => particles({ count: 1 })).toThrow(/inside three\(\{ setup \}\)/);
  });

  it("adds light where particles overlap (additive) in the software renderer", () => {
    registerThreeLoaders(createThreeLoaders({ read: async () => new Uint8Array(), decodeImage: async () => ({ width: 1, height: 1, data: new Uint8Array(4) }) }));
    const make = (count: number) =>
      three({
        name: `glow-${count}`,
        width: 32,
        height: 32,
        setup({ scene, camera }) {
          scene.background = new THREE.Color("#000000");
          // every particle at the origin, always alive: overlap is the only difference
          const dust = particles({ count, seed: 3, area: [0, 0, 0], velocity: [0, 0, 0], turbulence: 0, spread: 0, size: 1.5, lifetime: 100, fade: 0, color: "#404040" });
          scene.add(dust.object);
          return { dust, camera };
        },
        update({ dust, camera }, _p, time) {
          dust.update(time + 50, camera);
        },
      });
    const centre = (count: number) => renderThreeNode(make(count), 0, 1)!.pixels[(16 * 32 + 16) * 4];
    expect(centre(2)).toBeGreaterThan(centre(1) + 10);
  });
});

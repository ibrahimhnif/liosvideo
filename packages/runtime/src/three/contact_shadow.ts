// Contact shadows for three() scenes: a soft dark patch on the floor under an object, darkest where
// the object touches the floor and fading as it rises off it (like ambient occlusion). It is baked
// on the CPU from the object's own triangles into a grid mesh whose vertex colours carry the
// opacity, so it needs no textures and looks the same in WebGL, WebGPU and the software rasteriser.
import * as THREE from "three";

export interface ContactShadowOptions {
  /** World y of the floor (default: the bottom of the object). */
  y?: number;
  /** Opacity where the object touches the floor (default 0.6). */
  opacity?: number;
  /** Height above the floor over which the shadow fades out (default: half the object's height). */
  falloff?: number;
  /** Softness of the edge in world units (default: 5% of the object's larger side). */
  blur?: number;
  /** Grid points along the larger side (default 64). */
  resolution?: number;
  /** Shadow colour (default black). */
  color?: string;
}

export interface ContactShadow {
  /** Add this to the scene. */
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Bakes the shadow again from where the object is now (call from update() for a moving object). */
  update(): void;
}

export function createContactShadow(object: THREE.Object3D, options: ContactShadowOptions = {}): ContactShadow {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(options.color ?? "#000000"),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = "contactShadow";
  mesh.renderOrder = -1; // under whatever stands on it
  const shadow: ContactShadow = {
    mesh,
    update() {
      const geometry = bake(object, mesh, options);
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    },
  };
  shadow.update();
  return shadow;
}

function bake(object: THREE.Object3D, self: THREE.Object3D, o: ContactShadowOptions): THREE.BufferGeometry {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    const m = child as THREE.Mesh;
    if (m.isMesh && m !== self && m.geometry?.attributes.position) {
      meshes.push(m);
      bounds.union(new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(m.matrixWorld));
    }
  });
  const size = bounds.isEmpty() ? new THREE.Vector3(1, 1, 1) : bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), size);
  const floor = o.y ?? bounds.min.y;
  const opacity = Math.min(1, Math.max(0, o.opacity ?? 0.6));
  const falloff = Math.max(1e-4, o.falloff ?? Math.max(size.y, 1e-3) / 2);
  const larger = Math.max(size.x, size.z, 1e-3);
  const blur = Math.max(0, o.blur ?? larger * 0.05);
  const resolution = Math.max(4, Math.floor(o.resolution ?? 64));

  // the grid: the footprint plus room for the blur
  const cell = (larger + 4 * blur) / (resolution - 1);
  const margin = 2 * blur + cell;
  const x0 = bounds.min.x - margin;
  const z0 = bounds.min.z - margin;
  const nx = Math.ceil((size.x + 2 * margin) / cell) + 1;
  const nz = Math.ceil((size.z + 2 * margin) / cell) + 1;

  // lowest point of the object over every grid point, from its triangles seen from below
  const low = new Float32Array(nx * nz).fill(Infinity);
  const v = new THREE.Vector3();
  const mark = (x: number, y: number, z: number) => {
    const i = Math.round((x - x0) / cell);
    const j = Math.round((z - z0) / cell);
    if (i >= 0 && i < nx && j >= 0 && j < nz) low[j * nx + i] = Math.min(low[j * nx + i], y);
  };
  for (const m of meshes) {
    const position = m.geometry.attributes.position as THREE.BufferAttribute;
    const world = new Float32Array(position.count * 3);
    for (let k = 0; k < position.count; k++) {
      v.fromBufferAttribute(position, k).applyMatrix4(m.matrixWorld);
      world[k * 3] = v.x;
      world[k * 3 + 1] = v.y;
      world[k * 3 + 2] = v.z;
      mark(v.x, v.y, v.z); // walls and thin parts that cover no grid point still count
    }
    const index = m.geometry.index?.array;
    const count = index ? index.length : position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = (index ? index[t] : t) * 3;
      const b = (index ? index[t + 1] : t + 1) * 3;
      const c = (index ? index[t + 2] : t + 2) * 3;
      triangle(world[a], world[a + 1], world[a + 2], world[b], world[b + 1], world[b + 2], world[c], world[c + 1], world[c + 2]);
    }
  }
  function triangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(area) < 1e-12) return;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cell));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell));
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / cell));
    const j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * cell;
        const w0 = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / area;
        const w1 = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const y = w0 * ay + w1 * by + w2 * cy;
        if (y < low[j * nx + i]) low[j * nx + i] = y;
      }
    }
  }

  // opacity from the height above the floor, then a Gaussian blur over the grid
  let alpha: Float32Array = new Float32Array(nx * nz);
  for (let k = 0; k < low.length; k++) {
    if (low[k] !== Infinity) alpha[k] = opacity * Math.min(1, Math.max(0, 1 - (low[k] - floor) / falloff));
  }
  const sigma = blur / 2 / cell;
  if (sigma > 0.3) alpha = blurGrid(alpha, nx, nz, sigma);

  // a flat grid on the floor, a hair above it so it never fights the floor's depth
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 4);
  const normals = new Float32Array(nx * nz * 3);
  const lift = floor + Math.max(1e-4, larger * 1e-3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      positions.set([x0 + i * cell, lift, z0 + j * cell], k * 3);
      normals.set([0, 1, 0], k * 3);
      colors.set([1, 1, 1, alpha[k]], k * 4);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i;
      // counter-clockwise seen from above (+y), so the face points up
      indices.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  // the mesh sits at the origin: grid positions are world positions (with an identity parent)
  self.position.set(0, 0, 0);
  self.rotation.set(0, 0, 0);
  self.scale.set(1, 1, 1);
  return geometry;
}

function blurGrid(src: Float32Array, nx: number, nz: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((s, w) => s + w, 0);
  const pass = (from: Float32Array, dx: number, dz: number) => {
    const out = new Float32Array(from.length);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const ii = i + k * dx;
          const jj = j + k * dz;
          if (ii >= 0 && ii < nx && jj >= 0 && jj < nz) sum += from[jj * nx + ii] * kernel[k + r];
        }
        out[j * nx + i] = sum / total;
      }
    }
    return out;
  };
  return pass(pass(src, 1, 0), 0, 1);
}

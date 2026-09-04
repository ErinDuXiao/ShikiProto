import * as THREE from 'three';
import type { Ground } from './locations';

/**
 * 異変 — the disturbance (spec 8/9/32/33).
 *
 * Two objects, one idea. The OMEN is what you see from the far end of the
 * street and walk towards; the BARRIER is what closes behind you when you get
 * there. Neither is a UI element: the wayfinding is the light itself, not an
 * arrow (spec 30).
 */

/** A red-black column of wrongness, readable from a couple of hundred units. */
export class Omen {
  readonly group = new THREE.Group();
  private column: THREE.Mesh;
  private stain: THREE.Mesh;
  private motes: THREE.Points;
  private moteY: Float32Array;
  private t = 0;
  private strength = 0;
  private target = 0;

  constructor(scene: THREE.Scene) {
    // The column is a tall cylinder with no depth write and additive blending,
    // so it glows through the town rather than being occluded by it.
    const cg = new THREE.CylinderGeometry(7, 15, 130, 18, 1, true);
    const cm = new THREE.MeshBasicMaterial({
      color: 0xb01a2a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      // A beacon that fades with distance is not a beacon. Fog is what makes
      // the street recede; the disturbance has to cut through it (spec 8/30).
      fog: false,
      toneMapped: false,
    });
    this.column = new THREE.Mesh(cg, cm);
    this.column.position.y = 62;
    this.group.add(this.column);

    const sg = new THREE.CircleGeometry(19, 40);
    sg.rotateX(-Math.PI / 2);
    const sm = new THREE.MeshBasicMaterial({
      color: 0x6a0e18,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    this.stain = new THREE.Mesh(sg, sm);
    this.stain.position.y = 0.12;
    this.group.add(this.stain);

    // white paper scraps drifting UPWARD -- the world running backwards
    const N = 90;
    const pos = new Float32Array(N * 3);
    this.moteY = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 24;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = this.moteY[i] = Math.random() * 40;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.PointsMaterial({
      color: 0xd8c0c4,
      size: 1.1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    this.motes = new THREE.Points(pg, pm);
    this.group.add(this.motes);

    this.group.visible = false;
    scene.add(this.group);
  }

  /** Point it at a place, and fade it in. */
  show(x: number, z: number) {
    this.group.position.set(x, 0, z);
    this.group.visible = true;
    this.target = 1;
  }

  hide() {
    this.target = 0;
  }

  /**
   * @param vx,vz the viewer, so the beacon can back off as it is reached.
   *
   * It is a thing seen from the far end of a street. Held at full strength up
   * close it floods the whole frame red and drowns the flock, so it fades as
   * the player arrives -- by then the place itself, and then the barrier, are
   * doing the talking.
   */
  update(dt: number, vx = 0, vz = 0) {
    this.t += dt;
    const dist = Math.hypot(this.group.position.x - vx, this.group.position.z - vz);
    const near = THREE.MathUtils.clamp((dist - 55) / 110, 0, 1);
    const range = 0.12 + 0.88 * near;
    this.strength += (this.target - this.strength) * (1 - Math.exp(-2.4 * dt));
    if (this.strength < 0.004 && this.target === 0) {
      this.group.visible = false;
      return;
    }
    if (this.strength > 0.004) this.group.visible = true;

    const pulse = 0.72 + Math.sin(this.t * 1.7) * 0.28;
    const a = this.strength * pulse * range;
    (this.column.material as THREE.MeshBasicMaterial).opacity = 0.26 * a;
    (this.stain.material as THREE.MeshBasicMaterial).opacity = 0.34 * a;
    (this.motes.material as THREE.PointsMaterial).opacity = 0.45 * this.strength * range;
    this.column.rotation.y += dt * 0.13;
    this.stain.scale.setScalar(0.9 + Math.sin(this.t * 1.1) * 0.08);

    const pos = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.moteY.length; i++) {
      this.moteY[i] += dt * (3 + (i % 5));
      if (this.moteY[i] > 46) this.moteY[i] = 0;
      arr[i * 3 + 1] = this.moteY[i];
    }
    pos.needsUpdate = true;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    });
  }
}

/**
 * The boundary that closes during a fight. Its shape is taken from the
 * location's own ground, so the bridge gets a corridor and the shrine gets a
 * ring -- never the same circle every time (spec 32).
 */
export class Barrier {
  readonly mesh: THREE.Mesh;
  private strength = 0;
  private target = 0;
  private t = 0;

  constructor(private scene: THREE.Scene) {
    const m = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  raise(ground: Ground) {
    this.mesh.geometry.dispose();
    this.mesh.geometry = wallGeometry(ground, 9);
    this.mesh.visible = true;
    this.target = 1;
  }

  drop() {
    this.target = 0;
  }

  get up(): boolean {
    return this.target > 0;
  }

  update(dt: number) {
    this.t += dt;
    this.strength += (this.target - this.strength) * (1 - Math.exp(-3.2 * dt));
    if (this.strength < 0.004) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const shimmer = 0.8 + Math.sin(this.t * 2.6) * 0.2;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.16 * this.strength * shimmer;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * A wall following the outline of a capsule: two half-circles joined by two
 * straight runs. Vertex colours fade it out towards the top so it reads as a
 * veil rather than a fence.
 */
function wallGeometry(g: Ground, height: number): THREE.BufferGeometry {
  const dx = g.bx - g.ax;
  const dz = g.bz - g.az;
  const len = Math.hypot(dx, dz);
  const ux = len > 1e-6 ? dx / len : 0;
  const uz = len > 1e-6 ? dz / len : 1;
  // normal to the axis
  const nx = -uz;
  const nz = ux;
  const base = Math.atan2(nz, nx);

  const outline: Array<[number, number]> = [];
  const ARC = 26;
  // half-circle around B
  for (let i = 0; i <= ARC; i++) {
    const a = base - Math.PI / 2 + (i / ARC) * Math.PI;
    outline.push([g.bx + Math.cos(a) * g.radius, g.bz + Math.sin(a) * g.radius]);
  }
  // half-circle around A
  for (let i = 0; i <= ARC; i++) {
    const a = base + Math.PI / 2 + (i / ARC) * Math.PI;
    outline.push([g.ax + Math.cos(a) * g.radius, g.az + Math.sin(a) * g.radius]);
  }
  outline.push(outline[0]);

  const pos: number[] = [];
  const col: number[] = [];
  const top = new THREE.Color(0x1a0208);
  const bot = new THREE.Color(0x7d1626);
  for (let i = 0; i < outline.length - 1; i++) {
    const [x0, z0] = outline[i];
    const [x1, z1] = outline[i + 1];
    pos.push(x0, 0, z0, x1, 0, z1, x1, height, z1);
    pos.push(x0, 0, z0, x1, height, z1, x0, height, z0);
    for (const c of [bot, bot, top, bot, top, top]) col.push(c.r, c.g, c.b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

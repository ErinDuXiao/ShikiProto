import * as THREE from 'three';
import { clampToField } from '../core/params';

const _clamped = { x: 0, z: 0 };
import { v5 } from '../core/v5Params';

/**
 * Q — Gravity Core / 集式核.
 *
 * Deals no damage. It places a temporary SECOND swarm centre, so the player
 * can decide where a recall starts from: throw it past a pack, the flock is
 * dragged onto it, walk around, and pull the whole thing back through them
 * (spec 7-11).
 */
export class GravityCore {
  readonly pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private group = new THREE.Group();
  private body: THREE.Mesh;
  private halo: THREE.Mesh;
  private ring: THREE.Mesh;
  private travel = 0;
  private landed = false;
  life: number;
  alive = true;
  /** peak shikigami held, for the log */
  maxPulled = 0;
  /** peak number of those that were sitting in WAIT (spec 8/16) */
  maxFromWait = 0;
  pulledSum = 0;
  pulledSamples = 0;

  constructor(
    private scene: THREE.Scene,
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
  ) {
    this.pos.set(x, 1.2, z);
    this.vel.set(dirX * v5.gravitySpeed, 0, dirZ * v5.gravitySpeed);
    this.life = v5.gravityLifetime;

    this.body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff6e2, toneMapped: false }),
    );
    this.body.scale.setScalar(1.15);
    this.group.add(this.body);

    this.halo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xdfe8ff,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.halo.scale.setScalar(2.4);
    this.group.add(this.halo);

    // ground ring showing exactly how far the pull reaches
    const g = new THREE.RingGeometry(0.92, 1, 64);
    g.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: 0xdfe8ff,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    scene.add(this.ring);
    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** true once it has stopped and is actually pulling */
  get pulling(): boolean {
    return this.landed;
  }

  get radius(): number {
    return v5.gravityRadius;
  }

  update(dt: number, heldCount: number, fromWait = 0) {
    if (!this.alive) return;

    if (!this.landed) {
      const step = this.vel.length() * dt;
      this.travel += step;
      this.pos.addScaledVector(this.vel, dt);
      // stops after a fixed throw, or at the edge of the playable ground
      const outside = clampToField(this.pos.x, this.pos.z, 2, _clamped);
      if (this.travel > 22 || outside) {
        this.pos.x = _clamped.x;
        this.pos.z = _clamped.z;
        this.landed = true;
        this.vel.set(0, 0, 0);
        this.onLand?.(this.pos.x, this.pos.z);
      }
    } else {
      this.life -= dt;
      this.pulledSum += heldCount;
      this.pulledSamples++;
      if (heldCount > this.maxPulled) this.maxPulled = heldCount;
      if (fromWait > this.maxFromWait) this.maxFromWait = fromWait;
      if (this.life <= 0) this.alive = false;
    }

    const t = performance.now() * 0.001;
    this.group.position.copy(this.pos);
    this.group.position.y = 1.2 + Math.sin(t * 2.2) * 0.18;
    this.body.rotation.y += dt * 0.9;
    this.body.rotation.x += dt * 0.5;
    this.halo.scale.setScalar(2.4 + Math.sin(t * 3.4) * 0.22);

    const fade = this.landed ? Math.min(1, this.life / 0.6) : 1;
    (this.body.material as THREE.MeshBasicMaterial).opacity = fade;
    (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.22 * fade;

    this.ring.visible = this.landed;
    if (this.landed) {
      this.ring.position.set(this.pos.x, 0.06, this.pos.z);
      // the ring shrinks as the core expires, so the timer is readable
      this.ring.scale.setScalar(this.radius * Math.max(0.05, this.life / v5.gravityLifetime));
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.32 * fade;
    }
  }

  onLand?: (x: number, z: number) => void;

  get averagePulled(): number {
    return this.pulledSamples ? this.pulledSum / this.pulledSamples : 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.ring);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    });
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}

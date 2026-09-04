import * as THREE from 'three';
import { SState, SType, type ShikigamiManager } from '../entities/shikigami';
import { SHIKIGAMI_Y } from '../core/params';

/** Trail/glow tuning, exposed in the debug panel. */
export const trailFx = {
  glowIntensity: 0.2,
  glowRadius: 0.46,
  /** short: a streak of speed, never a tail attached to a head */
  trailLength: 0.1,
  trailOpacity: 0.26,
  trailWidth: 0.055,
  recallTrailMul: 1.35,
  /** fraction of the flock that shows a visible streak at all */
  trailShare: 0.45,
};

export const DEFAULT_TRAIL_FX = { ...trailFx };

/**
 * A soft halo per shikigami and one thin streak per shikigami.
 *
 * The rule that matters: 100 recalling shikigami must read as 100 creatures,
 * never as one fat beam (spec 9). Every streak is drawn independently from that
 * shikigami's own recent positions.
 */
export class SwarmVfx {
  private glow: THREE.InstancedMesh;
  private trail: THREE.InstancedMesh;
  private trailPerAgent: number;

  private m = new THREE.Matrix4();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private view = new THREE.Vector3();
  private bx = new THREE.Vector3();
  private by = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3();
  private col = new THREE.Color();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -9999, 0);

  constructor(
    private scene: THREE.Scene,
    capacity: number,
    trailMax: number,
  ) {
    this.trailPerAgent = trailMax - 1;
    const glowTex = radialTexture();
    const streakTex = streakTexture();

    this.glow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      capacity,
    );
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 3;
    scene.add(this.glow);

    this.trail = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: streakTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      capacity * this.trailPerAgent,
    );
    this.trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 2;
    scene.add(this.trail);
  }

  update(swarm: ShikigamiManager, camera: THREE.Camera) {
    const e = camera.matrixWorld.elements;
    this.right.set(e[0], e[1], e[2]).normalize();
    this.up.set(e[4], e[5], e[6]).normalize();
    this.view.set(e[8], e[9], e[10]).normalize();

    const segs = THREE.MathUtils.clamp(
      Math.round(trailFx.trailLength / swarm.trailInterval),
      0,
      this.trailPerAgent,
    );
    let slot = 0;

    for (let i = 0; i < this.glow.count; i++) {
      if (i >= swarm.count || !swarm.alive[i]) {
        this.glow.setMatrixAt(i, this.hidden);
        continue;
      }
      const speed = Math.hypot(swarm.vx[i], swarm.vz[i]);
      const st = swarm.state[i];
      const fox = swarm.type[i] === SType.TENGJA;
      this.pos.set(swarm.px[i], SHIKIGAMI_Y, swarm.pz[i]);
      const r = trailFx.glowRadius * (1 + Math.min(0.8, speed * 0.01)) * (fox ? 1.25 : 1);
      this.scl.set(r * 2.4, r * 2.4, 1);
      this.compose(this.pos, this.right, this.up, this.scl);
      this.glow.setMatrixAt(i, this.m);
      this.tint(fox, st);
      this.col.multiplyScalar(trailFx.glowIntensity * (st === SState.RECALL ? 1.5 : 1));
      this.glow.setColorAt(i, this.col);

      // Trails ONLY while recalling (spec 14). A permanent tail on every small
      // white object reads as a head-plus-tail creature, which is exactly the
      // impression this build is trying to get rid of.
      if (segs > 0 && st === SState.RECALL && speed > 18) {
        // and not every shikigami gets one -- 100 identical tails side by side
        // is the same problem at flock scale (spec 16)
        const share = hash01(i);
        if (share < trailFx.trailShare) {
          const strength = 0.45 + (1 - share / Math.max(0.001, trailFx.trailShare)) * 0.55;
          const extra = fox ? 1.25 : 1;
          slot = this.writeTrail(
            swarm, i, segs, trailFx.recallTrailMul * extra * strength, fox, st, slot,
          );
        }
      }
    }
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;

    for (let k = slot; k < this.trail.count; k++) this.trail.setMatrixAt(k, this.hidden);
    this.trail.instanceMatrix.needsUpdate = true;
    if (this.trail.instanceColor) this.trail.instanceColor.needsUpdate = true;
  }

  private writeTrail(
    swarm: ShikigamiManager,
    i: number,
    segs: number,
    boost: number,
    fox: boolean,
    st: number,
    slot: number,
  ): number {
    const head = swarm.trailHead;
    const max = swarm.trailMax;
    for (let k = 0; k < segs; k++) {
      if (slot >= this.trail.count) break;
      const ai = (head - k + max * 2) % max;
      const bi = (head - k - 1 + max * 2) % max;
      this.a.set(swarm.trailX[i * max + ai], SHIKIGAMI_Y, swarm.trailZ[i * max + ai]);
      this.b.set(swarm.trailX[i * max + bi], SHIKIGAMI_Y, swarm.trailZ[i * max + bi]);
      const len = this.a.distanceTo(this.b);
      if (len < 0.05) continue;

      this.by.subVectors(this.a, this.b).multiplyScalar(1 / len);
      this.bx.crossVectors(this.by, this.view);
      if (this.bx.lengthSq() < 1e-6) continue;
      this.bx.normalize();

      const taper = 1 - k / segs;
      this.pos.copy(this.a).add(this.b).multiplyScalar(0.5);
      this.scl.set(trailFx.trailWidth * boost * taper, len * 1.05, 1);
      this.compose(this.pos, this.bx, this.by, this.scl);
      this.trail.setMatrixAt(slot, this.m);
      this.tint(fox, st);
      this.col.multiplyScalar(trailFx.trailOpacity * boost * taper * taper);
      this.trail.setColorAt(slot, this.col);
      slot++;
    }
    return slot;
  }

  private tint(fox: boolean, st: number) {
    if (fox) this.col.setRGB(0.74, 0.85, 1.0);
    else this.col.setRGB(1.0, 0.98, 0.92);
    if (st === SState.WAIT) this.col.multiplyScalar(0.6);
  }

  private compose(p: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, s: THREE.Vector3) {
    this.m.makeBasis(x, y, this.view);
    this.m.scale(s);
    this.m.setPosition(p);
  }

  dispose() {
    for (const m of [this.glow, this.trail]) {
      this.scene.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      m.dispose();
    }
  }
}

/** stable per-index value in 0..1, so a shikigami keeps the same trail role */
function hash01(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function radialTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function streakTexture(): THREE.CanvasTexture {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, S, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

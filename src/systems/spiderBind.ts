import * as THREE from 'three';
import { clampToField } from '../core/params';

const _clamped = { x: 0, z: 0 };
import { SPIDER_PARAMS as v4 } from '../core/spiderLegacy';
import type { EnemyBase } from '../entities/enemy';

const MAX_SPIDERS = 24;
const MAX_WEBS = 96;

interface Spider {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  lastX: number;
  lastZ: number;
}

interface Web {
  x: number;
  z: number;
  ang: number;
  len: number;
  life: number;
  maxLife: number;
}

/**
 * Spider Bind — DISABLED in v5 (spec 19).
 *
 * Playtests repeatedly showed it was hard to read, hard to aim deliberately,
 * and hard to connect to the recall. The code is kept behind SPIDER_ENABLED
 * rather than deleted, so it can be revived without rewriting it.
 */
export class SpiderBind {
  private spiders: Spider[] = [];
  private webs: Web[] = [];

  private spiderMesh: THREE.InstancedMesh;
  private webMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -999, 0);
  private col = new THREE.Color();

  /** log counters */
  uses = 0;
  enemiesBound = 0;
  private boundIds = new Set<number>();

  onBind?: (enemy: EnemyBase) => void;

  constructor(private scene: THREE.Scene) {
    this.spiderMesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({ color: 0xe6e8ea, toneMapped: false }),
      MAX_SPIDERS,
    );
    this.spiderMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spiderMesh.frustumCulled = false;
    scene.add(this.spiderMesh);

    const wg = new THREE.PlaneGeometry(1, 1);
    wg.rotateX(-Math.PI / 2);
    this.webMesh = new THREE.InstancedMesh(
      wg,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      MAX_WEBS,
    );
    this.webMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.webMesh.frustumCulled = false;
    this.webMesh.renderOrder = 2;
    scene.add(this.webMesh);
    this.parkAll();
  }

  private parkAll() {
    for (let i = 0; i < MAX_SPIDERS; i++) this.spiderMesh.setMatrixAt(i, this.hidden);
    for (let i = 0; i < MAX_WEBS; i++) this.webMesh.setMatrixAt(i, this.hidden);
    this.spiderMesh.instanceMatrix.needsUpdate = true;
    this.webMesh.instanceMatrix.needsUpdate = true;
  }

  /** Throw a fan of spiders along `dir`. */
  cast(x: number, z: number, dirX: number, dirZ: number) {
    this.uses++;
    const n = Math.round(v4.spiderCount);
    for (let i = 0; i < n && this.spiders.length < MAX_SPIDERS; i++) {
      const spread = ((i / Math.max(1, n - 1)) - 0.5) * 0.85;
      const cs = Math.cos(spread);
      const sn = Math.sin(spread);
      const dx = dirX * cs - dirZ * sn;
      const dz = dirX * sn + dirZ * cs;
      const sp = 26 + Math.random() * 8;
      this.spiders.push({
        x,
        z,
        vx: dx * sp,
        vz: dz * sp,
        life: 0.55 + Math.random() * 0.15,
        lastX: x,
        lastZ: z,
      });
    }
  }

  update(dt: number, enemies: EnemyBase[]) {
    // --- spiders run out, stringing thread behind them
    for (let i = this.spiders.length - 1; i >= 0; i--) {
      const s = this.spiders[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.vx *= Math.exp(-1.1 * dt);
      s.vz *= Math.exp(-1.1 * dt);
      if (clampToField(s.x, s.z, 0, _clamped)) s.life = 0;
      if (Math.hypot(s.x - s.lastX, s.z - s.lastZ) > 0.7) {
        this.addWeb(s.lastX, s.lastZ, s.x, s.z);
        s.lastX = s.x;
        s.lastZ = s.z;
      }
      if (s.life <= 0) {
        this.addWeb(s.lastX, s.lastZ, s.x, s.z);
        this.spiders.splice(i, 1);
      }
    }

    // --- thread binds whatever touches it
    const half = v4.webWidth;
    for (let i = this.webs.length - 1; i >= 0; i--) {
      const w = this.webs[i];
      w.life -= dt;
      if (w.life <= 0) {
        this.webs.splice(i, 1);
        continue;
      }
      for (const e of enemies) {
        if (!e.alive || e.snared) continue;
        const d = segDistSq(w.x, w.z, w.ang, w.len, e.pos.x, e.pos.z);
        const rr = half + e.radius;
        if (d < rr * rr) {
          e.applySnare(v4.bindDuration);
          if (!this.boundIds.has(e.id)) {
            this.boundIds.add(e.id);
            this.enemiesBound++;
          }
          this.onBind?.(e);
        }
      }
    }

    this.write();
  }

  private addWeb(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) return;
    if (this.webs.length >= MAX_WEBS) this.webs.shift();
    this.webs.push({
      x: (ax + bx) * 0.5,
      z: (az + bz) * 0.5,
      ang: Math.atan2(dx, dz),
      len,
      life: v4.webLifetime,
      maxLife: v4.webLifetime,
    });
  }

  private write() {
    const d = this.dummy;
    for (let i = 0; i < MAX_SPIDERS; i++) {
      if (i < this.spiders.length) {
        const s = this.spiders[i];
        d.position.set(s.x, 0.35, s.z);
        d.rotation.set(0, Math.atan2(s.vx, s.vz), performance.now() * 0.004);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.spiderMesh.setMatrixAt(i, d.matrix);
      } else {
        this.spiderMesh.setMatrixAt(i, this.hidden);
      }
    }
    this.spiderMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MAX_WEBS; i++) {
      if (i < this.webs.length) {
        const w = this.webs[i];
        const t = w.life / w.maxLife;
        d.position.set(w.x, 0.08, w.z);
        d.rotation.set(0, w.ang, 0);
        // Drawn far thinner than it collides, and overlapping its neighbour.
        // At collision width the strands read as a dashed white road rather
        // than thread (spec 24).
        d.scale.set(v4.webWidth * 0.22, 1, w.len + 0.7);
        d.updateMatrix();
        this.webMesh.setMatrixAt(i, d.matrix);
        const f = 0.25 + t * 0.75;
        this.col.setRGB(0.5 * f, 0.54 * f, 0.6 * f);
        this.webMesh.setColorAt(i, this.col);
      } else {
        this.webMesh.setMatrixAt(i, this.hidden);
      }
    }
    this.webMesh.instanceMatrix.needsUpdate = true;
    if (this.webMesh.instanceColor) this.webMesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.spiderMesh, this.webMesh]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}

function segDistSq(
  cx: number,
  cz: number,
  ang: number,
  len: number,
  px: number,
  pz: number,
): number {
  const hx = Math.sin(ang) * len * 0.5;
  const hz = Math.cos(ang) * len * 0.5;
  const ax = cx - hx;
  const az = cz - hz;
  const vx = hx * 2;
  const vz = hz * 2;
  const wx = px - ax;
  const wz = pz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 1e-9 ? (wx * vx + wz * vz) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = wx - vx * t;
  const dz = wz - vz * t;
  return dx * dx + dz * dz;
}

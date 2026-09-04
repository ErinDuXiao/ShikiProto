import * as THREE from 'three';
import { v5 } from '../core/v5Params';
import type { PickupKind } from '../core/runConfig';
import type { Player } from '../entities/player';
import type { Fx } from '../core/fx';
import type { Sfx } from '../core/audio';

interface Pickup {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  x: number;
  z: number;
  vx: number;
  vz: number;
  value: number;
  kind: PickupKind;
  life: number;
  bob: number;
}

const MAGNET = 7.5;

/**
 * Spirit talismans. The one growth channel in v4 (spec 5) — kills drop them,
 * walking over them grows the flock. Skill-based growth is off because the
 * cause and effect was unreadable in the last test.
 */
export class PickupSystem {
  private items: Pickup[] = [];
  private geoS = new THREE.OctahedronGeometry(0.3, 0);
  private geoM = new THREE.OctahedronGeometry(0.44, 0);
  private geoL = new THREE.OctahedronGeometry(0.62, 0);
  /** 輪符 — the ring talisman that sets the flock wheeling */
  private geoRing = new THREE.TorusGeometry(0.46, 0.11, 8, 20);
  private matBody = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private matRing = new THREE.MeshBasicMaterial({ color: 0xfff0c4, toneMapped: false });
  private glowGeo = new THREE.PlaneGeometry(1, 1);
  private glowMat: THREE.MeshBasicMaterial;

  onCollect?: (value: number, kind: PickupKind) => void;

  constructor(
    private scene: THREE.Scene,
    private fx: Fx,
    private sfx: Sfx,
  ) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.4, 'rgba(220,235,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.glowMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }

  /** Called on every kill. */
  dropFor(x: number, z: number, isBoss: boolean) {
    let n = Math.floor(v5.pickupDropRate);
    if (Math.random() < v5.pickupDropRate - n) n++;
    if (isBoss) n += 4;
    for (let k = 0; k < n; k++) {
      if (Math.random() < v5.orbitDropChance) {
        this.spawn(x, z, 'orbit');
        continue;
      }
      const roll = Math.random();
      const kind: PickupKind =
        isBoss && k < 2 ? 'large' : roll < 0.65 ? 'small' : roll < 0.92 ? 'medium' : 'large';
      this.spawn(x, z, kind);
    }
  }

  private spawn(x: number, z: number, kind: PickupKind) {
    const ring = kind === 'orbit';
    const geo = ring
      ? this.geoRing
      : kind === 'small'
        ? this.geoS
        : kind === 'medium'
          ? this.geoM
          : this.geoL;
    const value = ring
      ? 0
      : kind === 'small'
        ? v5.rewardSmall
        : kind === 'medium'
          ? v5.rewardMedium
          : v5.rewardLarge;
    const mesh = new THREE.Mesh(geo, ring ? this.matRing : this.matBody);
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    const s = ring ? 3.6 : kind === 'small' ? 2.2 : kind === 'medium' ? 3 : 4;
    glow.scale.setScalar(s);
    // camera has a fixed tilt, so a static billboard rotation is enough
    glow.rotation.x = -Math.atan2(22, 28);
    this.scene.add(mesh);
    this.scene.add(glow);
    const a = Math.random() * Math.PI * 2;
    const sp = 2.5 + Math.random() * 3.5;
    this.items.push({
      mesh,
      glow,
      x,
      z,
      vx: Math.cos(a) * sp,
      vz: Math.sin(a) * sp,
      value: Math.round(value),
      kind,
      life: 30,
      bob: Math.random() * 6,
    });
  }

  update(dt: number, player: Player) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      const dx = player.pos.x - p.x;
      const dz = player.pos.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < MAGNET) {
        const pull = 30 * (1 - d / MAGNET) + 8;
        p.vx += (dx / d) * pull * dt * 6;
        p.vz += (dz / d) * pull * dt * 6;
      }
      const drag = Math.exp(-3.4 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.bob += dt * 5;
      const y = 0.95 + Math.sin(p.bob) * 0.18;
      p.mesh.position.set(p.x, y, p.z);
      if (p.kind === 'orbit') {
        p.mesh.rotation.x = -Math.PI / 2;
        p.mesh.rotation.z += dt * 2.2;
      } else {
        p.mesh.rotation.y += dt * 2.6;
        p.mesh.rotation.x += dt * 1.4;
      }
      p.glow.position.set(p.x, y, p.z);

      if (d < 1.5 || p.life <= 0) {
        if (d < 1.5) this.collect(p);
        this.scene.remove(p.mesh);
        this.scene.remove(p.glow);
        this.items.splice(i, 1);
      }
    }
  }

  private collect(p: Pickup) {
    // the talisman becomes light, then shikigami
    if (p.kind === 'orbit') {
      this.fx.ring(p.x, p.z, 0.4, 7, 0.45, 0xfff0c4);
      this.fx.burst(p.x, 1.2, p.z, 22, 0xfff0c4, 7, 0.6);
      this.sfx.recallStart();
    } else {
      this.fx.burst(p.x, 1.2, p.z, 10 + p.value * 2, 0xffffff, 6, 0.45);
      this.fx.ring(p.x, p.z, 0.3, 2.6, 0.28, 0xdfe8ff);
      this.sfx.send();
    }
    this.onCollect?.(p.value, p.kind);
  }

  dispose() {
    for (const p of this.items) {
      this.scene.remove(p.mesh);
      this.scene.remove(p.glow);
    }
    this.items.length = 0;
    for (const g of [this.geoS, this.geoM, this.geoL, this.geoRing, this.glowGeo]) g.dispose();
    this.matBody.dispose();
    this.matRing.dispose();
    this.glowMat.map?.dispose();
    this.glowMat.dispose();
  }
}

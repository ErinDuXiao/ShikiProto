import * as THREE from 'three';
import { clampToField } from '../core/params';
import type { Input } from '../core/input';

const _clamped = { x: 0, z: 0 };
const MOVE_SPEED = 13;
/**
 * Kyoto walks between encounters at a higher speed (spec 47). Combat snaps
 * straight back to 100%; the ramp only runs the other way, so leaving a fight
 * never feels like the game sped up under you.
 */
const EXPLORE_SPEED_MUL = 1.3;
const ACCEL = 90;
const DASH_SPEED = 46;
const DASH_TIME = 0.16;
const DASH_COOLDOWN = 0.5;
const DASH_IFRAMES = 0.34;

/**
 * The onmyoji. He never attacks -- he only moves, and the swarm turns his
 * movement into violence (spec 34).
 */
export class Player {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3(0, 0, 12);
  readonly vel = new THREE.Vector3();
  /** unit facing vector, driven by the mouse */
  readonly facing = new THREE.Vector3(0, 0, -1);

  maxHp = 160;
  hp = 160;
  /** set by PaperTheme; keeps the hurt flash from re-lighting the ink body */
  inkMode = false;
  invuln = 0;
  /**
   * I-frames that came specifically from a dash. Kept apart from `invuln`
   * because taking a hit also grants invulnerability, and a Perfect Dodge must
   * mean "you dashed through it", not "you were still flashing" (spec 14).
   */
  dashIFrames = 0;
  /** 0 = combat pace, 1 = exploration pace */
  private explore = 0;
  dashTimer = 0;
  dashCooldown = 0;
  dashCount = 0;
  private hurtFlash = 0;
  private dashDir = new THREE.Vector3(0, 0, -1);
  private tmp = new THREE.Vector3();

  private body: THREE.Mesh;
  private nose: THREE.Mesh;
  private halo: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf6f4ee,
      roughness: 0.55,
      metalness: 0.05,
      emissive: 0x222028,
      emissiveIntensity: 0.35,
    });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 1.05, 6, 14), bodyMat);
    this.body.position.y = 1.05;
    this.body.castShadow = true;
    this.body.userData.themeRole = 'playerBody';
    this.group.add(this.body);

    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 0.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.7 }),
    );
    hat.position.y = 1.92;
    hat.rotation.y = Math.PI / 4;
    hat.userData.themeRole = 'playerDark';
    this.group.add(hat);

    const sash = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.16, 1.12),
      new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.8 }),
    );
    sash.position.y = 1.0;
    sash.userData.themeRole = 'playerDark';
    this.group.add(sash);

    // facing marker
    this.nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.8, 3),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.nose.rotation.x = Math.PI / 2;
    this.nose.position.set(0, 0.95, -0.85);
    this.nose.userData.themeRole = 'playerNose';
    this.group.add(this.nose);

    // ground halo -- keeps the player readable inside a dense swarm
    const haloGeo = new THREE.RingGeometry(0.86, 1.04, 40);
    haloGeo.rotateX(-Math.PI / 2);
    this.halo = new THREE.Mesh(
      haloGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.halo.position.y = 0.04;
    this.halo.userData.themeRole = 'playerHalo';
    this.group.add(this.halo);

    scene.add(this.group);
  }

  get dashing(): boolean {
    return this.dashTimer > 0;
  }

  get invulnerable(): boolean {
    return this.invuln > 0;
  }

  /**
   * Ease toward exploration pace, or snap back to combat pace. Asymmetric on
   * purpose: dawdling out of a fight is fine, being slow the instant one starts
   * is not (spec 47).
   */
  setExploring(on: boolean, dt: number) {
    if (!on) this.explore = 0;
    else this.explore += (1 - this.explore) * (1 - Math.exp(-1.6 * dt));
  }

  /** true only while the dash's own i-frames are up */
  get dashInvulnerable(): boolean {
    return this.dashIFrames > 0;
  }

  update(dt: number, input: Input) {
    // facing from mouse
    this.tmp.copy(input.aimPoint).sub(this.pos);
    this.tmp.y = 0;
    if (this.tmp.lengthSq() > 0.001) this.facing.copy(this.tmp).normalize();

    const move = input.moveVector(this.tmp);

    if (input.consumeDash() && this.dashCooldown <= 0) {
      this.dashTimer = DASH_TIME;
      this.dashCooldown = DASH_COOLDOWN;
      this.invuln = Math.max(this.invuln, DASH_IFRAMES);
      this.dashIFrames = DASH_IFRAMES;
      this.dashCount++;
      this.dashDir.copy(move.lengthSq() > 0 ? move : this.facing).normalize();
      this.onDash?.(this.dashDir);
    }

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashIFrames = Math.max(0, this.dashIFrames - dt);

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(DASH_SPEED);
    } else {
      const speed = MOVE_SPEED * (1 + (EXPLORE_SPEED_MUL - 1) * this.explore);
      const target = move.clone().multiplyScalar(speed);
      const k = 1 - Math.exp(-(ACCEL / MOVE_SPEED) * dt);
      this.vel.x += (target.x - this.vel.x) * k;
      this.vel.z += (target.z - this.vel.z) * k;
    }

    this.pos.addScaledVector(this.vel, dt);

    // Play-field clamp (arena circle, encounter ground, or travel corridor).
    // Only the OUTWARD part of the velocity is removed, so walking into a
    // boundary slides along it instead of stalling against it -- with a
    // corridor that is 180 units long, killing all speed on contact turned a
    // 14-second walk into a 38-second grind.
    if (clampToField(this.pos.x, this.pos.z, 1.4, _clamped)) {
      const nx = this.pos.x - _clamped.x;
      const nz = this.pos.z - _clamped.z;
      const n = Math.hypot(nx, nz);
      this.pos.x = _clamped.x;
      this.pos.z = _clamped.z;
      if (n > 1e-6) {
        const out = (this.vel.x * nx + this.vel.z * nz) / n;
        if (out > 0) {
          this.vel.x -= (nx / n) * out;
          this.vel.z -= (nz / n) * out;
        }
      }
    }

    // presentation
    this.group.position.copy(this.pos);
    const yaw = Math.atan2(this.facing.x, this.facing.z);
    this.group.rotation.y = yaw + Math.PI;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.body.rotation.z = 0;
    this.body.position.y = 1.05 + Math.sin(performance.now() * 0.004) * 0.03;
    this.body.scale.set(1, 1 + Math.min(0.22, speed * 0.006), 1);

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    const mat = this.body.material as THREE.MeshStandardMaterial;
    if (this.inkMode) mat.emissive.setRGB(this.hurtFlash * 0.5, 0, 0);
    else mat.emissive.setRGB(0.13 + this.hurtFlash, 0.12, 0.16);
    const haloMat = this.halo.material as THREE.MeshBasicMaterial;
    haloMat.opacity = this.invuln > 0 ? 0.25 + Math.sin(performance.now() * 0.05) * 0.2 : 0.5;
  }

  onDash?: (dir: THREE.Vector3) => void;

  takeDamage(amount: number): boolean {
    if (this.invuln > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 0.7;
    this.hurtFlash = 1;
    return true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mm = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm.dispose();
      }
    });
  }
}

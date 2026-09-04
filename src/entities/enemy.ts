import * as THREE from 'three';
import { clampToField } from '../core/params';
import type { Fx } from '../core/fx';
import type { Sfx } from '../core/audio';

const _clamped = { x: 0, z: 0 };
let nextEnemyId = 1;
export function resetEnemyIds() {
  nextEnemyId = 1;
}

/** Everything an enemy is allowed to do to the rest of the world. */
export interface EnemyWorld {
  playerPos: THREE.Vector3;
  fx: Fx;
  sfx: Sfx;
  hitPlayer(damage: number, from: THREE.Vector3): void;
  /** boss phase-2 move: yank N shikigami off the player and corrupt them */
  vacuum(source: EnemyBase, count: number): void;
}

export abstract class EnemyBase {
  readonly id = nextEnemyId++;
  readonly pos = new THREE.Vector3();
  readonly facing = new THREE.Vector3(0, 0, 1);
  readonly group = new THREE.Group();
  hp = 1;
  maxHp = 1;
  radius = 1;
  alive = true;
  isBoss = false;
  /** vertical centre used for damage numbers */
  hitHeight = 1.4;
  /** knockback resistance. Without this a 60-shikigami recall punts the target
   *  out of its own incoming stream and the rest of the volley whiffs. */
  mass = 1;
  maxKnock = 14;
  /**
   * Multiplier applied to RECALL hits only. Boss limbs use it so that cutting
   * one is emphatically a job for the pull, not for chip damage (spec 17).
   */
  recallBonus = 1;
  /** true for 境喰・八肢's own limbs and core, which manage their own lifecycle */
  eaterPart = false;
  /** A2: seconds left frozen in cursed thread */
  snareTimer = 0;
  /** how many times this enemy has been snared, and for how long in total */
  snareCount = 0;
  snareTotalTime = 0;
  protected flash = 0;
  protected knock = new THREE.Vector3();
  private stunRing: THREE.Mesh | null = null;

  constructor(protected scene: THREE.Scene) {}

  get snared(): boolean {
    return this.snareTimer > 0;
  }

  applySnare(duration: number) {
    if (!this.alive) return;
    this.snareTimer = duration;
    this.snareCount++;
    this.snareTotalTime += duration;
    if (!this.stunRing) {
      const g = new THREE.TorusGeometry(0.9, 0.1, 6, 18);
      g.rotateX(-Math.PI / 2);
      this.stunRing = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color: 0xeaf0ff, transparent: true, opacity: 0.85 }),
      );
      this.group.add(this.stunRing);
    }
  }

  /** Advances the snare clock and its indicator. Returns true while frozen. */
  protected updateSnare(dt: number): boolean {
    const on = this.snareTimer > 0;
    if (on) this.snareTimer = Math.max(0, this.snareTimer - dt);
    if (this.stunRing) {
      this.stunRing.visible = on;
      if (on) {
        this.stunRing.position.y = this.hitHeight + 1.5;
        this.stunRing.rotation.z += dt * 7;
        this.stunRing.scale.setScalar((this.radius + 0.4) * (1 + Math.sin(this.snareTimer * 18) * 0.08));
      }
    }
    return on;
  }

  /** Damage scaling for a hit arriving along `dir` (normalised, travel direction). */
  damageMultiplier(_dir: THREE.Vector3): number {
    return 1;
  }

  /** Returns true if this hit killed it. */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  push(x: number, z: number) {
    this.knock.x += x / this.mass;
    this.knock.z += z / this.mass;
    const l = Math.hypot(this.knock.x, this.knock.z);
    if (l > this.maxKnock) {
      this.knock.x = (this.knock.x / l) * this.maxKnock;
      this.knock.z = (this.knock.z / l) * this.maxKnock;
    }
  }

  abstract update(dt: number, world: EnemyWorld): void;

  protected integrateKnock(dt: number) {
    this.pos.x += this.knock.x * dt;
    this.pos.z += this.knock.z * dt;
    const d = Math.exp(-9 * dt);
    this.knock.x *= d;
    this.knock.z *= d;
    if (clampToField(this.pos.x, this.pos.z, this.radius, _clamped)) {
      this.pos.x = _clamped.x;
      this.pos.z = _clamped.z;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

type YokaiState = 'chase' | 'windup' | 'recover';

/** Small yokai. Closes in, telegraphs, swipes. Dies to one decent recall. */
export class Yokai extends EnemyBase {
  private state: YokaiState = 'chase';
  private timer = 0;
  private mesh: THREE.Mesh;
  private eye: THREE.Mesh;
  private tell: THREE.Mesh;
  speed = 6.2;
  private bob = Math.random() * 10;

  constructor(scene: THREE.Scene, x: number, z: number) {
    super(scene);
    this.maxHp = this.hp = 26;
    this.mass = 1.4;
    this.maxKnock = 13;
    this.radius = 1.05;
    this.hitHeight = 1.5;
    this.pos.set(x, 0, z);

    this.mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.0, 5),
      new THREE.MeshStandardMaterial({
        color: 0x8e1f2c,
        emissive: 0x3a0a12,
        emissiveIntensity: 1,
        roughness: 0.5,
        flatShading: true,
      }),
    );
    this.mesh.position.y = 1.05;
    this.group.add(this.mesh);

    this.eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe14a }),
    );
    this.eye.position.set(0, 1.45, 0.62);
    this.group.add(this.eye);

    const g = new THREE.RingGeometry(0.9, 1.05, 28);
    g.rotateX(-Math.PI / 2);
    this.tell = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: 0xff3322,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.tell.position.y = 0.05;
    this.group.add(this.tell);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  update(dt: number, world: EnemyWorld) {
    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;

    const frozen = this.updateSnare(dt);
    if (frozen) {
      // completely stopped: no movement, no attack, no wind-up progress
      (this.tell.material as THREE.MeshBasicMaterial).opacity = 0;
      this.integrateKnock(dt);
      this.group.position.copy(this.pos);
      this.group.position.y = 0;
      this.paintBody(dt, true);
      return;
    }

    this.facing.set(dx / dist, 0, dz / dist);

    switch (this.state) {
      case 'chase': {
        if (dist > 2.3) {
          this.pos.x += (dx / dist) * this.speed * dt;
          this.pos.z += (dz / dist) * this.speed * dt;
        } else {
          this.state = 'windup';
          this.timer = 0.55;
        }
        break;
      }
      case 'windup': {
        this.timer -= dt;
        const t = 1 - this.timer / 0.55;
        (this.tell.material as THREE.MeshBasicMaterial).opacity = 0.25 + t * 0.55;
        this.tell.scale.setScalar(2.6 - t * 1.2);
        if (this.timer <= 0) {
          (this.tell.material as THREE.MeshBasicMaterial).opacity = 0;
          if (dist < 3.4) world.hitPlayer(8, this.pos);
          world.fx.ring(this.pos.x, this.pos.z, 0.6, 3.0, 0.25, 0xff4433);
          this.push(this.facing.x * -6, this.facing.z * -6);
          this.state = 'recover';
          this.timer = 1.15;
        }
        break;
      }
      case 'recover': {
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'chase';
        break;
      }
    }

    this.integrateKnock(dt);
    this.bob += dt * 6;
    this.group.position.copy(this.pos);
    this.group.position.y = Math.sin(this.bob) * 0.08;
    this.group.rotation.y = Math.atan2(this.facing.x, this.facing.z);

    this.paintBody(dt, false);
  }

  private paintBody(dt: number, frozen: boolean) {
    this.flash = Math.max(0, this.flash - dt * 6);
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    const eye = this.eye.material as THREE.MeshBasicMaterial;
    if (frozen) {
      // bound: pale and frost-still, so "it cannot move" reads instantly
      m.color.setRGB(0.62, 0.68, 0.78);
      m.emissive.setRGB(0.12 + this.flash * 1.2, 0.2, 0.3);
      eye.color.setRGB(0.85, 0.93, 1);
    } else {
      // dark red ink against a black field
      m.color.setRGB(0.28, 0.055, 0.09);
      m.emissive.setRGB(0.11 + this.flash * 1.4, 0.012 + this.flash * 0.5, 0.03 + this.flash * 0.5);
      eye.color.setHex(0xffb24a);
    }
    this.mesh.scale.setScalar(1 + this.flash * 0.12);
  }
}

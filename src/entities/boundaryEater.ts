import * as THREE from 'three';
import { EnemyBase, type EnemyWorld } from './enemy';

/**
 * 境喰・八肢 — BOUNDARY_EATER (spec 6/7).
 *
 * The trash mobs are the power fantasy: a hundred shikigami erase twenty yokai
 * and that must never get worse. This thing carries the other half of the
 * difficulty — it aims at the ONMYOJI, not at the flock, and the only answer to
 * its legs is the player's own dash (spec 3).
 *
 * The loop it exists to create:
 *
 *     sweep telegraph -> dash -> the leg is stuck out and cracked open
 *     -> put the flock past it -> recall through it -> the leg comes off
 *     -> the arena opens up -> two legs down -> the core is bare
 *     -> gravity behind the core -> dash to the far side -> 100-shikigami recall
 *
 * Nothing here is a new player verb. Every answer is Dash, Release, Spread,
 * Gravity and Recall, exactly as they already are (spec 47).
 */

export type LegAttack = 'idle' | 'sweepWindup' | 'sweeping' | 'exposed' | 'pillar' | 'retract';

const SWEEP_WINDUP = 0.9;
const SWEEP_TIME = 0.26;
/** how long the leg lies stuck out and vulnerable after a sweep (spec 13) */
const WEAK_WINDOW = 1.5;
const PERFECT_BONUS = 0.4;
/** damage a leg deals when it connects */
const SWEEP_DAMAGE = 16;
const PILLAR_DAMAGE = 9;
/** how much of a hit lands when the leg is NOT in its weak window */
const ARMOURED = 0.3;
/** recall hits count for far more than anything else (spec 17) */
const RECALL_MUL = 1.8;

let nextLegId = 1;

/**
 * One limb. It is an EnemyBase so the existing swept-segment collision, damage
 * aggregation and recall reporting all apply to it unchanged -- a leg is cut by
 * the same code that cuts a yokai.
 */
export class BossLeg extends EnemyBase {
  readonly legId = nextLegId++;
  state: LegAttack = 'idle';
  timer = 0;
  /** angle of the limb around the body, radians */
  angle: number;
  /** how far the limb reaches from the body */
  reach = 26;
  severed = false;
  /** set while the limb is planted and poisoning the ground under it */
  hazardX = 0;
  hazardZ = 0;
  hazardR = 0;
  /** recall hits taken since it was last exposed, for the sever event */
  hitsSinceExposed = 0;
  lastPerfect = false;

  private root = new THREE.Vector3();
  private tipTarget = new THREE.Vector3();
  private limb: THREE.Mesh;
  private tip: THREE.Mesh;
  private rim: THREE.Mesh;
  private crack: THREE.Mesh;
  private telegraph: THREE.Mesh;
  private sweepFrom = 0;
  private sweepTo = 0;
  private hitThisSweep = false;
  private pillarTick = 0;

  onSweep?: (leg: BossLeg, hit: boolean, perfect: boolean) => void;
  onPillarHit?: (leg: BossLeg) => void;

  constructor(scene: THREE.Scene, angle: number, hp: number) {
    super(scene);
    this.angle = angle;
    this.maxHp = this.hp = hp;
    this.radius = 2.4;
    this.hitHeight = 2.2;
    // a limb is anchored in the ground: nothing the swarm does moves it
    this.mass = 9999;
    this.maxKnock = 0;
    this.recallBonus = RECALL_MUL;
    this.eaterPart = true;

    const mat = new THREE.MeshBasicMaterial({ color: 0x07070b, toneMapped: false });
    this.limb = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.5, 1, 7), mat);
    this.group.add(this.limb);

    this.tip = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 4.6, 7),
      new THREE.MeshBasicMaterial({ color: 0x14141c, toneMapped: false }),
    );
    this.group.add(this.tip);

    // Pale wireframe edge. Without it the limb is 0x07070b on a 0x05060a floor
    // and simply cannot be seen -- the exact failure spec 8 calls out.
    this.rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 1.56, 1, 7, 1),
      new THREE.MeshBasicMaterial({
        color: 0x8b93a6,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
        toneMapped: false,
      }),
    );
    this.group.add(this.rim);

    // the cut line: invisible until the limb is open, then a thin gold crack
    this.crack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 1.58, 1, 7, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffe6a8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.group.add(this.crack);

    // ground tell: the arc the sweep will cover
    const tg = new THREE.RingGeometry(0.35, 1, 40, 1, 0, 1);
    tg.rotateX(-Math.PI / 2);
    this.telegraph = new THREE.Mesh(
      tg,
      new THREE.MeshBasicMaterial({
        color: 0xc1352a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.telegraph.frustumCulled = false;
    scene.add(this.telegraph);

    scene.add(this.group);
  }

  /** where the limb currently reaches to */
  get tipPos(): THREE.Vector3 {
    return this.pos;
  }

  get vulnerable(): boolean {
    return this.state === 'exposed';
  }

  /** Legs are armoured except in the window the dodge opens (spec 13/15). */
  override damageMultiplier(dir: THREE.Vector3): number {
    void dir;
    return this.vulnerable ? 1 : ARMOURED;
  }

  setRoot(x: number, z: number) {
    this.root.set(x, 0, z);
  }

  beginSweep(playerAngle: number, arc: number) {
    this.state = 'sweepWindup';
    this.timer = SWEEP_WINDUP;
    this.hitThisSweep = false;
    this.lastPerfect = false;
    // sweeps THROUGH where the player is standing, so standing still is punished
    this.sweepFrom = playerAngle - arc * 0.5;
    this.sweepTo = playerAngle + arc * 0.5;
    this.angle = this.sweepFrom;
  }

  beginPillar(x: number, z: number, radius: number, seconds: number) {
    this.state = 'pillar';
    this.timer = seconds;
    this.hazardX = x;
    this.hazardZ = z;
    this.hazardR = radius;
    this.angle = Math.atan2(z - this.root.z, x - this.root.x);
    this.reach = Math.hypot(x - this.root.x, z - this.root.z);
  }

  update(dt: number, world: EnemyWorld) {
    if (!this.alive) return;
    this.timer -= dt;

    switch (this.state) {
      case 'sweepWindup':
        if (this.timer <= 0) {
          this.state = 'sweeping';
          this.timer = SWEEP_TIME;
        }
        break;

      case 'sweeping': {
        const t = 1 - Math.max(0, this.timer) / SWEEP_TIME;
        this.angle = this.sweepFrom + (this.sweepTo - this.sweepFrom) * t;
        this.updateTip();
        if (!this.hitThisSweep) {
          const d = Math.hypot(world.playerPos.x - this.pos.x, world.playerPos.z - this.pos.z);
          if (d < this.radius + 1.6) {
            this.hitThisSweep = true;
            world.hitPlayer(SWEEP_DAMAGE, this.pos);
            this.onSweep?.(this, true, false);
          }
        }
        if (this.timer <= 0) {
          // Stuck out and open. This is the entire reward for dodging: the
          // window is the attack chance, not a damage bonus (spec 13/14).
          this.state = 'exposed';
          this.timer = WEAK_WINDOW + (this.lastPerfect ? PERFECT_BONUS : 0);
          this.hitsSinceExposed = 0;
          if (!this.hitThisSweep) this.onSweep?.(this, false, this.lastPerfect);
        }
        break;
      }

      case 'exposed':
        if (this.timer <= 0) {
          this.state = 'retract';
          this.timer = 0.5;
        }
        break;

      case 'pillar': {
        const d = Math.hypot(world.playerPos.x - this.hazardX, world.playerPos.z - this.hazardZ);
        if (d < this.hazardR) {
          world.hitPlayer(PILLAR_DAMAGE * dt, this.pos);
          this.pillarTick -= dt;
          if (this.pillarTick <= 0) {
            this.pillarTick = 0.8;
            this.onPillarHit?.(this);
          }
        }
        if (this.timer <= 0) {
          this.state = 'retract';
          this.timer = 0.5;
          this.hazardR = 0;
        }
        break;
      }

      case 'retract':
        if (this.timer <= 0) this.state = 'idle';
        break;

      case 'idle':
        break;
    }

    this.updateTip();
    this.integrateKnock(dt);
    this.present();
  }

  /** Mark that the sweep was dodged inside the dash window. */
  notePerfect() {
    this.lastPerfect = true;
  }

  private updateTip() {
    const r = this.state === 'idle' || this.state === 'retract' ? this.reach * 0.55 : this.reach;
    this.tipTarget.set(
      this.root.x + Math.cos(this.angle) * r,
      0,
      this.root.z + Math.sin(this.angle) * r,
    );
    this.pos.copy(this.tipTarget);
  }

  private present() {
    const dx = this.pos.x - this.root.x;
    const dz = this.pos.z - this.root.z;
    const len = Math.hypot(dx, dz) || 1;
    const mid = this.group.position;
    mid.set(this.root.x + dx * 0.5, 2.4, this.root.z + dz * 0.5);
    const yaw = Math.atan2(dx, dz);

    for (const m of [this.limb, this.crack, this.rim]) {
      m.rotation.set(Math.PI / 2, 0, 0);
      m.scale.set(1, len, 1);
    }
    this.group.rotation.set(0, yaw, 0);

    this.tip.position.set(0, 0, len * 0.5);
    this.tip.rotation.set(Math.PI / 2, 0, 0);

    // the crack only glows while the limb is open
    const open = this.state === 'exposed' ? 1 : 0;
    const cm = this.crack.material as THREE.MeshBasicMaterial;
    cm.opacity += (open * 0.6 - cm.opacity) * 0.2;
    // the edge goes red-black while a swing is being telegraphed
    const rm = this.rim.material as THREE.MeshBasicMaterial;
    const winding = this.state === 'sweepWindup' || this.state === 'sweeping';
    rm.color.setHex(winding ? 0xc1352a : open ? 0xffe6a8 : 0x8b93a6);
    rm.opacity = winding ? 0.85 : 0.45;

    // ground telegraph during the wind-up
    const tm = this.telegraph.material as THREE.MeshBasicMaterial;
    if (this.state === 'sweepWindup') {
      const p = 1 - Math.max(0, this.timer) / SWEEP_WINDUP;
      this.telegraph.visible = true;
      this.telegraph.position.set(this.root.x, 0.09, this.root.z);
      this.telegraph.scale.setScalar(this.reach);
      this.telegraph.rotation.y = -this.sweepFrom;
      const g = this.telegraph.geometry as THREE.RingGeometry;
      void g;
      tm.opacity = 0.16 + p * 0.34;
    } else {
      this.telegraph.visible = false;
      tm.opacity = 0;
    }
  }

  /** the arc the sweep will cover, for rebuilding the telegraph */
  get sweepArc(): number {
    return this.sweepTo - this.sweepFrom;
  }

  override dispose() {
    this.telegraph.parent?.remove(this.telegraph);
    this.telegraph.geometry.dispose();
    (this.telegraph.material as THREE.Material).dispose();
    super.dispose();
  }
}

/** The body's core. Only takes damage while it is open (spec 20). */
export class BossCore extends EnemyBase {
  exposed = false;
  private shell: THREE.Mesh;
  private glow: THREE.Mesh;
  private rim: THREE.Mesh;
  private t = 0;

  constructor(scene: THREE.Scene, x: number, z: number, hp: number) {
    super(scene);
    this.maxHp = this.hp = hp;
    this.radius = 5.4;
    this.hitHeight = 6.5;
    this.mass = 9999;
    this.maxKnock = 0;
    this.eaterPart = true;
    // the core is the payoff, so a pull through it reads bigger than anything
    // else in the game (spec 21)
    this.recallBonus = 1.6;
    this.pos.set(x, 0, z);

    this.shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(7.2, 1),
      new THREE.MeshBasicMaterial({ color: 0x08080c, toneMapped: false }),
    );
    this.shell.position.y = 5.2;
    this.group.add(this.shell);

    this.glow = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.4, 1),
      new THREE.MeshBasicMaterial({
        color: 0x8e1420,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.glow.position.y = 5.2;
    this.group.add(this.glow);

    // outline, for the same reason as the limbs
    this.rim = new THREE.Mesh(
      new THREE.IcosahedronGeometry(7.4, 1),
      new THREE.MeshBasicMaterial({
        color: 0x9aa2b4,
        wireframe: true,
        transparent: true,
        opacity: 0.34,
        toneMapped: false,
      }),
    );
    this.rim.position.y = 5.2;
    this.group.add(this.rim);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** Closed body: hits glance off entirely, so the legs are the way in. */
  override damageMultiplier(dir: THREE.Vector3): number {
    void dir;
    return this.exposed ? 1 : 0;
  }

  update(dt: number, world: EnemyWorld) {
    void world;
    this.t += dt;
    this.shell.rotation.y += dt * 0.16;
    this.shell.scale.setScalar(1 + Math.sin(this.t * 0.8) * 0.02);
    this.rim.rotation.y -= dt * 0.1;
    this.rim.scale.setScalar(1 + Math.sin(this.t * 0.8) * 0.02);
    const rm = this.rim.material as THREE.MeshBasicMaterial;
    rm.color.setHex(this.exposed ? 0xffd9a0 : 0x9aa2b4);
    rm.opacity = this.exposed ? 0.7 : 0.3;
    const gm = this.glow.material as THREE.MeshBasicMaterial;
    const want = this.exposed ? 1.15 : 0.36;
    gm.opacity += (want - gm.opacity) * (1 - Math.exp(-3 * dt));
    this.glow.scale.setScalar((this.exposed ? 1.35 : 1) + Math.sin(this.t * 2.4) * 0.05);
    (this.shell.material as THREE.MeshBasicMaterial).color.setHex(this.exposed ? 0x140a10 : 0x08080c);
  }
}

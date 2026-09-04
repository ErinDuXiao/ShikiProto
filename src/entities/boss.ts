import * as THREE from 'three';
import { EnemyBase, type EnemyWorld } from './enemy';

export type OniState = 'idle' | 'slam' | 'charge' | 'swing' | 'recover';

/**
 * Seconds the Oni is planted and open after an attack (spec 7). This is the
 * whole point of the fight: the dodge is not survival, it is what buys the
 * window.
 */
const RECOVER = { slam: 1.35, charge: 1.15, swing: 1.0 };
/** a perfect dodge stretches the window rather than adding damage (spec 10) */
const PERFECT_BONUS = 0.45;
/** recall hits land harder while it is recovering (spec 11) */
const RECALL_VULNERABLE_MUL = 1.4;

/**
 * The Oni. Guards its front, so hammering it head-on with shikigami is a waste
 * -- the player has to walk around it and recall THROUGH it (spec 19).
 */
export class Oni extends EnemyBase {
  phase = 1;
  state: OniState = 'idle';
  /**
   * True only in the window where a dash is genuinely a dodge: the tail of a
   * wind-up, or a charge that is already moving. Flagging the whole attack
   * from the first frame of the tell let a player dash a second early and
   * still be credited -- which teaches the wrong timing.
   */
  get swinging(): boolean {
    if (this.state === 'charge') return this.sub === 1;
    if (this.state === 'slam' || this.state === 'swing') return this.timer < 0.36;
    return false;
  }
  /** set for the duration of one attack, cleared when the next is chosen */
  private attacking = false;
  /** set once per attack when the player dashed clear of it */
  perfectThisAttack = false;
  perfectDodges = 0;
  slamHitsTaken = 0;
  chargeHitsTaken = 0;
  swingHitsTaken = 0;
  /** what the player is about to have to answer, for the debug read-out */
  private queued: OniState = 'idle';
  onPerfectDodge?: () => void;
  onTelegraph?: (kind: OniState) => void;
  timer = 1.6;
  private sub = 0;
  private chargeDir = new THREE.Vector3(0, 0, 1);
  private body: THREE.Mesh;
  private shield: THREE.Mesh;
  private tell: THREE.Mesh;
  private arc: THREE.Mesh;
  private core: THREE.Mesh;
  private baseScale = 1;

  /** set by GameManager so it can react to phase transitions */
  onPhase?: (phase: number) => void;

  constructor(scene: THREE.Scene, x: number, z: number) {
    super(scene);
    this.isBoss = true;
    this.maxHp = this.hp = 1200;
    this.mass = 30;
    this.maxKnock = 3.2;
    this.radius = 3.0;
    this.hitHeight = 3.2;
    this.pos.set(x, 0, z);

    this.body = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.6, 4.6, 6),
      new THREE.MeshStandardMaterial({
        color: 0xa8202c,
        emissive: 0x40060e,
        emissiveIntensity: 1,
        roughness: 0.42,
        flatShading: true,
      }),
    );
    this.body.position.y = 2.4;
    this.group.add(this.body);

    const hornMat = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 5), hornMat);
      horn.position.set(s * 0.95, 5.0, 0.2);
      horn.rotation.z = s * -0.35;
      this.group.add(horn);
    }

    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffcf5a }),
    );
    this.core.position.set(0, 3.1, -1.6); // the exposed back core
    this.group.add(this.core);

    // front guard plate -- a visual promise that the front is bad news
    const sg = new THREE.CylinderGeometry(3.05, 3.05, 3.6, 24, 1, true, -0.95, 1.9);
    this.shield = new THREE.Mesh(
      sg,
      new THREE.MeshBasicMaterial({
        color: 0x5fd8ff,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.shield.position.y = 2.4;
    this.group.add(this.shield);

    const tg = new THREE.RingGeometry(0.8, 1.0, 40);
    tg.rotateX(-Math.PI / 2);
    this.tell = new THREE.Mesh(
      tg,
      new THREE.MeshBasicMaterial({
        color: 0xff2a1a,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.tell.position.y = 0.07;
    scene.add(this.tell);

    // wide arc drawn on the floor for the close-range swing
    const ag = new THREE.RingGeometry(0.28, 1, 44, 1, -1.15, 2.3);
    ag.rotateX(-Math.PI / 2);
    this.arc = new THREE.Mesh(
      ag,
      new THREE.MeshBasicMaterial({
        color: 0xff2a1a,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.arc.position.y = 0.08;
    scene.add(this.arc);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** true while it is planted after an attack -- the opening a dodge earns */
  get recovering(): boolean {
    return this.state === 'recover';
  }

  /** front = heavily reduced, back = big bonus. */
  damageMultiplier(dir: THREE.Vector3): number {
    // dir is the shikigami travel direction; a hit "into the face" travels
    // opposite to where the boss is looking.
    const facingDot = -(dir.x * this.facing.x + dir.z * this.facing.z);
    if (facingDot > 0.45) return this.phase >= 3 ? 0.05 : 0.18; // front
    if (facingDot < -0.3) return this.phase >= 3 ? 3.0 : 2.4; // back
    return this.phase >= 3 ? 0.85 : 1.0; // flank
  }

  update(dt: number, world: EnemyWorld) {
    const hpFrac = this.hp / this.maxHp;
    if (this.phase === 1 && hpFrac <= 0.6) this.setPhase(2, world);
    else if (this.phase === 2 && hpFrac <= 0.25) this.setPhase(3, world);

    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;

    // turn toward the player, slowly enough that flanking works
    if (this.state !== 'charge') {
      const want = Math.atan2(dx, dz);
      const cur = Math.atan2(this.facing.x, this.facing.z);
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const turnRate = this.state === 'idle' ? 1.5 + this.phase * 0.25 : 0.45;
      const step = THREE.MathUtils.clamp(d, -turnRate * dt, turnRate * dt);
      const na = cur + step;
      this.facing.set(Math.sin(na), 0, Math.cos(na));
    }

    const tellMat = this.tell.material as THREE.MeshBasicMaterial;

    switch (this.state) {
      case 'idle': {
        this.timer -= dt;
        // drift toward the player so it never turtles in a corner
        // closes to inside swing range: it used to stop drifting at 7 while
        // the swing needed < 6.5, so that attack could never actually come out
        if (dist > 5.2) {
          this.pos.x += (dx / dist) * 2.6 * dt;
          this.pos.z += (dz / dist) * 2.6 * dt;
        }
        tellMat.opacity = 0;
        if (this.timer <= 0) this.pickAttack(world, dist);
        break;
      }
      case 'slam': {
        this.timer -= dt;
        const total = 0.85;
        const t = 1 - this.timer / total;
        this.tell.position.set(
          this.pos.x + this.facing.x * 4.6,
          0.07,
          this.pos.z + this.facing.z * 4.6,
        );
        this.tell.scale.setScalar(5.6);
        tellMat.color.setHex(0xff2a1a);
        tellMat.opacity = 0.2 + t * 0.55;
        this.body.rotation.x = -t * 0.28;
        if (this.timer <= 0) {
          this.body.rotation.x = 0;
          tellMat.opacity = 0;
          const cx = this.pos.x + this.facing.x * 4.6;
          const cz = this.pos.z + this.facing.z * 4.6;
          world.fx.ring(cx, cz, 1.5, 8.5, 0.34, 0xff5533);
          world.fx.burst(cx, 0.4, cz, 42, 0xff6a3a, 13, 0.55);
          world.fx.shake(0.5);
          world.sfx.hit(1);
          const pd = Math.hypot(world.playerPos.x - cx, world.playerPos.z - cz);
          // only count it if it actually connected -- a dodged slam is not a
          // "hit taken", and the metric is meant to show how often the player
          // failed to answer the tell
          if (pd < 5.6 && world.hitPlayer(13, this.pos)) this.slamHitsTaken++;
          this.enterRecover('slam', world);
        }
        break;
      }
      case 'charge': {
        this.timer -= dt;
        if (this.sub === 0) {
          // wind up
          tellMat.color.setHex(0xffaa22);
          tellMat.opacity = 0.55;
          this.tell.position.set(
            this.pos.x + this.chargeDir.x * 7,
            0.07,
            this.pos.z + this.chargeDir.z * 7,
          );
          this.tell.scale.setScalar(2.4);
          if (this.timer <= 0) {
            this.sub = 1;
            this.timer = 0.6;
            world.sfx.dash();
          }
        } else {
          tellMat.opacity = 0;
          const sp = 30;
          this.pos.x += this.chargeDir.x * sp * dt;
          this.pos.z += this.chargeDir.z * sp * dt;
          if (dist < 3.4 && world.hitPlayer(12, this.pos)) this.chargeHitsTaken++;
          if (this.timer <= 0) {
            world.fx.shake(0.3);
            this.sub = 0;
            this.enterRecover('charge', world);
          }
        }
        break;
      }
      case 'swing': {
        this.timer -= dt;
        const total = 0.8;
        const t = 1 - this.timer / total;
        // the arc sits on the Oni and sweeps the side the player is on
        this.arc.position.set(this.pos.x, 0.08, this.pos.z);
        this.arc.scale.setScalar(7.4);
        this.arc.rotation.y = -Math.atan2(this.facing.x, this.facing.z) + Math.PI / 2;
        (this.arc.material as THREE.MeshBasicMaterial).opacity = 0.18 + t * 0.5;
        this.body.rotation.y = -t * 0.5;
        if (this.timer <= 0) {
          this.body.rotation.y = 0;
          (this.arc.material as THREE.MeshBasicMaterial).opacity = 0;
          world.fx.ring(this.pos.x, this.pos.z, 2, 7.4, 0.3, 0xff5533);
          world.fx.burst(this.pos.x, 2.2, this.pos.z, 30, 0xff6a3a, 11, 0.45);
          world.fx.shake(0.42);
          world.sfx.hit(0.85);
          if (dist < 7.4 && world.hitPlayer(13, this.pos)) this.swingHitsTaken++;
          this.enterRecover('swing', world);
        }
        break;
      }
      case 'recover': {
        // Planted, breathing hard, wide open. The tell is a soft ring rather
        // than a warning colour so it reads as "now" and not "danger".
        this.timer -= dt;
        tellMat.color.setHex(0xffd98a);
        tellMat.opacity = 0.1 + Math.sin(performance.now() * 0.012) * 0.05;
        this.tell.position.set(this.pos.x, 0.07, this.pos.z);
        this.tell.scale.setScalar(4.6);
        if (this.timer <= 0) {
          tellMat.opacity = 0;
          this.recallBonus = 1;
          this.state = 'idle';
          this.timer = this.restTime();
        }
        break;
      }
    }

    this.integrateKnock(dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(this.facing.x, this.facing.z);

    this.flash = Math.max(0, this.flash - dt * 5);
    const m = this.body.material as THREE.MeshStandardMaterial;
    const p3 = this.phase >= 3 ? 0.35 : 0;
    m.color.setRGB(0.34, 0.05, 0.1);
    m.emissive.setRGB(0.16 + p3 * 0.5 + this.flash * 1.1, 0.014 + this.flash * 0.5, 0.04 + this.flash * 0.5);
    const pulse = this.phase >= 3 ? 1 + Math.sin(performance.now() * 0.006) * 0.03 : 1;
    this.group.scale.setScalar(this.baseScale * pulse);
    (this.shield.material as THREE.MeshBasicMaterial).opacity =
      this.phase >= 3 ? 0.34 + Math.sin(performance.now() * 0.005) * 0.08 : 0.16;
    (this.core.material as THREE.MeshBasicMaterial).color.setRGB(
      1,
      0.78 + Math.sin(performance.now() * 0.004) * 0.15,
      0.3,
    );
  }

  private restTime(): number {
    return this.phase === 1 ? 2.6 : this.phase === 2 ? 2.1 : 1.75;
  }

  /**
   * Three attacks, chosen by range so the answer is always legible: far means
   * charge, close means swing, and slam covers the middle (spec 7-9).
   */
  private pickAttack(world: EnemyWorld, dist: number) {
    this.perfectThisAttack = false;
    this.attacking = true;
    const roll = Math.random();
    if (dist > 9 || (dist > 6 && roll > 0.62)) {
      this.state = 'charge';
      this.sub = 0;
      this.timer = 0.8;
      const dx = world.playerPos.x - this.pos.x;
      const dz = world.playerPos.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.chargeDir.set(dx / d, 0, dz / d);
      this.facing.copy(this.chargeDir);
    } else if (dist < 8 && roll > 0.42) {
      this.state = 'swing';
      this.timer = 0.8;
    } else {
      this.state = 'slam';
      this.timer = 0.9;
    }
    this.queued = this.state;
    this.onTelegraph?.(this.state);
  }

  /**
   * Attack over: plant, open up, and stay that way long enough that the player
   * can actually place the flock and pull it through (spec 7/11).
   */
  private enterRecover(from: 'slam' | 'charge' | 'swing', world: EnemyWorld) {
    this.attacking = false;
    this.state = 'recover';
    this.timer = RECOVER[from] + (this.perfectThisAttack ? PERFECT_BONUS : 0);
    this.recallBonus = RECALL_VULNERABLE_MUL;
    if (this.perfectThisAttack) {
      this.perfectDodges++;
      this.onPerfectDodge?.();
    }
    void world;
  }

  /** the game calls this when the player dashed clear of a committed attack */
  notePerfectDodge() {
    if (this.attacking && this.swinging) this.perfectThisAttack = true;
  }

  get nextAttack(): string {
    if (this.state === 'idle') return 'in ' + Math.max(0, this.timer).toFixed(1) + 's';
    if (this.state === 'recover') return 'OPEN ' + Math.max(0, this.timer).toFixed(1) + 's';
    return this.state.toUpperCase();
  }

  get lastQueued(): OniState {
    return this.queued;
  }

  private setPhase(p: number, world: EnemyWorld) {
    this.phase = p;
    this.state = 'idle';
    this.sub = 0;
    this.timer = 1.1;
    if (p === 3) this.baseScale = 1.2;
    world.fx.ring(this.pos.x, this.pos.z, 2, 20, 0.7, p === 3 ? 0xff2a1a : 0xb06bff);
    world.fx.shake(0.7);
    world.fx.screenFlash(0.2);
    world.sfx.bigHit(20);
    this.onPhase?.(p);
  }

  override dispose() {
    this.scene.remove(this.arc);
    this.arc.geometry.dispose();
    (this.arc.material as THREE.Material).dispose();
    this.scene.remove(this.tell);
    this.tell.geometry.dispose();
    (this.tell.material as THREE.Material).dispose();
    super.dispose();
  }
}

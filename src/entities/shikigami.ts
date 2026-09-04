import * as THREE from 'three';
import { params, clampToField, SHIKIGAMI_Y } from '../core/params';
import { v5 } from '../core/v5Params';
import { SType } from '../core/runConfig';
import { BoidSystem } from '../systems/boidSystem';
import { SwarmVfx } from '../vfx/swarmVfx';
import type { Player } from './player';
import type { EnemyBase } from './enemy';

export { SType };

/**
 * BEHAVIOUR / INTENT (spec 11). What the shikigami is trying to do. This is the
 * only thing that survives from frame to frame, and only RECALL is a weapon.
 */
export enum SState {
  /** drifting around the onmyoji */
  FOLLOW = 0,
  /** just released, still travelling outward */
  LAUNCH = 1,
  /** parked out in the field, waiting for an order */
  WAIT = 2,
  /** diving home -- the weapon */
  RECALL = 3,
  /** knocked loose by damage; recoverable for a few seconds, then lost */
  SCATTERED = 4,
  /** victory choreography */
  FINISH = 5,
}

/**
 * FORMATION MODIFIER (spec 11/13). How the flock is *arranged* right now.
 * Deliberately separate from behaviour: Spread, Orbit and Gravity change the
 * shape of the swarm and nothing else. None of them makes a shikigami hunt.
 */
export enum SFormation {
  NORMAL = 0,
  SPREAD = 1,
  ORBIT = 2,
  GRAVITY_PULL = 3,
}

/**
 * COMBAT STATE (spec 11/12). ATTACKING is reserved for the two verbs the
 * player aimed: 放つ and 呼ぶ. Spread, Orbit and Gravity never set it.
 */
export enum SCombat {
  PASSIVE = 0,
  ATTACKING = 1,
}

export const CAPACITY = 190;
const TRAIL_MAX = 8;
const TRAIL_SAMPLE = 0.035;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** how fast velocity converges. Follow is lazy (inertia, wide curves);
 *  recall is immediate -- that contrast is the whole feel (spec 33). */
const FOLLOW_RESPONSE = 7.5;
const RECALL_RESPONSE = 16;
const TENGJA_HUNT_WINDOW = 1.15;
/** a recall reaches this many recover-ranges when reclaiming scattered shikigami */
const RECALL_REACH = 2.5;
/** below this speed the spread surface has settled and stops grazing (spec 5) */
const SPREAD_CONTACT_SPEED_SQ = 9 * 9;
const _clamped = { x: 0, z: 0 };

/** A point that pulls the flock, published by the Gravity Core. */
export interface Attractor {
  x: number;
  z: number;
  radius: number;
  strength: number;
}

export class ShikigamiManager {
  count: number;
  maxCount: number;

  readonly px = new Float32Array(CAPACITY);
  readonly pz = new Float32Array(CAPACITY);
  readonly prevX = new Float32Array(CAPACITY);
  readonly prevZ = new Float32Array(CAPACITY);
  readonly vx = new Float32Array(CAPACITY);
  readonly vz = new Float32Array(CAPACITY);
  readonly state = new Uint8Array(CAPACITY);
  /** SFormation per shikigami, recomputed every frame from the active modifiers */
  readonly formation = new Uint8Array(CAPACITY);
  readonly type = new Uint8Array(CAPACITY);
  readonly alive = new Uint8Array(CAPACITY);
  readonly timer = new Float32Array(CAPACITY);
  readonly slotA = new Float32Array(CAPACITY);
  readonly slotR = new Float32Array(CAPACITY);
  readonly lag = new Float32Array(CAPACITY);
  readonly bob = new Float32Array(CAPACITY);
  readonly lastHitId = new Int32Array(CAPACITY);
  readonly lastHitT = new Float32Array(CAPACITY);
  /** when this shikigami was scattered, for the recovery-time metric */
  private scatterAt = new Float32Array(CAPACITY);

  readonly trailX = new Float32Array(CAPACITY * TRAIL_MAX);
  readonly trailZ = new Float32Array(CAPACITY * TRAIL_MAX);
  readonly trailMax = TRAIL_MAX;
  readonly trailInterval = TRAIL_SAMPLE;
  trailHead = 0;
  private trailTimer = 0;
  private finishX = new Float32Array(CAPACITY);
  private finishZ = new Float32Array(CAPACITY);

  private boids = new BoidSystem(CAPACITY);
  private participates = new Uint8Array(CAPACITY);

  readonly mesh: THREE.InstancedMesh;
  private vfx: SwarmVfx;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  recalling = false;
  recallElapsed = 0;
  private swirl = 0;
  private dashLag = 0;

  // --- SPACE spread
  /** 0..1 how far open the flock is */
  spreadT = 0;
  private spreadTimer = 0;

  // --- orbit pickup
  orbitTimer = 0;
  private orbitAngle = 0;

  readonly swarmCenter = new THREE.Vector3();
  activeCount = 0;
  looseCount = 0;
  scatteredCount = 0;
  avgSpeed = 0;
  avgDistance = 0;
  finishing = false;

  attractor: Attractor | null = null;
  heldByCore = 0;
  /** of heldByCore, how many were parked in WAIT rather than following (spec 16) */
  heldFromWait = 0;

  readonly tengjaTargets = new Set<number>();
  homingRedirects = 0;

  // --- scatter bookkeeping
  totalScattered = 0;
  totalRecovered = 0;
  totalLost = 0;
  recoverTimeSum = 0;

  onSpawn?: (x: number, z: number) => void;
  onRecover?: (x: number, z: number) => void;
  onLost?: (x: number, z: number) => void;

  constructor(
    private scene: THREE.Scene,
    player: Player,
  ) {
    this.count = Math.max(1, Math.round(v5.initialShikigami));
    this.maxCount = this.count;

    this.mesh = new THREE.InstancedMesh(
      shardGeometry(),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      CAPACITY,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.vfx = new SwarmVfx(scene, CAPACITY, TRAIL_MAX);

    const want = Math.round(this.count * v5.tengjaRatio);
    const stride = want > 0 ? Math.max(1, Math.round(this.count / want)) : 0;
    for (let i = 0; i < CAPACITY; i++) {
      this.initSlot(i, player.pos.x, player.pos.z);
      this.alive[i] = i < this.count ? 1 : 0;
      this.type[i] = stride > 0 && i < this.count && i % stride === 0 ? SType.TENGJA : SType.PAPER;
    }
  }

  private initSlot(i: number, x: number, z: number) {
    const a = i * GOLDEN;
    const r = Math.sqrt(((i % 100) + 0.5) / 100);
    this.slotA[i] = a;
    this.slotR[i] = r;
    this.lag[i] = 0.35 + r * 1.5;
    this.bob[i] = Math.random() * Math.PI * 2;
    this.px[i] = x + Math.cos(a) * r * 3;
    this.pz[i] = z + Math.sin(a) * r * 3;
    this.prevX[i] = this.px[i];
    this.prevZ[i] = this.pz[i];
    this.vx[i] = 0;
    this.vz[i] = 0;
    this.lastHitId[i] = -1;
    this.lastHitT[i] = -99;
    this.state[i] = SState.FOLLOW;
    for (let k = 0; k < TRAIL_MAX; k++) {
      this.trailX[i * TRAIL_MAX + k] = this.px[i];
      this.trailZ[i * TRAIL_MAX + k] = this.pz[i];
    }
  }

  // ---------------------------------------------------------------- queries

  /**
   * BEHAVIOUR only (spec 11). Orbit and Spread used to be reported here, which
   * hid the fact that they are formations rather than things the flock is
   * doing -- they now live in formationName.
   */
  get stateName(): string {
    if (this.finishing) return 'FINISH';
    if (this.recalling) return 'RECALL';
    return this.looseCount > this.activeCount - this.looseCount ? 'WAIT' : 'FOLLOW';
  }

  /** The modifier the flock as a whole is under, for the debug read-out. */
  get formationName(): string {
    if (this.attractor) return 'GRAVITY_PULL';
    if (this.orbitTimer > 0) return 'ORBIT';
    if (this.spreadT > 0.15) return 'SPREAD';
    return 'NORMAL';
  }

  /** The formation this shikigami is currently arranged into (spec 11). */
  formationOf(i: number): SFormation {
    return this.formation[i] as SFormation;
  }

  /**
   * Only 放つ and 呼ぶ are attacks (spec 12). Neither Spread nor Orbit nor
   * Gravity may flip a shikigami into ATTACKING -- they are placement verbs.
   */
  combatOf(i: number): SCombat {
    const s = this.state[i];
    return s === SState.RECALL || s === SState.LAUNCH ? SCombat.ATTACKING : SCombat.PASSIVE;
  }

  /**
   * SPACE is a placement verb, but a shikigami passing straight through a body
   * with nothing happening reads as broken, so the outward sweep grazes
   * (spec 5). It ends on its own when the surface stops moving.
   */
  get spreadContactActive(): boolean {
    return this.spreadTimer > 0;
  }

  /** inner/outer edge of the orbit band, used for the ring's own collision */
  get orbitInnerRadius(): number {
    return v5.orbitRadius * 0.55;
  }

  get orbitOuterRadius(): number {
    const rings = Math.max(1, Math.round(v5.orbitRings));
    return v5.orbitRadius * (0.55 + ((rings - 1) / rings) * 0.75);
  }

  isDamaging(i: number): boolean {
    if (!this.alive[i]) return false;
    const s = this.state[i];
    if (s === SState.RECALL || s === SState.LAUNCH) return true;
    // Orbit is deliberately absent here. Its damage belongs to the RING, not to
    // the individual (spec 1) -- see CombatSystem.updateOrbitRing. What is left
    // is the spread graze, and only for shikigami whose formation really is
    // SPREAD: under ORBIT or GRAVITY_PULL the flock is being placed, not swung.
    if (s !== SState.FOLLOW || !this.spreadContactActive) return false;
    if (this.formation[i] !== SFormation.SPREAD) return false;
    return this.vx[i] * this.vx[i] + this.vz[i] * this.vz[i] > SPREAD_CONTACT_SPEED_SQ;
  }

  /** true when this contact is a graze rather than a strike */
  isLightContact(i: number): boolean {
    return this.state[i] === SState.FOLLOW;
  }

  hitPower(i: number): number {
    const s = this.state[i];
    if (s === SState.RECALL) return 1.5;
    if (s === SState.LAUNCH) return 0.85;
    return v5.spreadContactDamage;
  }

  countOfType(t: SType): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.alive[i] && this.type[i] === t) n++;
    return n;
  }

  // ---------------------------------------------------------------- actions

  send(dir: THREE.Vector3, originX: number, originZ: number, want: number): number {
    let sent = 0;
    for (let i = 0; i < this.count && sent < want; i++) {
      if (!this.alive[i] || this.state[i] !== SState.FOLLOW) continue;
      this.state[i] = SState.LAUNCH;
      this.timer[i] = 0.42 + Math.random() * 0.14;
      const spread = (Math.random() - 0.5) * 0.34;
      const cs = Math.cos(spread);
      const sn = Math.sin(spread);
      const dx = dir.x * cs - dir.z * sn;
      const dz = dir.x * sn + dir.z * cs;
      const sp = (34 + Math.random() * 12) * (this.type[i] === SType.TENGJA ? v5.tengjaSpeed : 1);
      this.vx[i] = dx * sp;
      this.vz[i] = dz * sp;
      this.px[i] = originX + dx * 0.8 + (Math.random() - 0.5) * 0.8;
      this.pz[i] = originZ + dz * 0.8 + (Math.random() - 0.5) * 0.8;
      this.lastHitId[i] = -1;
      sent++;
    }
    return sent;
  }

  /** SPACE. Opens the flock into a wide surface (spec 4/5). */
  spread() {
    this.spreadTimer = v5.spreadOpenTime + v5.spreadHoldTime;
    // anything parked in the field rejoins so the surface is actually made of
    // the whole flock
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] && this.state[i] === SState.WAIT) this.state[i] = SState.FOLLOW;
    }
  }

  /** Ring talisman: the flock gathers and wheels around the caster. */
  startOrbit() {
    this.orbitTimer = v5.orbitDuration;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] && this.state[i] === SState.WAIT) this.state[i] = SState.FOLLOW;
      if (this.alive[i]) this.lastHitId[i] = -1;
    }
  }

  beginRecall(now = 0, px = 0, pz = 0): number {
    this.recalling = true;
    this.recallElapsed = 0;
    this.tengjaTargets.clear();
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.state[i] === SState.FINISH) continue;
      if (this.state[i] === SState.SCATTERED) {
        // A recall reels in scattered shikigami, but only those within reach
        // (spec 25: "Recover Range内でRecall"). Recovering every one at any
        // distance made permanent loss impossible, so damage carried no weight
        // and a run could never actually be lost.
        //
        // Reach is measured from the whole RECALL LINE, not just from the
        // caster. The flock streams home along that line, so anything it passes
        // is swept up. Measuring from the player alone meant a flock parked on
        // a gravity core flew straight through its own scattered shikigami and
        // left them to expire -- which made using the placement skill cost a
        // third of the swarm on every hit taken (recovery 0.66 vs 0.90).
        const d = distToSegment(this.px[i], this.pz[i], this.swarmCenter.x, this.swarmCenter.z, px, pz);
        if (d > v5.recoverRange * RECALL_REACH) continue;
        this.totalRecovered++;
        this.recoverTimeSum += Math.max(0, now - this.scatterAt[i]);
      }
      this.state[i] = SState.RECALL;
      this.timer[i] = 0.11 + Math.random() * 0.05;
      this.lastHitId[i] = -1;
      n++;
    }
    // pulling breaks the ring; that is the intended use of orbit as a set-up
    this.orbitTimer = 0;
    return n;
  }

  endRecall() {
    this.recalling = false;
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === SState.RECALL) this.state[i] = SState.FOLLOW;
    }
  }

  /**
   * HP SYSTEM v1 (spec 20-27). Damage does not drain a bar -- it knocks
   * shikigami out of the flock. They stay on the field for a few seconds and
   * can be recovered by walking over them or by recalling; anything left is
   * lost for good. Damage therefore hands the player a positioning problem.
   */
  scatter(fromX: number, fromZ: number, count: number, now: number): number {
    // A flat 16 wipes half a 30-strong flock but barely dents 150, so the
    // count is a share of what is currently flying, capped by the parameter.
    const want = Math.min(count, Math.max(3, Math.round(this.activeCount * 0.18)));

    let done = 0;
    for (let i = 0; i < this.count && done < want; i++) {
      if (!this.alive[i]) continue;
      const st = this.state[i];
      if (st === SState.SCATTERED || st === SState.FINISH) continue;
      const dx = this.px[i] - fromX;
      const dz = this.pz[i] - fromZ;
      const d = Math.hypot(dx, dz) || 1;
      const sp = 17 + Math.random() * 13;
      // flung outward on a curve, like sparks, not blown apart
      const wob = (Math.random() - 0.5) * 0.8;
      const cs = Math.cos(wob);
      const sn = Math.sin(wob);
      this.vx[i] = ((dx / d) * cs - (dz / d) * sn) * sp;
      this.vz[i] = ((dx / d) * sn + (dz / d) * cs) * sp;
      this.state[i] = SState.SCATTERED;
      this.timer[i] = v5.scatterLifetime;
      this.scatterAt[i] = now;
      done++;
    }
    this.totalScattered += done;
    return done;
  }

  // ----------------------------------------------------------------- growth

  grow(n: number, player: Player, elapsed = Infinity): number {
    const limit = Math.min(CAPACITY, Math.round(v5.maxShikigami), scheduleCap(elapsed));
    let added = 0;
    for (let k = 0; k < n; k++) {
      if (this.count >= limit) break;
      const idx = this.count++;
      const a = Math.random() * Math.PI * 2;
      this.initSlot(idx, player.pos.x + Math.cos(a) * 2, player.pos.z + Math.sin(a) * 2);
      this.alive[idx] = 1;
      const t = this.countOfType(SType.TENGJA);
      this.type[idx] = t / Math.max(1, this.count) < v5.tengjaRatio ? SType.TENGJA : SType.PAPER;
      this.maxCount = Math.max(this.maxCount, this.count);
      this.onSpawn?.(this.px[idx], this.pz[idx]);
      added++;
    }
    return added;
  }

  startFinish(cx: number, cz: number) {
    this.finishing = true;
    this.recalling = false;
    this.orbitTimer = 0;
    const R = 8.5;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      pts.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]);
    }
    const order = [0, 2, 4, 1, 3, 0];
    for (let i = 0; i < this.count; i++) {
      const t = (i / this.count) * 5;
      const seg = Math.min(4, Math.floor(t));
      const f = t - seg;
      const a = pts[order[seg]];
      const b = pts[order[seg + 1]];
      this.finishX[i] = a[0] + (b[0] - a[0]) * f;
      this.finishZ[i] = a[1] + (b[1] - a[1]) * f;
      this.state[i] = SState.FINISH;
    }
  }

  notifyDash() {
    this.dashLag = 1;
  }

  // ----------------------------------------------------------------- update

  update(
    dt: number,
    time: number,
    player: Player,
    enemies: EnemyBase[],
    camera?: THREE.Camera,
  ) {
    const p = params;
    if (this.recalling) this.recallElapsed += dt;
    // slow drift, not a buzz (spec 32/34)
    this.swirl += dt * 0.18;
    this.dashLag = Math.max(0, this.dashLag - dt * 2.2);
    if (this.orbitTimer > 0) {
      this.orbitTimer = Math.max(0, this.orbitTimer - dt);
      this.orbitAngle += dt * v5.orbitSpeed;
    }

    // spread envelope: open quickly, hold, then ease back
    if (this.spreadTimer > 0) {
      this.spreadTimer -= dt;
      const open = Math.max(0.05, v5.spreadOpenTime);
      const rise = 1 - Math.exp(-(3 / open) * dt);
      this.spreadT += (1 - this.spreadT) * rise;
    } else {
      this.spreadT += (0 - this.spreadT) * (1 - Math.exp(-1.1 * dt));
      if (this.spreadT < 0.002) this.spreadT = 0;
    }

    for (let i = 0; i < CAPACITY; i++) {
      this.participates[i] =
        i < this.count && this.alive[i] === 1 && this.state[i] !== SState.SCATTERED ? 1 : 0;
    }
    this.boids.compute(this.count, this.px, this.pz, this.vx, this.vz, this.participates);

    const pvx = player.vel.x;
    const pvz = player.vel.z;
    const crowd = THREE.MathUtils.clamp(Math.sqrt(Math.max(1, this.activeCount) / 45), 0.9, 1.9);
    const baseRing = p.followDistance * p.formationTightness * crowd;
    const followRing =
      baseRing * (1 + this.spreadT * (v5.spreadRadiusMul - 1)) * (this.recalling ? 0.55 : 1);
    const maxSp2 = p.maxSpeed * p.maxSpeed;

    const att = this.attractor;
    let held = 0;
    let heldWait = 0;
    const recoverR2 = v5.recoverRange * v5.recoverRange;

    let sumX = 0;
    let sumZ = 0;
    let sumSpeed = 0;
    let active = 0;
    let loose = 0;
    let scattered = 0;

    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      this.prevX[i] = this.px[i];
      this.prevZ[i] = this.pz[i];

      const st = this.state[i];
      const ty = this.type[i];
      let tvx = 0;
      let tvz = 0;
      let clamp = maxSp2;
      let response = FOLLOW_RESPONSE;

      switch (st) {
        case SState.FOLLOW: {
          let ax: number;
          let az: number;
          // Formation priority (spec 12): GRAVITY_PULL > ORBIT / SPREAD > NORMAL.
          // None of these touches the combat state.
          let form = SFormation.NORMAL;
          if (this.orbitTimer > 0) {
            // ring formation, 1..N concentric rings
            const rings = Math.max(1, Math.round(v5.orbitRings));
            const ring = i % rings;
            const r = v5.orbitRadius * (0.55 + (ring / rings) * 0.75);
            const a = this.orbitAngle + this.slotA[i] + ring * 0.6;
            ax = player.pos.x + Math.cos(a) * r;
            az = player.pos.z + Math.sin(a) * r;
            clamp = (p.maxSpeed * 1.5) ** 2;
            response = 11;
            form = SFormation.ORBIT;
          } else {
            const rr = 0.35 + 0.85 * this.slotR[i];
            const a = this.slotA[i] + this.swirl;
            ax = player.pos.x + Math.cos(a) * followRing * rr;
            az = player.pos.z + Math.sin(a) * followRing * rr;
            const lagK = p.dashFollowDelay * this.lag[i] * (1 + this.dashLag * 2.2);
            ax -= pvx * lagK;
            az -= pvz * lagK;
            if (this.spreadT > 0.15) form = SFormation.SPREAD;
          }

          // Gravity Core -- a second swarm centre. Unconditional while it
          // lives, so a core thrown past the enemy actually gathers the flock.
          if (att) {
            const ca = this.slotA[i] * 2.3 + this.swirl * 1.4;
            const cr = 1.4 + this.slotR[i] * (att.radius * 0.22);
            ax += (att.x + Math.cos(ca) * cr - ax) * att.strength;
            az += (att.z + Math.sin(ca) * cr - az) * att.strength;
            form = SFormation.GRAVITY_PULL;
            if (Math.hypot(att.x - this.px[i], att.z - this.pz[i]) < att.radius) held++;
          }

          this.formation[i] = form;
          tvx = (ax - this.px[i]) * p.playerAttraction + pvx;
          tvz = (az - this.pz[i]) * p.playerAttraction + pvz;
          active++;
          break;
        }
        case SState.LAUNCH: {
          this.formation[i] = SFormation.NORMAL;
          this.timer[i] -= dt;
          const drag = Math.exp(-1.5 * dt);
          this.vx[i] *= drag;
          this.vz[i] *= drag;
          if (this.timer[i] <= 0) {
            this.state[i] = SState.WAIT;
            this.timer[i] = 0.4 + Math.random() * 0.5;
          }
          this.px[i] += this.vx[i] * dt;
          this.pz[i] += this.vz[i] * dt;
          this.clampArena(i);
          active++;
          sumX += this.px[i];
          sumZ += this.pz[i];
          sumSpeed += Math.hypot(this.vx[i], this.vz[i]);
          continue;
        }
        case SState.WAIT: {
          this.timer[i] -= dt;
          if (att) {
            // spec 8/9. A core is an explicit placement order, so it has to
            // reach WAIT shikigami too. Skipping them meant "I threw a core
            // over there" produced different results depending on an internal
            // state the player has no way to see.
            const ca = this.slotA[i] * 2.3 + this.swirl * 1.4;
            const cr = 1.4 + this.slotR[i] * (att.radius * 0.22);
            const ax = att.x + Math.cos(ca) * cr;
            const az = att.z + Math.sin(ca) * cr;
            tvx = (ax - this.px[i]) * p.playerAttraction * att.strength + this.boids.sepX[i];
            tvz = (az - this.pz[i]) * p.playerAttraction * att.strength + this.boids.sepZ[i];
            clamp = (p.maxSpeed * 1.4) ** 2;
            response = 9;
            this.formation[i] = SFormation.GRAVITY_PULL;
            if (Math.hypot(att.x - this.px[i], att.z - this.pz[i]) < att.radius) {
              held++;
              heldWait++;
            }
          } else {
            // no core: drift in place. WAIT never seeks an enemy (spec 7).
            const w = time * 0.35 + this.bob[i];
            tvx = Math.cos(w) * 0.7 + this.boids.sepX[i] + this.boids.cohX[i] * 0.25;
            tvz = Math.sin(w * 1.13) * 0.7 + this.boids.sepZ[i] + this.boids.cohZ[i] * 0.25;
            clamp = 30;
            this.formation[i] = SFormation.NORMAL;
          }
          active++;
          loose++;
          break;
        }
        case SState.SCATTERED: {
          this.formation[i] = SFormation.NORMAL;
          scattered++;
          this.timer[i] -= dt;
          // glide outward and settle
          const drag = Math.exp(-2.6 * dt);
          this.vx[i] *= drag;
          this.vz[i] *= drag;
          this.px[i] += this.vx[i] * dt;
          this.pz[i] += this.vz[i] * dt;
          this.clampArena(i);
          const d2 =
            (this.px[i] - player.pos.x) ** 2 + (this.pz[i] - player.pos.z) ** 2;
          if (d2 < recoverR2) {
            this.state[i] = SState.FOLLOW;
            this.totalRecovered++;
            this.recoverTimeSum += Math.max(0, time - this.scatterAt[i]);
            this.onRecover?.(this.px[i], this.pz[i]);
            scattered--;
            active++;
          } else if (this.timer[i] <= 0) {
            this.alive[i] = 0;
            this.totalLost++;
            this.onLost?.(this.px[i], this.pz[i]);
            scattered--;
          }
          // Scattered shikigami are deliberately left out of the centroid.
          // Counting them in the sum but not in the denominator sent the
          // camera target to x=397 the moment the player took a hit.
          continue;
        }
        case SState.RECALL: {
          // RECALL outranks every formation modifier (spec 12): the flock stops
          // being a shape and becomes a line through the enemy.
          this.formation[i] = SFormation.NORMAL;
          response = RECALL_RESPONSE;
          const dx = player.pos.x - this.px[i];
          const dz = player.pos.z - this.pz[i];
          const d = Math.hypot(dx, dz) || 1;
          if (this.timer[i] > 0) {
            this.timer[i] -= dt;
            tvx = (dx / d) * 2.5;
            tvz = (dz / d) * 2.5;
            clamp = 30;
          } else {
            const sp = p.recallSpeed * (ty === SType.TENGJA ? v5.tengjaSpeed : 1);
            let dirX = dx / d;
            let dirZ = dz / d;

            // 騰蛇: weaves toward a nearby enemy, then comes home. The player
            // still draws the overall line (spec 1).
            if (ty === SType.TENGJA) {
              const e = this.nearestEnemy(i, enemies, 18);
              if (e) {
                const ex = e.pos.x - this.px[i];
                const ez = e.pos.z - this.pz[i];
                const ed = Math.hypot(ex, ez) || 1;
                const hunting =
                  this.lastHitId[i] !== e.id && this.recallElapsed < TENGJA_HUNT_WINDOW;
                const ew = hunting ? v5.tengjaEnemyPull : 0;
                const pw = hunting ? 1 - v5.tengjaEnemyPull : v5.tengjaPlayerPull;
                const wrap = THREE.MathUtils.clamp((6 - ed) / 6, 0, 1) * (hunting ? 1 : 0);
                const sgn = i % 2 === 0 ? 1 : -1;
                const lx = (ex / ed) * (1 - wrap) + (-ez / ed) * sgn * wrap;
                const lz = (ez / ed) * (1 - wrap) + (ex / ed) * sgn * wrap;
                dirX = (dx / d) * pw + lx * ew;
                dirZ = (dz / d) * pw + lz * ew;
                const l = Math.hypot(dirX, dirZ) || 1;
                dirX /= l;
                dirZ /= l;
                if (hunting && !this.tengjaTargets.has(e.id)) {
                  this.tengjaTargets.add(e.id);
                  this.homingRedirects++;
                }
              }
            }

            tvx = dirX * sp + this.boids.sepX[i] * 0.35;
            tvz = dirZ * sp + this.boids.sepZ[i] * 0.35;
            clamp = (sp * 1.25) ** 2;
          }
          if (d < 1.35) {
            this.state[i] = SState.FOLLOW;
            this.lastHitId[i] = -1;
          }
          active++;
          break;
        }
        case SState.FINISH: {
          this.formation[i] = SFormation.NORMAL;
          response = RECALL_RESPONSE;
          tvx = (this.finishX[i] - this.px[i]) * 11;
          tvz = (this.finishZ[i] - this.pz[i]) * 11;
          clamp = 3600;
          active++;
          break;
        }
      }

      if (st === SState.FOLLOW || st === SState.RECALL) {
        tvx += this.boids.sepX[i] + this.boids.cohX[i] + this.boids.aliX[i] * p.maxSpeed;
        tvz += this.boids.sepZ[i] + this.boids.cohZ[i] + this.boids.aliZ[i] * p.maxSpeed;
      }

      const l2 = tvx * tvx + tvz * tvz;
      if (l2 > clamp) {
        const s = Math.sqrt(clamp / l2);
        tvx *= s;
        tvz *= s;
      }

      const smooth = 1 - Math.exp(-response * dt);
      this.vx[i] += (tvx - this.vx[i]) * smooth;
      this.vz[i] += (tvz - this.vz[i]) * smooth;
      this.px[i] += this.vx[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.clampArena(i);

      sumX += this.px[i];
      sumZ += this.pz[i];
      sumSpeed += Math.hypot(this.vx[i], this.vz[i]);
    }

    this.activeCount = active;
    this.looseCount = loose;
    this.scatteredCount = scattered;
    this.heldByCore = held;
    this.heldFromWait = heldWait;
    const denom = Math.max(1, active);
    this.swarmCenter.set(sumX / denom, SHIKIGAMI_Y, sumZ / denom);
    this.avgSpeed = sumSpeed / denom;
    this.avgDistance = Math.hypot(
      this.swarmCenter.x - player.pos.x,
      this.swarmCenter.z - player.pos.z,
    );

    this.sampleTrails(dt);
    this.writeInstances(time);
    if (camera) this.vfx.update(this, camera);
  }

  private nearestEnemy(i: number, enemies: EnemyBase[], range: number): EnemyBase | null {
    let best: EnemyBase | null = null;
    let bd = range * range;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.pos.x - this.px[i]) ** 2 + (e.pos.z - this.pz[i]) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private clampArena(i: number) {
    if (clampToField(this.px[i], this.pz[i], 0, _clamped)) {
      this.px[i] = _clamped.x;
      this.pz[i] = _clamped.z;
      this.vx[i] *= 0.4;
      this.vz[i] *= 0.4;
    }
  }

  private sampleTrails(dt: number) {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = TRAIL_SAMPLE;
    this.trailHead = (this.trailHead + 1) % TRAIL_MAX;
    for (let i = 0; i < this.count; i++) {
      this.trailX[i * TRAIL_MAX + this.trailHead] = this.px[i];
      this.trailZ[i * TRAIL_MAX + this.trailHead] = this.pz[i];
    }
  }

  private writeInstances(time: number) {
    const d = this.dummy;
    for (let i = 0; i < CAPACITY; i++) {
      if (i >= this.count || !this.alive[i]) {
        d.position.set(0, -500, 0);
        d.rotation.set(0, 0, 0);
        d.scale.setScalar(0.0001);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      const vx = this.vx[i];
      const vz = this.vz[i];
      const speed = Math.hypot(vx, vz);
      const st = this.state[i];
      // a slow float, well under anything that could read as a wingbeat
      const y =
        st === SState.SCATTERED
          ? 0.55 + Math.sin(time * 1.1 + this.bob[i]) * 0.1
          : SHIKIGAMI_Y + Math.sin(time * 0.6 + this.bob[i]) * 0.11;
      d.position.set(this.px[i], y, this.pz[i]);
      if (speed > 0.15) d.lookAt(this.px[i] + vx, y + speed * 0.04, this.pz[i] + vz);
      else d.rotation.set(0, this.slotA[i], 0);

      const tengja = this.type[i] === SType.TENGJA;
      const stretch = 1 + Math.min(tengja ? 3.2 : 4.2, speed * (tengja ? 0.05 : 0.062));
      const s = tengja ? 1.2 : 1;
      d.scale.set(s, s, stretch);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      this.cardColor(i, tengja, time);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private cardColor(i: number, tengja: boolean, time: number) {
    const st = this.state[i];
    if (st === SState.SCATTERED) {
      // fading, softly pulsing -- "come and get me"
      const life = Math.max(0, this.timer[i]) / Math.max(0.1, v5.scatterLifetime);
      const pulse = 0.55 + Math.sin(time * 7 + this.bob[i]) * 0.3;
      const v = (0.25 + 0.75 * life) * pulse;
      this.color.setRGB(v, v, v * 1.05);
      return;
    }
    if (tengja) {
      if (st === SState.RECALL) this.color.setRGB(0.82, 0.92, 1.0);
      else if (st === SState.WAIT) this.color.setRGB(0.45, 0.55, 0.72);
      else this.color.setRGB(0.7, 0.82, 0.98);
      return;
    }
    if (st === SState.RECALL) this.color.setRGB(1.0, 0.98, 0.9);
    else if (st === SState.WAIT) this.color.setRGB(0.5, 0.5, 0.55);
    else if (st === SState.LAUNCH) this.color.setRGB(1.0, 0.95, 0.78);
    else if (st === SState.FINISH) this.color.setRGB(1.0, 0.92, 0.6);
    else if (this.orbitTimer > 0) this.color.setRGB(1.0, 0.96, 0.84);
    else this.color.setRGB(0.94, 0.93, 0.9);
  }

  dispose() {
    this.vfx.dispose();
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** 30 at 0:00 -> ~100 around 4:30-5:00 -> 150 by the end (spec 46). */
function scheduleCap(elapsed: number): number {
  if (!Number.isFinite(elapsed)) return Number.MAX_SAFE_INTEGER;
  const t = elapsed * v5.growthSpeed;
  const base = v5.initialShikigami;
  const toHundred = (Math.min(t, 285) / 285) * 70;
  const after = (Math.max(0, t - 285) / 120) * 50;
  return Math.round(base + toHundred + after);
}

/**
 * A comet shard: long, pointed, slightly asymmetric. Reads as a mote of light
 * or a slip of paper — never a body with wings (spec 31).
 */
function shardGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const w = 0.085;
  const h = 0.03;
  const nose = 0.34;
  const tail = 0.16;
  const verts = new Float32Array([
    0, 0, nose, w, 0, 0, 0, h, 0,
    0, 0, nose, 0, h, 0, -w * 0.85, 0, 0,
    0, 0, nose, -w * 0.85, 0, 0, 0, -h, 0,
    0, 0, nose, 0, -h, 0, w, 0, 0,
    0, 0, -tail, 0, h, 0, w, 0, 0,
    0, 0, -tail, -w * 0.85, 0, 0, 0, h, 0,
    0, 0, -tail, 0, -h, 0, -w * 0.85, 0, 0,
    0, 0, -tail, w, 0, 0, 0, -h, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

/** shortest distance from (px,pz) to the segment a->b, in 2D */
function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-9 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

import * as THREE from 'three';
import { BossCore, BossLeg } from '../entities/boundaryEater';
import type { EnemyBase } from '../entities/enemy';

export interface BossEvent {
  t: number;
  type: string;
  [k: string]: unknown;
}

export interface PhaseSummary {
  phase: number;
  duration: number;
  damageTaken: number;
  perfectDodges: number;
  legsSevered: number;
  recallCount: number;
  maxRecallHits: number;
}

export interface BossProbe {
  recallCount: number;
  maxRecallHits: number;
  damageTaken: number;
  shikigami: number;
}

const CORE_WINDOW = [5, 6, 7.5];
/** legs to cut before the core opens, per phase */
const SEVER_GOAL = [2, 3, 3];
/** how many limbs the body keeps out, per phase (spec 11/21/28) */
const LEG_COUNT = [4, 6, 8];
const LEG_HP = [190, 230, 260];
/** pause before severed limbs re-form */
const REGROW_DELAY = 2.2;
const ARENA_R = 40;

/**
 * Runs 境喰・八肢 (spec 11-31).
 *
 * The whole shape is: legs take the arena away, dodging one opens it, cutting
 * enough of them opens the core, and the core is where the hundred shikigami
 * finally go. Phases raise the pressure by adding legs and hazards, never by
 * making anything tankier (spec 47).
 */
export class BossFight {
  phase = 1;
  readonly legs: BossLeg[] = [];
  readonly core: BossCore;
  coreExposed = false;
  coreTimer = 0;
  defeated = false;
  /** seconds the whole fight has run */
  elapsed = 0;

  // --- metrics (spec 40-44)
  legsSevered = 0;
  perfectDodges = 0;
  sweepHitsTaken = 0;
  pillarHitsTaken = 0;
  coreExposureCount = 0;
  coreRecallHits = 0;
  coreRecallDamage = 0;
  readonly events: BossEvent[] = [];
  readonly phases: PhaseSummary[] = [];

  private attackTimer = 3.2;
  private severedThisPhase = 0;
  private phaseClock = 0;
  private phaseProbe: BossProbe | null = null;
  private hazards: THREE.Mesh[] = [];
  private crossQueue = 0;
  private regrowTimer = 0;

  onSpawnTrash?: (n: number) => void;
  /** a new limb pushed out, so the game can add it to the hittable list */
  onLegGrown?: (leg: BossLeg) => void;
  onLegRemoved?: (leg: BossLeg) => void;
  onPhase?: (phase: number) => void;
  onLegSevered?: (leg: BossLeg) => void;
  onCoreOpen?: (seconds: number) => void;
  onCoreClose?: () => void;
  onDefeated?: () => void;
  onTelegraph?: () => void;
  probe?: () => BossProbe;

  constructor(
    private scene: THREE.Scene,
    x: number,
    z: number,
  ) {
    // Sized against measured throughput, not guessed: one full 100-shikigami
    // recall through the open core deals ~147 damage, and a core window fits
    // about two of them. Inflating this instead of matching it is exactly the
    // "make the boss a tank" failure spec 37/47 rules out.
    this.core = new BossCore(scene, x, z, 1500);
    this.regrowLegs();
    this.phaseProbe = null;
  }

  /** every part the combat system should be able to hit */
  get parts(): EnemyBase[] {
    return [this.core, ...this.legs.filter((l) => l.alive)];
  }

  /**
   * Push limbs back out until the body has its full complement again.
   *
   * Without this the fight deadlocks: cut every limb and there is nothing left
   * to sever, so the core never opens again and the boss just stands there
   * (measured: 398 seconds with the core still at 90%). It is also the right
   * read for a flowing mass -- cut a limb off and the boundary grows another.
   */
  private regrowLegs() {
    const want = LEG_COUNT[this.phase - 1] ?? 4;
    const hp = LEG_HP[this.phase - 1] ?? LEG_HP[0];
    let live = this.legs.filter((l) => l.alive).length;
    while (live < want) {
      // fill the widest gap in the ring so the limbs stay spread out
      const leg = new BossLeg(this.scene, this.widestGap(), hp);
      leg.setRoot(this.core.pos.x, this.core.pos.z);
      leg.onSweep = (l, hit, perfect) => this.noteSweep(l, hit, perfect);
      leg.onPillarHit = () => this.pillarHitsTaken++;
      this.legs.push(leg);
      this.onLegGrown?.(leg);
      live++;
    }
  }

  private widestGap(): number {
    const angles = this.legs
      .filter((l) => l.alive)
      .map((l) => norm(l.angle))
      .sort((a, b) => a - b);
    if (!angles.length) return Math.random() * Math.PI * 2;
    let best = angles[0] + Math.PI;
    let bestGap = 0;
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      const b = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
      if (b - a > bestGap) {
        bestGap = b - a;
        best = (a + b) * 0.5;
      }
    }
    return norm(best);
  }

  /** drop limbs that have finished their sever beat */
  private pruneLegs() {
    for (let i = this.legs.length - 1; i >= 0; i--) {
      const l = this.legs[i];
      if (l.alive || !l.severed) continue;
      this.onLegRemoved?.(l);
      l.dispose();
      this.legs.splice(i, 1);
    }
  }

  private noteSweep(leg: BossLeg, hit: boolean, perfect: boolean) {
    if (hit) {
      this.sweepHitsTaken++;
      return;
    }
    if (perfect) {
      this.perfectDodges++;
      this.events.push({
        t: r2(this.elapsed),
        type: 'boss_perfect_dodge',
        attackType: 'sweep',
        legId: leg.legId,
        bossPhase: this.phase,
      });
    }
  }

  /** Called by the game when a dash beat a sweep. */
  registerDodge(leg: BossLeg) {
    leg.notePerfect();
  }

  // ------------------------------------------------------------------ update

  update(dt: number, playerPos: THREE.Vector3, probe: BossProbe) {
    if (this.defeated) return;
    this.elapsed += dt;
    this.phaseClock += dt;
    if (!this.phaseProbe) this.phaseProbe = { ...probe };

    // --- severed legs
    for (const leg of this.legs) {
      if (leg.alive || leg.severed) continue;
      leg.severed = true;
      this.legsSevered++;
      this.severedThisPhase++;
      this.events.push({
        t: r2(this.elapsed),
        type: 'boss_leg_severed',
        legId: leg.legId,
        phase: this.phase,
        recallHits: leg.hitsSinceExposed,
        afterPerfectDodge: leg.lastPerfect,
      });
      this.onLegSevered?.(leg);
      this.regrowTimer = REGROW_DELAY;
    }

    // limbs re-form a beat after they are cut, unless the body is open
    if (this.regrowTimer > 0 && !this.coreExposed) {
      this.regrowTimer -= dt;
      if (this.regrowTimer <= 0) {
        this.pruneLegs();
        this.regrowLegs();
      }
    }

    // --- core window
    if (this.coreExposed) {
      this.coreTimer -= dt;
      if (this.coreTimer <= 0) this.closeCore();
    } else if (this.severedThisPhase >= (SEVER_GOAL[this.phase - 1] ?? 3)) {
      this.openCore();
    }

    this.core.exposed = this.coreExposed;

    // --- phase transitions, driven by core health (spec 21/26)
    const frac = this.core.hp / this.core.maxHp;
    if (this.phase === 1 && frac <= 0.68) this.enterPhase(2);
    else if (this.phase === 2 && frac <= 0.33) this.enterPhase(3);
    if (!this.core.alive && !this.defeated) {
      this.defeated = true;
      this.closePhase();
      this.onDefeated?.();
      return;
    }

    // --- attack scheduling
    this.attackTimer -= dt;
    if (this.attackTimer <= 0 && !this.coreExposed) this.schedule(playerPos);

    for (const leg of this.legs) if (leg.alive) leg.setRoot(this.core.pos.x, this.core.pos.z);
    this.updateHazards(dt);
  }

  private schedule(playerPos: THREE.Vector3) {
    const ready = this.legs.filter((l) => l.alive && l.state === 'idle');
    if (!ready.length) {
      this.attackTimer = 0.8;
      return;
    }
    const pa = Math.atan2(playerPos.z - this.core.pos.z, playerPos.x - this.core.pos.x);

    // Phase 3 runs a readable rota rather than everything at once (spec 28)
    if (this.crossQueue > 0) {
      this.crossQueue--;
      this.sweep(ready, pa + 0.8);
      this.attackTimer = 1.5;
      return;
    }

    const roll = Math.random();
    if (this.phase >= 2 && roll < 0.34) {
      this.pillar(ready, playerPos);
      this.attackTimer = 3.4;
    } else if (this.phase >= 2 && roll < 0.52) {
      // CROSS SWEEP: two sweeps with a readable gap, never a chain (spec 23)
      this.sweep(ready, pa);
      this.crossQueue = 1;
      this.attackTimer = 1.6;
    } else {
      this.sweep(ready, pa);
      this.attackTimer = this.phase === 1 ? 3.6 : 2.9;
    }
    if (this.phase >= 2 && Math.random() < 0.4) this.onSpawnTrash?.(3 + Math.floor(Math.random() * 3));
  }

  private sweep(ready: BossLeg[], playerAngle: number) {
    // The limb nearest the player's side swings, but a limb that just swung is
    // pushed down the order. Picking purely by angle meant a player who held
    // position was attacked by the SAME leg every time, so the other three were
    // never threats and never got cut.
    let best = ready[0];
    let bestScore = Infinity;
    for (const l of ready) {
      const rest = this.elapsed - (this.lastSwing.get(l.legId) ?? -99);
      const score = Math.abs(angleDiff(l.angle, playerAngle)) + (rest < 7 ? (7 - rest) * 0.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = l;
      }
    }
    this.lastSwing.set(best.legId, this.elapsed);
    best.beginSweep(playerAngle, 1.5 + Math.random() * 0.5);
    this.onTelegraph?.();
  }

  private lastSwing = new Map<number, number>();

  private pillar(ready: BossLeg[], playerPos: THREE.Vector3) {
    const leg = ready[Math.floor(Math.random() * ready.length)];
    // planted a little off the player, so it shrinks the ground without
    // being an unavoidable hit (spec 22)
    const a = Math.random() * Math.PI * 2;
    const x = THREE.MathUtils.clamp(playerPos.x + Math.cos(a) * 11, -ARENA_R + 8, ARENA_R - 8);
    const z = THREE.MathUtils.clamp(playerPos.z + Math.sin(a) * 11, -ARENA_R + 8, ARENA_R - 8);
    leg.beginPillar(x, z, 8.5, 7);
    this.addHazard(leg);
    this.onTelegraph?.();
  }

  private addHazard(leg: BossLeg) {
    const g = new THREE.CircleGeometry(1, 34);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: 0x7a1420,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    m.position.set(leg.hazardX, 0.07, leg.hazardZ);
    m.scale.setScalar(leg.hazardR);
    m.userData.leg = leg;
    this.scene.add(m);
    this.hazards.push(m);
  }

  private updateHazards(dt: number) {
    void dt;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      const leg = h.userData.leg as BossLeg;
      // cutting the limb clears the ground it poisoned (spec 22)
      if (!leg.alive || leg.hazardR <= 0) {
        this.scene.remove(h);
        h.geometry.dispose();
        (h.material as THREE.Material).dispose();
        this.hazards.splice(i, 1);
        continue;
      }
      const m = h.material as THREE.MeshBasicMaterial;
      m.opacity = 0.16 + Math.sin(performance.now() * 0.004 + leg.legId) * 0.05;
    }
  }

  // ------------------------------------------------------------------- phase

  private openCore() {
    this.coreExposed = true;
    this.coreExposureCount++;
    this.coreTimer = CORE_WINDOW[this.phase - 1] ?? 5;
    this.severedThisPhase = 0;
    this.regrowTimer = 0;
    // legs stand down while the body is open, so the window is a clean run at it
    for (const l of this.legs) if (l.alive) l.state = 'idle';
    this.onCoreOpen?.(this.coreTimer);
  }

  private closeCore() {
    this.coreExposed = false;
    this.attackTimer = 1.4;
    // the body shuts and pushes its limbs back out, so the loop can run again
    this.pruneLegs();
    this.regrowLegs();
    this.onCoreClose?.();
  }

  private enterPhase(n: number) {
    this.closePhase();
    this.phase = n;
    this.phaseClock = 0;
    this.severedThisPhase = 0;
    this.phaseProbe = this.probe?.() ?? null;
    // more limbs, not tougher ones
    this.pruneLegs();
    this.regrowLegs();
    for (const l of this.legs) {
      if (!l.alive) continue;
      l.reach = n === 3 ? 30 : 27;
    }
    this.attackTimer = 2.2;
    this.onPhase?.(n);
  }

  private closePhase() {
    const a = this.phaseProbe;
    const b = this.probe?.();
    if (!a || !b) return;
    this.phases.push({
      phase: this.phase,
      duration: r2(this.phaseClock),
      damageTaken: r2(b.damageTaken - a.damageTaken),
      perfectDodges: this.perfectDodges,
      legsSevered: this.legsSevered,
      recallCount: b.recallCount - a.recallCount,
      maxRecallHits: b.maxRecallHits,
    });
    this.phaseProbe = null;
  }

  /** the game reports recall damage that landed on the open core */
  noteCoreRecall(hits: number, damage: number, shikigami: number, afterGravity: boolean) {
    if (!hits) return;
    this.coreRecallHits += hits;
    this.coreRecallDamage += damage;
    this.events.push({
      t: r2(this.elapsed),
      type: 'boss_core_recall',
      hits,
      damage: r2(damage),
      shikigamiCount: shikigami,
      afterGravity,
    });
  }

  get activeLegs(): number {
    return this.legs.filter((l) => l.alive).length;
  }

  /** the limb currently winding up or swinging, if any */
  get threat(): BossLeg | null {
    for (const l of this.legs) {
      if (l.alive && (l.state === 'sweepWindup' || l.state === 'sweeping')) return l;
    }
    return null;
  }

  get nextAttack(): string {
    const t = this.threat;
    if (t) return t.state === 'sweeping' ? 'SWEEP' : 'SWEEP (tell)';
    if (this.coreExposed) return 'CORE OPEN';
    return this.attackTimer > 0 ? 'in ' + this.attackTimer.toFixed(1) + 's' : '--';
  }

  dispose() {
    for (const h of this.hazards) {
      this.scene.remove(h);
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
    }
    this.hazards.length = 0;
    for (const l of this.legs) l.dispose();
    this.legs.length = 0;
    this.core.dispose();
  }
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function norm(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

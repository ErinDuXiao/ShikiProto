import * as THREE from 'three';
import { v5 } from '../core/v5Params';
import { ShikigamiManager, SState, SType } from '../entities/shikigami';
import type { EnemyBase } from '../entities/enemy';
import type { Fx } from '../core/fx';
import type { Sfx } from '../core/audio';
import type { RecallSystem } from './recallSystem';

/** min seconds before the same shikigami may hit the same enemy again */
const REHIT_COOLDOWN = 0.32;
/** hits landing within this window on one enemy merge into a single number */
const AGGREGATE_WINDOW = 0.11;

interface Accum {
  enemy: EnemyBase;
  count: number;
  damage: number;
  timer: number;
  guardOnly: boolean;
  fromRecall: boolean;
  /** every contribution so far was a graze (orbit ring / spread sweep) */
  light: boolean;
}

export interface CombatTotals {
  damageDealt: number;
  recallDamage: number;
  normalAttackDamage: number;
  bossDamage: number;
  enemiesKilled: number;
  largestRecallHit: number;
  largestRecallShikigamiCount: number;
  foxfireHits: number;
  foxfireDamage: number;
  /** recall hits landed on enemies held by Spider Bind */
  hitsAgainstBound: number;
  damageAgainstBound: number;
  /** contacts made by the ORBIT RING itself, not by individual shikigami */
  orbitContactHits: number;
  orbitContactDamage: number;
  /** grazes made by the SPREAD surface while it opened */
  spreadContactHits: number;
  spreadContactDamage: number;
}

/**
 * Turns shikigami motion into damage. Nothing here fires on its own: a
 * shikigami only hurts something while the player is throwing it, recalling
 * it, or spinning it (spec 34).
 */
export class CombatSystem {
  readonly totals: CombatTotals = {
    damageDealt: 0,
    recallDamage: 0,
    normalAttackDamage: 0,
    bossDamage: 0,
    enemiesKilled: 0,
    largestRecallHit: 0,
    largestRecallShikigamiCount: 0,
    foxfireHits: 0,
    foxfireDamage: 0,
    hitsAgainstBound: 0,
    damageAgainstBound: 0,
    orbitContactHits: 0,
    orbitContactDamage: 0,
    spreadContactHits: 0,
    spreadContactDamage: 0,
  };

  private accum = new Map<number, Accum>();
  /** next time each enemy may be ticked by the orbit ring */
  private orbitTick = new Map<number, number>();
  /** time of the last ring contact, so the ring can flash */
  lastOrbitContact = -99;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  onKill?: (enemy: EnemyBase) => void;
  /** every landed hit, so the boss fight can attribute recalls to its parts */
  onHit?: (enemy: EnemyBase, damage: number, isRecall: boolean) => void;

  constructor(
    private swarm: ShikigamiManager,
    private fx: Fx,
    private sfx: Sfx,
    private camera: THREE.Camera,
    private recall: RecallSystem,
  ) {}

  update(dt: number, time: number, enemies: EnemyBase[], playerX: number, playerZ: number) {
    const s = this.swarm;

    this.updateOrbitRing(time, enemies, playerX, playerZ);

    for (let i = 0; i < s.count; i++) {
      if (!s.isDamaging(i)) continue;
      const ax = s.prevX[i];
      const az = s.prevZ[i];
      const bx = s.px[i];
      const bz = s.pz[i];
      const isRecall = s.state[i] === SState.RECALL;
      // a spread graze is a light contact: no hit stop, no big number (spec 6)
      const isLight = s.isLightContact(i);

      for (const e of enemies) {
        if (!e.alive) continue;
        if (s.lastHitId[i] === e.id && time - s.lastHitT[i] < REHIT_COOLDOWN) continue;
        const rr = e.radius + 0.85;
        if (segmentCircleSq(ax, az, bx, bz, e.pos.x, e.pos.z) > rr * rr) continue;

        // travel direction decides whether we hit the guarded face
        const vx = bx - ax;
        const vz = bz - az;
        const vl = Math.hypot(vx, vz) || 1;
        this.dir.set(vx / vl, 0, vz / vl);
        // Spider Bind grants no damage bonus on purpose: its job is time, not
        // damage, so the reward still comes from the recall itself (spec 26).
        const mult = e.damageMultiplier(this.dir);
        const vsBound = e.snared && isRecall;

        const speed = Math.hypot(s.vx[i], s.vz[i]);
        const speedFactor = THREE.MathUtils.clamp(speed / 45, 0.3, 1.8);
        const dmg = s.hitPower(i) * speedFactor * mult * (isRecall ? e.recallBonus : 1);

        s.lastHitId[i] = e.id;
        s.lastHitT[i] = time;

        const killed = e.takeDamage(dmg);
        this.onHit?.(e, dmg, isRecall);
        this.totals.damageDealt += dmg;
        if (s.type[i] === SType.TENGJA) {
          this.totals.foxfireHits++;
          this.totals.foxfireDamage += dmg;
        }
        if (vsBound) {
          this.totals.hitsAgainstBound++;
          this.totals.damageAgainstBound += dmg;
          this.recall.markBoundHit();
        }
        if (e.isBoss) this.totals.bossDamage += dmg;
        if (isRecall) {
          this.totals.recallDamage += dmg;
          this.recall.reportHit(e.id, i, dmg);
        } else {
          this.totals.normalAttackDamage += dmg;
        }
        if (isLight) {
          this.totals.spreadContactHits++;
          this.totals.spreadContactDamage += dmg;
        }

        // a graze barely moves the target; only a strike shoves it
        const knock = isLight ? 0.5 : 2.4;
        e.push(this.dir.x * knock * mult, this.dir.z * knock * mult);

        this.record(e, dmg, mult, isRecall, isLight);

        if (killed) {
          this.totals.enemiesKilled++;
          if (isRecall) this.recall.reportKill();
          this.onKill?.(e);
          this.killFx(e);
          break;
        }
      }
    }

    this.flush(dt);
  }

  /**
   * ORBIT (spec 1/16). The damage belongs to the FORMATION, not to the
   * shikigami. Nothing leaves the ring to chase anything: the ring is a band
   * around the caster, and an enemy that walks into the band gets cut.
   *
   * It ticks on a timer per enemy rather than per shikigami, so the number of
   * shikigami in the ring changes how the ring *looks*, not how hard it hits.
   */
  private updateOrbitRing(time: number, enemies: EnemyBase[], px: number, pz: number) {
    const s = this.swarm;
    if (s.orbitTimer <= 0) {
      if (this.orbitTick.size) this.orbitTick.clear();
      return;
    }
    const inner = s.orbitInnerRadius;
    const outer = s.orbitOuterRadius;

    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - px;
      const dz = e.pos.z - pz;
      const d = Math.hypot(dx, dz) || 0.0001;
      // a band, not a disc: standing dead centre inside the formation is not
      // touching it
      if (d + e.radius < inner || d - e.radius > outer) continue;

      const next = this.orbitTick.get(e.id);
      if (next !== undefined && time < next) continue;
      this.orbitTick.set(e.id, time + Math.max(0.05, v5.orbitTickInterval));

      this.dir.set(dx / d, 0, dz / d);
      const mult = e.damageMultiplier(this.dir);
      const dmg = v5.orbitDamage * mult;

      const killed = e.takeDamage(dmg);
      this.totals.damageDealt += dmg;
      this.totals.normalAttackDamage += dmg;
      this.totals.orbitContactHits++;
      this.totals.orbitContactDamage += dmg;
      this.lastOrbitContact = time;

      // 牽制: nudged back out of the ring rather than punted
      e.push(this.dir.x * 3.4, this.dir.z * 3.4);
      this.record(e, dmg, mult, false, true);

      if (killed) {
        this.totals.enemiesKilled++;
        this.onKill?.(e);
        this.killFx(e);
      }
    }
  }

  private record(e: EnemyBase, dmg: number, mult: number, fromRecall: boolean, light: boolean) {
    let a = this.accum.get(e.id);
    if (!a) {
      a = {
        enemy: e,
        count: 0,
        damage: 0,
        timer: 0,
        guardOnly: true,
        fromRecall: false,
        light: true,
      };
      this.accum.set(e.id, a);
    }
    a.count++;
    a.damage += dmg;
    a.timer = AGGREGATE_WINDOW;
    if (mult >= 0.9) a.guardOnly = false;
    if (fromRecall) a.fromRecall = true;
    if (!light) a.light = false;
  }

  /** Emit any pending aggregates. Safe to call on frames where collision is
   *  skipped (e.g. during the finisher) so the last hit is never swallowed. */
  flush(dt: number) {
    for (const [id, a] of this.accum) {
      a.timer -= dt;
      if (a.timer > 0) continue;
      this.accum.delete(id);
      this.emit(a);
    }
  }

  private emit(a: Accum) {
    const e = a.enemy;
    this.tmp.set(e.pos.x, e.hitHeight + 0.6, e.pos.z);
    const dmg = Math.round(a.damage);
    const big = a.count >= 12;

    // spec 6: a graze must never read like a recall. Small number, small
    // flash, no hit stop, no shake.
    if (a.light) {
      if (dmg >= 1) this.fx.damageNumber(this.tmp, this.camera, `${dmg}`, 'light');
      this.fx.burst(e.pos.x, e.hitHeight, e.pos.z, Math.min(10, 2 + a.count), 0xbfd4e6, 3.2, 0.22);
      this.sfx.hit(0.09);
      return;
    }

    if (a.guardOnly && a.count >= 3) {
      this.fx.damageNumber(this.tmp, this.camera, 'GUARD ' + dmg, 'guard');
      this.fx.burst(e.pos.x, e.hitHeight, e.pos.z, 6, 0x6fd2ff, 4, 0.3);
      this.sfx.hit(0.15);
      return;
    }

    this.fx.damageNumber(this.tmp, this.camera, `${dmg}`, big ? 'big' : 'normal');
    this.fx.burst(
      e.pos.x,
      e.hitHeight,
      e.pos.z,
      Math.min(60, 4 + a.count * 2),
      big ? 0xffe6c0 : 0xd8a898,
      5 + Math.min(10, a.count * 0.4),
      0.4,
    );

    if (a.count >= 24) {
      this.fx.stop(0.075);
      this.fx.shake(0.7);
      this.fx.screenFlash(0.16);
      this.fx.ring(e.pos.x, e.pos.z, 1, 11, 0.34, 0xfff0b0);
      this.sfx.bigHit(a.count);
    } else if (a.count >= 10) {
      this.fx.stop(0.045);
      this.fx.shake(0.38);
      this.sfx.bigHit(a.count);
    } else {
      this.fx.stop(0.018);
      this.fx.shake(0.12);
      this.sfx.hit(Math.min(1, a.count / 8));
    }

    if (a.fromRecall) {
      if (a.damage > this.totals.largestRecallHit) this.totals.largestRecallHit = a.damage;
      if (a.count > this.totals.largestRecallShikigamiCount) {
        this.totals.largestRecallShikigamiCount = a.count;
      }
    }
  }

  onKillFx?: (e: EnemyBase) => void;

  private killFx(e: EnemyBase) {
    this.fx.burst(e.pos.x, e.hitHeight, e.pos.z, e.isBoss ? 160 : 34, 0xc4485a, e.isBoss ? 18 : 9, 0.8);
    this.fx.ring(e.pos.x, e.pos.z, 1, e.isBoss ? 22 : 7, 0.5, 0xff8866);
    this.fx.shake(e.isBoss ? 1.0 : 0.35);
    this.sfx.enemyDown();
  }

  /** drop any pending aggregate for enemies that were removed */
  forget(id: number) {
    this.accum.delete(id);
  }
}

/** squared distance from circle centre (cx,cz) to segment a->b, in 2D */
function segmentCircleSq(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = cx - ax;
  const wz = cz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-9 ? (wx * vx + wz * vz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = wx - vx * t;
  const dz = wz - vz * t;
  return dx * dx + dz * dz;
}

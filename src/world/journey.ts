import * as THREE from 'three';
import { setField } from '../core/params';
import {
  LOCATIONS,
  ROAD_HALF_WIDTH,
  ROUTE,
  START,
  type LocationDef,
  type LocationId,
} from './locations';
import { Encounter, type EncounterSpawn } from './encounter';

export type Phase = 'travel' | 'combat' | 'calm' | 'done';

export interface TravelLeg {
  from: string;
  to: string;
  travelTime: number;
}

export interface RouteChoice {
  t: number;
  type: 'route_choice';
  options: LocationId[];
  selected: LocationId;
}

export interface LocationEvent {
  t: number;
  type:
    | 'locationEntered'
    | 'locationCombatStarted'
    | 'locationCombatEnded'
    | 'locationExited';
  location: string;
}

export interface LocationCombat {
  location: string;
  duration: number;
  recallCount: number;
  maxRecallHits: number;
  gravityUses: number;
  spreadUses: number;
  damageTaken: number;
  enemiesKilled: number;
  shikigamiLost: number;
  shikigamiAtStart: number;
  shikigamiAtEnd: number;
}

/** counters the journey samples at the start and end of each fight */
export interface CombatProbe {
  recallCount: number;
  maxRecallHits: number;
  gravityUses: number;
  spreadUses: number;
  damageTaken: number;
  enemiesKilled: number;
  shikigamiLost: number;
  shikigami: number;
}

/** how close you have to get before the disturbance notices you (spec 9) */
const TRIGGER_PAD = 8;
/** seconds of quiet after a location is cleared (spec 25) */
const CALM_TIME = 4.5;

/**
 * 京都を歩く (spec 1).
 *
 * The wave system is not thrown away -- it is wrapped. Underneath, an
 * Encounter still releases enemies on a schedule. What changes is that the
 * player never waits for a wave: they walk somewhere, the place is wrong when
 * they arrive, and when it is quiet again they walk somewhere else.
 *
 * This class owns the play field. Travelling, the field is a corridor along
 * the road; fighting, it is the location's own ground.
 */
export class Journey {
  phase: Phase = 'travel';
  current: LocationDef | null = null;
  encounter: Encounter | null = null;

  /** where the walk started from, for the corridor and the travel log */
  private fromPos = { x: START.x, z: START.z };
  private fromName = 'start';
  private routeIndex = 0;
  private options: LocationId[] = [];
  private locked: LocationId | null = null;
  private travelClock = 0;
  private calmClock = 0;
  private awaitingChoiceLog = false;

  // --- metrics (spec 42)
  readonly legs: TravelLeg[] = [];
  readonly events: LocationEvent[] = [];
  readonly combats: LocationCombat[] = [];
  readonly choices: RouteChoice[] = [];
  totalExplorationTime = 0;
  totalCombatTime = 0;
  locationsCleared = 0;
  routeSelected: string[] = [];

  private probeAtStart: CombatProbe | null = null;
  private combatClock = 0;

  onArrive?: (loc: LocationDef) => void;
  onCombatStart?: (loc: LocationDef) => void;
  onCleared?: (loc: LocationDef) => void;
  onDepart?: (to: LocationDef[]) => void;
  onSpawn?: (s: EncounterSpawn) => void;
  onBoss?: () => void;
  onFinish?: () => void;
  /** asked for the live counters when a fight opens and closes */
  probe?: () => CombatProbe;

  constructor() {
    this.advanceTargets();
    // The field has to be the first corridor BEFORE anything updates: the
    // player moves earlier in the frame than the journey does, so a stale arena
    // circle would yank them off the road on frame one.
    const t = this.target;
    if (t) setField(this.fromPos.x, this.fromPos.z, t.x, t.z, ROAD_HALF_WIDTH);
  }

  // ------------------------------------------------------------------ target

  /** the place (or places) the player is currently walking towards */
  get targets(): LocationDef[] {
    return this.options.map((id) => LOCATIONS[id]);
  }

  /** the fork option the player has committed to, or null while undecided */
  get committed(): LocationId | null {
    return this.locked;
  }

  /** the one actually being approached, once it is clear which */
  get target(): LocationDef | null {
    if (!this.options.length) return null;
    return LOCATIONS[this.locked ?? this.options[0]];
  }

  private advanceTargets() {
    if (this.routeIndex >= ROUTE.length) {
      this.options = [];
      this.locked = null;
      return;
    }
    const step = ROUTE[this.routeIndex];
    this.options = Array.isArray(step) ? [...step] : [step];
    this.locked = this.options.length === 1 ? this.options[0] : null;
    this.awaitingChoiceLog = this.options.length > 1;
  }

  // ------------------------------------------------------------------ update

  update(dt: number, time: number, playerPos: THREE.Vector3, aliveCount: number) {
    switch (this.phase) {
      case 'travel':
        this.updateTravel(dt, time, playerPos);
        break;
      case 'combat':
        this.updateCombat(dt, time, playerPos, aliveCount);
        break;
      case 'calm':
        this.updateCalm(dt, time);
        break;
      case 'done':
        break;
    }
  }

  private updateTravel(dt: number, time: number, playerPos: THREE.Vector3) {
    this.travelClock += dt;
    this.totalExplorationTime += dt;

    const targets = this.targets;
    if (!targets.length) {
      this.phase = 'done';
      return;
    }

    // At a fork the road is chosen by walking down it -- no menu (spec 17/30).
    // Whichever corridor the player is closest to becomes the live one, and it
    // locks once they have clearly committed.
    let best = targets[0];
    if (!this.locked && targets.length > 1) {
      let bestD = Infinity;
      for (const t of targets) {
        const d = distToSegment(playerPos.x, playerPos.z, this.fromPos.x, this.fromPos.z, t.x, t.z);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      const walked = Math.hypot(playerPos.x - this.fromPos.x, playerPos.z - this.fromPos.z);
      const total = Math.hypot(best.x - this.fromPos.x, best.z - this.fromPos.z);
      if (walked > total * 0.45) {
        this.locked = best.id;
        if (this.awaitingChoiceLog) {
          this.awaitingChoiceLog = false;
          this.choices.push({
            t: r2(time),
            type: 'route_choice',
            options: this.options.slice(),
            selected: best.id,
          });
        }
      }
    } else if (this.locked) {
      best = LOCATIONS[this.locked];
    }

    // the corridor you are walking down
    setField(this.fromPos.x, this.fromPos.z, best.x, best.z, ROAD_HALF_WIDTH);

    const d = Math.hypot(playerPos.x - best.x, playerPos.z - best.z);
    if (d < best.ground.radius + TRIGGER_PAD) this.beginEncounter(best, time);
  }

  private beginEncounter(loc: LocationDef, time: number) {
    this.locked = loc.id;
    this.current = loc;
    this.phase = 'combat';
    this.combatClock = 0;
    this.routeSelected.push(loc.id);

    this.legs.push({
      from: this.fromName,
      to: loc.id,
      travelTime: r2(this.travelClock),
    });
    this.travelClock = 0;

    const g = loc.ground;
    setField(g.ax, g.az, g.bx, g.bz, g.radius);

    this.events.push({ t: r2(time), type: 'locationEntered', location: loc.id });
    this.events.push({ t: r2(time), type: 'locationCombatStarted', location: loc.id });
    this.probeAtStart = this.probe?.() ?? null;

    const enc = new Encounter(loc);
    enc.onSpawn = (s) => this.onSpawn?.(s);
    enc.onBoss = () => this.onBoss?.();
    enc.onCleared = () => this.finishEncounter(time + this.combatClock);
    this.encounter = enc;

    this.onArrive?.(loc);
    this.onCombatStart?.(loc);
  }

  private updateCombat(dt: number, time: number, playerPos: THREE.Vector3, aliveCount: number) {
    this.combatClock += dt;
    this.totalCombatTime += dt;
    const loc = this.current;
    if (!loc) return;
    const g = loc.ground;
    setField(g.ax, g.az, g.bx, g.bz, g.radius);
    this.encounter?.update(dt, aliveCount, playerPos);
    void time;
  }

  private finishEncounter(time: number) {
    const loc = this.current;
    if (!loc) return;
    this.phase = 'calm';
    this.calmClock = CALM_TIME;
    this.locationsCleared++;
    this.events.push({ t: r2(time), type: 'locationCombatEnded', location: loc.id });

    const a = this.probeAtStart;
    const b = this.probe?.() ?? null;
    if (a && b) {
      this.combats.push({
        location: loc.id,
        duration: r2(this.combatClock),
        recallCount: b.recallCount - a.recallCount,
        maxRecallHits: b.maxRecallHits,
        gravityUses: b.gravityUses - a.gravityUses,
        spreadUses: b.spreadUses - a.spreadUses,
        damageTaken: r2(b.damageTaken - a.damageTaken),
        enemiesKilled: b.enemiesKilled - a.enemiesKilled,
        shikigamiLost: b.shikigamiLost - a.shikigamiLost,
        shikigamiAtStart: a.shikigami,
        shikigamiAtEnd: b.shikigami,
      });
    }
    this.probeAtStart = null;
    loc.reward?.apply();
    this.onCleared?.(loc);
  }

  /**
   * Close the current fight from outside. The boss finisher ends the run
   * before the encounter can notice it is over, which otherwise left the last
   * location out of the log entirely.
   */
  closeCurrent(time: number) {
    if (this.phase !== 'combat' || !this.current) return;
    this.finishEncounter(time);
  }

  private updateCalm(dt: number, time: number) {
    this.calmClock -= dt;
    this.totalExplorationTime += dt;
    if (this.calmClock > 0) return;

    const loc = this.current;
    if (loc) {
      this.events.push({ t: r2(time), type: 'locationExited', location: loc.id });
      this.fromPos = { x: loc.x, z: loc.z };
      this.fromName = loc.id;
    }
    this.encounter = null;
    this.current = null;
    this.routeIndex++;
    this.advanceTargets();

    if (!this.options.length) {
      this.phase = 'done';
      this.onFinish?.();
      return;
    }
    this.phase = 'travel';
    this.travelClock = 0;
    this.onDepart?.(this.targets);
  }

  // ----------------------------------------------------------------- metrics

  get averageTravelTime(): number {
    if (!this.legs.length) return 0;
    return r2(this.legs.reduce((a, l) => a + l.travelTime, 0) / this.legs.length);
  }

  get longestTravelTime(): number {
    return this.legs.length ? r2(Math.max(...this.legs.map((l) => l.travelTime))) : 0;
  }

  /** how far along the current walk the player is, 0..1, for the HUD */
  progressTo(playerPos: THREE.Vector3): number {
    const t = this.target;
    if (!t || this.phase !== 'travel') return 1;
    const total = Math.hypot(t.x - this.fromPos.x, t.z - this.fromPos.z) || 1;
    const left = Math.hypot(t.x - playerPos.x, t.z - playerPos.z);
    return THREE.MathUtils.clamp(1 - left / total, 0, 1);
  }
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-9 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

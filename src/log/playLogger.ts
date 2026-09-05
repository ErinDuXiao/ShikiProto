import { VERSION } from '../core/runConfig';

const STORAGE_KEY = 'shikigami_flow_logs_v9';
const MAX_STORED = 40;

export interface RecallRecord {
  t: number;
  shikigami: number;
  hits: number;
  damage: number;
  maxPenetration: number;
  /** fired inside the gravity-core window */
  afterGravity: boolean;
  /** fired inside the spread window */
  afterSpread: boolean;
  /** fired while the ring formation was up */
  duringOrbit: boolean;
  /** which formula it satisfied, if any */
  formula: string | null;
}

/** the growth checkpoints, and the field each one lands in */
export const GROWTH_MILESTONES = [
  { count: 50, key: 'timeTo50' },
  { count: 75, key: 'timeTo75' },
  { count: 100, key: 'timeTo100' },
  { count: 125, key: 'timeTo125' },
  { count: 150, key: 'timeTo150' },
] as const;

export interface GrowthEvent {
  t: number;
  /** e.g. "reach_100" */
  type: string;
  /** the actual flock size at that moment, which may overshoot the milestone */
  shikigami: number;
}

/** Kyoto exploration metrics (spec 39-42). Absent in arena runs. */
export interface ExplorationLog {
  mode: 'kyoto';
  totalExplorationTime: number;
  totalCombatTime: number;
  combatShare: number;
  explorationShare: number;
  averageTravelTime: number;
  longestTravelTime: number;
  locationsCleared: number;
  routeSelected: string[];
  travel: Array<{ from: string; to: string; travelTime: number }>;
  events: Array<{ t: number; type: string; location: string }>;
  choices: Array<{ t: number; type: string; options: string[]; selected: string }>;
  locations: Array<Record<string, string | number>>;
}

/** Tutorial analytics (spec 41-43). */
export interface TutorialStep {
  step: string;
  startTime: number;
  completeTime: number;
  attempts: number;
}

export interface TutorialLog {
  started: boolean;
  completed: boolean;
  skipped: boolean;
  duration: number;
  steps: TutorialStep[];
  /** how many times Release -> Move -> Recall actually killed something */
  recallSuccessCount: number;
  timeToUnderstandRelease: number | null;
  timeToFirstSuccessfulRecall: number | null;
  timeToFirstRecallKill: number | null;
  timeToFirstDash: number | null;
  timeToFirstGravitySetup: number | null;
}

export interface PlayLog {
  sessionId: string;
  version: string;
  mode: 'arena' | 'kyoto' | 'tutorial';
  playStartTime: string;
  /**
   * SIMULATION seconds -- the same clock every other timestamp in this log is
   * measured against. It deliberately differs from wall-clock time: it stops
   * while the tab is backgrounded and slows during hit stop.
   */
  playDuration: number;
  /** wall-clock seconds from the first frame to finalise, for comparison */
  wallDuration: number;
  victory: boolean;
  result: 'victory' | 'defeat' | 'incomplete';

  // --- growth
  initialShikigami: number;
  /**
   * Peak size of the LIVE flock -- the number on the HUD. Milestones are read
   * off this same figure, so `maxShikigamiReached >= n` always implies the
   * matching `timeToN` is set.
   */
  maxShikigamiReached: number;
  /**
   * Peak number of shikigami ever allocated this run, losses included. Always
   * >= maxShikigamiReached; it says how much the pickups delivered, not how
   * big the flock ever actually got.
   */
  totalShikigamiGrown: number;
  finalShikigami: number;
  timeTo50: number | null;
  timeTo75: number | null;
  timeTo100: number | null;
  timeTo125: number | null;
  timeTo150: number | null;
  pickupsCollected: number;

  // --- recall
  recallCount: number;
  avgRecallHits: number;
  maxRecallHits: number;
  recalls50Plus: number;
  recalls100Plus: number;
  totalRecallDamage: number;

  // --- spread
  spreadUses: number;
  spreadToRecallCount: number;
  /** same figure under the name spec 15 asks for: recalls inside the 4s window */
  recallsWithin4Seconds: number;
  averageRecallHitsAfterSpread: number;
  successfulSpreadSetups: number;
  /** grazes landed by the opening surface, which is NOT an attack (spec 5) */
  spreadContactHits: number;
  spreadContactDamage: number;

  // --- gravity core
  gravityUses: number;
  avgShikigamiAttracted: number;
  maxShikigamiAttracted: number;
  /** summed peak pull across every core thrown this run */
  totalShikigamiAttracted: number;
  /** of those, how many were sitting in WAIT when the core took them (spec 8) */
  shikigamiPulledFromWait: number;
  gravityToRecallCount: number;
  /** same figure under the name spec 15 asks for: recalls inside the 5s window */
  recallsWithin5Seconds: number;
  averageRecallHitsAfterGravity: number;
  successfulGravitySetups: number;

  // --- orbit
  orbitPickups: number;
  totalOrbitDuration: number;
  recallsDuringOrbit: number;
  hitsFromOrbitStateRecall: number;
  /** contacts made by the RING itself; individuals never chase (spec 1) */
  orbitContactHits: number;
  orbitContactDamage: number;

  // --- scatter / recover
  damageEvents: number;
  totalShikigamiScattered: number;
  totalShikigamiRecovered: number;
  totalShikigamiLost: number;
  averageRecoverTime: number;
  recoveryRate: number;

  // --- formula
  coreSetupSuccesses: number;
  spreadSetupSuccesses: number;
  fullSetupSuccesses: number;

  // --- 騰蛇
  tengjaHits: number;
  tengjaDamage: number;
  homingRedirectCount: number;

  enemiesKilled: number;

  // --- 鬼 the arena Oni
  bossEncountered: boolean;
  bossDefeated: boolean;
  bossFightDuration: number;
  bossDamageTaken: number;
  bossPerfectDodges: number;
  bossSlamHitsTaken: number;
  bossChargeHitsTaken: number;
  bossSwingHitsTaken: number;

  /** only present for tutorial runs */
  tutorial: TutorialLog | null;

  // --- raw input counters, so the log can be sanity-checked against the run
  leftClickCount: number;
  dashCount: number;
  spreadCount: number;
  gravityUseCount: number;
  orbitActivationCount: number;
  damageTaken: number;

  recalls: RecallRecord[];
  /** one entry the first time each growth milestone is crossed */
  growthEvents: GrowthEvent[];
  /** only present for Kyoto runs */
  exploration: ExplorationLog | null;
  params: Record<string, number>;
  /** set exactly once, when the run is finalised */
  finalized: boolean;
}

export interface BuildInput {
  result: PlayLog['result'];
  victory: boolean;
  mode: 'arena' | 'kyoto' | 'tutorial';
  exploration: ExplorationLog | null;
  initialShikigami: number;
  totalShikigamiGrown: number;
  finalShikigami: number;
  totalRecallDamage: number;
  tengjaHits: number;
  tengjaDamage: number;
  orbitContactHits: number;
  orbitContactDamage: number;
  spreadContactHits: number;
  spreadContactDamage: number;
  enemiesKilled: number;
  boss: {
    damageTaken: number;
    perfectDodges: number;
    slamHitsTaken: number;
    chargeHitsTaken: number;
    swingHitsTaken: number;
    fightDuration: number;
  };
  tutorial: TutorialLog | null;
  scattered: number;
  recovered: number;
  lost: number;
  recoverTimeSum: number;
  spreadToRecallCount: number;
  averageRecallHitsAfterSpread: number;
  gravityToRecallCount: number;
  averageRecallHitsAfterGravity: number;
  coreSetupSuccesses: number;
  spreadSetupSuccesses: number;
  fullSetupSuccesses: number;
  params: Record<string, number>;
}

function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * One logger instance per run, so every PLAY mints a fresh UUID.
 *
 * An older exporter re-serialised every stored session on each export, which is
 * why the same sessionId kept reappearing in exported files. The default export
 * is now THIS RUN ONLY (spec 41/42).
 */
export class PlayLogger {
  readonly sessionId = uid();
  readonly startEpoch = Date.now();

  recallCount = 0;
  pickupsCollected = 0;
  spreadUses = 0;
  gravityUses = 0;
  orbitPickups = 0;
  totalOrbitDuration = 0;
  recallsDuringOrbit = 0;
  hitsFromOrbitStateRecall = 0;
  damageEvents = 0;
  leftClickCount = 0;
  dashCount = 0;
  damageTaken = 0;
  gravityPulledSum = 0;
  gravityPulledSamples = 0;
  maxShikigamiAttracted = 0;
  homingRedirectCount = 0;
  bossEncountered = false;
  bossDefeated = false;
  bossFightDuration = 0;
  bossDamageTakenAtSpawn = 0;
  /** summed across cores: peak pulled, and how many of those were in WAIT */
  totalShikigamiAttracted = 0;
  shikigamiPulledFromWait = 0;

  recalls: RecallRecord[] = [];
  /** peak LIVE flock size; the milestones are read off this same number */
  maxShikigamiReached = 0;
  growthEvents: GrowthEvent[] = [];
  private milestones = new Map<number, number>();
  /** guards against the run being finalised twice (spec 4) */
  private finalized = false;

  constructor() {
    console.log('[session] NEW SESSION | ID: ' + this.sessionId);
  }

  /**
   * The run's simulation clock, supplied by the Game.
   *
   * Everything else in the log -- wave times, boss times, exploration, growth
   * milestones -- is stamped in simulation seconds. Reading wall-clock time
   * here made recall timestamps and `playDuration` disagree with all of them,
   * by minutes if the tab had ever been in the background. One clock now.
   */
  clock: (() => number) | null = null;

  now(): number {
    if (this.clock) return r2(this.clock());
    return this.wallNow();
  }

  wallNow(): number {
    return r2((Date.now() - this.startEpoch) / 1000);
  }

  /**
   * Track the flock's growth. Call whenever the count may have changed.
   *
   * The peak and the milestones are deliberately read from THE SAME number.
   * They used to come from two different ones -- the milestones from the live
   * flock, the peak from the total ever allocated -- and since a lost
   * shikigami leaves the flock without freeing its slot, the peak ran ahead of
   * anything the milestones could ever see. That is how a run could report
   * maxShikigamiReached 141 with timeTo100 still null.
   *
   * A milestone is "first time the count was >= n", so overshooting it (98 ->
   * 103) still records it, several at once share one timestamp, and a later
   * drop never clears it.
   */
  updateGrowth(count: number, elapsed: number) {
    if (count > this.maxShikigamiReached) this.maxShikigamiReached = count;
    for (const m of GROWTH_MILESTONES) {
      if (this.milestones.has(m.count) || count < m.count) continue;
      this.milestones.set(m.count, r2(elapsed));
      this.growthEvents.push({ t: r2(elapsed), type: 'reach_' + m.count, shikigami: count });
    }
  }

  addRecall(r: RecallRecord) {
    this.recalls.push(r);
  }

  build(x: BuildInput): PlayLog {
    const hits = this.recalls.map((r) => r.hits);
    return {
      sessionId: this.sessionId,
      version: VERSION,
      mode: x.mode,
      playStartTime: new Date(this.startEpoch).toISOString(),
      playDuration: this.now(),
      wallDuration: this.wallNow(),
      victory: x.victory,
      result: x.result,

      initialShikigami: x.initialShikigami,
      maxShikigamiReached: this.maxShikigamiReached,
      totalShikigamiGrown: x.totalShikigamiGrown,
      finalShikigami: x.finalShikigami,
      timeTo50: this.milestones.get(50) ?? null,
      timeTo75: this.milestones.get(75) ?? null,
      timeTo100: this.milestones.get(100) ?? null,
      timeTo125: this.milestones.get(125) ?? null,
      timeTo150: this.milestones.get(150) ?? null,
      pickupsCollected: this.pickupsCollected,

      recallCount: this.recallCount,
      avgRecallHits: hits.length ? r2(hits.reduce((a, c) => a + c, 0) / hits.length) : 0,
      maxRecallHits: hits.length ? Math.max(...hits) : 0,
      recalls50Plus: hits.filter((h) => h >= 50).length,
      recalls100Plus: hits.filter((h) => h >= 100).length,
      totalRecallDamage: r2(x.totalRecallDamage),

      spreadUses: this.spreadUses,
      spreadToRecallCount: x.spreadToRecallCount,
      recallsWithin4Seconds: x.spreadToRecallCount,
      averageRecallHitsAfterSpread: r2(x.averageRecallHitsAfterSpread),
      successfulSpreadSetups: x.spreadSetupSuccesses,
      spreadContactHits: x.spreadContactHits,
      spreadContactDamage: r2(x.spreadContactDamage),

      gravityUses: this.gravityUses,
      avgShikigamiAttracted: this.gravityPulledSamples
        ? r2(this.gravityPulledSum / this.gravityPulledSamples)
        : 0,
      maxShikigamiAttracted: this.maxShikigamiAttracted,
      totalShikigamiAttracted: this.totalShikigamiAttracted,
      shikigamiPulledFromWait: this.shikigamiPulledFromWait,
      gravityToRecallCount: x.gravityToRecallCount,
      recallsWithin5Seconds: x.gravityToRecallCount,
      averageRecallHitsAfterGravity: r2(x.averageRecallHitsAfterGravity),
      successfulGravitySetups: x.coreSetupSuccesses,

      orbitPickups: this.orbitPickups,
      totalOrbitDuration: r2(this.totalOrbitDuration),
      recallsDuringOrbit: this.recallsDuringOrbit,
      hitsFromOrbitStateRecall: this.hitsFromOrbitStateRecall,
      orbitContactHits: x.orbitContactHits,
      orbitContactDamage: r2(x.orbitContactDamage),

      damageEvents: this.damageEvents,
      totalShikigamiScattered: x.scattered,
      totalShikigamiRecovered: x.recovered,
      totalShikigamiLost: x.lost,
      averageRecoverTime: x.recovered ? r2(x.recoverTimeSum / x.recovered) : 0,
      recoveryRate: x.scattered ? r2(x.recovered / x.scattered) : 0,

      coreSetupSuccesses: x.coreSetupSuccesses,
      spreadSetupSuccesses: x.spreadSetupSuccesses,
      fullSetupSuccesses: x.fullSetupSuccesses,

      tengjaHits: x.tengjaHits,
      tengjaDamage: r2(x.tengjaDamage),
      homingRedirectCount: this.homingRedirectCount,

      enemiesKilled: x.enemiesKilled,

      bossEncountered: this.bossEncountered,
      bossDefeated: this.bossDefeated,
      bossFightDuration: this.bossFightDuration || x.boss.fightDuration,
      bossDamageTaken: r2(x.boss.damageTaken),
      bossPerfectDodges: x.boss.perfectDodges,
      bossSlamHitsTaken: x.boss.slamHitsTaken,
      bossChargeHitsTaken: x.boss.chargeHitsTaken,
      bossSwingHitsTaken: x.boss.swingHitsTaken,

      tutorial: x.tutorial,

      leftClickCount: this.leftClickCount,
      dashCount: this.dashCount,
      spreadCount: this.spreadUses,
      gravityUseCount: this.gravityUses,
      orbitActivationCount: this.orbitPickups,
      damageTaken: r2(this.damageTaken),

      recalls: this.recalls,
      growthEvents: this.growthEvents,
      exploration: x.exploration,
      params: x.params,
      finalized: this.finalized,
    };
  }

  /**
   * Close the run exactly once and push a snapshot into history.
   *
   * Victory and the end screen could both reach here, and a run that never
   * finalised left nothing in history at all -- which is why exports looked
   * stale (spec 4/5).
   */
  finalize(build: () => PlayLog): PlayLog | null {
    if (this.finalized) return null;
    this.finalized = true;
    const log = build();
    log.finalized = true;
    validateGrowth(log);
    PlayLogger.save(log);
    console.log(
      '[session] SESSION FINALIZED | ID: ' + this.sessionId +
        ' | Recall: ' + log.recallCount +
        ' | Dash: ' + log.dashCount +
        ' | Spread: ' + log.spreadCount +
        ' | Gravity: ' + log.gravityUseCount +
        ' | Orbit: ' + log.orbitActivationCount,
    );
    return log;
  }

  get isFinalized(): boolean {
    return this.finalized;
  }

  static save(log: PlayLog) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr: PlayLog[] = raw ? JSON.parse(raw) : [];
      // never let the same session land in history twice (spec 5)
      const i = arr.findIndex((l) => l.sessionId === log.sessionId);
      if (i >= 0) arr[i] = log;
      else arr.push(structuredClone(log));
      while (arr.length > MAX_STORED) arr.shift();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (err) {
      console.warn('[playlog] could not persist to localStorage', err);
    }
  }

  static loadAll(): PlayLog[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PlayLog[]) : [];
    } catch {
      return [];
    }
  }

  /** EXPORT CURRENT SESSION — this run only. */
  static downloadCurrent(log: PlayLog) {
    console.log('[session] EXPORT CURRENT SESSION | ID: ' + log.sessionId);
    download(
      { game: 'SHIKIGAMI FLOW', version: VERSION, exportedAt: new Date().toISOString(), session: log },
      'shikigami-v5-' + log.sessionId.slice(0, 8),
    );
  }

  /** Opt-in: everything kept in this browser. */
  static downloadAll() {
    const sessions = PlayLogger.loadAll();
    download(
      { game: 'SHIKIGAMI FLOW', version: VERSION, exportedAt: new Date().toISOString(), sessions },
      'shikigami-v5-all-' + sessions.length,
    );
  }
}

function download(payload: unknown, name: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Spec 13/14. The invariant is that reaching a count implies a timestamp for
 * it, so if that ever breaks again it should be loud in the console rather
 * than quietly shipping a log with holes in it.
 */
function validateGrowth(log: PlayLog) {
  for (const m of GROWTH_MILESTONES) {
    const t = log[m.key];
    if (log.maxShikigamiReached >= m.count && t == null) {
      console.error(
        '[playlog] missing growth milestone: ' + m.key +
          ' (maxShikigamiReached ' + log.maxShikigamiReached + ')',
      );
    } else if (t != null && log.maxShikigamiReached < m.count) {
      console.warn(
        '[playlog] ' + m.key + ' is set but the peak flock was only ' + log.maxShikigamiReached,
      );
    }
  }
}

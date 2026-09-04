/**
 * Owns the lifecycle of a single recall and the numbers we care about most:
 * how many shikigami went through the SAME enemy in one pull (spec 27).
 */
export interface RecallRecord {
  timestamp: number;
  shikigamiCount: number;
  playerPos: [number, number];
  swarmCenter: [number, number];
  nearestEnemyPos: [number, number] | null;
  hits: number;
  damage: number;
  /** distinct shikigami that passed through one single enemy */
  maxPenetration: number;
  killedEnemies: number;
  /** did any shikigami in this recall strike a bound enemy? */
  hitBound: boolean;
  /** how many hits landed on bound enemies */
  boundHits: number;
}

export class RecallSystem {
  active = false;
  private startedAt = 0;
  private record: RecallRecord | null = null;
  /** enemyId -> set of agent indices that passed through it this recall */
  private perEnemy = new Map<number, Set<number>>();

  begin(
    timestamp: number,
    shikigamiCount: number,
    playerPos: [number, number],
    swarmCenter: [number, number],
    nearestEnemyPos: [number, number] | null,
  ) {
    this.active = true;
    this.startedAt = timestamp;
    this.perEnemy.clear();
    this.record = {
      timestamp,
      shikigamiCount,
      playerPos,
      swarmCenter,
      nearestEnemyPos,
      hits: 0,
      damage: 0,
      maxPenetration: 0,
      killedEnemies: 0,
      hitBound: false,
      boundHits: 0,
    };
  }

  markBoundHit() {
    if (!this.record) return;
    this.record.hitBound = true;
    this.record.boundHits++;
  }

  reportHit(enemyId: number, agentIndex: number, damage: number) {
    if (!this.record) return;
    this.record.hits++;
    this.record.damage += damage;
    let set = this.perEnemy.get(enemyId);
    if (!set) {
      set = new Set();
      this.perEnemy.set(enemyId, set);
    }
    set.add(agentIndex);
    if (set.size > this.record.maxPenetration) this.record.maxPenetration = set.size;
  }

  reportKill() {
    if (this.record) this.record.killedEnemies++;
  }

  /** total pass-throughs so far this recall (drives the B2 skill tiers) */
  get currentHits(): number {
    return this.record?.hits ?? 0;
  }

  /** Largest simultaneous pierce through one enemy while the recall is running. */
  get currentMaxPenetration(): number {
    return this.record?.maxPenetration ?? 0;
  }

  get elapsed(): number {
    return this.startedAt;
  }

  end(): RecallRecord | null {
    this.active = false;
    const r = this.record;
    this.record = null;
    this.perEnemy.clear();
    return r;
  }
}

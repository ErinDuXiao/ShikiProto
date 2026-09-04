import * as THREE from 'three';
import type { EncounterShape, LocationDef } from './locations';

export interface EncounterSpawn {
  x: number;
  z: number;
  elite?: boolean;
}

/**
 * One location's fight (spec 10/38).
 *
 * The point of this class is that the enemies are the SAME everywhere -- what
 * changes is where they come from, and the shape of the ground they come onto.
 * A yokai on the bridge and a yokai in the graveyard pose different Recall
 * Geometry problems without either being a new enemy type.
 */
export class Encounter {
  private released = 0;
  private timer = 0.9;
  private beat = 0;
  private lull = 0;
  private bossSpawned = false;
  finished = false;
  elapsed = 0;

  onSpawn?: (s: EncounterSpawn) => void;
  onBoss?: () => void;
  /** fired once, when the last enemy of the encounter goes down */
  onCleared?: () => void;

  constructor(private def: LocationDef) {}

  /** Hold off releasing anything for a moment (used by the 100th shikigami). */
  pause(seconds: number) {
    this.lull = Math.max(this.lull, seconds);
  }

  get remaining(): number {
    return this.def.budget - this.released;
  }

  update(dt: number, aliveCount: number, playerPos: THREE.Vector3) {
    if (this.finished) return;
    this.elapsed += dt;

    if (this.released >= this.def.budget) {
      // the boss only arrives once its escort is gone
      if (this.def.boss && !this.bossSpawned && aliveCount <= 2) {
        this.bossSpawned = true;
        this.onBoss?.();
        return;
      }
      const bossPending = this.def.boss === true && !this.bossSpawned;
      if (!bossPending && aliveCount <= 0) {
        this.finished = true;
        this.onCleared?.();
      }
      return;
    }

    // one short lull partway through, so even a single encounter has a breath
    // in it rather than being an unbroken 80 seconds (spec 24)
    if (this.lull > 0) {
      this.lull -= dt;
      return;
    }
    if (
      this.beat > 0 &&
      this.released > this.def.budget * 0.55 &&
      this.released < this.def.budget * 0.62 &&
      aliveCount <= 2
    ) {
      this.lull = 2.6;
      this.released = Math.ceil(this.def.budget * 0.62);
      return;
    }

    this.timer -= dt;
    if (this.timer > 0 || aliveCount >= this.def.concurrent) return;

    // pace the release so the encounter lands near its intended length
    this.timer = Math.max(1.1, (this.def.duration * 0.62) / this.def.budget) * 2.4;
    const pack = this.packFor(this.beat);
    this.beat++;
    for (const s of this.spawnsFor(this.def.shape, pack, playerPos)) {
      if (this.released >= this.def.budget) break;
      this.released++;
      this.onSpawn?.(s);
    }
  }

  private packFor(beat: number): number {
    const left = this.remaining;
    return Math.max(2, Math.min(left, 3 + (beat % 3) * 2));
  }

  // ------------------------------------------------------------------ shapes

  private spawnsFor(
    shape: EncounterShape,
    n: number,
    playerPos: THREE.Vector3,
  ): EncounterSpawn[] {
    switch (shape) {
      case 'line':
        return this.alongAxis(n, playerPos);
      case 'encircle':
        return this.bothEnds(n, playerPos);
      case 'converge':
        return this.allAround(n);
      case 'scatter':
        return this.acrossGround(n);
      case 'combination':
        return this.mixed(n, playerPos);
    }
  }

  /**
   * BRIDGE. Everything arrives at the far end and walks the deck towards you,
   * so the enemies stack into a queue. One recall down the length of the bridge
   * takes the whole queue -- which is the lesson (spec 11).
   */
  private alongAxis(n: number, playerPos: THREE.Vector3): EncounterSpawn[] {
    const g = this.def.ground;
    // the end further from the player
    const dA = Math.hypot(g.ax - playerPos.x, g.az - playerPos.z);
    const dB = Math.hypot(g.bx - playerPos.x, g.bz - playerPos.z);
    const [ex, ez] = dA > dB ? [g.ax, g.az] : [g.bx, g.bz];
    const [ox, oz] = dA > dB ? [g.bx, g.bz] : [g.ax, g.az];
    const ux = (ox - ex) / (Math.hypot(ox - ex, oz - ez) || 1);
    const uz = (oz - ez) / (Math.hypot(ox - ex, oz - ez) || 1);
    const out: EncounterSpawn[] = [];
    for (let i = 0; i < n; i++) {
      const along = i * 3.4;
      out.push({
        x: ex + ux * along + -uz * (Math.random() - 0.5) * g.radius * 0.9,
        z: ez + uz * along + ux * (Math.random() - 0.5) * g.radius * 0.9,
      });
    }
    // every third beat, one comes up behind you: the reason to keep dashing
    if (this.beat % 3 === 2) {
      out.push({ x: ox - ux * 4, z: oz - uz * 4, elite: this.beat > 4 });
    }
    return out;
  }

  /**
   * ALLEY. Both ends at once, in a slot too narrow to walk around them. The
   * answer is a dash into the side passage, then a gravity core down the slot
   * (spec 12).
   */
  private bothEnds(n: number, playerPos: THREE.Vector3): EncounterSpawn[] {
    const g = this.def.ground;
    const out: EncounterSpawn[] = [];
    const ends: Array<[number, number]> = [
      [g.ax, g.az],
      [g.bx, g.bz],
    ];
    for (let i = 0; i < n; i++) {
      const [ex, ez] = ends[i % 2];
      const back = Math.floor(i / 2) * 3.2;
      const ux = (playerPos.x - ex) / (Math.hypot(playerPos.x - ex, playerPos.z - ez) || 1);
      const uz = (playerPos.z - ez) / (Math.hypot(playerPos.x - ex, playerPos.z - ez) || 1);
      out.push({
        x: ex - ux * back + (Math.random() - 0.5) * g.radius,
        z: ez - uz * back + (Math.random() - 0.5) * g.radius,
      });
    }
    return out;
  }

  /** SHRINE. Open yard, pressure from every compass point — what Orbit answers. */
  private allAround(n: number): EncounterSpawn[] {
    const g = this.def.ground;
    const out: EncounterSpawn[] = [];
    const off = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const r = g.radius * (0.92 + Math.random() * 0.16);
      out.push({ x: g.ax + Math.cos(a) * r, z: g.az + Math.sin(a) * r });
    }
    return out;
  }

  /**
   * GRAVEYARD. Spread wide and deep, so there is no angle that lines them all
   * up and the gravestones eat any straight pull. The core has to go round
   * (spec 14).
   */
  private acrossGround(n: number): EncounterSpawn[] {
    const g = this.def.ground;
    const out: EncounterSpawn[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = g.radius * (0.4 + Math.random() * 0.62);
      out.push({ x: g.ax + Math.cos(a) * r, z: g.az + Math.sin(a) * r });
    }
    return out;
  }

  /** MANSION. Cycles the other three, then hands over to the boss (spec 16). */
  private mixed(n: number, playerPos: THREE.Vector3): EncounterSpawn[] {
    const pick: EncounterShape[] = ['converge', 'line', 'encircle', 'scatter'];
    const s = pick[this.beat % pick.length];
    const out = this.spawnsFor(s, n, playerPos);
    if (this.beat % 4 === 3) out[0] && (out[0].elite = true);
    return out;
  }
}

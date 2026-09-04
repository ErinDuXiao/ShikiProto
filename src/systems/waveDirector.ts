import * as THREE from 'three';
import { ARENA_RADIUS } from '../core/params';
import { v5 } from '../core/v5Params';
import { TIMELINE, type WaveEvent } from '../core/runConfig';
import { Yokai, type EnemyBase } from '../entities/enemy';

export interface SpawnRequest {
  x: number;
  z: number;
  /** tougher, slower variant */
  elite?: boolean;
}

/**
 * Combat rhythm (spec 44-47).
 *
 * The previous build just raised the enemy count and the stretch before the
 * mid-boss dragged. This runs a script instead: something changes every 45-60
 * seconds, and each beat poses a different Recall Geometry problem through the
 * *formation* the enemies arrive in rather than through new enemy types.
 */
export class WaveDirector {
  private next = 0;
  private trickle = 3;
  /**
   * Enemy pressure is deliberately switched off for a couple of seconds after a
   * scripted beat is cleared (spec 18-22). Constant pressure was reported as
   * tiring, and the swarm is worth looking at -- 2-4s of nothing is a rest, not
   * missing content.
   */
  private rest = 0;
  private awaitingClear = false;
  private sinceRest = 0;
  restingNow = false;
  onRest?: (seconds: number) => void;

  /** Force a pause, e.g. right after the hundredth shikigami arrives. */
  breathe(seconds: number) {
    this.rest = Math.max(this.rest, seconds);
    this.awaitingClear = false;
    this.sinceRest = 0;
    this.onRest?.(seconds);
  }

  onEvent?: (e: WaveEvent) => void;
  onSpawn?: (r: SpawnRequest) => void;
  onMidBoss?: () => void;
  onBoss?: () => void;

  /** Only used for the moving-column beat. */
  private column: { x: number; z: number; dx: number; dz: number; left: number } | null = null;

  update(dt: number, time: number, aliveCount: number, playerPos: THREE.Vector3) {
    while (this.next < TIMELINE.length && time >= TIMELINE[this.next].t) {
      this.fire(TIMELINE[this.next], playerPos);
      this.next++;
      this.awaitingClear = true;
    }

    // Clearing a scripted beat earns a breather. The threshold is "almost
    // clear" rather than zero: the background trickle keeps topping the field
    // up, so waiting for a true zero meant the pause almost never happened.
    if (this.awaitingClear && aliveCount <= 1) {
      this.awaitingClear = false;
      this.breathe(2.5 + Math.random() * 1.5);
    }

    // and a guaranteed pulse, so a slow player still gets the rhythm
    this.sinceRest += dt;
    if (this.sinceRest > 38) this.breathe(2.5);

    if (this.rest > 0) {
      this.rest -= dt;
      this.restingNow = this.rest > 0;
      if (this.restingNow) return;
    }
    this.restingNow = false;

    // a light background trickle so the field is never empty between beats
    this.trickle -= dt * v5.growthSpeed;
    const cap = Math.min(14, 3 + Math.floor(time / 60) * 2);
    if (this.trickle <= 0 && aliveCount < cap) {
      this.trickle = 2.4;
      this.ring(1, 24, playerPos);
    }

    if (this.column) {
      this.column.left -= dt;
      if (this.column.left <= 0) {
        this.column = null;
      } else if (Math.random() < dt * 4) {
        this.onSpawn?.({ x: this.column.x, z: this.column.z });
        this.column.x += this.column.dx;
        this.column.z += this.column.dz;
      }
    }
  }

  private fire(e: WaveEvent, playerPos: THREE.Vector3) {
    switch (e.kind) {
      case 'intro':
        this.ring(3, 22, playerPos);
        break;
      case 'rift':
        // one tear, a lot of enemies out of a single point: a fat recall line
        this.cluster(11, playerPos);
        break;
      case 'elite':
        this.elite(playerPos);
        break;
      case 'fourWay':
        // pressure from every side, which is what Spread answers
        this.fourDirections(6, playerPos);
        break;
      case 'cluster':
        this.cluster(9, playerPos);
        this.line(6, playerPos);
        break;
      case 'midboss':
        this.onMidBoss?.();
        this.ring(4, 20, playerPos);
        break;
      case 'boss':
        this.onBoss?.();
        this.cluster(8, playerPos);
        break;
    }
    if (e.label) this.onEvent?.(e);
  }

  private at(a: number, r: number): SpawnRequest {
    const rr = Math.min(ARENA_RADIUS - 4, r);
    return { x: Math.cos(a) * rr, z: Math.sin(a) * rr };
  }

  private ring(n: number, r: number, _p: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      this.onSpawn?.(this.at(Math.random() * Math.PI * 2, r + Math.random() * 6));
    }
  }

  /** One dense knot — the ideal single-recall target. */
  private cluster(n: number, playerPos: THREE.Vector3) {
    const a = Math.atan2(-playerPos.z, -playerPos.x) + (Math.random() - 0.5) * 1.2;
    const r = 22 + Math.random() * 8;
    const cx = Math.cos(a) * Math.min(ARENA_RADIUS - 8, r);
    const cz = Math.sin(a) * Math.min(ARENA_RADIUS - 8, r);
    for (let i = 0; i < n; i++) {
      const t = Math.random() * Math.PI * 2;
      const d = Math.random() * 4.5;
      this.onSpawn?.({ x: cx + Math.cos(t) * d, z: cz + Math.sin(t) * d });
    }
  }

  /** A wall — pierce it lengthwise or not at all. */
  private line(n: number, playerPos: THREE.Vector3) {
    const a = Math.random() * Math.PI * 2;
    const cx = Math.cos(a) * 20;
    const cz = Math.sin(a) * 20;
    const px = -Math.sin(a);
    const pz = Math.cos(a);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * 18;
      this.onSpawn?.({ x: cx + px * t, z: cz + pz * t });
    }
    void playerPos;
  }

  private fourDirections(perSide: number, _p: THREE.Vector3) {
    for (let q = 0; q < 4; q++) {
      const base = (q / 4) * Math.PI * 2;
      for (let i = 0; i < perSide; i++) {
        this.onSpawn?.(this.at(base + (Math.random() - 0.5) * 0.6, 24 + Math.random() * 5));
      }
    }
  }

  /**
   * The reward for reaching 100 (spec 24-29): a long corridor plus two heavy
   * knots, arranged so one big recall line sweeps the lot. Power fantasy, not
   * a difficulty spike.
   */
  hundredEvent(playerPos: THREE.Vector3) {
    const a = Math.atan2(-playerPos.z, -playerPos.x);
    const cx = Math.cos(a) * 16;
    const cz = Math.sin(a) * 16;
    const px = -Math.sin(a);
    const pz = Math.cos(a);
    // a long column straight through the middle
    for (let i = 0; i < 16; i++) {
      const t = (i / 15 - 0.5) * 26;
      this.onSpawn?.({ x: cx + px * t * 0.25 + Math.cos(a) * t * 0.9, z: cz + pz * t * 0.25 + Math.sin(a) * t * 0.9 });
    }
    // and a dense knot on each flank
    for (const side of [-1, 1]) {
      const bx = cx + px * side * 13;
      const bz = cz + pz * side * 13;
      for (let i = 0; i < 9; i++) {
        const t = Math.random() * Math.PI * 2;
        const d = Math.random() * 4;
        this.onSpawn?.({ x: bx + Math.cos(t) * d, z: bz + Math.sin(t) * d });
      }
    }
  }

  private elite(playerPos: THREE.Vector3) {
    const a = Math.atan2(-playerPos.z, -playerPos.x);
    this.onSpawn?.({ x: Math.cos(a) * 20, z: Math.sin(a) * 20, elite: true });
    this.ring(4, 22, playerPos);
  }

  /** Elites are just a bigger, tougher, slower yokai — no new AI (spec 47). */
  static makeElite(e: Yokai): EnemyBase {
    e.maxHp = e.hp = 190;
    e.radius = 1.9;
    e.hitHeight = 2.4;
    e.mass = 4;
    e.maxKnock = 7;
    e.group.scale.setScalar(1.75);
    e.speed = 4.4;
    return e;
  }
}

import * as THREE from 'three';
import { InkSurface } from './inkSurface';
import { ARENA_RADIUS, field } from '../core/params';
import { v5 } from '../core/v5Params';
import { SState, type ShikigamiManager } from '../entities/shikigami';

const CELL = 2.4;
const GRID = Math.ceil((ARENA_RADIUS * 2 + 8) / CELL);
const WINDOW = 0.14;
/** only fast movement counts as a sweep */
const MIN_SPEED = 22;

/**
 * The one part of the old sumi experiment worth keeping (spec 33).
 *
 *   Shikigami = individual creatures.  Ink = the afterimage of the swarm.
 *
 * Nothing is ever converted into a brush stroke. Ink appears only where a lot
 * of shikigami swept the same small patch of ground at once, and it is gone
 * again within about a second.
 */
export class InkAccent {
  private surface: InkSurface;
  private count = new Int16Array(GRID * GRID);
  private dirX = new Float32Array(GRID * GRID);
  private dirZ = new Float32Array(GRID * GRID);
  private timer = 0;
  private touched: number[] = [];

  constructor(scene: THREE.Scene) {
    this.surface = new InkSurface(scene);
    this.surface.setVisible(true);
  }

  /** Follow the play field, so ink still lands when Kyoto moves the ground. */
  recenter(x: number, z: number) {
    this.surface.recenter(x, z);
    this.count.fill(0);
    this.touched.length = 0;
  }

  private cellOf(x: number, z: number): number {
    const cx = Math.floor((x - field.cx + ARENA_RADIUS + 4) / CELL);
    const cz = Math.floor((z - field.cz + ARENA_RADIUS + 4) / CELL);
    if (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID) return -1;
    return cz * GRID + cx;
  }

  update(dt: number, swarm: ShikigamiManager) {
    // the surface owns its own drying fade
    this.surface.fadeWith(dt, v5.inkLifetime);

    for (let i = 0; i < swarm.count; i++) {
      if (!swarm.alive[i]) continue;
      const st = swarm.state[i];
      if (st !== SState.RECALL && st !== SState.LAUNCH) continue;
      const vx = swarm.vx[i];
      const vz = swarm.vz[i];
      const sp = Math.hypot(vx, vz);
      if (sp < MIN_SPEED) continue;
      const c = this.cellOf(swarm.px[i], swarm.pz[i]);
      if (c < 0) continue;
      if (this.count[c] === 0) this.touched.push(c);
      this.count[c]++;
      this.dirX[c] += vx / sp;
      this.dirZ[c] += vz / sp;
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = WINDOW;

    const threshold = Math.max(2, Math.round(v5.inkThreshold));
    for (const c of this.touched) {
      const n = this.count[c];
      this.count[c] = 0;
      const dx = this.dirX[c];
      const dz = this.dirZ[c];
      this.dirX[c] = 0;
      this.dirZ[c] = 0;
      if (n < threshold) continue;

      const l = Math.hypot(dx, dz) || 1;
      const ux = dx / l;
      const uz = dz / l;
      const cx = (c % GRID) * CELL - ARENA_RADIUS - 4 + CELL * 0.5 + field.cx;
      const cz = Math.floor(c / GRID) * CELL - ARENA_RADIUS - 4 + CELL * 0.5 + field.cz;
      // width grows with how much of the flock went through, but stays a
      // residue -- it must never look like a stroke drawn on purpose
      const w = 0.5 + Math.min(2.2, (n / threshold) * 0.9);
      const half = CELL * 0.75;
      this.surface.segment(
        cx - ux * half,
        cz - uz * half,
        cx + ux * half,
        cz + uz * half,
        w,
        w * 0.8,
        {
          color: '#f3f0e6',
          alpha: Math.min(0.35, v5.inkOpacity * (0.6 + n / (threshold * 2.5))),
          // low kasure: at this scale the dry lanes read as hard stripes, not
          // as a brush that ran dry
          kasure: 0.2,
          bristles: 2,
          spread: 1.1,
          wobble: 0.12,
          phase: c,
        },
      );
    }
    this.touched.length = 0;
    this.surface.commit();
  }

  /** A single longer smear behind a massive recall (spec 35). */
  slash(x: number, z: number, dirX: number, dirZ: number, strength: number) {
    const len = 3.5 + strength * 3;
    this.surface.segment(x - dirX * len, z - dirZ * len, x + dirX * len * 0.35, z + dirZ * len * 0.35, 1.6 + strength * 1.4, 0.6, {
      color: '#f3f0e6',
      alpha: Math.min(0.4, v5.inkOpacity * 2.2),
      kasure: 0.35,
      bristles: 5,
      spread: 1.3,
      wobble: 0.18,
      phase: (x * 7 + z * 13) | 0,
    });
    this.surface.commit();
  }

  setEnabled(on: boolean) {
    this.surface.setVisible(on);
    if (!on) this.surface.clear();
  }

  dispose(scene: THREE.Scene) {
    this.surface.dispose(scene);
  }
}

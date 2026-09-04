import { params } from '../core/params';

/**
 * Neighbour steering (separation / cohesion / alignment).
 *
 * 100-150 agents means the naive O(n^2) sweep is ~5-11k pair tests per frame,
 * which is nothing. A spatial hash would only add bugs at this scale, so the
 * simple version stays until profiling says otherwise (spec 38).
 */
export class BoidSystem {
  readonly sepX: Float32Array;
  readonly sepZ: Float32Array;
  readonly cohX: Float32Array;
  readonly cohZ: Float32Array;
  readonly aliX: Float32Array;
  readonly aliZ: Float32Array;

  /** squared radii */
  private static readonly SEP_R = 0.62;
  private static readonly NEI_R = 2.6;

  constructor(n: number) {
    this.sepX = new Float32Array(n);
    this.sepZ = new Float32Array(n);
    this.cohX = new Float32Array(n);
    this.cohZ = new Float32Array(n);
    this.aliX = new Float32Array(n);
    this.aliZ = new Float32Array(n);
  }

  /**
   * Fills the force arrays for every agent flagged in `participates`.
   * Forces are expressed as velocity contributions (units/s).
   */
  compute(
    n: number,
    px: Float32Array,
    pz: Float32Array,
    vx: Float32Array,
    vz: Float32Array,
    participates: Uint8Array,
  ) {
    const sepR = BoidSystem.SEP_R;
    const sepR2 = sepR * sepR;
    const neiR2 = BoidSystem.NEI_R * BoidSystem.NEI_R;

    this.sepX.fill(0);
    this.sepZ.fill(0);
    this.cohX.fill(0);
    this.cohZ.fill(0);
    this.aliX.fill(0);
    this.aliZ.fill(0);

    const cx = this.cohX;
    const cz = this.cohZ;
    const ax = this.aliX;
    const az = this.aliZ;
    const count = new Uint16Array(n);

    for (let i = 0; i < n; i++) {
      if (!participates[i]) continue;
      const xi = px[i];
      const zi = pz[i];
      for (let j = i + 1; j < n; j++) {
        if (!participates[j]) continue;
        const dx = xi - px[j];
        const dz = zi - pz[j];
        const d2 = dx * dx + dz * dz;
        if (d2 > neiR2 || d2 < 1e-8) continue;

        if (d2 < sepR2) {
          const d = Math.sqrt(d2);
          // linear falloff: strongest when overlapping
          const w = (1 - d / sepR) / d;
          const fx = dx * w;
          const fz = dz * w;
          this.sepX[i] += fx;
          this.sepZ[i] += fz;
          this.sepX[j] -= fx;
          this.sepZ[j] -= fz;
        }

        cx[i] += px[j];
        cz[i] += pz[j];
        cx[j] += xi;
        cz[j] += zi;
        ax[i] += vx[j];
        az[i] += vz[j];
        ax[j] += vx[i];
        az[j] += vz[i];
        count[i]++;
        count[j]++;
      }
    }

    // turn accumulators into steering velocities
    const kSep = params.separation;
    const kCoh = params.cohesion;
    const kAli = params.alignment;
    for (let i = 0; i < n; i++) {
      if (!participates[i]) continue;
      this.sepX[i] *= kSep;
      this.sepZ[i] *= kSep;
      const c = count[i];
      if (c > 0) {
        const inv = 1 / c;
        this.cohX[i] = (cx[i] * inv - px[i]) * kCoh;
        this.cohZ[i] = (cz[i] * inv - pz[i]) * kCoh;
        this.aliX[i] = (ax[i] * inv - vx[i]) * kAli;
        this.aliZ[i] = (az[i] * inv - vz[i]) * kAli;
      } else {
        this.cohX[i] = this.cohZ[i] = this.aliX[i] = this.aliZ[i] = 0;
      }
    }
  }
}

/**
 * 術式 — "composing a formula" (spec 37-40).
 *
 * The mastery this prototype is testing is not damage, it is *preparation that
 * connected*. A recall that lands big because several deliberate actions were
 * chained into it is recognised as a different thing from a recall that
 * happened to hit a crowd.
 */
export type FormulaKind = 'CORE' | 'SPREAD' | 'FULL';

export interface FormulaResult {
  kind: FormulaKind;
  hits: number;
}

const CORE_WINDOW = 5;
const SPREAD_WINDOW = 4;
const FULL_WINDOW = 6;

const CORE_HITS = 50;
const SPREAD_HITS = 40;
const FULL_HITS = 70;

export class FormulaTracker {
  lastGravity = -999;
  lastSpread = -999;

  coreSuccesses = 0;
  spreadSuccesses = 0;
  fullSuccesses = 0;

  /** how many recalls followed each set-up at all, successful or not */
  gravityToRecall = 0;
  spreadToRecall = 0;
  hitsAfterGravity = 0;
  hitsAfterSpread = 0;

  noteGravity(t: number) {
    this.lastGravity = t;
  }

  noteSpread(t: number) {
    this.lastSpread = t;
  }

  /**
   * Called when a recall resolves. Returns the strongest formula it satisfied,
   * or null. FULL outranks the single-skill set-ups.
   */
  evaluate(t: number, hits: number): FormulaResult | null {
    const sinceCore = t - this.lastGravity;
    const sinceSpread = t - this.lastSpread;
    const coreFresh = sinceCore <= CORE_WINDOW;
    const spreadFresh = sinceSpread <= SPREAD_WINDOW;

    if (coreFresh) {
      this.gravityToRecall++;
      this.hitsAfterGravity += hits;
    }
    if (spreadFresh) {
      this.spreadToRecall++;
      this.hitsAfterSpread += hits;
    }

    if (sinceCore <= FULL_WINDOW && sinceSpread <= FULL_WINDOW && hits >= FULL_HITS) {
      this.fullSuccesses++;
      return { kind: 'FULL', hits };
    }
    if (coreFresh && hits >= CORE_HITS) {
      this.coreSuccesses++;
      return { kind: 'CORE', hits };
    }
    if (spreadFresh && hits >= SPREAD_HITS) {
      this.spreadSuccesses++;
      return { kind: 'SPREAD', hits };
    }
    return null;
  }

  get averageHitsAfterGravity(): number {
    return this.gravityToRecall ? this.hitsAfterGravity / this.gravityToRecall : 0;
  }

  get averageHitsAfterSpread(): number {
    return this.spreadToRecall ? this.hitsAfterSpread / this.spreadToRecall : 0;
  }
}

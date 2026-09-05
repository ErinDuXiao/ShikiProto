import * as THREE from 'three';
import type { TutorialLog, TutorialStep } from '../log/playLogger';

export type StepId =
  | 'move'
  | 'release'
  | 'between'
  | 'recall'
  | 'dash'
  | 'gravity'
  | 'spread'
  | 'final';

export interface StepView {
  /** the one line of instruction, large and centred */
  title: string;
  /** the single control being taught, bottom of screen */
  key: string;
  action: string;
}

/**
 * The interactive tutorial (spec 16-24).
 *
 * The thing being taught is NOT a list of controls. It is one idea that the
 * genre trains players out of: left click is not attack. The flock has to be
 * on the FAR side of something before the pull is worth anything, so the
 * player must physically do
 *
 *     release -> walk past the enemy -> recall
 *
 * at least once before the tutorial will let them go (spec 24/43). Everything
 * else here is arranged around getting them to that one moment.
 */
export class Tutorial {
  step: StepId = 'move';
  done = false;
  skipped = false;
  /** seconds since the tutorial opened */
  elapsed = 0;

  // --- analytics (spec 41/42)
  private startedAt = 0;
  private stepStart = 0;
  private attempts = 0;
  private steps: TutorialStep[] = [];
  recallSuccessCount = 0;
  timeToUnderstandRelease: number | null = null;
  timeToFirstSuccessfulRecall: number | null = null;
  timeToFirstRecallKill: number | null = null;
  timeToFirstDash: number | null = null;
  timeToFirstGravitySetup: number | null = null;

  /** where the player started this step, for the MOVE check */
  private anchor = new THREE.Vector3();
  private holdTimer = 0;
  private opened = false;
  /** baselines captured on entry, so a step cannot be satisfied by something
   *  the player already did during an earlier one */
  private killsAtStepStart = 0;
  private dashAtStepStart = 0;
  private dashCount = 0;
  /** set when the step's own ability is actually used */
  private abilityUsed = false;

  onStepChange?: (step: StepId, view: StepView) => void;
  onComplete?: () => void;
  /** the tutorial asks the game to build the situation each step needs */
  onSetup?: (step: StepId) => void;

  begin(playerPos: THREE.Vector3) {
    this.startedAt = 0;
    this.elapsed = 0;
    this.anchor.copy(playerPos);
    this.enter('move');
  }

  private enter(step: StepId) {
    // close the outgoing step first. Guarding this on `steps.length` meant the
    // very first step was never recorded at all.
    if (this.opened) this.closeStep();
    this.step = step;
    this.opened = true;
    this.stepStart = this.elapsed;
    this.attempts = 0;
    this.holdTimer = 0;
    this.killsAtStepStart = this.recallSuccessCount;
    this.dashAtStepStart = this.dashCount;
    this.abilityUsed = false;
    this.onSetup?.(step);
    this.onStepChange?.(step, VIEWS[step]);
  }

  private closeStep() {
    this.steps.push({
      step: this.step,
      startTime: r2(this.stepStart),
      completeTime: r2(this.elapsed),
      attempts: this.attempts,
    });
  }

  /** the player tried the thing this step is asking for */
  noteAttempt() {
    this.attempts++;
  }

  advance() {
    const order: StepId[] = [
      'move',
      'release',
      'between',
      'recall',
      'dash',
      'gravity',
      'spread',
      'final',
    ];
    const i = order.indexOf(this.step);
    if (i < 0 || i + 1 >= order.length) {
      this.finish();
      return;
    }
    this.enter(order[i + 1]);
  }

  finish() {
    if (this.done) return;
    if (this.opened) this.closeStep();
    this.opened = false;
    this.done = true;
    // A skip is not a completion. finish() used to fire onComplete either way,
    // so leaving early played the whole send-off -- bell, line and all -- for a
    // lesson the player had just declined to take.
    if (!this.skipped) this.onComplete?.();
  }

  skip() {
    this.skipped = true;
    this.finish();
  }

  // ----------------------------------------------------------------- events

  noteRelease(looseCount: number) {
    if (this.step !== 'release') return;
    if (looseCount >= 8) {
      if (this.timeToUnderstandRelease === null) this.timeToUnderstandRelease = r2(this.elapsed);
      this.advance();
    }
  }

  noteRecall(hits: number, killed: number) {
    if (this.timeToFirstSuccessfulRecall === null) this.timeToFirstSuccessfulRecall = r2(this.elapsed);
    if (killed > 0) {
      this.recallSuccessCount++;
      if (this.timeToFirstRecallKill === null) this.timeToFirstRecallKill = r2(this.elapsed);
    }
    void hits;
  }

  noteDash() {
    if (this.timeToFirstDash === null) this.timeToFirstDash = r2(this.elapsed);
  }

  noteGravity() {
    if (this.step === 'gravity') this.abilityUsed = true;
    if (this.timeToFirstGravitySetup === null) this.timeToFirstGravitySetup = r2(this.elapsed);
  }

  noteSpread() {
    if (this.step === 'spread') this.abilityUsed = true;
  }

  // ----------------------------------------------------------------- update

  /**
   * @param aliveEnemies enemies still standing in the current set-up
   * @param behind true when the player has an enemy between them and the flock
   */
  update(
    dt: number,
    playerPos: THREE.Vector3,
    aliveEnemies: number,
    behind: boolean,
    dashCount: number,
  ) {
    if (this.done) return;
    this.elapsed += dt;
    this.dashCount = dashCount;

    switch (this.step) {
      case 'move':
        if (playerPos.distanceTo(this.anchor) > 9) this.advance();
        break;

      case 'between':
        // hold the position for a beat so it registers as a decision rather
        // than something they walked through by accident
        this.holdTimer = behind ? this.holdTimer + dt : 0;
        if (this.holdTimer > 0.45) this.advance();
        break;

      case 'recall':
        // The one lesson the tutorial exists for: it is not over until a
        // recall has actually killed something. Advancing on "no enemies
        // left" let the step complete instantly, because the previous step's
        // dummy had already been cleared away (spec 24/43).
        if (this.recallSuccessCount > this.killsAtStepStart) this.advance();
        break;

      case 'gravity':
      case 'spread':
        // Clearing the enemies is not enough -- these two steps exist to teach
        // that Q and SPACE are placement tools, and a player who just recalled
        // repeatedly would have passed without ever pressing either (measured:
        // the gravity step completed with timeToFirstGravitySetup still null).
        if (this.abilityUsed && aliveEnemies <= 0) this.advance();
        break;

      case 'final':
        if (aliveEnemies <= 0) this.advance();
        break;

      case 'dash':
        // measured from entry: dashCount is cumulative for the whole run, so
        // a dash used back in the release step used to satisfy this instantly
        if (this.dashCount > this.dashAtStepStart) this.advance();
        break;

      case 'release':
        break;
    }
  }

  log(): TutorialLog {
    return {
      started: true,
      completed: this.done && !this.skipped,
      skipped: this.skipped,
      duration: r2(this.elapsed),
      steps: this.steps.slice(),
      recallSuccessCount: this.recallSuccessCount,
      timeToUnderstandRelease: this.timeToUnderstandRelease,
      timeToFirstSuccessfulRecall: this.timeToFirstSuccessfulRecall,
      timeToFirstRecallKill: this.timeToFirstRecallKill,
      timeToFirstDash: this.timeToFirstDash,
      timeToFirstGravitySetup: this.timeToFirstGravitySetup,
    };
  }
}

/**
 * One line each. Spec 17 bans walls of text and bans showing the whole keyboard
 * up front -- only the control currently being taught is named.
 */
export const VIEWS: Record<StepId, StepView> = {
  move: { title: 'Move', key: 'WASD', action: 'MOVE' },
  release: { title: 'Send your shikigami away', key: 'LEFT CLICK', action: 'RELEASE' },
  between: { title: 'Now put the enemy between you and them', key: 'WASD', action: 'MOVE' },
  recall: { title: 'Call them back', key: 'RIGHT CLICK', action: 'RECALL' },
  dash: { title: 'Dodge', key: 'SHIFT', action: 'DASH' },
  gravity: { title: 'Gather them somewhere else, then pull', key: 'Q', action: 'GRAVITY CORE' },
  spread: { title: 'Open space, then pull', key: 'SPACE', action: 'SPREAD' },
  final: { title: 'Use what you have learned', key: '', action: '' },
};

/**
 * When the tutorial itself last changed.
 *
 * A player is sent through it again whenever they have not seen it since this
 * date, so revising a lesson actually reaches the people who already played.
 * Bump this whenever the steps or their wording change; leave it alone for
 * unrelated work, or everyone repeats the tutorial for nothing.
 */
export const TUTORIAL_REVISION = '2026-09-04T00:00:00.000Z';

const PLAYED_KEY = 'shikigami_tutorial_playedAt';
/** pre-revision builds stored a bare 'true' here */
const LEGACY_KEY = 'shikigami_tutorial_done';

/** ISO timestamp of the last completed run, or null if there has never been one */
export function tutorialPlayedAt(): string | null {
  try {
    const at = localStorage.getItem(PLAYED_KEY);
    if (at) return at;
    // Someone who finished the old tutorial has a 'true' and no date. Treat
    // that as "seen, but before the current revision" so they get the updated
    // one exactly once rather than being counted as never having played.
    if (localStorage.getItem(LEGACY_KEY) === 'true') return '1970-01-01T00:00:00.000Z';
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the player has never finished the tutorial, or finished a version
 * of it older than the current one.
 */
export function tutorialDue(): boolean {
  const at = tutorialPlayedAt();
  if (!at) return true;
  const seen = Date.parse(at);
  if (Number.isNaN(seen)) return true;
  return seen < Date.parse(TUTORIAL_REVISION);
}

export function markTutorialCompleted() {
  try {
    localStorage.setItem(PLAYED_KEY, new Date().toISOString());
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* private window: the tutorial simply shows again */
  }
}

export function resetTutorial() {
  try {
    localStorage.removeItem(PLAYED_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* nothing to do */
  }
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

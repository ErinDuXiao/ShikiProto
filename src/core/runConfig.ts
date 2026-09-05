/**
 * Prototype v5 — Swarm Techniques / Scatter & Recover / Combat Rhythm.
 *
 * The grammar the whole game is built from (spec 2):
 *   放つ Release · 広げる Spread · 集める Gather · 呼ぶ Recall
 *
 * Number growth is no longer an experiment — it is a core system.
 */

export enum SType {
  /** 通常の式 — straight, sharp recall */
  PAPER = 0,
  /** 騰蛇の式 — the old "foxfire"; weaves toward enemies on the way home */
  TENGJA = 1,
}

/** Arena keeps the old combat test reachable; Kyoto is the v7 slice (spec 47). */
export type GameMode = 'arena' | 'kyoto' | 'tutorial';

export const VERSION = 'prototype_v10';

/** Spider Bind is disabled, not deleted (spec 19). */
export const SPIDER_ENABLED = false;

export const RUN = {
  initialPaper: 25,
  initialTengja: 5,
  /** the run is about six minutes long (spec 45) */
  length: 360,
  milestone: 100,
};

export type PickupKind = 'small' | 'medium' | 'large' | 'orbit';

export interface SkillSlot {
  key: string;
  label: string;
  blurb: string;
}

/** Four verbs, four inputs. Shift is Dash and only Dash (spec 3). */
export const CONTROLS: SkillSlot[] = [
  { key: 'LMB', label: 'RELEASE', blurb: 'Throw shikigami along your aim.' },
  { key: 'RMB', label: 'RECALL', blurb: 'Call the whole flock home. Everything it passes through takes the hit.' },
  { key: 'SPACE', label: 'SPREAD', blurb: 'Open the flock outward into a wide surface. Wrap a crowd, then cut it.' },
  { key: 'Q', label: 'GRAVITY CORE', blurb: 'Throw a core that becomes a second swarm centre. Place it past the enemy.' },
  { key: 'SHIFT', label: 'DASH', blurb: 'Get to the other side. This is how a recall line gets built.' },
];

/**
 * Scripted beats rather than a rising enemy count: something should change
 * every 45–60 seconds (spec 44/46).
 */
export interface WaveEvent {
  t: number;
  kind: 'intro' | 'rift' | 'elite' | 'surge' | 'fourWay' | 'cluster' | 'boss';
  label: string;
}

/**
 * v10: the beats now serve the growth curve.
 *
 * The 135 s mid-boss was measured ending runs at ~222 s with the flock at 84 --
 * the Oni arrived while the player was still growing, and killing it closed the
 * run before 100 shikigami was reachable at all. It is replaced by a SURGE: a
 * deliberately large, tightly packed wave, which is a fat recall line and a
 * heap of talismans rather than a wall (v10 spec 8).
 *
 * The Oni's own arrival is no longer scripted here -- it comes from the growth
 * condition in Game.updateOni (210 s or 80 shikigami). The 330 s entry is only
 * a backstop for a player who somehow reaches it without either.
 */
export const TIMELINE: WaveEvent[] = [
  { t: 0, kind: 'intro', label: '' },
  { t: 45, kind: 'rift', label: 'RIFT' },
  { t: 80, kind: 'elite', label: 'ELITE' },
  { t: 120, kind: 'fourWay', label: 'FOUR DIRECTIONS' },
  { t: 155, kind: 'surge', label: '百鬼' },
  { t: 195, kind: 'cluster', label: 'SWARM' },
  { t: 250, kind: 'surge', label: '百鬼' },
  { t: 330, kind: 'boss', label: 'ONI' },
];

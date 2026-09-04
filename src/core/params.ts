/**
 * Boid / swarm tuning parameters.
 * All of these are live-editable from the debug panel (see ui/debugPanel.ts).
 *
 * Design intent (spec 30): defaults sit on the VERY responsive side. Normal
 * running should feel like cloth or smoke trailing off the player's body, not
 * like a squad of NPCs trying to keep up. Delay is not the game -- delay only
 * happens when the player explicitly asks for it (Dash / Spread / Send).
 */
export interface BoidParams {
  playerAttraction: number;
  cohesion: number;
  alignment: number;
  separation: number;
  maxSpeed: number;
  recallSpeed: number;
  followDistance: number;
  formationTightness: number;
  dashFollowDelay: number;
  spreadRadius: number;
}

export const DEFAULT_PARAMS: Readonly<BoidParams> = Object.freeze({
  /** spring gain pulling each shikigami to its formation slot (1/s) */
  playerAttraction: 14,
  /** pull toward local neighbour centroid */
  cohesion: 1.4,
  /** how strongly a shikigami matches neighbour velocity (0..1) */
  alignment: 0.28,
  /** short range push-apart, keeps the swarm from collapsing to a point */
  separation: 11,
  /** normal cruise clamp (units/s). Player runs at 13. */
  maxSpeed: 32,
  /** recall dive speed -- must feel WAY faster than following */
  recallSpeed: 74,
  /** radius of the resting ring around the onmyoji */
  followDistance: 3.8,
  /** multiplier on followDistance; low = a dense ball */
  formationTightness: 1.0,
  /** seconds of positional lag proportional to player velocity -> spear shape */
  dashFollowDelay: 0.16,
  /** radius the swarm opens up to while SHIFT is held */
  spreadRadius: 11,
});

export const params: BoidParams = { ...DEFAULT_PARAMS };

export function resetParams(): void {
  Object.assign(params, DEFAULT_PARAMS);
}

export interface SliderSpec {
  key: keyof BoidParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const SLIDERS: SliderSpec[] = [
  { key: 'playerAttraction', label: 'Player Attraction', min: 1, max: 40, step: 0.5 },
  { key: 'cohesion', label: 'Cohesion', min: 0, max: 8, step: 0.1 },
  { key: 'alignment', label: 'Alignment', min: 0, max: 1, step: 0.01 },
  { key: 'separation', label: 'Separation', min: 0, max: 40, step: 0.5 },
  { key: 'maxSpeed', label: 'Max Speed', min: 8, max: 70, step: 1 },
  { key: 'recallSpeed', label: 'Recall Speed', min: 20, max: 140, step: 1 },
  { key: 'followDistance', label: 'Follow Distance', min: 1, max: 12, step: 0.1 },
  { key: 'formationTightness', label: 'Formation Tightness', min: 0.2, max: 2.5, step: 0.05 },
  { key: 'dashFollowDelay', label: 'Dash Follow Delay', min: 0, max: 0.8, step: 0.01 },
  { key: 'spreadRadius', label: 'Spread Radius', min: 4, max: 26, step: 0.5 },
];

/** Shared world constants. */
export const ARENA_RADIUS = 40;
export const SHIKIGAMI_COUNT = 100;
export const SHIKIGAMI_Y = 0.95;

/**
 * The playable ground, as a mutable CAPSULE: every point within `radius` of
 * the segment A->B. A == B gives a plain circle, which is what Arena mode uses
 * forever.
 *
 * Kyoto moves it. A bridge and an alley are corridors, not circles, and the
 * walk between two locations is a corridor too -- so one capsule expresses the
 * arena, the encounter grounds and the travel routes alike, and no entity has
 * to know which mode it is in.
 */
export const field = {
  ax: 0,
  az: 0,
  bx: 0,
  bz: 0,
  radius: ARENA_RADIUS,
  /** midpoint of the axis; what "the middle of the playable ground" means */
  cx: 0,
  cz: 0,
};

export function setField(ax: number, az: number, bx: number, bz: number, radius: number) {
  field.ax = ax;
  field.az = az;
  field.bx = bx;
  field.bz = bz;
  field.radius = radius;
  field.cx = (ax + bx) * 0.5;
  field.cz = (az + bz) * 0.5;
}

export function resetField() {
  setField(0, 0, 0, 0, ARENA_RADIUS);
}

/** Nearest point on the field axis to (x, z), written into out. */
export function fieldAxisPoint(x: number, z: number, out: { x: number; z: number }) {
  const vx = field.bx - field.ax;
  const vz = field.bz - field.az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-9 ? ((x - field.ax) * vx + (z - field.az) * vz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  out.x = field.ax + vx * t;
  out.z = field.az + vz * t;
}

const _axis = { x: 0, z: 0 };

/**
 * Push a point back inside the capsule. Returns the clamped position through
 * `out`, and true when it actually had to move.
 */
export function clampToField(
  x: number,
  z: number,
  margin: number,
  out: { x: number; z: number },
): boolean {
  fieldAxisPoint(x, z, _axis);
  const dx = x - _axis.x;
  const dz = z - _axis.z;
  const r = Math.hypot(dx, dz);
  const lim = Math.max(1, field.radius - margin);
  out.x = x;
  out.z = z;
  if (r <= lim) return false;
  const s = r > 1e-6 ? lim / r : 0;
  out.x = _axis.x + dx * s;
  out.z = _axis.z + dz * s;
  return true;
}

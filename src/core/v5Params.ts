/** Everything the v5 debug panel can move at runtime. */
export interface V5Params {
  // --- number growth
  initialShikigami: number;
  maxShikigami: number;
  pickupDropRate: number;
  rewardSmall: number;
  rewardMedium: number;
  rewardLarge: number;
  growthSpeed: number;

  // --- 騰蛇 tengja
  tengjaRatio: number;
  tengjaEnemyPull: number;
  tengjaPlayerPull: number;
  tengjaSpeed: number;

  // --- SPACE spread
  spreadRadiusMul: number;
  spreadOpenTime: number;
  spreadHoldTime: number;
  spreadCooldown: number;
  spreadContactDamage: number;

  // --- Q gravity core
  gravityCooldown: number;
  gravityLifetime: number;
  gravityRadius: number;
  gravityStrength: number;
  gravitySpeed: number;

  // --- orbit pickup
  orbitDuration: number;
  orbitRings: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitDamage: number;
  orbitTickInterval: number;
  orbitDropChance: number;

  // --- scatter / recover
  scatterPerHit: number;
  scatterLifetime: number;
  recoverRange: number;

  // --- white ink residue
  inkThreshold: number;
  inkLifetime: number;
  inkOpacity: number;
}

export const DEFAULT_V5: Readonly<V5Params> = Object.freeze({
  initialShikigami: 30,
  maxShikigami: 150,
  pickupDropRate: 0.5,
  rewardSmall: 1,
  rewardMedium: 3,
  rewardLarge: 5,
  growthSpeed: 1.0,

  tengjaRatio: 0.17,
  tengjaEnemyPull: 0.72,
  tengjaPlayerPull: 0.6,
  tengjaSpeed: 0.9,

  /** how far past the normal follow ring the flock opens */
  spreadRadiusMul: 3.2,
  spreadOpenTime: 0.45,
  spreadHoldTime: 1.6,
  spreadCooldown: 2.0,
  /** graze power of the opening surface. ~10-20% of a recall hit (spec 5) */
  spreadContactDamage: 0.8,

  gravityCooldown: 7,
  gravityLifetime: 4,
  gravityRadius: 14,
  gravityStrength: 0.95,
  gravitySpeed: 26,

  orbitDuration: 6.5,
  orbitRings: 3,
  orbitRadius: 4.2,
  orbitSpeed: 2.1,
  /** damage the RING deals per contact tick -- not per shikigami (spec 1) */
  orbitDamage: 2.0,
  orbitTickInterval: 0.3,
  /** share of kills that drop a ring talisman instead of a spirit one */
  orbitDropChance: 0.12,

  /** shikigami knocked loose per hit taken */
  scatterPerHit: 16,
  /** seconds a scattered shikigami waits to be recovered before it is lost */
  scatterLifetime: 4.5,
  recoverRange: 5.5,

  inkThreshold: 30,
  inkLifetime: 0.7,
  inkOpacity: 0.12,
});

export const v5: V5Params = { ...DEFAULT_V5 };

export function resetV5() {
  Object.assign(v5, DEFAULT_V5);
}

export interface V5SliderSpec {
  key: keyof V5Params;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const V5_SLIDERS: { group: string; items: V5SliderSpec[] }[] = [
  {
    group: 'NUMBER GROWTH',
    items: [
      { key: 'initialShikigami', label: 'Initial Shikigami', min: 5, max: 80, step: 1 },
      { key: 'maxShikigami', label: 'Max Shikigami', min: 40, max: 200, step: 5 },
      { key: 'pickupDropRate', label: 'Pickup Drop Rate', min: 0.2, max: 3, step: 0.1 },
      { key: 'rewardSmall', label: 'Small Reward', min: 1, max: 10, step: 1 },
      { key: 'rewardMedium', label: 'Medium Reward', min: 1, max: 15, step: 1 },
      { key: 'rewardLarge', label: 'Large Reward', min: 1, max: 25, step: 1 },
      { key: 'growthSpeed', label: 'Growth Speed', min: 0.3, max: 3, step: 0.05 },
    ],
  },
  {
    group: '騰蛇 TENGJA',
    items: [
      { key: 'tengjaRatio', label: 'Tengja Ratio', min: 0, max: 0.6, step: 0.01 },
      { key: 'tengjaEnemyPull', label: 'Enemy Attraction', min: 0, max: 0.95, step: 0.01 },
      { key: 'tengjaPlayerPull', label: 'Player Attraction', min: 0.1, max: 1, step: 0.01 },
      { key: 'tengjaSpeed', label: 'Tengja Speed', min: 0.4, max: 1.5, step: 0.02 },
    ],
  },
  {
    group: 'SPREAD (SPACE)',
    items: [
      { key: 'spreadRadiusMul', label: 'Spread Radius Mul', min: 1.5, max: 6, step: 0.1 },
      { key: 'spreadOpenTime', label: 'Open Time', min: 0.1, max: 1.5, step: 0.05 },
      { key: 'spreadHoldTime', label: 'Hold Time', min: 0.2, max: 5, step: 0.1 },
      { key: 'spreadCooldown', label: 'Cooldown', min: 0, max: 8, step: 0.1 },
      { key: 'spreadContactDamage', label: 'Contact Damage', min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    group: 'GRAVITY CORE (Q)',
    items: [
      { key: 'gravityCooldown', label: 'Cooldown', min: 1, max: 20, step: 0.5 },
      { key: 'gravityLifetime', label: 'Lifetime', min: 1, max: 12, step: 0.25 },
      { key: 'gravityRadius', label: 'Gather Radius', min: 4, max: 30, step: 0.5 },
      { key: 'gravityStrength', label: 'Gather Strength', min: 0.1, max: 1, step: 0.02 },
      { key: 'gravitySpeed', label: 'Core Speed', min: 8, max: 60, step: 1 },
    ],
  },
  {
    group: 'ORBIT PICKUP',
    items: [
      { key: 'orbitDuration', label: 'Duration', min: 2, max: 14, step: 0.5 },
      { key: 'orbitRings', label: 'Rings', min: 1, max: 5, step: 1 },
      { key: 'orbitRadius', label: 'Radius', min: 2, max: 10, step: 0.2 },
      { key: 'orbitSpeed', label: 'Rotation Speed', min: 0.4, max: 6, step: 0.1 },
      { key: 'orbitDamage', label: 'Ring Damage / Tick', min: 0, max: 8, step: 0.1 },
      { key: 'orbitTickInterval', label: 'Ring Tick Interval', min: 0.1, max: 1.5, step: 0.05 },
      { key: 'orbitDropChance', label: 'Drop Chance', min: 0, max: 0.6, step: 0.01 },
    ],
  },
  {
    group: 'SCATTER / RECOVER',
    items: [
      { key: 'scatterPerHit', label: 'Scatter Per Hit', min: 2, max: 45, step: 1 },
      { key: 'scatterLifetime', label: 'Scatter Lifetime', min: 1, max: 12, step: 0.25 },
      { key: 'recoverRange', label: 'Recover Range', min: 1, max: 15, step: 0.5 },
    ],
  },
  {
    group: 'WHITE INK RESIDUE',
    items: [
      { key: 'inkThreshold', label: 'Ink Threshold', min: 5, max: 90, step: 1 },
      { key: 'inkLifetime', label: 'Ink Lifetime', min: 0.2, max: 2, step: 0.05 },
      { key: 'inkOpacity', label: 'Ink Opacity', min: 0, max: 0.8, step: 0.01 },
    ],
  },
];

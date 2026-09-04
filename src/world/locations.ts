/**
 * The Kyoto vertical slice (spec 3/4).
 *
 * Five places, one branch, one boss. Deliberately NOT a city: this is a corridor
 * of five stages with walks between them, sized so a run lands in the 12-15
 * minute range without any of the walks feeling like commuting.
 *
 * Every location states its own COMBAT GEOMETRY, because that -- not new enemy
 * types -- is what makes the fights feel different (spec 10). The bridge is a
 * line, the alley is a slot, the shrine is an open circle, the graveyard is a
 * field of blockers, the mansion is a broken courtyard.
 */

export type LocationId = 'bridge' | 'alley' | 'shrine' | 'graveyard' | 'mansion';

/** How the encounter arrives. One per location (spec 38). */
export type EncounterShape =
  | 'line' // packed along the long axis: the bridge
  | 'encircle' // closes from both ends of a slot: the alley
  | 'converge' // from every compass point at once: the shrine
  | 'scatter' // spread out behind cover: the graveyard
  | 'combination'; // all of the above, then the boss

export interface Ground {
  /** capsule axis; ax==bx && az==bz makes it a circle */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
}

export interface RewardSpec {
  label: string;
  blurb: string;
  apply: () => void;
}

export interface LocationDef {
  id: LocationId;
  /** 日本語 name shown on arrival */
  name: string;
  reading: string;
  /** one line of framing, shown once on arrival (spec 34/35) */
  line: string;
  /** where the player stands when the encounter begins */
  x: number;
  z: number;
  /** the fighting ground */
  ground: Ground;
  shape: EncounterShape;
  /** roughly how long the encounter should last, in seconds */
  duration: number;
  /** total enemies the encounter releases */
  budget: number;
  /** how many may be alive at once */
  concurrent: number;
  /** the boss waits here */
  boss?: boolean;
  /** what clearing it gives you (spec 18/19); undefined = shikigami only */
  reward?: RewardSpec;
}

const CIRCLE = (x: number, z: number, radius: number): Ground => ({
  ax: x,
  az: z,
  bx: x,
  bz: z,
  radius,
});

/**
 * Reward hooks are resolved lazily so this module stays free of engine imports
 * and can be unit-read on its own.
 */
export const rewardHooks: {
  orbitDuration: (mul: number) => void;
  tengjaRatio: (add: number) => void;
} = {
  orbitDuration: () => {},
  tengjaRatio: () => {},
};

export const LOCATIONS: Record<LocationId, LocationDef> = {
  bridge: {
    id: 'bridge',
    name: '一条戻橋',
    reading: 'ICHIJO MODORIBASHI',
    line: 'The bridge where the dead are said to come back.',
    x: 0,
    z: 62,
    // a long deck: fighting happens along it, never around it
    ground: { ax: 0, az: 100, bx: 0, bz: 24, radius: 13 },
    shape: 'line',
    duration: 70,
    budget: 30,
    concurrent: 8,
  },
  alley: {
    id: 'alley',
    name: '路地',
    reading: 'ROJI',
    line: 'The lanterns end here.',
    x: -210,
    z: -140,
    // a bent slot between machiya walls
    ground: { ax: -184, az: -100, bx: -236, bz: -180, radius: 11 },
    shape: 'encircle',
    duration: 80,
    budget: 36,
    concurrent: 10,
  },
  shrine: {
    id: 'shrine',
    name: '小さな社',
    reading: 'CHIISAI YASHIRO',
    line: 'Something has been let in through the torii.',
    x: -430,
    z: -350,
    ground: CIRCLE(-430, -350, 27),
    shape: 'converge',
    duration: 85,
    budget: 40,
    concurrent: 12,
    reward: {
      label: '輪の加護',
      blurb: 'ORBIT DURATION +20%',
      apply: () => rewardHooks.orbitDuration(1.2),
    },
  },
  graveyard: {
    id: 'graveyard',
    name: '墓地',
    reading: 'BOCHI',
    line: 'The stones are facing the wrong way.',
    x: 40,
    z: -380,
    ground: CIRCLE(40, -380, 31),
    shape: 'scatter',
    duration: 85,
    budget: 38,
    concurrent: 11,
    reward: {
      label: '騰蛇の符',
      blurb: '騰蛇 RATIO +10%',
      apply: () => rewardHooks.tengjaRatio(0.1),
    },
  },
  mansion: {
    id: 'mansion',
    name: '異界の屋敷',
    reading: 'YASHIKI',
    line: 'The corridor does not end where the wall is.',
    x: -210,
    z: -640,
    ground: CIRCLE(-210, -640, 36),
    shape: 'combination',
    duration: 150,
    budget: 62,
    concurrent: 15,
    boss: true,
  },
};

/** Where the run starts — a quiet stretch of road south of the bridge. */
export const START = { x: 0, z: 380 };

/**
 * The route. One branch (spec 17): shrine or graveyard, never both, and the
 * two hand out different rewards so the choice is a small build decision
 * rather than only a change of scenery (spec 18).
 */
export const ROUTE: Array<LocationId | LocationId[]> = [
  'bridge',
  'alley',
  ['shrine', 'graveyard'],
  'mansion',
];

/** Travel corridor half-width; wide enough to wander, tight enough to lead. */
export const ROAD_HALF_WIDTH = 30;

export function locationOf(id: LocationId): LocationDef {
  return LOCATIONS[id];
}

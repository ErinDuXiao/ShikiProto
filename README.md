# SHIKIGAMI FLOW — Prototype v10

Swarm Techniques / Scatter & Recover / Combat Rhythm.

One run, about six minutes. The loop everything serves:

**Release → Move → Recall → Hit**, and the swarm grows the whole way.

The grammar the player has over the flock (spec 2):

> **放つ** release · **広げる** spread · **集める** gather · **呼ぶ** recall

---

## Play it

**https://erinduxiao.github.io/ShikiProto/** — deployed from `main` by GitHub Actions
on every push.

## Running

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

Node 18+. No external assets.

---

## Controls

| Input | Verb | What it does |
| --- | --- | --- |
| **WASD** | — | Move |
| **LMB** | 放つ | Release shikigami along your aim |
| **RMB** | 呼ぶ | Recall — the whole flock dives home through whatever is in the way |
| **SPACE** | 広げる | **Spread** — the flock opens outward into a wide surface |
| **Q** | 集める | **Gravity Core** — throw a second swarm centre |
| **SHIFT** | — | **Dash**, and only Dash |

Shift is never shared with Spread. Dash is how you get to the other side of a pack,
which is how a recall line gets built.

---

## Growth — what was actually holding it back

v9 ended runs with the flock around 60. The brief's first guess was the talisman
economy, and the fix it suggested was `pickupDropRate: 0.5 -> 0.6`.

That is not what was capping it. Growth is gated by a **schedule**, not by
supply:

```
cap(t) = 30 + min(t, HUNDRED_AT) / HUNDRED_AT * 70
```

At `HUNDRED_AT = 285` that allowed 50 at 81 s, 75 at 183 s, and 100 only at
4:45. Measured, the autopilot reached 50 at 84.8 s and 75 at 181.7 s — it was
riding the ceiling the entire run.

> Raising `pickupDropRate` from **0.5 to 0.9** changed the run by **nothing**.
> Same seed, same enemies, identical flock size at every sample. Every talisman
> above the cap is discarded, so the dial the brief reached for was connected to
> nothing for a player who was already keeping up.

`HUNDRED_AT` is now **240**, which puts the whole curve inside the target
window. The drop-rate change is kept at 0.6 anyway, because it is the dial that
matters for anyone NOT riding the cap — the reference human run peaked at 60
where the schedule would have allowed 93.

The 135 s mid-boss went with it. It was arriving mid-growth and, once killed,
ending the run: measured at ~222 s with the flock at 84 and 100 unreachable.
Its slot is now a **SURGE** — a big, tightly packed wave, which is a fat recall
line and a heap of talismans (brief 8).

### Measured, one run, autopilot

| | target | v9 | v10 |
| --- | --- | --- | --- |
| 50 shikigami | 1:00–1:30 | 1:24 | **1:07** |
| 75 shikigami | 2:15–3:00 | 3:02 | **2:33** |
| 100 shikigami | 3:30–4:30 | never | **4:09** |
| peak flock | 100+ | 87 | **104** |
| run length | 4–6 min | 4:00 | **4:26** |
| flock when the Oni lands | 80–100 | 80 | **80** |
| boss fight | 45–90 s | 37 s | **90 s** |
| spread uses | 10–20 | 13 | **17** |

`gravityUses` (7) and `dashCount` (111) are the autopilot's own hard-coded
cadence — a 12 s gravity timer and a dash on every close enemy — not a statement
about the tuning.

**Growth is playstyle-dependent, and that is intended.** A second autopilot
written to prioritise the boss fight over talismans reached 75 at 190 s rather
than 153 s. The schedule sets the ceiling; what the player does decides how
close they get to it.

---

## 鬼 — dodge, then answer

The brief's diagnosis was that the Oni was a wall rather than a rhythm. Three
things changed, none of them HP or damage (brief 27).

**The charge is now the fight.** At v9's thresholds the Oni closed to 5.2 units
and then could only swing or slam, so the move the whole encounter is built
around barely came out. Measured over 180 s at charge range: charge is now
**76%** of its attacks.

**The tell is the loudest thing on screen.** A 0.9 s wind-up in which it drops
into a crouch, locks on, and paints the 22-unit lane it is about to cross.

**The opening is longer and legible.** Charge recovery measured at **1.57 s**
(slam 1.15, swing 0.95), during which the posture breaks, the chest lights up,
hairline cracks run across the body, and `recallBonus` rises to 1.4×.

### Is the charge fair?

Same test, same sidestep, varying only what the player does and how fast they
react:

| reaction delay | walk only | walk + dash |
| --- | --- | --- |
| 0.25 s | **25% hit** | **0% hit** |
| 0.35 s | **50% hit** | **0% hit** |
| no reaction | **44% hit** | — |

Walking is tight and gets worse the slower you are; dashing works outright.

### Perfect Dodge

v9 scored **one** perfect dodge across a whole run. The timing was real but the
window was smaller than human reaction noise, and — worse — it was judged on
*proximity*.

> That was backwards. The charge travels 18 units THROUGH where the player was
> standing, so a dodge that works ends with the two of them far apart: measured,
> a clean sideways dash leaves **13 to 27 units** between them. The proximity
> test credited the player who never moved and denied the one who did.

It is judged on timing now, with a ±0.22 s window either side of the committed
moment. The discrimination is what matters, and it holds:

| dash timing | perfect dodges |
| --- | --- |
| never | 0 |
| early, during the wind-up | **0** |
| on the commit | **23 / 24** |
| late, after it has passed | **0** |

### Counter Recall

Get out of the way of a charge, then answer it within 3 seconds. Measured: 22
charge dodges produced **12 counters**. No banner and no score — a bell, a
heavier hit stop, and one white stroke left across the ground (brief 20). Each
one is logged as its own event:

```json
{ "t": 9.98, "type": "counter_recall", "bossAttack": "charge",
  "recallHits": 71, "damage": 14.25, "secondsAfterDodge": 1.16,
  "shikigamiCount": 100 }
```

---

## Spread — measured, then left alone

The brief asked for 10–20 uses in a 4–5 minute run, and was explicit that the
cooldown should be the **last** thing touched. Measured: **17**, already inside
the window, so the cooldown stays at 2.0 s.

The one honest caveat: an autopilot cannot measure a habit. The 45 uses in the
reference human run came from pressing SPACE whenever it came off cooldown, and
nothing an autopilot does reproduces that. What the build can say is that a
*pointless* spread still earns nothing — the setup feedback needs 40+ recall
hits inside 4 s — and that `spreadSetupSuccesses` (11 of 17 here) is now in the
log, so the next human run can be checked rather than guessed at.

If it stays at 45, brief 34's 2.0 -> 2.5–3.0 is the next step.

---

## Tutorial

The controls are not the hard part. The hard part is that **left click is not
attack** — the flock has to be on the far side of something before the pull is
worth anything. That cannot be read, only done, so the tutorial makes the player
do it:

```
release  →  walk past the enemy  →  recall
```

Eight steps, one line of text and one control named at a time. The permanent
control strip and the cooldown pips are hidden while it runs; the pips come back
at the step that teaches them.

**Every step is gated on the action it teaches, not on the field being clear.**
That distinction mattered — the first build let three steps pass without the
player doing the thing:

> The **recall** step completed instantly, because each step cleared the arena
> and that wiped the dummy the player was supposed to pull through. It now
> requires a recall that actually killed something (spec 24/43).
>
> The **dash** step read `player.dashCount > 0`, which is cumulative for the
> run, so a dash used earlier satisfied it before it began. Baselines are now
> captured on entry.
>
> The **gravity** and **spread** steps completed by recalling repeatedly, with
> `timeToFirstGravitySetup` still `null` — the player passed the lesson on
> placement tools without ever pressing one. Both now require the ability.

### When it runs

`PLAY ARENA` is the only button most people press, so the tutorial comes to them
rather than sitting beside it. It runs automatically when either is true:

- the browser has no record of the player finishing it, **or**
- they finished a version older than `TUTORIAL_REVISION` in `src/systems/tutorial.ts`

Completion stores an **ISO timestamp** under `shikigami_tutorial_playedAt`, so
revising a lesson and bumping that constant reaches everyone who already played
— once. Bump it when the steps or their wording change, and leave it alone
otherwise, or every player repeats the tutorial for nothing.

| stored value | runs? |
| --- | --- |
| nothing | yes |
| `true` (the pre-timestamp build) | yes, treated as seen-but-older |
| a date before `TUTORIAL_REVISION` | yes |
| a date after it | no |
| anything unparseable | yes |

`Tutorial` in the menu replays it, `SKIP TUTORIAL` leaves at any time (and still
records the timestamp, so skipping is not punished with a loop), `RESET TUTORIAL`
is in the debug panel.

**It does not end on a victory screen.** The tutorial is onboarding, not a mode
with a win state, so finishing it produces no VICTORY, no fanfare and no stats
panel -- the field empties, the flock comes home, one bell, one small line, and
the arena fades up from the same curtain. The player should be thinking "right,
now the real thing", not "I won".

```
last wave down -> flock returns -> bell -> one line, ~1.5s -> fade -> arena
```

Skipping gets the curtain but not the send-off. That distinction needed a fix of
its own: `Tutorial.finish()` fired `onComplete` either way, so leaving early used
to play the whole completion sequence for a lesson the player had just
declined.

Measured, autopiloted: **23 s** and all 8 steps, with the recall kill landing
inside the recall step. A human reading each line will be nearer the 60–90 s the
brief asks for.

---

## 鬼 — the arena Oni

The multi-limbed boss is gone: `boundaryEater.ts` and `bossFight.ts` are deleted
and every hook they had is removed. Three things they introduced were worth
keeping and now serve the Oni — `EnemyBase.recallBonus`, `CombatSystem.onHit`,
and `Player.dashIFrames`.

Three attacks, chosen by range so the answer is always legible:

| | range | tell | answer |
| --- | --- | --- | --- |
| **CHARGE** | far | ground line, body drops | dash sideways |
| **SLAM** | mid | ring on the floor, 0.9 s | dash out of it |
| **SWING** | close | wide arc on the floor | dash back |

Every attack ends in a **recovery** state of 1.0–1.35 s where the Oni is planted
and `recallBonus` rises to **1.4×**. The dodge is not survival — it is what buys
the window.

**Perfect Dodge** requires the dash's own i-frames to overlap the *committed*
part of the attack. Measured: dashing at the first frame of the tell scores
**0**; dashing on time scores **12**.

> Two things the measurements caught. **Swing never fired** — the Oni stopped
> drifting at range 7 while the swing needed < 6.5, so one of its three attacks
> was unreachable. And the hit counters incremented on attempts rather than
> connections, so `EnemyWorld.hitPlayer` now returns whether it actually landed.

Spawns at ~3 min or 75 shikigami. Measured kill time with a perfect autopilot is
**19 s**; a real player, taking the front guard into account, should land nearer
the 1–2 min the brief asks for.

**The power fantasy is untouched** — one recall at 100 shikigami still erases
**25 of 32** yokai. No enemy HP was raised.

---

## Guidance in the arena

The full control list sits bottom-right for the first 45 s and then fades. After
that, one quiet nudge per unused ability (`Q` if gravity has never been cast
while a crowd is up, and so on) — once each, never repeated.

---

## Two modes

The start screen offers both. Arena is the old combat test, untouched and still
reachable so any tuning question can be answered the way it always was (spec 47).

```
[        PLAY ARENA        ]     the mode under test
          Tutorial
   Kyoto Prototype · experimental
```

Arena is primary, takes default focus and starts on Enter.

`SHIKIGAMI.kyoto()` / `SHIKIGAMI.arena()` do the same from the console.

---

## 京都 — the vertical slice

```
START ── 一条戻橋 ── 路地 ─┬─ 小さな社 ─┬─ 異界の屋敷 (BOSS)
                          └─ 墓地 ─────┘
```

Walk, find the disturbance, put it down, walk on. There are no waves — or rather,
there are, but the player never waits for one. The `WaveDirector` is not deleted;
in Kyoto it is replaced by an `Encounter` bound to the place you chose to walk into.

**The play field is a capsule** (`src/core/params.ts`), which is what lets one
piece of code express the arena circle, a bridge corridor, an alley slot and the
road between two locations. Travelling, it is the road; fighting, it is the
location's own ground.

### The five places

| | shape | what the ground does to a recall |
| --- | --- | --- |
| **一条戻橋** | corridor 76×13 | everything queues down the deck — one pull takes the line |
| **路地** | bent slot 11 wide | closes from both ends; dash into the side passage, then a core down the slot |
| **小さな社** | circle r27 | pressure from every compass point at once — the Orbit yard |
| **墓地** | circle r31, 40 blockers | no angle lines them up; the core has to go round the stones |
| **異界の屋敷** | circle r36, pillars + veranda | cycles all four, then the boss |

Enemies are identical everywhere. Only the arrival geometry and the ground change
— that is the whole thesis of spec 10.

### The branch

Shrine or graveyard, never both. Chosen by **walking down one road**, with no menu:
both disturbances light up, the corridor follows whichever you commit to, and the
other goes dark. Shrine gives ORBIT DURATION +20%; graveyard gives 騰蛇 RATIO +10%.

### Wayfinding

The disturbance is a red-black column with white paper scraps drifting *upward*,
`fog: false` so distance never dims it, fading out as you arrive because by then the
place itself is doing the talking. Two are alive at a fork.

> At this camera pitch the view only reaches about **45 units** past the player, so
> a light 190 units down the street is simply not on screen. The camera leans 9 units
> down the road while walking (spec 29's "widen forward visibility a little" — at 24
> the player fell off the bottom of the frame), and a small edge chevron with a
> distance covers the rest. That is the "small objective marker" spec 30 allows, and
> nothing more.

### Measured — one full run, autopiloted

| | |
| --- | --- |
| result | victory, all 4 locations logged |
| travel legs | 23.0 / 22.3 / 22.0 / 25.9 s — **all inside the 20–40 s band** |
| average travel | 23.3 s |
| **combat / exploration** | **68% / 32%** (target 70/30) |
| rest after each fight | 4.5 s of guaranteed quiet, no spawns |

```
bridge  : 33.7s, 56 recalls, max 49 hits, 30 kills, 式 30→44
alley   : 40.4s, 65 recalls, max 51 hits, 36 kills, 式 44→58
shrine  : 35.5s, 59 recalls, max 51 hits, 40 kills, 式 58→75
mansion : 118.4s, 196 recalls, max 82 hits, 63 kills, 式 76→107
```

> Total was 5.6 minutes, not the 12–15 the brief asks for — but the autopilot
> recalls every 0.67 s with perfect uptime and never stops to look at anything.
> Encounter length is one number per location (`budget` in
> `src/world/locations.ts`); the ratio is the constraint I tuned to, because it is
> the one that survives contact with a real player.

---

## Placement and attack are separate

The swarm grammar splits cleanly in two, and the split is enforced in the code rather
than being a description of it:

| Verb | What it is | Damage |
| --- | --- | --- |
| **放つ** LMB | attack | full |
| **広げる** SPACE | placement | graze only, while the surface is moving |
| **集める** Q | placement | none |
| **輪符** orbit | placement | the **ring** cuts; the shikigami do not |
| **呼ぶ** RMB | attack | full — the main damage source |

No formation ever turns a shikigami into a hunter. Nothing leaves the flock to chase.
Three concepts are tracked separately (`src/entities/shikigami.ts`):

- **Behaviour** — `FOLLOW` / `WAIT` / `RECALL` (plus `LAUNCH`, `SCATTERED`, `FINISH`).
  What the shikigami is trying to do; persists between frames.
- **Formation** — `NORMAL` / `SPREAD` / `ORBIT` / `GRAVITY_PULL`. How the flock is
  arranged; recomputed every frame.
- **Combat** — `PASSIVE` / `ATTACKING`. Only `RECALL` and `LAUNCH` are ever `ATTACKING`.

Priority when several apply: `RECALL > GRAVITY_PULL > ORBIT / SPREAD > NORMAL`.
Both debug rows are shown live (`STATE` is behaviour, `FORMATION` is the modifier).

---

## The two techniques

### SPACE — Spread / 展式

The flock opens like a flower rather than exploding: it eases outward over
`spreadOpenTime` (0.45s) to **3.2×** the normal follow ring, holds for 1.6s, then drifts
back to normal on its own. Loose shikigami rejoin so the surface is made of the whole
flock.

It is for making a **surface** — wrap a crowd, then cut through the middle; or push the
flock outside a ring of enemies so the recall passes through all of them on the way in.
Shikigami never target, chase or stop on an enemy while spreading; they open and keep
going.

**Contact graze.** A shikigami passing straight through a body with nothing happening
read as broken, so the moving surface grazes what it sweeps. It is deliberately tiny:

- Measured **0.27 damage per contact** vs **1.76** for a recall contact — **15.3%**,
  inside the 10–20% the spec asked for.
- One full spread of 100 shikigami into a ring of 8 enemies dealt **1.8–3.1 each**. A
  yokai has 26 HP, so spread alone needs ~10 casts to kill one — it finishes something
  already dying and nothing else.
- Feedback is a small pale number and a short flash. No hit stop, no shake, no knockback
  worth the name (0.5 vs 2.4). The gap against a recall's impact is the point.
- The graze stops as soon as the surface stops travelling (below 9 u/s), and applies only
  to shikigami whose formation actually *is* `SPREAD` — under `ORBIT` or `GRAVITY_PULL`
  the flock is being placed, not swung.

Measured: resting ring 2.1 → **7.4** while open, decaying back afterwards.

### Q — Gravity Core / 集式核

Throws a heavy white core along your aim. It flies ~22 units, stops, and for 4s becomes a
second swarm centre that drags the flock onto itself. A shrinking ground ring shows the
time left. Cooldown 7s.

**Core ─ Enemy ─ Player** is the shape it exists to make. Measured: fired 20 units out,
**30 of 30** shikigami travelled to it and the swarm centre moved to within 0.9 units of
the core.

> The pull is unconditional while the core lives. An earlier version only captured
> shikigami already inside its radius, which meant a core thrown *past* the enemy —
> the entire reason to use one — gathered nobody.

**It reaches WAIT shikigami too.** A core is an explicit placement order, so it must not
skip part of the flock based on an internal state the player cannot see. Shikigami parked
out in the field are pulled exactly like the ones following you.

Measured with 80 of 100 shikigami parked in `WAIT`: average distance to the core
**16.09 → 8.63**, peak pulled **91**, of which **80 came from WAIT**. When the core
expires they drop back to `WAIT` — the core changes the formation, never the behaviour.
A recall mid-pull overrides it and everything comes home.

The debug panel shows this directly while a core is up:

```
GRAVITY     ACTIVE
  PULLED    74
  FROM WAIT 34
```

---

## Orbit — the ring talisman (輪符)

Not a button. Some kills drop a ring talisman; picking it up makes the flock gather and
wheel around you in **3 concentric rings** for 6.5s.

**The ring has the hitbox, not the shikigami.** No shikigami leaves the circle to attack
anything. What deals damage is the *formation*: a band around you, and an enemy that
walks into the band gets cut. The number of shikigami in the ring changes how it looks,
not how hard it hits. A faint ground annulus draws the band so the boundary is readable,
and brightens for a moment on each contact.

Measured over 3s with the band at **2.31–4.41**:

| target | damage |
| --- | --- |
| standing **on** the band | **20** (10 ticks at 0.3s) |
| standing **inside** the formation | 0 |
| standing 16 units away | 0 |

Max shikigami radius stayed at 4.87 and **zero** shikigami left to chase the far enemy.
At ~6.7 dps a 26 HP yokai takes about 4s, so orbit is a defensive formation and a
deterrent, never a way to clear a field.

Recall still works during orbit, and that is the point: the ring is a **starting
formation**. Pulling breaks the circle immediately (`orbitTimer → 0`, band hidden) and
sends shikigami inward from every direction at once rather than from one side.

---

## HP is the flock — Scatter & Recover

There is no HP bar. Taking a hit knocks **18% of the flying flock** loose (capped by
`scatterPerHit`). Scattered shikigami arc outward on a curve, settle, and sit there
pulsing softly for `scatterLifetime` (4.5s).

- Walk within `recoverRange` (5.5) → recovered.
- **Recall** → recovered, but only within `recoverRange × 2.5` (spec 25). A pull does not
  reclaim shikigami scattered across the arena.
- Neither, in time → they dim out and are **gone for good**.

So damage does not drain a number, it hands you a positioning problem, and solving it
moves you somewhere new — which sets up the next recall (spec 27).

You lose when nothing is left flying and nothing is left to recover.

---

## Shikigami

**通常の式** — an elongated, slightly asymmetric shard. Straight, sharp recall.

**騰蛇の式 (Tengja)** — the old "foxfire", renamed. ~17% of the flock, only a touch
cooler in colour. On recall it commits to an unspeared enemy within 18 units, swings
tangentially once close so it curves *around* rather than stalling, then reverts to the
normal return. The hunt window closes after 1.15s, so it always comes home.

**Not insects, and no permanent tails (v5.1 PART 2).** A constant trail on every small
white object read as a head-plus-tail creature, so:

- **trails are gone at rest.** They appear only while a shikigami is in RECALL *and*
  moving above 18 u/s, and they are much shorter than before (0.22s → 0.10s)
- **only ~45% of the flock shows a streak at all**, picked by a stable per-index hash, so
  a hundred identical tails never line up. The rest fly bare
- the trail is a residue of *speed*, not a body part — it fades the moment the shikigami
  arrives
- follow uses a *lazy* velocity response (inertia, wide curves), recall snaps to a much
  faster one; the resting swirl and vertical float were both slowed further
- the shape is a small comet shard: pointed nose, short tail, no body, no wings, no face

Group passage still leaves a **white ink residue** on the ground where a lot of shikigami
swept the same patch — that is separate from individual trails and is what carries the
"a big recall happened here" reading.

---

## Combat rhythm

### Rest — 休符

Constant pressure was tiring, so enemy pressure is **switched off for 2.5–4 seconds**
after a scripted beat is cleared, and a pause is force-fired if 38 seconds pass without
one. During a rest nothing spawns; the flock drifts back around the onmyoji and there is
time to look at it, check the count, and see what is coming.

Measured over a 3-minute passive run: **5 rests, average 2.7s** (2.5–3.4s).

> The trigger is "almost clear" (≤1 enemy alive), not zero. Waiting for a true zero meant
> the background trickle refilled the field first and the pause practically never fired.

Something changes every 45–60 seconds instead of the enemy count merely rising:

| time | beat | what it asks of you |
| --- | --- | --- |
| 0:00 | intro | learn release → move → recall |
| 0:45 | **RIFT** | one dense knot out of a single point — a fat recall line |
| 1:20 | **ELITE** | a big, slow, tough yokai; Gravity Core pays off |
| 2:15 | **ONI** (mid boss) | brought far forward so the run stops sagging |
| 3:15 | **FOUR DIRECTIONS** | pressure from every side — Spread answers it |
| 4:00 | **SWARM** | a cluster plus a line at once |
| 4:45 | **RIFT** | again, with a much larger flock |
| 5:30 | **ONI** (boss) | on top of a full field |

Formations, not new enemy types: cluster, line, four-directions, ring, moving column.

---

## 術式 — composing a formula

The mastery being tested is not damage, it is **preparation that connected** (spec 37-40).
A recall is recognised as a formula when it was the product of a chain:

| formula | condition |
| --- | --- |
| **CORE SETUP** | Gravity Core → recall within 5s → 50+ hits |
| **SPREAD SETUP** | Spread → recall within 4s → 40+ hits |
| **FULL SETUP** | both → recall within 6s → 70+ hits |

Feedback is restrained: stronger hit stop, a heavier impact, a longer white-ink smear,
and the hit counter gains a **frame** instead of getting louder. Debug shows
`術式成立 / SETUP`.

---

## Growth

30 → 150, paced so 100 lands around 4:30–5:00. Kills drop talismans: **small +1,
medium +3, large +5**. Measured bot run:

```
50 @ 1:25    75 @ 3:12    100 @ 4:52    108 at victory (5:55)
```

### The hundred — 百式

Crossing 100 is answered immediately rather than just noted:

1. a small **百式** mark, a low bell, one flash — no long level-up sequence
2. **3 seconds of forced quiet** while the flock gathers and the player looks at it
3. then **百鬼**: a long column driving away from the player plus a dense knot on each
   flank — ~34 enemies arranged so a single recall line sweeps the lot

It is tuned as power fantasy, not as a difficulty spike: the point is to immediately want
to use the hundred you just finished growing.

> The milestone is checked **every frame**, not on pickup. `activeCount` is recomputed
> inside the swarm update, so testing it at collect time read a stale value and the
> milestone could be missed entirely.

---

## Logging

**Every PLAY mints a fresh UUID** at run start (not page load), and the default export is
**EXPORT CURRENT SESSION** — this run only, as a single `session` object.
`EXPORT ALL SESSIONS` is the debug-only alternative. Stored under
`shikigami_flow_logs_v5_1`, tagged `prototype_v5_1`.

A run is **finalised exactly once**: victory and the end screen both route through the
same guard, the snapshot is pushed to history with de-duplication by `sessionId`, and
`finalized: true` is written into the log. The console prints `NEW SESSION`,
`SESSION FINALIZED` (with Recall / Dash / Spread / Gravity / Orbit) and
`EXPORT CURRENT SESSION`.

### What the bug actually was

Session **ID generation was already correct** — three consecutive runs produced three
unique ids before any change. The real fault was that **runs almost never finalised**:
the only defeat condition was an empty flock, and a recall recovered every scattered
shikigami *at any distance*, so nothing was ever permanently lost and the run could not
end. Nothing reached history, `result` stayed `"incomplete"` for every session, and
`EXPORT ALL SESSIONS` (plus leftover `…_v4` / `…_v3` storage keys from earlier builds)
was the only thing with content in it — which is what looked like "old sessions being
exported".

Fixed by honouring spec 25 properly: a recall now reclaims scattered shikigami only
within `recoverRange × 2.5`. Damage can now cost you the run, and runs finalise.

### Three-run verification

| run | session id | result | finalized | dash | spread | gravity | LMB | scattered → recovered / lost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `e5299df9` | defeat | ✔ | 1 | 2 | 1 | 3 | 48 → 16 / 32 |
| 2 | `177efc7a` | defeat | ✔ | 2 | 3 | 1 | 4 | 40 → 9 / 31 |
| 3 | `f6334a63` | incomplete | – | 3 | 4 | 1 | 5 | 69 → 52 / 17 |

Counters match the scripted inputs exactly, ids are unique, history holds only the two
finalised runs with no duplicates, and every export was a single `session` object.

Recorded: session · growth (`timeTo50/75/100/125/150`) · recall · **spread**
(`spreadUses`, `spreadToRecallCount`, `averageRecallHitsAfterSpread`,
`successfulSpreadSetups`) · **gravity** (`gravityUses`, `avgShikigamiAttracted`,
`maxShikigamiAttracted`, `gravityToRecallCount`, `averageRecallHitsAfterGravity`,
`successfulGravitySetups`) · **orbit** (`orbitPickups`, `totalOrbitDuration`,
`recallsDuringOrbit`, `hitsFromOrbitStateRecall`) · **scatter** (`damageEvents`,
`totalShikigamiScattered/Recovered/Lost`, `averageRecoverTime`, `recoveryRate`) ·
**formula** (`coreSetupSuccesses`, `spreadSetupSuccesses`, `fullSetupSuccesses`) ·
騰蛇 · plus every recall individually.

Console: `SHIKIGAMI.logs()`, `SHIKIGAMI.exportCurrent()`, `SHIKIGAMI.exportAll()`.

---

## Performance

CPU per frame, worst case (mid-recall, 10 enemies), render stubbed:

| shikigami | ms/frame |
| --- | --- |
| 30 | 0.074 |
| 100 | 0.126 |
| 150 | 0.199 |

---

## Not in this build

Spider Bind is **disabled, not deleted** — `SPIDER_ENABLED = false` in `runConfig.ts`,
with its parameters parked in `core/spiderLegacy.ts`. Also absent, per spec 48/49:
elements, status effects, 反閇, 方違え, skill trees, story, permanent progression.

---

## Growth milestones

`timeTo50 / 75 / 100 / 125 / 150` record **the first moment the live flock was ≥ n**.
Overshooting records it (98 → 103 sets `timeTo100`), crossing several at once gives them
one shared timestamp, and a later drop never clears one. `growthEvents` carries one
`reach_n` entry each, with the real count at that moment.

Two peak figures are logged, and they mean different things:

| field | meaning |
| --- | --- |
| `maxShikigamiReached` | biggest the **live flock** ever got — the HUD number. Milestones are read off this. |
| `totalShikigamiGrown` | most shikigami ever **allocated**, losses included. Always ≥ the above. |

> **The bug this fixes.** The milestones were read from the live flock while
> `maxShikigamiReached` was read from the allocated total — two different numbers. A lost
> shikigami leaves the flock but never frees its slot, so the reported peak ran ahead of
> anything the milestones could see, and a run could report a peak of 141 with
> `timeTo100: null`. The `>=` comparison was never the problem; it had been correct all
> along. Both figures now come from the same number, so `maxShikigamiReached >= n` implies
> `timeToN` is set — and `finalize()` asserts exactly that, logging `console.error` if it
> ever breaks again.

---

## Fixed after the v9 review

An external review of the v9 tree turned up seven defects. All seven were
reproduced before being touched and measured again afterwards.

### The arena could run three bosses at once

Three separate places wrote straight into `this.boss` — the 135 s mid-boss beat,
the automatic Oni at 195 s / 75 shikigami, and the 330 s boss beat — while the
Oni already on the field stayed alive in `enemies`. The HUD bar, the Perfect
Dodge check and every boss statistic followed whichever came last; the earlier
Oni went on hitting the player, unrecorded.

Victory made it worse. It was decided by `time >= 300`, so killing *any*
leftover boss late in a run ended it — including a Kyoto location boss.

There is now one Oni at a time and each carries a **role**:

| role | comes from | killing it |
| --- | --- | --- |
| `mid` | the 135 s beat | drops loot, nothing else |
| `final` | the automatic spawn / the 330 s beat | ends the run |
| `location` | a Kyoto location, the tutorial's dash step | drops loot, nothing else |

> The first version of this fix made things worse, and the long-run measurement
> caught it. Refusing to spawn while a boss stands meant a mid-boss the player
> never killed blocked the real Oni **forever** — a measured run reached 342 s
> with 82 enemies on the field and no climax. A mid-boss still standing when the
> real Oni is due is now **promoted** rather than replaced: same fight, HP left
> where it is, role upgraded. Measured: `mid@135 → final@195`, one Oni
> throughout. A player who kills the mid-boss in time still meets a fresh 1200.

### The game kept playing behind the end screen

`ended` gated the player's actions and wave spawning — and nothing else. The
swarm, enemies, pickups, combat and cooldowns all kept ticking, so the field the
player was looking at drifted away from the numbers they were reading, and an
abandoned tab simulated forever. Measured after the fix: 30 s of frames on the
end screen change the clock, enemy count, damage and player position by nothing
at all.

### Kyoto rewards followed the player into the next run

Location rewards write into the module-global `v5`, which outlives the `Game`.
Clearing the shrine three times left `orbitDuration` at 6.5 → 11.232 for every
arena and tutorial run afterwards. The two keys a reward can touch are now
captured before the first one lands and restored on `dispose()`; the debug
sliders are untouched. Measured: 6.5 → 11.232 during the Kyoto run → **6.5** in
the next one.

### Losing a Kyoto fight counted as clearing it

`endGame` called `journey.closeCurrent()` for victory *and* defeat, and that
method only had a success path — so dying on the bridge incremented
`locationsCleared`, logged `locationCombatEnded` and handed out the location's
reward. A defeat now records `locationCombatAborted` and keeps the combat stats
(how long they lasted and what it cost is the interesting part) while awarding
nothing.

### The log had two clocks

Gameplay ran on capped, hit-stop-scaled delta time; `playDuration` and every
recall timestamp came from `Date.now()`. A backgrounded tab pulled them minutes
apart. Everything is stamped against the simulation clock now, and the real
elapsed time is kept alongside it as `wallDuration` rather than thrown away.
Measured on a fast-forwarded run: `playDuration 42.98` / `wallDuration 0.74`,
where the old build would have reported 0.74 next to wave times of ~43.

### The tutorial's hand-off could hijack a later choice

Finishing the tutorial scheduled `setTimeout(() => startRun('arena'), 900)` with
nothing able to cancel it, so going to the menu inside that second disposed the
new state and forced the arena. A run token guards it. Measured: menu still
showing 1.4 s later, and the normal hand-off still lands in the arena.

### The mid-encounter lull ate enemies

The Kyoto breather advanced `released` to 62 % of the budget instead of setting a
flag, silently deleting every enemy in between — so encounters were smaller than
their `LocationDef.budget` and the pacing numbers described a fight that never
happened. Now a one-shot flag. Measured across all five locations: every one
releases its full budget (30/36/40/38/62), still with exactly one lull.

### The power fantasy is unchanged

Same synthetic recall measured on both builds, 8 runs each:

| | mean kills | range |
| --- | --- | --- |
| before | 17.63 | 14–21 |
| after | 17.75 | 15–20 |

The first single sample looked like a 22 → 16 regression. It was run-to-run
variance, and it is the reason the table above exists.

---

## Changed in v5.2

Behaviour only. No new abilities, no growth/tengja/dash/recall/scatter/enemy changes.

**Gameplay**
- `src/entities/shikigami.ts` — `SFormation` / `SCombat` split out from `SState`;
  `LOOSE` renamed `WAIT`; per-agent `formation` array; orbit removed from `isDamaging`;
  spread graze added; gravity now steers `WAIT`; `heldFromWait`; `stateName` reports
  behaviour only, `formationName` reports the modifier.
- `src/systems/combat.ts` — new `updateOrbitRing()` (band collision, per-enemy tick);
  `record()` extracted; `light` aggregate flag; graze knockback cut to 0.5.
- `src/entities/gravityCore.ts` — tracks `maxFromWait`.
- `src/game.ts` — orbit band mesh + `updateOrbitBand()`; combat now receives the player
  position; gravity debug stats.
- `src/core/v5Params.ts` — `spreadContactDamage`, `orbitTickInterval`; `orbitDamage`
  is now damage **per ring tick** (0.55 → 2.0) and re-labelled.
- `src/core/fx.ts`, `index.html` — `light` damage-number style; debug rows.

**Logging**
- `src/log/playLogger.ts` — `orbitContactHits/Damage`, `spreadContactHits/Damage`,
  `totalShikigamiAttracted`, `shikigamiPulledFromWait`, `recallsWithin4Seconds`,
  `recallsWithin5Seconds`. Storage key bumped to `shikigami_flow_logs_v5_2`.

---

## Changed in v7

Kyoto is a layer **outside** the existing game, not a rewrite of it. Arena mode is
byte-for-byte the same experience.

**New** — `src/world/locations.ts` (map + route + rewards), `kyotoWorld.ts` (the
low-poly night city, ~14 draw calls), `journey.ts` (travel → combat → calm state
machine, owns the field, owns the metrics), `encounter.ts` (per-location spawn
geometry), `disturbance.ts` (Omen + Barrier).

**Changed** — `params.ts` (the capsule field and `clampToField`), `player.ts` /
`enemy.ts` / `shikigami.ts` / `gravityCore.ts` / `spiderBind.ts` (use the field),
`cameraRig.ts` (calm pull-back + look-ahead), `inkSurface.ts` / `inkAccent.ts`
(follow the field), `game.ts` (mode flag + wiring), `hud.ts` / `index.html`
(objective label, edge marker, mode buttons), `playLogger.ts` (`ExplorationLog`).

> **Q used to delete the city.** The world/omen/barrier teardown was anchored on
> `this.core?.dispose()` when it was added — a string that appears **twice** in
> `game.ts`, and the edit landed on the first one, inside the Gravity Core handler
> rather than inside `dispose()`. Every cast of Q removed the Kyoto group from the
> scene, so the town vanished and only the swarm and enemies were left. Teardown now
> lives in `dispose()`, and `retireCore()` is the single path that closes a core —
> which also fixed a second bug the same test caught: recasting Q before a core
> expired threw away that core's pull statistics, so `maxShikigamiAttracted` read 0
> after five casts.

> **Every part of a structure references `DECK_TOP`.** Sinking the deck without
> moving its railings left them floating 1.15 units above it, so the bridge read as
> though it were hovering. Posts and rails are now positioned from the same constant
> as the deck they stand on.

> **The bridge ate the flock.** Every walkable surface in Kyoto now tops out at
> `DECK_TOP` (0.15), below the shikigami flight height of 0.95. The bridge deck was
> a 1.1-unit slab resting on y=0, so its surface stood *above* the flock and the
> whole swarm spent the first encounter inside the geometry. The mansion veranda had
> the same fault waiting further along the route. (The floating shrine hall and torii
> were fixed in the same pass — they were sitting 3 and 4.5 units off the ground.)

> **Movement fix found on the way.** The old clamp killed *all* velocity on contact
> with the boundary. Harmless in a 40-unit circle; in a 300-unit corridor it turned
> a 23-second walk into a 38-second grind at a median 1.9 u/s. It now removes only
> the outward component, so you slide along a wall instead of sticking to it —
> median walking speed went back to the full 13.0 u/s.

---

## Changed in v5.3

Logging only. No gameplay, growth, enemy, VFX or balance changes.

- `src/log/playLogger.ts` — `GROWTH_MILESTONES` table; `markMilestone()` replaced by
  `updateGrowth()` (peak and milestones from one number); `growthEvents`;
  `totalShikigamiGrown`; `validateGrowth()` run at finalize.
- `src/game.ts` — calls `updateGrowth()`; passes `totalShikigamiGrown`; end screen shows
  PEAK and GROWN separately.

---

## Source layout

```
src/
  main.ts                    renderer, frame loop, start screen, run lifecycle
  game.ts                    the run: skills, damage, formula, logging, summary
  core/
    runConfig.ts             SType, timeline, control list, SPIDER_ENABLED
    v5Params.ts              every debug-tunable value
    spiderLegacy.ts          frozen params for the disabled skill
    params.ts / input.ts / cameraRig.ts / fx.ts / audio.ts
  entities/
    shikigami.ts             agent data, spread, orbit, scatter/recover, tengja homing
    gravityCore.ts           Q skill entity
    player.ts / enemy.ts / boss.ts
  systems/
    boidSystem.ts / combat.ts / recallSystem.ts
    waveDirector.ts          the timeline and enemy formations
    formula.ts               術式 detection
    pickups.ts               spirit and ring talismans
    spiderBind.ts            disabled
  vfx/
    swarmVfx.ts              per-shikigami glow + trails
    inkAccent.ts             swarm-passage afterimage
    inkSurface.ts            world-pinned Canvas2D ink layer
  ui/hud.ts, ui/debugPanel.ts
  log/playLogger.ts
```

---

## Walking pace in Kyoto

Out of combat the onmyoji walks at **1.3×** (measured 16.7 u/s against 13.0 in a
fight). It eases up over about a second when a fight ends and snaps straight back
the moment one starts — dawdling out of an encounter is fine, being slow the
instant one begins is not.

---

## Recall sweeps its own path

A recall reclaims scattered shikigami within `recoverRange × 2.5` (13.75) — measured
from the **whole recall line**, not from the caster.

That distinction was a bug for a long time. Reach was measured from the player alone,
so a flock parked on a gravity core streamed home *straight through* its own scattered
shikigami and left every one of them to expire. Using the placement skill therefore
converted each hit taken into permanent losses, and the numbers were stark:

| same bot, same route | lost | recovery | outcome |
| --- | --- | --- | --- |
| never casts Q — before | 54 | 0.90 | survived |
| casts Q — **before** | **90** | **0.66** | **defeat at 83 s** |
| never casts Q — after | 29 | 0.93 | survived |
| casts Q — **after** | **30** | **0.97** | survived |

Q now costs the same as not casting it, and loss is still real: a 30-strong flock that
ignores its scattered shikigami still dies (defeat at 96 s, 31 lost, recovery 0.88), so
spec 25's requirement that a run can actually be lost still holds.

> Two narrower fixes were tried first and both were wrong. Scattering the *nearest*
> shikigami instead removed permanent loss almost entirely — a run that used to end in
> defeat survived three minutes at recovery 1.00. Tumbling distant ones back toward the
> caster helped the landing distance (20–30 → 11–13) but left the recovery gap at
> 0.66 vs 0.90, because the flaw was never where they landed; it was that the pull
> ignored everything it flew past.

---

## A note on the preview pane

If the game appears frozen — you press W and nothing happens — the page has been
backgrounded. Measured in that state: `document.hidden === true`, **0** `requestAnimationFrame`
callbacks in 2 seconds, and `setInterval(…, 16)` throttled to **1.3 Hz**. Input still
registers (the key shows up in `Input.keys`); nothing is ticking. There is no in-page
workaround worth having — a timer fallback would run at about 1 fps — so the fix is to
click into the game view and keep it foregrounded.

---

## Known issues

0. **Scatter is now genuinely lethal, and that is a balance change.** Limiting recall
   recovery to `recoverRange × 2.5` is what makes a run finishable, but it also means
   ignoring scattered shikigami permanently costs them (31–32 lost per run in the
   verification above). If that turns out to feel punishing rather than motivating,
   `recoverRange` and `RECALL_REACH` are the two knobs.
1. **SPREAD SETUP fires far more often than CORE SETUP** — a scripted run got 25 spread
   setups, 11 full, and only **2** core setups. Partly the bot (it spreads immediately
   before every recall), but the 40-hit threshold also sits *below* the average recall
   (48 hits), so the spread formula is nearly automatic once the flock is large. The
   thresholds probably need to scale with flock size rather than being fixed.
2. **Recall hit counts inflate with swarm size.** `hits` counts every pass-through across
   every enemy, so at 100+ shikigami the 50/100 tiers fire on most pulls. Counting
   *pierced enemies* would be steadier than raw hits.
3. **Gravity Core takes the whole flock**, not part of it. That is what makes it legible,
   but a mistimed core leaves you with nothing around you — the one place a technique can
   still interrupt the basic loop rather than serve it.
5. **GPU cost is unmeasured** — the table above stubs out rendering. Additive trails over
   a large area are the likely bottleneck.
6. **The mid boss and the boss are the same Oni**, differing only in HP (900 vs 1800),
   including its front guard.

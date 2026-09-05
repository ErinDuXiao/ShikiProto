import * as THREE from 'three';
import { ARENA_RADIUS, params, resetField, setField } from './core/params';
import { v5 } from './core/v5Params';
import { RUN, SType, type GameMode } from './core/runConfig';
import { Input } from './core/input';
import { CameraRig } from './core/cameraRig';
import { Fx } from './core/fx';
import type { Sfx } from './core/audio';
import { Player } from './entities/player';
import { ShikigamiManager } from './entities/shikigami';
import { EnemyBase, Yokai, resetEnemyIds, type EnemyWorld } from './entities/enemy';
import { Oni } from './entities/boss';
import { GravityCore } from './entities/gravityCore';
import { CombatSystem } from './systems/combat';
import { RecallSystem } from './systems/recallSystem';
import { PickupSystem } from './systems/pickups';
import { WaveDirector } from './systems/waveDirector';
import { FormulaTracker } from './systems/formula';
import { Tutorial, markTutorialCompleted, resetTutorial, type StepId } from './systems/tutorial';
import { InkAccent } from './vfx/inkAccent';
import { KyotoWorld } from './world/kyotoWorld';
import { Journey } from './world/journey';
import { Omen, Barrier } from './world/disturbance';
import { START, rewardHooks, type LocationDef } from './world/locations';
import { PlayLogger, type PlayLog } from './log/playLogger';
import type { Hud } from './ui/hud';
import type { DebugPanel } from './ui/debugPanel';

/**
 * How far down the road the camera leans while walking (spec 29).
 *
 * Small on purpose. The view only reaches ~45 units past the player, so every
 * unit of lean pushes the onmyoji visibly down the frame; at 24 the player and
 * the whole flock fell off the bottom of the screen. The far-off disturbance is
 * the edge marker's job, not the camera's.
 */
const LOOK_AHEAD = 9;

/** when the Oni arrives if the flock has not got there first (v10 spec 7) */
const ONI_TIME = 210;
const ONI_SHIKIGAMI = 80;
/** how long after a dash its i-frames still count for a dodge (v10 spec 22) */
const DODGE_GRACE = 0.22;
/**
 * The attack has to have been aimed at the player rather than happening
 * elsewhere. This is deliberately a range and not a "the hitbox brushed your
 * collision" test: the charge travels 18 units THROUGH where the player was
 * standing, so a dodge that works ends with the two of them far apart --
 * measured, a clean sideways dash leaves 13 to 27 units between them. Judging
 * on proximity would credit the player who never moved and deny the one who
 * did. The discrimination lives in the timing instead, which is measurable:
 * dashing early or late scores nothing.
 */
const DODGE_NEAR = 14;
const SEND_MIN = 10;
const SEND_MAX = 18;

/**
 * Prototype v5.
 *
 * The swarm grammar is 放つ / 広げる / 集める / 呼ぶ — release, spread, gather,
 * recall. Spread and Gravity Core exist to make the recall better, never to
 * replace it, and damage is paid for in shikigami rather than in an HP bar.
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;

  private input: Input;
  private fx: Fx;
  private player: Player;
  private swarm: ShikigamiManager;
  private combat: CombatSystem;
  private recall = new RecallSystem();
  private pickups: PickupSystem;
  private waves = new WaveDirector();
  private formula = new FormulaTracker();
  private ink: InkAccent;
  private logger = new PlayLogger();
  private enemies: EnemyBase[] = [];
  private boss: Oni | null = null;
  /**
   * What the Oni currently on the field is FOR.
   *
   * There are three places an Oni can come from -- the 135s mid-boss beat, the
   * automatic arena spawn, and a Kyoto location -- and each one used to write
   * straight into `this.boss`. Overlapping spawns left the earlier Oni alive
   * but untracked, and because victory was decided by `time >= 300`, killing
   * any leftover boss late in a run ended it. The role decides that now.
   */
  private bossRole: 'mid' | 'final' | 'location' | null = null;
  private core: GravityCore | null = null;

  private time = 0;
  private ended = false;
  private finishTimer = -1;
  private movedOnce = false;
  private milestoneShown = false;
  private lastLog: PlayLog | null = null;
  private world: EnemyWorld;

  /** ground band showing exactly where the orbit formation cuts (spec 1) */
  private orbitBand: THREE.Mesh;
  private bandInner = 1;
  private bandOuter = 1.2;
  // --- Kyoto layer (v7). Null in arena mode, so the old test path is intact.
  private kyoto: KyotoWorld | null = null;
  private journey: Journey | null = null;
  private omens: Omen[] = [];
  private barrier: Barrier | null = null;
  private locationBanner = 0;
  // --- the arena Oni (v9). Trash stays the power fantasy; this is the part
  // that asks the player to move (spec 3/6).
  private tutorial: Tutorial | null = null;
  private tutorialKills = 0;
  private oniSpawned = false;
  private oniStart = 0;
  private oniRecallHits = 0;
  private oniRecallDamage = 0;
  private bossDamageAtSpawn = 0;
  private gravityCd = 0;
  private spreadCd = 0;
  private recallStartedInOrbit = false;
  private tmpDir = new THREE.Vector3();

  onEnd?: (victory: boolean) => void;
  /**
   * Fired after this run has actually put a frame on screen.
   *
   * The curtain is raised from here rather than from a requestAnimationFrame
   * callback in main.ts: rAF is what drives the render in the first place, so
   * hooking the reveal to a real drawn frame is both more accurate and immune
   * to a hidden tab, where a bare rAF callback measured 0 frames per second and
   * would have left the player looking at black.
   */
  onFirstFrame?: () => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private hud: Hud,
    private debug: DebugPanel,
    private sfx: Sfx,
    readonly mode: GameMode = 'arena',
  ) {
    resetEnemyIds();
    resetField();
    // every timestamp in the log is measured against the simulation clock, not
    // the wall clock, so a backgrounded tab cannot desynchronise them
    this.logger.clock = () => this.time;
    this.scene.background = new THREE.Color(0x05060a);
    // Kyoto needs to see the next disturbance from the far end of a street, so
    // the fog has to reach much further than the arena's did.
    this.scene.fog = new THREE.Fog(0x05060a, this.kyotoMode ? 130 : 48, this.kyotoMode ? 620 : 135);
    if (this.kyotoMode) this.kyoto = new KyotoWorld(this.scene);
    else this.buildArena();

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.input = new Input(renderer.domElement);
    this.fx = new Fx(this.scene);
    this.player = new Player(this.scene);
    this.swarm = new ShikigamiManager(this.scene, this.player);
    this.combat = new CombatSystem(this.swarm, this.fx, this.sfx, this.rig.camera, this.recall);
    this.pickups = new PickupSystem(this.scene, this.fx, this.sfx);
    this.ink = new InkAccent(this.scene);

    // The ring's damage belongs to the formation, so the formation needs an
    // edge the player can read. Kept faint: the shikigami are still the ring.
    this.orbitBand = new THREE.Mesh(
      bandGeometry(1, 1.2),
      new THREE.MeshBasicMaterial({
        color: 0xdfe8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.orbitBand.visible = false;
    this.scene.add(this.orbitBand);

    this.player.onDash = () => {
      this.lastDashAt = this.time;
      this.logger.dashCount++;
      this.tutorial?.noteDash();
      this.swarm.notifyDash();
      this.fx.ring(this.player.pos.x, this.player.pos.z, 0.5, 4.5, 0.28, 0x9fd8ff);
      this.sfx.dash();
    };
    this.swarm.onSpawn = (x, z) => this.fx.burst(x, 1.1, z, 6, 0xffffff, 5, 0.4);
    this.swarm.onRecover = (x, z) => {
      this.fx.burst(x, 0.8, z, 5, 0xdfe8ff, 4, 0.35);
      this.sfx.send();
    };
    this.swarm.onLost = (x, z) => this.fx.burst(x, 0.6, z, 4, 0x3a3a44, 2, 0.5);
    this.combat.onKill = (e) => this.handleKill(e);
    this.combat.onHit = (e, dmg, isRecall) => this.noteBossHit(e, dmg, isRecall);

    this.pickups.onCollect = (value, kind) => {
      if (kind === 'orbit') {
        this.swarm.startOrbit();
        this.logger.orbitPickups++;
        this.logger.totalOrbitDuration += v5.orbitDuration;
        this.hud.showSkill('輪符  ORBIT');
        return;
      }
      const added = this.swarm.grow(value, this.player, this.time);
      this.logger.pickupsCollected++;
      if (added > 0) this.hud.showPop('霊札 +' + added, this.swarm.activeCount);
    };

    this.waves.onSpawn = (r) => this.spawnYokai(r.x, r.z, r.elite === true);
    this.waves.onEvent = (e) => {
      if (e.label) this.hud.showBanner(e.label, 2.0);
      this.fx.shake(0.25);
    };
    this.waves.onRest = () => {
      // no UI shout; the quiet is the message
      this.hud.hideBanner();
    };
    // The scripted boss beat and the growth-driven spawn are the same event, so
    // they share one idempotent entry point rather than racing each other.
    this.waves.onBoss = () => this.spawnArenaOni();

    this.world = {
      playerPos: this.player.pos,
      fx: this.fx,
      sfx: this.sfx,
      hitPlayer: (dmg, from) => this.hitPlayer(dmg, from),
      vacuum: () => {
        /* not used in v5 */
      },
    };

    this.hud.reset();
    this.hud.setSwarm(this.swarm.activeCount, 0, Math.round(v5.maxShikigami));
    // after hud.reset(), which clears the objective line
    if (this.kyotoMode) this.setupJourney();
    this.hud.setControlsVisible(!this.tutorialMode);
    this.hud.setSkillPipsVisible(!this.tutorialMode);
    if (this.tutorialMode) this.setupTutorial();
    this.debug.onBossSandbox = () => this.spawnArenaOni();
    this.debug.onResetTutorial = () => resetTutorial();
    this.debug.onExportCurrent = () => this.exportCurrent();
    this.debug.onExportAll = () => PlayLogger.downloadAll();
    if (this.mode === 'arena') this.hud.showReminder(45);
    if (!this.tutorialMode) {
      this.hud.showBanner(
        this.kyotoMode ? '境が、またひとつ破れた。' : 'Release → Position → Recall',
        this.kyotoMode ? 4.0 : 5.0,
      );
    }
  }

  get kyotoMode(): boolean {
    return this.mode === 'kyoto';
  }

  get tutorialMode(): boolean {
    return this.mode === 'tutorial';
  }

  // ------------------------------------------------------------- tutorial

  private setupTutorial() {
    const t = new Tutorial();
    t.onSetup = (step) => this.buildTutorialStep(step);
    t.onStepChange = (step, view) => {
      this.hud.setLesson(view.title, view.key, view.action);
      // the cooldown pips only appear once their abilities have been taught
      if (step === 'gravity') this.hud.setSkillPipsVisible(true);
      if (step !== 'move') this.sfx.send();
    };
    t.onComplete = () => {
      markTutorialCompleted();
      this.beginTutorialOutro(true);
    };
    this.hud.setSkipVisible(true, () => {
      t.skip();
      markTutorialCompleted();
      // leaving early skips the send-off too, but still gets the curtain --
      // a hard cut into the arena reads as a crash
      this.beginTutorialOutro(false);
    });
    this.tutorial = t;
    t.begin(this.player.pos);
  }

  /**
   * Seconds since the last lesson was answered. -1 while the tutorial is still
   * being played.
   *
   * The tutorial is onboarding, not a mode with a win state, so it does not end
   * on a VICTORY screen, a fanfare or a stat readout. It ends the way a lesson
   * ends: the field empties, the flock comes home, one bell, one small line,
   * and then the arena. The player should be thinking "right, now the real
   * thing", not "I won".
   */
  private tutorialOutro = -1;

  /** the beats of that send-off, in seconds from the last lesson */
  private static readonly OUTRO = {
    /** the flock has reached the player and settles back into formation */
    settle: 0.6,
    /** the line has been up long enough to read */
    hold: 2.1,
    /** the curtain is fully down and the arena can take over */
    done: 3.0,
  };

  private beginTutorialOutro(completed: boolean) {
    this.hud.setLesson('', '', '');
    this.hud.setSkipVisible(false);
    this.hud.hideBanner();
    if (!completed) {
      // skipped: straight to the curtain, no send-off they did not earn
      this.tutorialOutro = Game.OUTRO.hold;
      return;
    }
    // the shikigami come back to the player -- the last thing they see before
    // the line is their own flock reforming, not a results panel
    this.swarm.beginRecall(this.time, this.player.pos.x, this.player.pos.z);
    this.sfx.bell();
    this.hud.showOutro('The shikigami are your weapon.');
    this.tutorialOutro = 0;
  }

  /**
   * Each step builds the smallest situation that makes its lesson true. The
   * enemies here are ordinary yokai with their HP left alone -- the tutorial
   * teaches geometry, not a special-cased scenario.
   */
  private buildTutorialStep(step: StepId) {
    // The recall step deliberately inherits the dummy the previous step
    // placed. Clearing the field on every step wiped the very enemy the
    // player was being asked to pull through.
    if (step !== 'recall') {
      for (const e of this.enemies) e.alive = false;
      this.reapEnemies();
    }
    const p = this.player.pos;

    switch (step) {
      case 'move':
        break;
      case 'release':
        break;
      case 'between': {
        // one dummy dropped between the player and where the flock went
        const c = this.swarm.swarmCenter;
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        this.spawnDummy(p.x + (dx / d) * 9, p.z + (dz / d) * 9);
        break;
      }
      case 'recall':
        break;
      case 'dash':
        // the real Oni, so the tell the player learns here is the one they
        // will meet in the arena (spec 25). 'location' rather than 'final':
        // killing it teaches the dodge, it does not win the tutorial.
        this.spawnOni('location');
        break;
      case 'gravity':
        for (let i = 0; i < 4; i++) {
          const a = -0.5 + i * 0.33;
          this.spawnDummy(p.x + Math.cos(a) * 17, p.z + Math.sin(a) * 17);
        }
        break;
      case 'spread':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.spawnDummy(p.x + Math.cos(a) * 7.5, p.z + Math.sin(a) * 7.5);
        }
        break;
      case 'final':
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 14 + Math.random() * 10;
          this.spawnDummy(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        }
        break;
    }
  }

  /** a plain yokai, unmodified; the tutorial never softens the enemy */
  private spawnDummy(x: number, z: number) {
    this.spawnYokai(x, z, false);
  }

  private updateTutorial(dt: number) {
    const t = this.tutorial;
    if (!t) return;

    if (this.tutorialOutro >= 0) {
      const was = this.tutorialOutro;
      this.tutorialOutro += dt;
      const now = this.tutorialOutro;
      const crossed = (m: number) => was < m && now >= m;
      const O = Game.OUTRO;
      if (crossed(O.settle)) this.swarm.endRecall();
      if (crossed(O.hold)) {
        this.hud.hideOutro();
        this.hud.setFade(1, O.done - O.hold);
      }
      if (now >= O.done) {
        this.tutorialOutro = -1;
        // quiet: the run is still logged, it just does not announce itself
        this.endGame(true, true);
      }
      return;
    }
    if (t.done) return;

    // "the enemy is between me and my flock" -- the one idea being taught
    const c = this.swarm.swarmCenter;
    let behind = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = distToSegment(e.pos.x, e.pos.z, this.player.pos.x, this.player.pos.z, c.x, c.z);
      if (d < e.radius + 3.5) behind = true;
    }
    t.update(dt, this.player.pos, this.aliveCount(), behind, this.player.dashCount);
    if (t.step === 'release') t.noteRelease(this.swarm.looseCount);
  }

  /**
   * Kyoto rewards write into the module-global `v5`, which outlives the run.
   * Clearing the shrine three times used to leave orbitDuration at 1.2^3 for
   * every arena and tutorial run afterwards. The values are captured once,
   * before the first reward lands, and put back in dispose(). Only the two
   * keys a reward can touch are restored, so the debug sliders are unaffected.
   */
  private rewardBaseline: { orbitDuration: number; tengjaRatio: number } | null = null;

  private captureRewardBaseline() {
    if (this.rewardBaseline) return;
    this.rewardBaseline = { orbitDuration: v5.orbitDuration, tengjaRatio: v5.tengjaRatio };
  }

  // ----------------------------------------------------------- Kyoto wiring

  private setupJourney() {
    this.player.pos.set(START.x, this.player.pos.y, START.z);
    this.player.group.position.copy(this.player.pos);
    this.omens = [new Omen(this.scene), new Omen(this.scene)];
    this.barrier = new Barrier(this.scene);

    // rewards are applied by the location itself; these are the only hooks it
    // is allowed to reach into the engine through (spec 19)
    rewardHooks.orbitDuration = (mul) => {
      this.captureRewardBaseline();
      v5.orbitDuration *= mul;
    };
    rewardHooks.tengjaRatio = (add) => {
      this.captureRewardBaseline();
      v5.tengjaRatio = Math.min(0.6, v5.tengjaRatio + add);
    };

    const j = new Journey();
    j.probe = () => ({
      recallCount: this.logger.recallCount,
      maxRecallHits: this.combat.totals.largestRecallShikigamiCount,
      gravityUses: this.logger.gravityUses,
      spreadUses: this.logger.spreadUses,
      damageTaken: this.logger.damageTaken,
      enemiesKilled: this.combat.totals.enemiesKilled,
      shikigamiLost: this.swarm.totalLost,
      shikigami: this.swarm.activeCount,
    });
    j.onSpawn = (r) => this.spawnYokai(r.x, r.z, r.elite === true);
    j.onBoss = () => this.spawnOni('location');
    j.onArrive = (loc) => this.arriveAt(loc);
    j.onCleared = (loc) => this.clearedAt(loc);
    j.onDepart = (to) => this.departFor(to);
    j.onFinish = () => {
      if (!this.ended) this.endGame(true);
    };
    this.journey = j;

    // the first disturbance is already glowing when the run starts
    this.departFor(j.targets);
  }

  private arriveAt(loc: LocationDef) {
    this.barrier?.raise(loc.ground);
    for (const o of this.omens) o.hide();
    this.ink.recenter(loc.x, loc.z);
    this.hud.showBanner(loc.name, 2.2);
    this.hud.setObjective(loc.name, loc.reading);
    this.locationBanner = 2.6;
    this.fx.shake(0.45);
    this.fx.screenFlash(0.08);
    this.sfx.recallStart();
    // pull the player onto the fighting ground if they clipped the edge
    setField(loc.ground.ax, loc.ground.az, loc.ground.bx, loc.ground.bz, loc.ground.radius);
  }

  private clearedAt(loc: LocationDef) {
    this.barrier?.drop();
    this.hud.showBanner('鎮', 1.6);
    this.sfx.seal();
    this.fx.ring(loc.x, loc.z, 1, loc.ground.radius * 1.6, 0.9, 0xdfe8ff);
    if (loc.reward) {
      this.hud.showSkill(loc.reward.label + '  ' + loc.reward.blurb);
    }
  }

  private departFor(to: LocationDef[]) {
    // both roads light up at a fork; the player picks by walking (spec 17)
    for (let i = 0; i < this.omens.length; i++) {
      const t = to[i];
      if (t) this.omens[i].show(t.x, t.z);
      else this.omens[i].hide();
    }
    const next = to[0];
    if (to.length > 1) {
      this.hud.setObjective(to.map((t) => t.name).join('  /  '), 'CHOOSE A ROAD');
      this.hud.showBanner(to.map((t) => t.name).join('  ·  '), 2.4);
    } else if (next) {
      this.hud.setObjective(next.name, next.reading);
    }
  }

  // ------------------------------------------------------------------ setup

  private buildArena() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS + 2, 72),
      new THREE.MeshStandardMaterial({ color: 0x0a0b12, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(ARENA_RADIUS * 2, 32, 0x1c2436, 0x141a28);
    grid.position.y = 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    for (const [r, o] of [
      [ARENA_RADIUS, 0.35],
      [ARENA_RADIUS * 0.55, 0.14],
    ] as const) {
      const g = new THREE.RingGeometry(r - 0.14, r, 96);
      g.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color: 0x4a5878, transparent: true, opacity: o }),
      );
      ring.position.y = 0.02;
      this.scene.add(ring);
    }

    const mat = new THREE.MeshBasicMaterial({ color: 0x0c0d16 });
    const post = new THREE.BoxGeometry(0.55, 9, 0.55);
    const lintel = new THREE.BoxGeometry(7.4, 0.6, 0.6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const r = ARENA_RADIUS + 11 + (i % 3) * 5;
      const t = new THREE.Group();
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(post, mat);
        p.position.set(s * 2.9, 4.5, 0);
        t.add(p);
      }
      const l = new THREE.Mesh(lintel, mat);
      l.position.y = 9.1;
      t.add(l);
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      t.rotation.y = -a;
      this.scene.add(t);
    }

    this.scene.add(new THREE.HemisphereLight(0x2c3a58, 0x05060a, 0.9));
    const dir = new THREE.DirectionalLight(0xb8c8ff, 0.5);
    dir.position.set(-10, 24, -18);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0xff7a6a, 0.45);
    rim.position.set(14, 10, 12);
    this.scene.add(rim);
  }

  // ----------------------------------------------------------------- update

  update(dtRaw: number) {
    this.fx.update(dtRaw);
    const dt = this.fx.hitStop > 0 ? dtRaw * 0.06 : dtRaw;

    // The run is over: hold the world exactly as the log describes it and keep
    // only what the end screen needs. Previously enemies, combat, pickups and
    // the swarm all carried on behind the overlay, so the field the player was
    // looking at kept drifting away from the numbers they were reading -- and
    // an abandoned tab burned a full simulation forever.
    if (this.ended) {
      this.rig.update(dtRaw, this.player.pos, this.swarm.swarmCenter);
      this.fx.applyShake(this.rig.camera, this.time);
      this.hud.update(dtRaw, this.movedOnce);
      this.renderer.render(this.scene, this.rig.camera);
      this.rig.restore();
      return;
    }

    this.time += dt;

    this.input.updateAim(this.rig.camera);
    if (!this.ended && this.finishTimer < 0) this.handleActions();

    // Kyoto only: walk faster when nothing is trying to kill you (spec 47)
    this.player.setExploring(this.journey ? this.journey.phase !== 'combat' : false, dt);
    this.player.update(dt, this.input);
    if (!this.movedOnce && (Math.abs(this.player.vel.x) > 1 || Math.abs(this.player.vel.z) > 1)) {
      this.movedOnce = true;
    }

    // --- gravity core publishes the second swarm centre
    if (this.core) {
      this.core.update(dt, this.swarm.heldByCore, this.swarm.heldFromWait);
      if (this.core.pulling) {
        this.swarm.attractor = {
          x: this.core.pos.x,
          z: this.core.pos.z,
          radius: this.core.radius,
          strength: v5.gravityStrength,
        };
      }
      if (!this.core.alive) {
        this.retireCore();
        this.swarm.attractor = null;
      }
    } else {
      this.swarm.attractor = null;
    }

    this.swarm.update(dt, this.time, this.player, this.enemies, this.rig.camera);
    for (const e of this.enemies) if (e.alive) e.update(dt, this.world);
    this.pickups.update(dt, this.player);

    if (this.finishTimer < 0) {
      this.combat.update(dt, this.time, this.enemies, this.player.pos.x, this.player.pos.z);
    }
    else this.combat.flush(dt);

    this.ink.update(dt, this.swarm);
    this.reapEnemies();
    if (!this.ended && this.finishTimer < 0) {
      if (this.tutorialMode) {
        // the tutorial spawns exactly what each step needs; the wave director
        // would fight it for control of the arena
      } else if (this.journey) {
        // Kyoto drives its own pressure: the wave director is replaced by the
        // location the player chose to walk into (spec 1).
        this.journey.update(dt, this.time, this.player.pos, this.aliveCount());
        // once a fork is committed to, the road not taken goes dark
        const locked = this.journey.committed;
        if (locked && this.journey.phase === 'travel') {
          const opts = this.journey.targets;
          for (let i = 0; i < this.omens.length; i++) {
            if (opts[i] && opts[i].id !== locked) this.omens[i].hide();
          }
          if (opts.length > 1) {
            const chosen = opts.find((o) => o.id === locked);
            if (chosen) this.hud.setObjective(chosen.name, chosen.reading);
          }
        }
        for (const o of this.omens) o.update(dt, this.player.pos.x, this.player.pos.z);
        this.barrier?.update(dt);
        if (this.hundredEventAt > 0 && this.time >= this.hundredEventAt) {
          this.hundredEventAt = -1;
          this.hud.showBanner('百鬼', 1.8);
          this.fx.shake(0.5);
          this.sfx.bigHit(40);
        }
      } else {
        this.waves.update(dt, this.time, this.aliveCount(), this.player.pos);
        if (this.hundredEventAt > 0 && this.time >= this.hundredEventAt) {
          this.hundredEventAt = -1;
          this.waves.hundredEvent(this.player.pos);
          this.hud.showBanner('百鬼', 1.8);
          this.fx.shake(0.5);
          this.sfx.bigHit(40);
        }
      }
    }
    if (this.tutorialMode) {
      this.updateTutorial(dt);
      // The tutorial's send-off ends the run, and main.ts disposes this Game
      // and builds the next one from inside that call. Carrying on down this
      // frame would render a disposed scene and stamp stale numbers over the
      // HUD the new run has just set.
      if (this.disposed) return;
    } else {
      this.updateOni(dt);
      this.updateHints(dt);
    }
    this.updateFinish(dt);

    this.updateOrbitBand();
    // Out of combat the camera eases back a little, so the street and the whole
    // flock are visible while walking (spec 29).
    this.rig.setCalm(this.journey ? this.journey.phase !== 'combat' : false, dt);
    if (this.journey) {
      const t = this.journey.phase === 'travel' ? this.journey.target : null;
      if (t) {
        const dx = t.x - this.player.pos.x;
        const dz = t.z - this.player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const reach = Math.min(LOOK_AHEAD, d * 0.5);
        this.rig.setLookAhead((dx / d) * reach, (dz / d) * reach, dt);
      } else {
        this.rig.setLookAhead(0, 0, dt);
      }
      this.updateMarker(t);
    }
    this.rig.update(dt, this.player.pos, this.swarm.swarmCenter);
    this.fx.applyShake(this.rig.camera, this.time);

    this.gravityCd = Math.max(0, this.gravityCd - dt);
    this.spreadCd = Math.max(0, this.spreadCd - dt);
    this.hud.setSkills(this.spreadCd / Math.max(0.01, v5.spreadCooldown), this.gravityCd / v5.gravityCooldown);
    this.hud.setSwarm(this.swarm.activeCount, this.swarm.scatteredCount, Math.round(v5.maxShikigami));
    if (this.boss && this.boss.alive) this.hud.setBoss(this.boss.hp, this.boss.maxHp, this.boss.phase);
    if (!this.ended) this.hud.setTimer(this.time);
    this.hud.update(dtRaw, this.movedOnce);
    // Polled rather than fired from the pickup callback: activeCount is
    // recomputed inside swarm.update, so reading it at collect time gives a
    // stale value. Here the order is count changed -> flock recomputed ->
    // peak updated -> milestones checked (spec 6/7).
    this.logger.updateGrowth(this.swarm.activeCount, this.time);
    // checked every frame, not on pickup: activeCount is recomputed inside the
    // swarm update, so testing it at collect time reads a stale value and the
    // milestone could be missed entirely
    if (!this.ended) this.checkMilestone();

    // spec 26: the flock is the life bar now
    if (!this.ended && this.swarm.activeCount <= 0 && this.swarm.scatteredCount <= 0) {
      this.endGame(false);
    }

    if (this.journey && this.locationBanner > 0) this.locationBanner -= dtRaw;

    this.debug.update(dtRaw, {
      total: this.swarm.count,
      active: this.swarm.activeCount,
      loose: this.swarm.looseCount,
      scattered: this.swarm.scatteredCount,
      avgDistance: this.swarm.avgDistance,
      swarmSpeed: this.swarm.avgSpeed,
      state: this.swarm.stateName,
      formation: this.swarm.formationName,
      gravityActive: this.swarm.attractor !== null,
      pulled: this.swarm.heldByCore,
      pulledFromWait: this.swarm.heldFromWait,
      boss: this.oniStats(),
      extra:
        '騰蛇 ' + this.swarm.countOfType(SType.TENGJA) +
        ' · CORE ' + this.swarm.heldByCore +
        ' · 術式 ' + (this.formula.coreSuccesses + this.formula.spreadSuccesses + this.formula.fullSuccesses) +
        (this.journey ? ' · ' + this.journey.phase.toUpperCase() : ''),
    });

    this.renderer.render(this.scene, this.rig.camera);
    this.rig.restore();
    if (!this.drewOnce) {
      this.drewOnce = true;
      this.onFirstFrame?.();
    }
  }

  private drewOnce = false;
  private disposed = false;

  /**
   * Point at the disturbance while it is out of frame. Projected from the top
   * of the omen column, so the marker disappears the moment the light itself
   * comes into view and the world takes over again.
   */
  private updateMarker(t: LocationDef | null) {
    if (!t) {
      this.hud.setMarker(0, 0, 0, false);
      return;
    }
    const cam = this.rig.camera;
    this.tmpDir.set(t.x, 40, t.z).project(cam);
    const behind = this.tmpDir.z > 1;
    const sx = (this.tmpDir.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-this.tmpDir.y * 0.5 + 0.5) * window.innerHeight;
    const onScreen = !behind && Math.abs(this.tmpDir.x) < 1 && Math.abs(this.tmpDir.y) < 1;
    const dist = Math.hypot(t.x - this.player.pos.x, t.z - this.player.pos.z);
    if (onScreen) {
      this.hud.setMarker(0, 0, 0, false);
      return;
    }
    // clamp to the screen edge, keeping the direction
    const cx = window.innerWidth * 0.5;
    const cy = window.innerHeight * 0.5;
    let dx = sx - cx;
    let dy = sy - cy;
    if (behind) {
      dx = -dx;
      dy = -dy;
    }
    const mx = window.innerWidth * 0.5 - 34;
    const my = window.innerHeight * 0.5 - 44;
    const s = Math.min(mx / Math.max(1, Math.abs(dx)), my / Math.max(1, Math.abs(dy)));
    this.hud.setMarker(cx + dx * s, cy + dy * s, dist, true);
  }

  /** Close a gravity core out, keeping whatever it measured. */
  private retireCore() {
    const c = this.core;
    if (!c) return;
    this.logger.gravityPulledSum += c.averagePulled;
    this.logger.gravityPulledSamples++;
    if (c.maxPulled > this.logger.maxShikigamiAttracted) {
      this.logger.maxShikigamiAttracted = c.maxPulled;
    }
    this.logger.totalShikigamiAttracted += c.maxPulled;
    this.logger.shikigamiPulledFromWait += c.maxFromWait;
    c.dispose();
    this.core = null;
  }

  private updateOrbitBand() {
    const on = this.swarm.orbitTimer > 0;
    this.orbitBand.visible = on;
    if (!on) return;
    const inner = this.swarm.orbitInnerRadius;
    const outer = this.swarm.orbitOuterRadius;
    // the sliders can move both edges, so the band is rebuilt when they do
    if (Math.abs(inner - this.bandInner) > 0.01 || Math.abs(outer - this.bandOuter) > 0.01) {
      this.bandInner = inner;
      this.bandOuter = outer;
      this.orbitBand.geometry.dispose();
      this.orbitBand.geometry = bandGeometry(inner, outer);
    }
    this.orbitBand.position.set(this.player.pos.x, 0.05, this.player.pos.z);
    const mat = this.orbitBand.material as THREE.MeshBasicMaterial;
    // brightens for a moment whenever something is actually cut by it
    const since = this.time - this.combat.lastOrbitContact;
    const flash = Math.max(0, 1 - since / 0.22);
    mat.opacity = (0.075 + flash * 0.3) * Math.min(1, this.swarm.orbitTimer / 0.5);
  }

  /**
   * One quiet nudge per ability, and only when the situation calls for it
   * (spec 37). Never repeated -- a reminder that nags is worse than no
   * reminder.
   */
  private hintsShown = new Set<string>();
  private hintCd = 0;

  private updateHints(dt: number) {
    if (this.mode !== 'arena' || this.ended) return;
    this.hintCd -= dt;
    if (this.hintCd > 0 || this.time < 60) return;
    const busy = this.aliveCount() >= 5;
    const check: Array<[string, boolean, string]> = [
      ['gravity', this.logger.gravityUses === 0 && busy, '<b>Q</b> gathers your shikigami somewhere else'],
      ['spread', this.logger.spreadUses === 0 && busy, '<b>SPACE</b> opens the flock into a wide surface'],
      ['dash', this.logger.dashCount === 0, '<b>SHIFT</b> dashes you out of the way'],
    ];
    for (const [id, want, text] of check) {
      if (!want || this.hintsShown.has(id)) continue;
      this.hintsShown.add(id);
      this.hud.showHint(text);
      this.hintCd = 25;
      return;
    }
  }

  // ------------------------------------------------------------- arena Oni

  /**
   * Spawn condition and Perfect Dodge (spec 10/14).
   *
   * The dodge is deliberately generous about position and strict about timing:
   * you must be inside the dash's own i-frames while the attack is committed.
   * Reward is a longer opening, never damage.
   */
  private updateOni(dt: number) {
    void dt;
    if (this.mode !== 'arena' || this.ended || this.finishTimer >= 0) return;

    if (!this.oniSpawned) {
      // v10 spec 7: whichever comes first, but both later than v9's 195 s / 75.
      // Measured, the old pair had the Oni arriving mid-growth and the run
      // ending at ~222 s with the flock at 84 -- 100 shikigami was never
      // reachable. The player should meet the Oni already commanding 80+.
      if (this.time > ONI_TIME || this.swarm.activeCount >= ONI_SHIKIGAMI) this.spawnArenaOni();
      return;
    }

    const b = this.boss;
    if (!b || !b.alive) return;

    // v10 spec 22: the test is whether the attack's hitbox swept past the
    // player while the dash's i-frames were live -- not whether the two happen
    // to be close afterwards. The charge covers 18 units, so by the time it
    // stops, a player who dodged it WELL is the furthest away of anyone; the v9
    // distance check credited the player who stood still and denied the one who
    // actually moved.
    const dashFresh =
      this.player.dashInvulnerable || this.time - this.lastDashAt <= DODGE_GRACE;
    if (dashFresh) {
      const d = Math.hypot(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z);
      if (d < DODGE_NEAR) {
        b.noteDash();
        if (b.swinging && !b.perfectThisAttack) b.notePerfectDodge();
      }
    }
  }

  /** Debug / tutorial entry point too. Idempotent: the wave script and the
   *  automatic trigger both call it. */
  spawnArenaOni() {
    if (this.oniSpawned) return;
    this.oniSpawned = true;

    // A slow player can still be fighting the 135s mid-boss when the real Oni
    // becomes due. PROMOTE that fight rather than stacking a second Oni on top
    // of it -- and rather than waiting for a kill that might never come, which
    // measured out as a run reaching 340s with 82 enemies on the field and no
    // climax at all. Its HP is left where it is: a player who is behind should
    // not be handed a fresh 1200 to chew through.
    if (this.boss && this.boss.alive) {
      this.bossRole = 'final';
      this.hud.showBanner('鬼', 2.4);
      return;
    }

    this.spawnOni('final');
    this.waves.breathe(2.5);
    this.hud.showBanner('鬼', 2.4);
    this.fx.screenFlash(0.18);
    this.fx.shake(0.9);
  }

  private noteBossHit(e: EnemyBase, dmg: number, isRecall: boolean) {
    const b = this.boss;
    if (!b || e !== b || !isRecall) return;
    this.oniRecallHits++;
    this.oniRecallDamage += dmg;
  }

  /** damage this one pull put into the Oni, kept past flushBossRecall */
  private oniRecallDamageThisPull = 0;

  /** a pull landed on an Oni that was still planted: say so */
  private flushBossRecall() {
    const b = this.boss;
    if (b && b.recovering && this.oniRecallHits >= 12) {
      this.fx.stop(0.06);
      this.fx.shake(0.5);
      this.sfx.bigHit(this.oniRecallHits);
    }
    this.oniRecallDamageThisPull = this.oniRecallDamage;
    this.oniRecallHits = 0;
    this.oniRecallDamage = 0;
  }

  private oniStats() {
    const b = this.boss;
    if (!b || !b.alive) return null;
    return {
      hp: Math.round(b.hp) + ' / ' + b.maxHp,
      phase: b.phase,
      state: b.state.toUpperCase(),
      nextAttack: b.nextAttack,
      recovering: b.recovering,
      perfectDodges: b.perfectDodges,
      chargeDodges: b.chargeDodges,
      counterRecalls: b.counterRecalls,
    };
  }

  private bossLog() {
    const b = this.boss;
    return {
      damageTaken: round2(this.logger.damageTaken - this.bossDamageAtSpawn),
      perfectDodges: b?.perfectDodges ?? this.lastOniPerfect,
      slamHitsTaken: b?.slamHitsTaken ?? this.lastOniSlam,
      chargeHitsTaken: b?.chargeHitsTaken ?? this.lastOniCharge,
      swingHitsTaken: b?.swingHitsTaken ?? this.lastOniSwing,
      chargeDodges: b?.chargeDodges ?? this.lastOniChargeDodges,
      counterRecalls: b?.counterRecalls ?? this.lastOniCounters,
      counterRecallDamage: round2(b?.counterRecallDamage ?? this.lastOniCounterDamage),
      events: this.counterRecalls.slice(),
      fightDuration: this.oniSpawned ? round2(this.time - this.oniStart) : 0,
    };
  }

  // the Oni is disposed by the reaper before the run is finalised, so its
  // counters are copied out while it is still alive
  private lastOniPerfect = 0;
  private lastOniSlam = 0;
  private lastOniCharge = 0;
  private lastOniSwing = 0;
  private lastOniChargeDodges = 0;
  private lastOniCounters = 0;
  private lastOniCounterDamage = 0;

  private keepOniCounters() {
    const b = this.boss;
    if (!b) return;
    this.lastOniPerfect = b.perfectDodges;
    this.lastOniSlam = b.slamHitsTaken;
    this.lastOniCharge = b.chargeHitsTaken;
    this.lastOniSwing = b.swingHitsTaken;
    this.lastOniChargeDodges = b.chargeDodges;
    this.lastOniCounters = b.counterRecalls;
    this.lastOniCounterDamage = b.counterRecallDamage;
  }

  // ---------------------------------------------------------------- actions

  private handleActions() {
    // --- LMB: 放つ
    if (this.input.consumeLmb()) {
      this.sfx.unlock();
      const dir = this.aimDir();
      const want = SEND_MIN + Math.floor(Math.random() * (SEND_MAX - SEND_MIN + 1));
      this.logger.leftClickCount++;
      if (this.swarm.send(dir, this.player.pos.x, this.player.pos.z, want) > 0) {
        this.sfx.send();
        this.fx.burst(this.player.pos.x, 1.2, this.player.pos.z, 8, 0xffe9a8, 6, 0.3);
      }
    }

    // --- SPACE: 広げる
    if (this.input.consumeSkill1() && this.spreadCd <= 0) {
      this.sfx.unlock();
      this.spreadCd = v5.spreadCooldown;
      this.logger.spreadUses++;
      this.tutorial?.noteSpread();
      this.formula.noteSpread(this.time);
      this.swarm.spread();
      this.fx.ring(
        this.player.pos.x,
        this.player.pos.z,
        1,
        params.followDistance * v5.spreadRadiusMul * 1.4,
        0.5,
        0xdfe8ff,
      );
      this.sfx.dash();
      this.hud.showSkill('展式  SPREAD');
    }

    // --- Q: 集める
    if (this.input.consumeSkill2() && this.gravityCd <= 0) {
      this.sfx.unlock();
      this.gravityCd = v5.gravityCooldown;
      this.logger.gravityUses++;
      this.tutorial?.noteGravity();
      const dir = this.aimDir();
      // recasting replaces a live core: harvest its numbers before dropping it,
      // or every core the player throws early goes unrecorded
      this.retireCore();
      this.core = new GravityCore(this.scene, this.player.pos.x, this.player.pos.z, dir.x, dir.z);
      this.core.onLand = (x, z) => {
        this.formula.noteGravity(this.time);
        this.fx.ring(x, z, 1, v5.gravityRadius * 2, 0.55, 0xdfe8ff);
        this.fx.burst(x, 1.4, z, 26, 0xdfe8ff, 8, 0.7);
        this.fx.shake(0.3);
        this.sfx.recallStart();
        this.hud.showSkill('集式核  GRAVITY');
      };
      this.sfx.send();
    }

    // --- RMB: 呼ぶ
    if (this.input.rmb && !this.recall.active) {
      this.sfx.unlock();
      this.recallStartedInOrbit = this.swarm.orbitTimer > 0;
      if (this.recallStartedInOrbit) this.logger.recallsDuringOrbit++;
      const n = this.swarm.beginRecall(this.time, this.player.pos.x, this.player.pos.z);
      this.logger.recallCount++;
      const nearest = this.nearestEnemyTo(this.player.pos);
      this.recall.begin(
        this.logger.now(),
        n,
        [round2(this.player.pos.x), round2(this.player.pos.z)],
        [round2(this.swarm.swarmCenter.x), round2(this.swarm.swarmCenter.z)],
        nearest ? [round2(nearest.pos.x), round2(nearest.pos.z)] : null,
      );
      this.fx.ring(this.player.pos.x, this.player.pos.z, 0.6, 9, 0.42, 0xfff0c0);
      this.sfx.recallStart();
      this.hud.hideBanner();
    } else if (!this.input.rmb && this.recall.active) {
      this.finishRecall();
    }
  }

  private aimDir(): THREE.Vector3 {
    const d = this.tmpDir.copy(this.input.aimPoint).sub(this.player.pos);
    d.y = 0;
    if (d.lengthSq() < 0.0001) d.copy(this.player.facing);
    return d.normalize();
  }

  private finishRecall() {
    const hits = this.recall.currentHits;
    this.flushBossRecall();
    this.swarm.endRecall();
    const rec = this.recall.end();
    if (!rec) return;

    // the tutorial only counts a recall that actually killed something: that
    // is the moment the whole lesson lands (spec 43)
    this.tutorial?.noteRecall(rec.hits, rec.killedEnemies);
    this.logger.homingRedirectCount = this.swarm.homingRedirects;
    if (this.recallStartedInOrbit) this.logger.hitsFromOrbitStateRecall += hits;

    // 術式: was this recall the product of a chain, or just a big crowd?
    const formula = this.formula.evaluate(this.time, hits);
    const counter = this.noteCounterRecall(rec.damage, rec.hits);

    this.logger.addRecall({
      t: rec.timestamp,
      shikigami: rec.shikigamiCount,
      hits: rec.hits,
      damage: round2(rec.damage),
      maxPenetration: rec.maxPenetration,
      afterGravity: this.time - this.formula.lastGravity <= 5,
      afterSpread: this.time - this.formula.lastSpread <= 4,
      duringOrbit: this.recallStartedInOrbit,
      formula: formula ? formula.kind : null,
    });

    if (counter) {
      // v10 spec 20: no banner, no score. A bell, a heavier stop, the Oni
      // rocked back, and one white stroke left across the ground.
      this.fx.stop(0.14);
      this.fx.shake(1.0);
      this.sfx.bell();
      this.inkSlash(1.6);
      this.hud.showSkill('反攻  COUNTER');
    }

    if (formula) {
      // a different, lower bell -- not the recall chime (spec 40)
      this.fx.stop(0.11);
      this.fx.shake(0.9);
      this.sfx.bigHit(hits);
      this.hud.showHits(hits, true);
      this.inkSlash(1.4);
      this.debugFormula(formula.kind);
    } else if (hits >= 100) {
      this.fx.stop(0.08);
      this.fx.shake(0.7);
      this.hud.showHits(hits, false);
      this.inkSlash(1);
      this.sfx.bigHit(hits);
    } else if (hits >= 50) {
      this.fx.stop(0.04);
      this.fx.shake(0.4);
      this.hud.showHits(hits, false);
      this.inkSlash(0.4);
      this.sfx.bigHit(hits);
    }
  }

  /**
   * The exchange the Oni fight is built around (v10 spec 19): get out of the
   * way of a charge, then answer it. Recorded rather than scored -- the reward
   * is the opening itself, not a bonus.
   */
  private counterRecalls: Array<Record<string, string | number>> = [];

  private noteCounterRecall(damage: number, hits: number): boolean {
    const b = this.boss;
    if (!b || !b.alive || this.oniRecallDamageThisPull <= 0) return false;
    const since = b.sinceChargeDodge;
    if (since === null) return false;
    if (!b.noteRecallHit(this.oniRecallDamageThisPull)) return false;
    this.counterRecalls.push({
      t: round2(this.time),
      type: 'counter_recall',
      bossAttack: 'charge',
      recallHits: hits,
      damage: round2(this.oniRecallDamageThisPull),
      secondsAfterDodge: since,
      shikigamiCount: this.swarm.activeCount,
    });
    void damage;
    return true;
  }

  private debugFormula(kind: string) {
    this.hud.showSkill('術式成立  ' + kind + ' SETUP');
  }

  private inkSlash(strength: number) {
    const d = this.tmpDir.copy(this.swarm.swarmCenter).sub(this.player.pos);
    d.y = 0;
    if (d.lengthSq() < 0.01) return;
    d.normalize();
    this.ink.slash(this.player.pos.x, this.player.pos.z, d.x, d.z, strength);
  }

  // ------------------------------------------------------------ player harm

  /** Damage is paid in shikigami, not in an HP bar (spec 20-27). */
  private hitPlayer(damage: number, from: THREE.Vector3): boolean {
    if (this.ended || this.finishTimer >= 0) return false;
    if (!this.player.takeDamage(damage)) return false;
    this.logger.damageEvents++;
    this.logger.damageTaken += damage;
    const n = Math.round(v5.scatterPerHit);
    const lost = this.swarm.scatter(from.x, from.z, n, this.time);
    this.fx.shake(0.5);
    this.fx.screenFlash(0.14);
    this.fx.stop(0.05);
    this.sfx.hurt();
    this.hud.showPop('式 散 −' + lost, this.swarm.activeCount);
    return true;
  }

  // --------------------------------------------------------------- director

  /**
   * Reaching 100 is answered immediately (spec 24-29): a small mark, a couple of
   * seconds of quiet while the flock gathers and the player can look at it, then
   * a formation built to be swept in one recall.
   */
  private checkMilestone() {
    if (this.milestoneShown || this.swarm.activeCount < RUN.milestone) return;
    this.milestoneShown = true;
    // v10 spec 9: short and strong. One second, a bell and a glow -- the old
    // three-second hold was a stop, and by v10 the Oni is usually already on
    // the field when the hundredth arrives.
    this.hud.showBanner('百式', 1.1);
    this.fx.screenFlash(0.14);
    this.fx.ring(this.player.pos.x, this.player.pos.z, 1, 18, 0.5, 0xffffff);
    this.fx.burst(this.player.pos.x, 1.4, this.player.pos.z, 30, 0xfff2cc, 9, 0.5);
    this.sfx.bell();
    const breath = this.boss && this.boss.alive ? 0 : 1.2;
    if (breath > 0) {
      if (this.journey) this.journey.encounter?.pause(breath);
      else this.waves.breathe(breath);
    }
    this.hundredEventAt = this.time + breath + 0.4;
  }

  private hundredEventAt = -1;
  /** when the player last dashed, for the dodge window */
  private lastDashAt = -99;

  private aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  private spawnYokai(x: number, z: number, elite: boolean) {
    const y = new Yokai(this.scene, x, z);
    if (elite) WaveDirector.makeElite(y);
    this.enemies.push(y);
    this.fx.ring(x, z, 0.5, elite ? 6 : 3.5, 0.35, 0xff4433);
  }

  /** @returns the Oni, or null if one is already on the field */
  private spawnOni(role: 'mid' | 'final' | 'location'): Oni | null {
    // Only ever one at a time. Two live Oni meant the HUD bar, the Perfect
    // Dodge check and every boss statistic followed the newer one while the
    // older one went on hitting the player unrecorded.
    if (this.boss && this.boss.alive) return null;
    const b = new Oni(this.scene, 0, -20);
    if (role === 'mid') {
      // an earlier, lighter encounter so the run does not sag before the boss
      b.maxHp = b.hp = 900;
    }
    this.boss = b;
    this.bossRole = role;
    this.enemies.push(b);
    if (role !== 'location') {
      this.oniStart = this.time;
      this.bossDamageAtSpawn = this.logger.damageTaken;
      this.logger.bossEncountered = true;
    }
    b.onPerfectDodge = () => {
      this.fx.stop(0.05);
      this.fx.ring(this.player.pos.x, this.player.pos.z, 0.5, 6, 0.3, 0xffe6a8);
      this.sfx.seal();
      this.hud.showSkill('見切り  PERFECT');
    };
    b.onTelegraph = () => this.sfx.hit(0.22);
    this.hud.showBoss(true);
    this.hud.setBoss(b.hp, b.maxHp, 1);
    this.fx.ring(b.pos.x, b.pos.z, 1, 18, 0.7, 0xff2a1a);
    this.fx.shake(0.8);
    this.sfx.bigHit(30);
    return b;
  }

  private handleKill(e: EnemyBase) {
    this.pickups.dropFor(e.pos.x, e.pos.z, e.isBoss);
    if (!e.isBoss) return;
    // Only the run's own final Oni ends the run. A mid-boss, a Kyoto location
    // boss, or a stray left over from an overlapping spawn just goes down.
    const role = e === this.boss ? this.bossRole : null;
    if (role !== 'final') {
      if (e === this.boss) this.clearBoss();
      return;
    }
    if (this.recall.active && this.swarm.activeCount >= 80) this.startFinish();
    else this.endGame(true);
  }

  private clearBoss() {
    this.boss = null;
    this.bossRole = null;
    this.hud.showBoss(false);
  }

  private reapEnemies() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive) continue;
      if (e.isBoss && this.finishTimer >= 0) continue;
      this.combat.forget(e.id);
      e.dispose();
      this.enemies.splice(i, 1);
      if (e === this.boss) {
        this.keepOniCounters();
        this.clearBoss();
      }
    }
  }

  // ------------------------------------------------------------- finisher

  private startFinish() {
    const b = this.boss;
    if (!b) {
      this.endGame(true);
      return;
    }
    this.finishTimer = 2.0;
    this.swarm.startFinish(b.pos.x, b.pos.z);
    const rec = this.recall.end();
    if (rec) {
      this.logger.addRecall({
        t: rec.timestamp,
        shikigami: rec.shikigamiCount,
        hits: rec.hits,
        damage: round2(rec.damage),
        maxPenetration: rec.maxPenetration,
        afterGravity: false,
        afterSpread: false,
        duringOrbit: this.recallStartedInOrbit,
        formula: null,
      });
    }
    this.fx.stop(0.16);
    this.fx.shake(0.9);
    this.sfx.seal();
  }

  private updateFinish(dt: number) {
    if (this.finishTimer < 0) return;
    this.finishTimer -= dt;
    const b = this.boss;
    if (b) {
      b.group.scale.multiplyScalar(1 - dt * 0.3);
      b.group.rotation.y += dt * 3;
    }
    if (this.finishTimer <= 0) {
      this.finishTimer = -1;
      if (b) {
        this.fx.burst(b.pos.x, 2, b.pos.z, 170, 0xfff0c0, 20, 1.0);
        this.fx.screenFlash(0.4);
        this.fx.shake(1.2);
      }
      this.endGame(true);
    }
  }

  // -------------------------------------------------------------- game over

  /**
   * @param quiet finalise and log the run without the end screen or the
   * fanfare. The tutorial uses this: it is onboarding, so there is nothing to
   * win and nothing to score.
   */
  private endGame(victory: boolean, quiet = false) {
    if (this.ended) return;
    this.ended = true;
    this.keepOniCounters();
    if (this.boss && !this.boss.alive) this.logger.bossDefeated = true;
    this.logger.bossFightDuration = this.oniSpawned ? round2(this.time - this.oniStart) : 0;
    if (this.recall.active) this.finishRecall();
    // the boss finisher gets here before the encounter notices it is clear
    this.journey?.closeCurrent(this.time, victory);
    // single finalise point: victory and the end screen both route through here
    const log = this.logger.finalize(() =>
      this.buildLog(victory ? 'victory' : 'defeat', victory),
    );
    if (!log) return;
    this.lastLog = log;
    if (!quiet) {
      this.hud.showEnd(victory, victory ? 'VICTORY' : 'THE FORMATION IS BROKEN', summary(log));
      if (victory) this.sfx.victory();
      else this.sfx.defeat();
    }
    this.onEnd?.(victory);
  }

  private buildLog(result: PlayLog['result'], victory: boolean): PlayLog {
    const t = this.combat.totals;
    return this.logger.build({
      result,
      victory,
      mode: this.mode,
      exploration: this.buildExploration(),
      initialShikigami: Math.round(v5.initialShikigami),
      totalShikigamiGrown: this.swarm.maxCount,
      finalShikigami: this.swarm.activeCount,
      totalRecallDamage: t.recallDamage,
      tengjaHits: t.foxfireHits,
      tengjaDamage: t.foxfireDamage,
      orbitContactHits: t.orbitContactHits,
      orbitContactDamage: t.orbitContactDamage,
      spreadContactHits: t.spreadContactHits,
      spreadContactDamage: t.spreadContactDamage,
      enemiesKilled: t.enemiesKilled,
      boss: this.bossLog(),
      tutorial: this.tutorial?.log() ?? null,
      scattered: this.swarm.totalScattered,
      recovered: this.swarm.totalRecovered,
      lost: this.swarm.totalLost,
      recoverTimeSum: this.swarm.recoverTimeSum,
      spreadToRecallCount: this.formula.spreadToRecall,
      averageRecallHitsAfterSpread: this.formula.averageHitsAfterSpread,
      gravityToRecallCount: this.formula.gravityToRecall,
      averageRecallHitsAfterGravity: this.formula.averageHitsAfterGravity,
      coreSetupSuccesses: this.formula.coreSuccesses,
      spreadSetupSuccesses: this.formula.spreadSuccesses,
      fullSetupSuccesses: this.formula.fullSuccesses,
      params: { ...v5, ...params },
    });
  }

  private buildExploration() {
    const j = this.journey;
    if (!j) return null;
    const total = Math.max(0.001, j.totalCombatTime + j.totalExplorationTime);
    return {
      mode: 'kyoto' as const,
      totalExplorationTime: round2(j.totalExplorationTime),
      totalCombatTime: round2(j.totalCombatTime),
      combatShare: round2(j.totalCombatTime / total),
      explorationShare: round2(j.totalExplorationTime / total),
      averageTravelTime: j.averageTravelTime,
      longestTravelTime: j.longestTravelTime,
      locationsCleared: j.locationsCleared,
      routeSelected: j.routeSelected.slice(),
      travel: j.legs.slice(),
      events: j.events.slice(),
      choices: j.choices.slice(),
      locations: j.combats.map((c) => ({ ...c })),
    };
  }

  exportCurrent() {
    PlayLogger.downloadCurrent(this.lastLog ?? this.buildLog('incomplete', false));
  }

  // ---------------------------------------------------------------- helpers

  private nearestEnemyTo(p: THREE.Vector3): EnemyBase | null {
    let best: EnemyBase | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  resize(w: number, h: number) {
    this.rig.resize(w / h);
  }

  dispose() {
    this.disposed = true;
    if (this.rewardBaseline) {
      Object.assign(v5, this.rewardBaseline);
      this.rewardBaseline = null;
    }
    this.input.dispose();
    this.fx.dispose();
    this.swarm.dispose();
    this.pickups.dispose();
    this.ink.dispose(this.scene);
    this.core?.dispose();
    for (const o of this.omens) o.dispose();
    this.omens.length = 0;
    this.barrier?.dispose();
    this.kyoto?.dispose();
    this.player.dispose(this.scene);
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.scene.clear();
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function summary(l: PlayLog): string {
  const lines = [
    'SHIKIGAMI &nbsp; <b>' + l.initialShikigami + '</b> → <b>' + l.finalShikigami +
      '</b> &nbsp; (PEAK <b>' + l.maxShikigamiReached + '</b> &nbsp; GROWN <b>' + l.totalShikigamiGrown + '</b>)',
    'MAX RECALL &nbsp; <b>' + l.maxRecallHits + '</b> HITS &nbsp; · &nbsp; AVG <b>' + l.avgRecallHits + '</b>',
    '術式 &nbsp; CORE <b>' + l.coreSetupSuccesses + '</b> &nbsp; SPREAD <b>' + l.spreadSetupSuccesses + '</b> &nbsp; FULL <b>' + l.fullSetupSuccesses + '</b>',
    'SPREAD <b>' + l.spreadUses + '</b> USES &nbsp; · &nbsp; GRAVITY <b>' + l.gravityUses + '</b> USES (MAX PULL <b>' + l.maxShikigamiAttracted + '</b>)',
    'SCATTERED <b>' + l.totalShikigamiScattered + '</b> &nbsp; RECOVERED <b>' + l.totalShikigamiRecovered + '</b> &nbsp; LOST <b>' + l.totalShikigamiLost + '</b> &nbsp; (' + Math.round(l.recoveryRate * 100) + '%)',
    'ORBIT <b>' + l.orbitPickups + '</b> &nbsp; · &nbsp; 騰蛇 HITS <b>' + l.tengjaHits + '</b> &nbsp; · &nbsp; TIME <b>' + l.playDuration.toFixed(1) + 's</b>',
  ];
  if (l.timeTo100 !== null) {
    lines.splice(1, 0, 'REACHED 100 AT &nbsp; <b>' + l.timeTo100.toFixed(0) + 's</b>');
  }
  return lines.join('<br>');
}

function bandGeometry(inner: number, outer: number): THREE.RingGeometry {
  const g = new THREE.RingGeometry(inner, outer, 72);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** shortest distance from (px,pz) to the segment a->b, in 2D */
function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-9 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

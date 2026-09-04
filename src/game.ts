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
import { BossFight } from './systems/bossFight';
import type { BossLeg } from './entities/boundaryEater';
import { GravityCore } from './entities/gravityCore';
import { CombatSystem } from './systems/combat';
import { RecallSystem } from './systems/recallSystem';
import { PickupSystem } from './systems/pickups';
import { WaveDirector } from './systems/waveDirector';
import { FormulaTracker } from './systems/formula';
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
  // --- 境喰・八肢, the arena boss (v8)
  private eater: BossFight | null = null;
  private eaterSpawnedAt = -1;
  private gravityCd = 0;
  private spreadCd = 0;
  private recallStartedInOrbit = false;
  private tmpDir = new THREE.Vector3();

  onEnd?: (victory: boolean) => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private hud: Hud,
    private debug: DebugPanel,
    private sfx: Sfx,
    readonly mode: GameMode = 'arena',
  ) {
    resetEnemyIds();
    resetField();
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
      this.logger.dashCount++;
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
    this.combat.onHit = (e, dmg, isRecall) => this.noteEaterHit(e, dmg, isRecall);

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
    this.waves.onMidBoss = () => this.spawnOni(true);
    // the timeline Oni stands down while 境喰・八肢 is on the field: two bosses
    // at once is not what this prototype is measuring
    this.waves.onBoss = () => {
      if (!this.eater) this.spawnOni(false);
    };

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
    this.debug.onBossSandbox = () => this.bossSandbox();
    this.debug.onExportCurrent = () => this.exportCurrent();
    this.debug.onExportAll = () => PlayLogger.downloadAll();
    this.hud.showBanner(
      this.kyotoMode ? '境が、またひとつ破れた。' : 'RELEASE · MOVE · RECALL',
      this.kyotoMode ? 4.0 : 3.0,
    );
  }

  get kyotoMode(): boolean {
    return this.mode === 'kyoto';
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
      v5.orbitDuration *= mul;
    };
    rewardHooks.tengjaRatio = (add) => {
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
    j.onBoss = () => this.spawnOni(false);
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
    this.time += dt;

    this.input.updateAim(this.rig.camera);
    if (!this.ended && this.finishTimer < 0) this.handleActions();

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

    this.updateEater(dt);
    this.updateEaterDeath(dt);
    this.ink.update(dt, this.swarm);
    this.reapEnemies();
    if (!this.ended && this.finishTimer < 0) {
      if (this.journey) {
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
      boss: this.eater
        ? {
            hp: Math.round(this.eater.core.hp) + ' / ' + this.eater.core.maxHp,
            phase: this.eater.phase,
            activeLegs: this.eater.activeLegs,
            severed: this.eater.legsSevered,
            nextAttack: this.eater.nextAttack,
            coreExposed: this.eater.coreExposed,
            perfectDodges: this.eater.perfectDodges,
          }
        : null,
      extra:
        '騰蛇 ' + this.swarm.countOfType(SType.TENGJA) +
        ' · CORE ' + this.swarm.heldByCore +
        ' · 術式 ' + (this.formula.coreSuccesses + this.formula.spreadSuccesses + this.formula.fullSuccesses) +
        (this.journey ? ' · ' + this.journey.phase.toUpperCase() : ''),
    });

    this.renderer.render(this.scene, this.rig.camera);
    this.rig.restore();
  }

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

  // ------------------------------------------------------------- arena boss

  /**
   * The trash waves stay exactly as they are; this is bolted on beside them so
   * the power fantasy is untouched and the difficulty comes from something that
   * aims at the player instead (spec 2/3).
   */
  private updateEater(dt: number) {
    if (this.mode !== 'arena' || this.ended || this.finishTimer >= 0) return;

    if (!this.eater) {
      // whichever comes first: about three and a half minutes, or a flock big
      // enough that the player has stopped needing to dodge (spec 9)
      const due = this.time > 205 || this.swarm.activeCount >= 75;
      if (due && this.eaterSpawnedAt < 0) this.spawnEater();
      return;
    }

    const e = this.eater;
    e.update(dt, this.player.pos, this.bossProbe());

    // Perfect Dodge: a sweep that missed while the dash i-frames were up. No
    // damage bonus -- the reward is a longer opening (spec 14).
    const t = e.threat;
    if (t && t.state === 'sweeping' && this.player.dashInvulnerable) {
      const d = Math.hypot(this.player.pos.x - t.pos.x, this.player.pos.z - t.pos.z);
      if (d < t.radius + 5) {
        e.registerDodge(t);
        if (!this.perfectFlash) {
          this.perfectFlash = true;
          this.fx.stop(0.05);
          this.fx.ring(this.player.pos.x, this.player.pos.z, 0.5, 6, 0.3, 0xffe6a8);
          this.sfx.seal();
          this.hud.showSkill('見切り  PERFECT');
        }
      }
    } else if (!t || t.state !== 'sweeping') {
      this.perfectFlash = false;
    }

    if (e.defeated && this.eaterDeath < 0) this.beginEaterDeath();
  }

  private eaterDeath = -1;

  /**
   * It does not explode. The black body goes the way ink goes in water: the
   * limbs first, then the core, and then the arena is simply quiet (spec 31/32).
   */
  private beginEaterDeath() {
    const e = this.eater;
    if (!e) return;
    this.eaterDeath = 3.2;
    this.waves.breathe(4);
    this.fx.stop(0.1);
    this.fx.shake(1.2);
    this.fx.screenFlash(0.3);
    this.sfx.seal();
    this.hud.showBanner('鎮', 2.4);
    for (const l of e.legs) {
      if (!l.alive) continue;
      l.alive = false;
      this.fx.burst(l.pos.x, 2.2, l.pos.z, 40, 0x14141c, 10, 1.1);
    }
    this.logger.bossDefeated = true;
    this.logger.bossFightDuration = round2(e.elapsed);
  }

  private updateEaterDeath(dt: number) {
    if (this.eaterDeath < 0) return;
    const e = this.eater;
    this.eaterDeath -= dt;
    if (e) {
      const k = Math.max(0, this.eaterDeath / 3.2);
      e.core.group.scale.setScalar(0.05 + k * 0.95);
      e.core.group.rotation.y += dt * 0.8;
      if (Math.random() < dt * 8) {
        this.fx.burst(e.core.pos.x, 5 + Math.random() * 5, e.core.pos.z, 6, 0x2a1a24, 5, 1.0);
      }
    }
    if (this.eaterDeath <= 0) {
      this.eaterDeath = -1;
      this.disposeEater();
      if (!this.ended) this.endGame(true);
    }
  }

  private disposeEater() {
    const e = this.eater;
    if (!e) return;
    // Snapshot before it goes. The death sequence disposes the boss and only
    // then ends the run, so reading these off `this.eater` at buildLog time
    // returned zeroes for every boss field in a winning run.
    this.lastBossLog = this.bossLog();
    const parts = new Set<number>(e.parts.map((p) => p.id));
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (parts.has(this.enemies[i].id)) this.enemies.splice(i, 1);
    }
    for (const l of e.legs) this.combat.forget(l.id);
    this.combat.forget(e.core.id);
    e.dispose();
    this.eater = null;
  }

  private perfectFlash = false;
  /** per-recall tallies against the boss, flushed when the recall resolves */
  private coreRecallHits = 0;
  private coreRecallDamage = 0;
  private legsHitThisRecall = new Set<number>();

  private noteEaterHit(e: EnemyBase, dmg: number, isRecall: boolean) {
    if (!this.eater || !e.eaterPart) return;
    if (e === this.eater.core) {
      // a hit on the closed shell does nothing; counting it would inflate the
      // core-recall metric with contacts that never landed
      if (isRecall && dmg > 0) {
        this.coreRecallHits++;
        this.coreRecallDamage += dmg;
      }
      return;
    }
    const leg = e as BossLeg;
    if (isRecall) {
      leg.hitsSinceExposed++;
      this.legsHitThisRecall.add(leg.legId);
    }
  }

  /**
   * Spec 18: a pull that catches two limbs at once is the thing worth
   * discovering, so it gets its own beat rather than just twice the numbers.
   */
  private flushEaterRecall() {
    const e = this.eater;
    if (!e) return;
    if (this.legsHitThisRecall.size >= 2) {
      this.fx.stop(0.06);
      this.fx.shake(0.55);
      this.fx.screenFlash(0.1);
      this.sfx.bigHit(50);
      this.hud.showSkill('双肢  ' + this.legsHitThisRecall.size + ' LEGS');
    }
    if (this.coreRecallHits > 0) {
      e.noteCoreRecall(
        this.coreRecallHits,
        this.coreRecallDamage,
        this.swarm.activeCount,
        this.time - this.formula.lastGravity <= 5,
      );
      // the core taking a full flock is the payoff the whole fight builds to
      this.fx.stop(0.09);
      this.fx.shake(1.0);
      this.fx.screenFlash(0.22);
      this.fx.ring(e.core.pos.x, e.core.pos.z, 1, 30, 0.8, 0xffffff);
      this.sfx.seal();
    }
    this.coreRecallHits = 0;
    this.coreRecallDamage = 0;
    this.legsHitThisRecall.clear();
  }

  private bossProbe() {
    return {
      recallCount: this.logger.recallCount,
      maxRecallHits: this.combat.totals.largestRecallShikigamiCount,
      damageTaken: this.logger.damageTaken,
      shikigami: this.swarm.activeCount,
    };
  }

  /** Debug / sandbox entry point too (spec 50). */
  spawnEater() {
    if (this.eater) return;
    // Far enough that it arrives rather than appearing on top of you, close
    // enough to stay in frame: this camera only shows about 45 units ahead, and
    // at 26 the body sat half off the top edge.
    const a = Math.atan2(this.player.pos.z, this.player.pos.x) + Math.PI;
    const x = THREE.MathUtils.clamp(this.player.pos.x + Math.cos(a) * 19, -22, 22);
    const z = THREE.MathUtils.clamp(this.player.pos.z + Math.sin(a) * 19, -22, 22);
    const e = new BossFight(this.scene, x, z);
    e.probe = () => this.bossProbe();
    e.onSpawnTrash = (n) => {
      for (let i = 0; i < n; i++) {
        const t = Math.random() * Math.PI * 2;
        this.spawnYokai(Math.cos(t) * 34, Math.sin(t) * 34, false);
      }
    };
    e.onPhase = (p) => {
      this.hud.showBanner('第' + p + '相', 1.8);
      this.fx.shake(0.6);
      this.sfx.bigHit(30);
    };
    e.onLegSevered = (leg) => this.severLeg(leg);
    // limbs come and go during the fight, so the hittable list follows them
    e.onLegGrown = (leg) => this.enemies.push(leg);
    e.onLegRemoved = (leg) => {
      const i = this.enemies.indexOf(leg);
      if (i >= 0) this.enemies.splice(i, 1);
      this.combat.forget(leg.id);
    };
    e.onCoreOpen = () => {
      this.hud.showBanner('核 露出', 1.6);
      this.fx.screenFlash(0.12);
      this.fx.ring(e.core.pos.x, e.core.pos.z, 2, 26, 0.7, 0xff8866);
      this.sfx.recallStart();
    };
    e.onCoreClose = () => this.hud.hideBanner();
    e.onTelegraph = () => this.sfx.hit(0.2);
    this.eater = e;
    this.eaterSpawnedAt = this.time;
    this.logger.bossEncountered = true;
    this.logger.bossDamageTakenAtSpawn = this.logger.damageTaken;

    for (const part of e.parts) this.enemies.push(part);
    // a moment of quiet so the arrival reads (spec 10)
    this.waves.breathe(3);
    this.hud.showBanner('境喰・八肢', 2.6);
    this.fx.screenFlash(0.2);
    this.fx.shake(1.0);
    this.sfx.defeat();
  }

  /** 100 shikigami, a boss, a little trash — straight to the thing being tested. */
  bossSandbox() {
    if (this.mode !== 'arena' || this.ended) return;
    this.swarm.grow(Math.max(0, 100 - this.swarm.count), this.player, 9999);
    for (const e of this.enemies) if (!e.eaterPart) e.alive = false;
    this.spawnEater();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.spawnYokai(Math.cos(a) * 30, Math.sin(a) * 30, false);
    }
  }

  private severLeg(leg: BossLeg) {
    // ink dissolving, not gore (spec 16)
    this.fx.stop(0.08);
    this.fx.shake(0.8);
    this.fx.burst(leg.pos.x, 2.4, leg.pos.z, 90, 0x14141c, 14, 0.9);
    this.fx.ring(leg.pos.x, leg.pos.z, 1, 14, 0.6, 0x8e1420);
    this.sfx.bigHit(40);
    this.hud.showPop('肢 断', this.swarm.activeCount);
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
    this.flushEaterRecall();
    this.swarm.endRecall();
    const rec = this.recall.end();
    if (!rec) return;

    this.logger.homingRedirectCount = this.swarm.homingRedirects;
    if (this.recallStartedInOrbit) this.logger.hitsFromOrbitStateRecall += hits;

    // 術式: was this recall the product of a chain, or just a big crowd?
    const formula = this.formula.evaluate(this.time, hits);

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
  private hitPlayer(damage: number, from: THREE.Vector3) {
    if (this.ended || this.finishTimer >= 0) return;
    if (!this.player.takeDamage(damage)) return;
    this.logger.damageEvents++;
    this.logger.damageTaken += damage;
    const n = Math.round(v5.scatterPerHit);
    const lost = this.swarm.scatter(from.x, from.z, n, this.time);
    this.fx.shake(0.5);
    this.fx.screenFlash(0.14);
    this.fx.stop(0.05);
    this.sfx.hurt();
    this.hud.showPop('式 散 −' + lost, this.swarm.activeCount);
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
    this.hud.showBanner('百式', 1.6);
    this.fx.screenFlash(0.1);
    this.fx.ring(this.player.pos.x, this.player.pos.z, 1, 16, 0.6, 0xffffff);
    this.sfx.seal();
    // 2-4s to walk and look at the flock before anything else happens (spec 22)
    if (this.journey) this.journey.encounter?.pause(3);
    else this.waves.breathe(3);
    this.hundredEventAt = this.time + 3.2;
  }

  private hundredEventAt = -1;

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

  private spawnOni(mid: boolean) {
    const b = new Oni(this.scene, 0, -20);
    if (mid) {
      // an earlier, lighter encounter so the run does not sag before the boss
      b.maxHp = b.hp = 900;
    }
    this.boss = b;
    this.enemies.push(b);
    this.hud.showBoss(true);
    this.hud.setBoss(b.hp, b.maxHp, 1);
    this.fx.ring(b.pos.x, b.pos.z, 1, 18, 0.7, 0xff2a1a);
    this.fx.shake(0.8);
    this.sfx.bigHit(30);
  }

  private handleKill(e: EnemyBase) {
    this.pickups.dropFor(e.pos.x, e.pos.z, e.isBoss);
    if (e.isBoss) {
      const last = this.time >= 300;
      if (!last) {
        this.boss = null;
        this.hud.showBoss(false);
        return;
      }
      if (this.recall.active && this.swarm.activeCount >= 80) this.startFinish();
      else this.endGame(true);
    }
  }

  private reapEnemies() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive) continue;
      // 境喰・八肢 owns its own limbs: it needs them around to run the sever
      // beat and the death sequence, so the generic reaper leaves them alone
      if (e.eaterPart) continue;
      if (e.isBoss && this.finishTimer >= 0) continue;
      this.combat.forget(e.id);
      e.dispose();
      this.enemies.splice(i, 1);
      if (e.isBoss) {
        this.boss = null;
        this.hud.showBoss(false);
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

  private endGame(victory: boolean) {
    if (this.ended) return;
    this.ended = true;
    if (this.recall.active) this.finishRecall();
    // the boss finisher gets here before the encounter notices it is clear
    this.journey?.closeCurrent(this.time);
    // single finalise point: victory and the end screen both route through here
    const log = this.logger.finalize(() =>
      this.buildLog(victory ? 'victory' : 'defeat', victory),
    );
    if (!log) return;
    this.lastLog = log;
    this.hud.showEnd(victory, victory ? 'VICTORY' : 'THE FORMATION IS BROKEN', summary(log));
    if (victory) this.sfx.victory();
    else this.sfx.defeat();
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

  private lastBossLog: BossLogSnapshot | null = null;

  private bossLog(): BossLogSnapshot {
    const e = this.eater;
    if (!e && this.lastBossLog) return this.lastBossLog;
    return {
      damageTaken: e ? this.logger.damageTaken - this.logger.bossDamageTakenAtSpawn : 0,
      legsSevered: e?.legsSevered ?? 0,
      coreExposureCount: e?.coreExposureCount ?? 0,
      coreRecallHits: e?.coreRecallHits ?? 0,
      coreRecallDamage: e?.coreRecallDamage ?? 0,
      perfectDodges: e?.perfectDodges ?? 0,
      sweepHitsTaken: e?.sweepHitsTaken ?? 0,
      pillarHitsTaken: e?.pillarHitsTaken ?? 0,
      events: (e?.events ?? []) as Array<Record<string, unknown>>,
      phases: (e?.phases ?? []) as unknown as Array<Record<string, number>>,
    };
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
    this.input.dispose();
    this.fx.dispose();
    this.swarm.dispose();
    this.pickups.dispose();
    this.ink.dispose(this.scene);
    this.core?.dispose();
    this.eater?.dispose();
    this.eater = null;
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

interface BossLogSnapshot {
  damageTaken: number;
  legsSevered: number;
  coreExposureCount: number;
  coreRecallHits: number;
  coreRecallDamage: number;
  perfectDodges: number;
  sweepHitsTaken: number;
  pillarHitsTaken: number;
  events: Array<Record<string, unknown>>;
  phases: Array<Record<string, number>>;
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

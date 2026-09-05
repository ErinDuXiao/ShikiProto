import * as THREE from 'three';
import { Game } from './game';
import { Hud } from './ui/hud';
import { DebugPanel } from './ui/debugPanel';
import { Sfx } from './core/audio';
import { PlayLogger } from './log/playLogger';
import { CONTROLS, type GameMode } from './core/runConfig';
import { resetTutorial, tutorialDue, tutorialPlayedAt } from './systems/tutorial';

const app = document.getElementById('app') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const hud = new Hud();
const debug = new DebugPanel();
const sfx = new Sfx();
const start = document.getElementById('start') as HTMLElement;

let game: Game | null = null;

let lastMode: GameMode = 'arena';

/**
 * Bumped by every navigation. The tutorial's hand-off to the arena is a timer,
 * and without this a player who hit RETRY or MENU during that second had the
 * stale callback dispose their new run and drop them into the arena instead.
 */
let runToken = 0;

/** Every run gets a brand new Game, and so a brand new sessionId (spec 39). */
function startRun(mode: GameMode = lastMode, fromBlack = false) {
  const token = ++runToken;
  lastMode = mode;
  start.classList.add('off');
  game?.dispose();
  // the Game constructor calls hud.reset(), which clears the curtain -- so the
  // curtain has to be dropped after it, not before
  game = new Game(renderer, hud, debug, sfx, mode);
  if (fromBlack) hud.blackout();
  // raise the curtain once the new run has actually drawn something
  game.onFirstFrame = () => {
    if (runToken === token) hud.setFade(0, fromBlack ? 0.9 : 0.25);
  };
  // finishing the tutorial rolls straight into the arena rather than dumping
  // the player back on a menu (spec 33)
  if (mode === 'tutorial') {
    game.onEnd = (victory) => {
      if (!victory) return;
      // The tutorial has already faded to black by the time it ends, so the
      // hand-off is immediate and the arena fades up from the same curtain --
      // one continuous transition rather than a result screen and a cut.
      if (runToken === token) startRun('arena', true);
    };
  }
}

function toStartScreen() {
  runToken++;
  game?.dispose();
  game = null;
  hud.reset();
  start.classList.remove('off');
  (document.getElementById('start-btn') as HTMLButtonElement | null)?.focus();
}

// the four verbs of the swarm grammar, shown before the run begins
const slotsEl = document.getElementById('slots') as HTMLElement;
slotsEl.innerHTML = '';
for (const s of CONTROLS) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.innerHTML =
    `<span class="k">${s.key}</span><span class="n">${s.label}</span><span class="d">${s.blurb}</span>`;
  slotsEl.appendChild(el);
}

const arenaBtn = document.getElementById('start-btn') as HTMLButtonElement;

/**
 * PLAY ARENA is the only button most people will press, so the tutorial has to
 * come to them rather than sit beside it. It runs automatically whenever the
 * player has never finished it, or finished a version older than the current
 * one, and goes straight to the arena otherwise. The tutorial hands over to
 * the arena when it ends, so this is the only place that decision is made.
 */
function playArena() {
  sfx.unlock();
  startRun(tutorialDue() ? 'tutorial' : 'arena');
}

arenaBtn.addEventListener('click', playArena);
document.getElementById('start-tutorial')!.addEventListener('click', () => {
  sfx.unlock();
  startRun('tutorial');
});
// Enter starts the arena from the title screen (spec 48)
window.addEventListener('keydown', (e) => {
  if (start.classList.contains('off')) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') playArena();
});
document.getElementById('start-kyoto')!.addEventListener('click', () => {
  sfx.unlock();
  startRun('kyoto');
});
document.getElementById('end-retry')!.addEventListener('click', () => {
  sfx.unlock();
  startRun();
});
document.getElementById('end-menu')!.addEventListener('click', toStartScreen);
document.getElementById('end-export')!.addEventListener('click', () => game?.exportCurrent());
debug.onExportCurrent = () => game?.exportCurrent();
debug.onExportAll = () => PlayLogger.downloadAll();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  game?.resize(window.innerWidth, window.innerHeight);
});

const unlock = () => sfx.unlock();
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  game?.update(dt);
}
requestAnimationFrame(frame);

(window as any).SHIKIGAMI = {
  logs: () => PlayLogger.loadAll(),
  exportCurrent: () => game?.exportCurrent(),
  exportAll: () => PlayLogger.downloadAll(),
  start: startRun,
  arena: () => startRun('arena'),
  spawnOni: () => game?.spawnArenaOni(),
  tutorial: () => startRun('tutorial'),
  resetTutorial,
  tutorialDue,
  tutorialPlayedAt,
  hud,
  kyoto: () => startRun('kyoto'),
  menu: toStartScreen,
  get game() {
    return game;
  },
};

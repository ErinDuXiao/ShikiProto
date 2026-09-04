import * as THREE from 'three';
import { Game } from './game';
import { Hud } from './ui/hud';
import { DebugPanel } from './ui/debugPanel';
import { Sfx } from './core/audio';
import { PlayLogger } from './log/playLogger';
import { CONTROLS, type GameMode } from './core/runConfig';

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

/** Every run gets a brand new Game, and so a brand new sessionId (spec 39). */
function startRun(mode: GameMode = lastMode) {
  lastMode = mode;
  start.classList.add('off');
  game?.dispose();
  game = new Game(renderer, hud, debug, sfx, mode);
}

function toStartScreen() {
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
arenaBtn.addEventListener('click', () => {
  sfx.unlock();
  startRun('arena');
});
// Enter starts the arena from the title screen (spec 48)
window.addEventListener('keydown', (e) => {
  if (start.classList.contains('off')) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    sfx.unlock();
    startRun('arena');
  }
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
  bossSandbox: () => game?.bossSandbox(),
  kyoto: () => startRun('kyoto'),
  menu: toStartScreen,
  get game() {
    return game;
  },
};

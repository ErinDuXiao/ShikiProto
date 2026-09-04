import { params, resetParams, SLIDERS, type BoidParams } from '../core/params';
import { v5, resetV5, V5_SLIDERS, type V5Params } from '../core/v5Params';
import { trailFx, DEFAULT_TRAIL_FX } from '../vfx/swarmVfx';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface DebugStats {
  fps: number;
  total: number;
  active: number;
  loose: number;
  scattered: number;
  avgDistance: number;
  swarmSpeed: number;
  state: string;
  extra: string;
  /** dominant formation modifier this frame (spec 11) */
  formation: string;
  /** spec 16: proof that WAIT shikigami are actually being pulled */
  gravityActive: boolean;
  pulled: number;
  pulledFromWait: number;
  /** Oni read-outs; null when no boss is on the field */
  boss: {
    hp: string;
    phase: number;
    state: string;
    nextAttack: string;
    recovering: boolean;
    perfectDodges: number;
  } | null;
}

type AnyKey = keyof V5Params | keyof BoidParams | keyof typeof trailFx;

const TRAIL_SLIDERS: Array<{ key: keyof typeof trailFx; label: string; min: number; max: number; step: number }> = [
  { key: 'glowIntensity', label: 'Glow Intensity', min: 0, max: 1, step: 0.02 },
  { key: 'glowRadius', label: 'Glow Radius', min: 0.1, max: 1.5, step: 0.02 },
  { key: 'trailLength', label: 'Trail Length', min: 0, max: 0.5, step: 0.01 },
  { key: 'trailOpacity', label: 'Trail Opacity', min: 0, max: 1, step: 0.02 },
  { key: 'trailWidth', label: 'Trail Width', min: 0.02, max: 0.35, step: 0.01 },
  { key: 'recallTrailMul', label: 'Recall Trail Mul', min: 1, max: 5, step: 0.05 },
  { key: 'trailShare', label: 'Trail Share', min: 0, max: 1, step: 0.02 },
];

/** Live read-outs plus every knob spec 38 asks for. */
export class DebugPanel {
  private root = $('debug');
  private btn = $('debugbtn');
  private fields: Record<string, HTMLElement> = {};
  private inputs = new Map<AnyKey, HTMLInputElement>();
  private values = new Map<AnyKey, HTMLElement>();
  private acc = 0;
  private frames = 0;
  private fps = 0;

  onExportCurrent?: () => void;
  onExportAll?: () => void;
  /** developer only: bring the Oni in now */
  onBossSandbox?: () => void;
  onResetTutorial?: () => void;

  constructor() {
    for (const k of [
      'fps', 'total', 'active', 'loose', 'scattered', 'dist', 'speed', 'state', 'extra',
      'formation', 'gravity', 'pulled', 'fromwait',
      'bhp', 'bphase', 'blegs', 'bsev', 'batk', 'bcore', 'bdodge',
    ]) {
      this.fields[k] = $('d-' + k);
    }

    const tuner = $('tuner');
    tuner.innerHTML = '';

    for (const g of V5_SLIDERS) {
      this.group(tuner, g.group);
      for (const s of g.items) {
        tuner.appendChild(
          this.slider(s.label, s.min, s.max, s.step, v5[s.key], (val) => {
            v5[s.key] = val;
          }, s.key),
        );
      }
    }

    this.group(tuner, 'TRAIL / GLOW');
    for (const s of TRAIL_SLIDERS) {
      tuner.appendChild(
        this.slider(s.label, s.min, s.max, s.step, trailFx[s.key], (val) => {
          trailFx[s.key] = val;
        }, s.key),
      );
    }

    this.group(tuner, 'BOID');
    for (const s of SLIDERS) {
      tuner.appendChild(
        this.slider(s.label, s.min, s.max, s.step, params[s.key], (val) => {
          params[s.key] = val;
        }, s.key),
      );
    }

    $('d-reset').addEventListener('click', () => {
      resetParams();
      resetV5();
      Object.assign(trailFx, DEFAULT_TRAIL_FX);
      this.sync();
    });
    $('d-boss').addEventListener('click', () => this.onBossSandbox?.());
    $('d-tut').addEventListener('click', () => this.onResetTutorial?.());
    $('d-export').addEventListener('click', () => this.onExportCurrent?.());
    $('d-export-all').addEventListener('click', () => this.onExportAll?.());
    this.btn.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.toggle();
    });
  }

  private group(parent: HTMLElement, title: string) {
    const h = document.createElement('div');
    h.className = 'subhead';
    h.textContent = title;
    parent.appendChild(h);
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    onInput: (v: number) => void,
    key: AnyKey,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sl';
    const lab = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('b');
    lab.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    val.textContent = fmt(initial);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      onInput(v);
      val.textContent = fmt(v);
    });
    wrap.append(lab, input);
    this.inputs.set(key, input);
    this.values.set(key, val);
    return wrap;
  }

  private sync() {
    const read = (k: AnyKey): number => {
      if (k in v5) return v5[k as keyof V5Params];
      if (k in trailFx) return trailFx[k as keyof typeof trailFx];
      return params[k as keyof BoidParams];
    };
    for (const [k, input] of this.inputs) {
      const v = read(k);
      input.value = String(v);
      const el = this.values.get(k);
      if (el) el.textContent = fmt(v);
    }
  }

  toggle() {
    this.root.classList.toggle('on');
  }

  update(dt: number, stats: Omit<DebugStats, 'fps'>) {
    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.35) {
      this.fps = this.frames / this.acc;
      this.acc = 0;
      this.frames = 0;
    }
    if (!this.root.classList.contains('on')) return;
    this.fields.fps.textContent = this.fps.toFixed(0);
    this.fields.total.textContent = String(stats.total);
    this.fields.active.textContent = String(stats.active);
    this.fields.loose.textContent = String(stats.loose);
    this.fields.scattered.textContent = String(stats.scattered);
    this.fields.dist.textContent = stats.avgDistance.toFixed(2);
    this.fields.speed.textContent = stats.swarmSpeed.toFixed(1);
    this.fields.state.textContent = stats.state;
    this.fields.extra.textContent = stats.extra || '--';
    this.fields.formation.textContent = stats.formation;
    this.fields.gravity.textContent = stats.gravityActive ? 'ACTIVE' : '--';
    this.fields.pulled.textContent = String(stats.pulled);
    this.fields.fromwait.textContent = String(stats.pulledFromWait);
    const b = stats.boss;
    this.fields.bhp.textContent = b ? b.hp : '--';
    this.fields.bphase.textContent = b ? String(b.phase) : '--';
    this.fields.blegs.textContent = b ? b.state : '--';
    this.fields.bsev.textContent = b ? b.nextAttack : '--';
    this.fields.batk.textContent = b ? (b.recovering ? 'YES' : 'no') : '--';
    this.fields.bcore.textContent = b ? String(b.perfectDodges) : '0';
    this.fields.bdodge.textContent = b ? String(b.perfectDodges) : '0';
  }
}

function fmt(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
}

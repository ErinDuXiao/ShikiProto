/** Tiny procedural WebAudio kit -- no external assets (spec 32). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) {
        this.enabled = false;
        return null;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture so the context is allowed to start. */
  unlock() {
    this.ensure();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    sweepTo?: number,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, lowpass: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  /** Bell that opens a recall. */
  recallStart() {
    this.tone(1760, 0.5, 'sine', 0.22);
    this.tone(2640, 0.34, 'sine', 0.1);
  }

  /** A shikigami punched through something. */
  hit(strength: number) {
    this.tone(150 + strength * 60, 0.09 + strength * 0.05, 'triangle', 0.1 + strength * 0.1, 60);
    this.noise(0.06, 0.05 + strength * 0.06, 1600);
  }

  /** Many shikigami through the same target at once. */
  bigHit(count: number) {
    const s = Math.min(1, count / 45);
    this.tone(90, 0.4 + s * 0.25, 'sine', 0.28 + s * 0.2, 40);
    this.noise(0.22, 0.12 + s * 0.14, 900);
    this.tone(320, 0.18, 'square', 0.06 + s * 0.05, 120);
  }

  send() {
    this.tone(680, 0.13, 'triangle', 0.09, 1200);
  }

  dash() {
    this.noise(0.16, 0.07, 2600);
  }

  hurt() {
    this.tone(220, 0.3, 'sawtooth', 0.14, 70);
    this.noise(0.2, 0.09, 700);
  }

  enemyDown() {
    this.tone(420, 0.28, 'triangle', 0.12, 90);
    this.noise(0.18, 0.08, 1200);
  }

  seal() {
    this.tone(1320, 1.1, 'sine', 0.22, 2640);
    this.tone(660, 1.3, 'sine', 0.14);
  }

  victory() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.6, 'sine', 0.16), i * 130));
  }

  defeat() {
    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.7, 'triangle', 0.14), i * 190));
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}

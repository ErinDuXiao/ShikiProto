import * as THREE from 'three';
import { ARENA_RADIUS } from '../core/params';


const TEX = 1024;
/** world half-extent the texture covers */
const HALF = ARENA_RADIUS + 4;
const SCALE = TEX / (HALF * 2);
/** fixed perpendicular lanes (as a fraction of half-width) where the brush runs
 *  dry; keeping them fixed makes the gaps continuous between segments */
const DRY_LANES = [-0.82, -0.52, -0.22, 0.16, 0.46, 0.78];

export interface BrushStyle {
  /** ink colour, css */
  color: string;
  /** 0..1 base alpha for the body */
  alpha: number;
  /** 0..1, how much bare paper shows through */
  kasure: number;
  /** number of thin sub-strokes */
  bristles: number;
  /** how far bristles fan, as a fraction of width */
  spread: number;
  /** edge wobble in world units */
  wobble: number;
  /** stroke-length position, used to keep dry streaks irregular but continuous */
  phase: number;
}

/**
 * The paper. A Canvas2D texture pinned to the arena floor, so ink stays where
 * it was painted no matter how the camera moves, and old strokes dry out with a
 * single uniform fade instead of being re-rendered every frame.
 *
 * This is deliberately NOT a fluid sim (spec 23) -- strokes are variable-width
 * polygons plus bristle lines plus erase streaks for kasure.
 */
export class InkSurface {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private dirty = false;
  /** seconds of fade owed but not yet applied */
  private fadeAccum = 0;
  /** seconds since anything was painted; used to stop work on a blank sheet */
  private idleFor = 0;
  private blank = true;
  /** world point the sheet is centred on; Kyoto moves it per encounter */
  private ox = 0;
  private oz = 0;
  /** the whole canvas is re-uploaded on commit, so cap how often that happens */
  private static readonly FADE_HZ = 20;

  constructor(scene: THREE.Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TEX;
    this.canvas.height = TEX;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D unavailable — calligraphy VFX cannot run');
    this.ctx = ctx;
    this.ctx.clearRect(0, 0, TEX, TEX);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.position.y = 0.05;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setVisible(v: boolean) {
    this.mesh.visible = v;
  }

  clear() {
    this.ctx.clearRect(0, 0, TEX, TEX);
    this.dirty = true;
    this.blank = true;
    this.idleFor = 0;
    this.fadeAccum = 0;
  }

  private touched() {
    this.dirty = true;
    this.blank = false;
    this.idleFor = 0;
  }

  /**
   * Move the sheet to a new patch of ground and wipe it. The texture only
   * covers one arena's worth of world, so in Kyoto it follows the encounter
   * rather than staying pinned at the origin.
   */
  recenter(x: number, z: number) {
    if (Math.abs(x - this.ox) < 0.01 && Math.abs(z - this.oz) < 0.01) return;
    this.ox = x;
    this.oz = z;
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.ctx.clearRect(0, 0, TEX, TEX);
    this.blank = true;
    this.dirty = true;
  }

  /** world -> texture pixels */
  private tx(x: number): number {
    return (x - this.ox + HALF) * SCALE;
  }
  private ty(z: number): number {
    return (HALF - (z - this.oz)) * SCALE;
  }
  /** world length -> texture pixels */
  private tl(w: number): number {
    return w * SCALE;
  }

  /**
   * Ink dries: one uniform alpha decay over the whole sheet.
   *
   * Batched to FADE_HZ rather than run per frame. Every fade dirties the canvas
   * and forces a full 1024x1024 texture re-upload, so doing it 60 times a second
   * is 4MB/frame of pure upload for a change nobody can see between frames.
   */
  fadeWith(dt: number, lifetime: number) {
    if (this.blank) return;
    const life = Math.max(0.1, lifetime);
    this.idleFor += dt;
    this.fadeAccum += dt;
    const step = 1 / InkSurface.FADE_HZ;
    if (this.fadeAccum < step) return;
    const a = 1 - Math.pow(0.04, this.fadeAccum / life);
    this.fadeAccum = 0;
    if (a <= 0) return;
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = `rgba(0,0,0,${a})`;
    c.fillRect(0, 0, TEX, TEX);
    c.restore();
    this.dirty = true;
    // once everything has dried past visibility, wipe once and go quiet
    if (this.idleFor > life * 2.2) {
      this.ctx.clearRect(0, 0, TEX, TEX);
      this.blank = true;
    }
  }

  /**
   * One segment of a collective brush stroke: a tapered quad for the body,
   * bristle lines alongside it, then erase streaks for the dry-brush breakup.
   */
  segment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    wA: number,
    wB: number,
    style: BrushStyle,
  ) {
    const c = this.ctx;
    const x0 = this.tx(ax);
    const y0 = this.ty(az);
    const x1 = this.tx(bx);
    const y1 = this.ty(bz);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.6) return;

    const nx = -dy / len;
    const ny = dx / len;
    const hA = Math.max(0.5, this.tl(wA) * 0.5);
    const hB = Math.max(0.5, this.tl(wB) * 0.5);
    const wob = this.tl(style.wobble);

    c.save();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = style.color;
    c.strokeStyle = style.color;
    c.lineCap = 'round';

    // --- body. Stamped as overlapping discs of jittered radius rather than a
    // clean capsule: a single round-capped line gives perfectly parallel edges,
    // which reads as a printed bar, not a loaded brush.
    const j = () => (Math.random() - 0.5) * wob;
    c.globalAlpha = style.alpha;
    const steps = Math.max(2, Math.ceil(len / Math.max(2, (hA + hB) * 0.28)));
    // One path, one fill. Filling each disc separately makes the overlaps
    // accumulate alpha to solid black, which erases the density signal --
    // a scattered swarm ended up exactly as dark as a packed one.
    c.beginPath();
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const h = (hA + (hB - hA) * f) * (0.86 + Math.random() * 0.26);
      const px = x0 + dx * f + j();
      const py = y0 + dy * f + j();
      c.moveTo(px + h, py);
      c.arc(px, py, h, 0, 6.2832);
    }
    c.fill();

    // --- bristles: the brush tip is split, so a few hairs run their own path
    const n = Math.round(style.bristles);
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : k / (n - 1) - 0.5;
      const offA = t * hA * 2 * style.spread;
      const offB = t * hB * 2 * style.spread;
      // a bristle that has run dry skips this segment entirely
      if (Math.random() < style.kasure * 0.45) continue;
      c.globalAlpha = style.alpha * (0.12 + Math.random() * 0.4);
      c.lineWidth = Math.max(0.7, hA * (0.09 + Math.random() * 0.16));
      c.beginPath();
      c.moveTo(x0 + nx * offA + j(), y0 + ny * offA + j());
      c.lineTo(x1 + nx * offB + j(), y1 + ny * offB + j());
      c.stroke();
    }

    // --- kasure. Erased along FIXED lanes running the full segment, so the
    // gaps line up across consecutive segments into long dry streaks. Random
    // per-segment cuts just look like notches punched in a bar.
    if (style.kasure > 0.02) {
      c.globalCompositeOperation = 'destination-out';
      const ph = style.phase;
      for (let k = 0; k < DRY_LANES.length; k++) {
        // Lanes drift and break on a slow pseudo-noise instead of a per-segment
        // coin flip: fixed lanes plus random skips read as regular dashes.
        const n1 = Math.sin(ph * 0.71 + k * 12.9) * 0.5 + 0.5;
        const n2 = Math.sin(ph * 0.29 + k * 7.31) * 0.5 + 0.5;
        const dryness = n1 * 0.62 + n2 * 0.38;
        if (dryness > style.kasure * 1.35) continue;
        const t = DRY_LANES[k] + Math.sin(ph * 0.9 + k * 3.1) * 0.07;
        if (style.kasure < Math.abs(t) * 0.55) continue;
        c.globalAlpha = style.kasure * (0.3 + dryness * 0.7);
        c.lineWidth = Math.max(0.6, hA * (0.05 + dryness * 0.16));
        c.beginPath();
        c.moveTo(x0 + nx * t * hA, y0 + ny * t * hA);
        c.lineTo(x1 + nx * t * hB, y1 + ny * t * hB);
        c.stroke();
      }
      // plus a few short scuffs for texture
      const scuffs = Math.round(style.kasure * 4);
      for (let k = 0; k < scuffs; k++) {
        const t = (Math.random() - 0.5) * 1.7;
        c.globalAlpha = style.kasure * 0.4;
        c.lineWidth = Math.max(0.6, hA * 0.09);
        const s = Math.random() * 0.6;
        c.beginPath();
        c.moveTo(x0 + dx * s + nx * t * hA, y0 + dy * s + ny * t * hA);
        c.lineTo(x0 + dx * Math.min(1, s + 0.45) + nx * t * hB, y0 + dy * Math.min(1, s + 0.45) + ny * t * hB);
        c.stroke();
      }
    }

    c.restore();
    this.touched();
  }

  /** Push the canvas to the GPU, at most once per frame and only if painted. */
  commit() {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}

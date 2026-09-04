import * as THREE from 'three';

const MAX_PARTICLES = 700;
const MAX_RINGS = 16;

/**
 * Lightweight game-feel layer: camera shake, hit stop, particles, expanding
 * rings, floating damage numbers and a screen flash. Deliberately cheap so it
 * never hides the swarm (spec 31).
 */
export class Fx {
  shakeAmount = 0;
  hitStop = 0;

  private points: THREE.Points;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private pBase: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pMax: Float32Array;
  private pCursor = 0;

  private rings: THREE.Mesh[] = [];
  private ringLife: number[] = [];
  private ringMaxLife: number[] = [];
  private ringGrow: number[] = [];

  private dmgLayer = document.getElementById('dmg') as HTMLDivElement;
  private flashEl = document.getElementById('flash') as HTMLDivElement;
  private flash = 0;
  private ndc = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pBase = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -999;
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const m = new THREE.PointsMaterial({
      size: 0.22,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);

    const ringGeo = new THREE.RingGeometry(0.86, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.rings.push(mesh);
      this.ringLife.push(0);
      this.ringMaxLife.push(1);
      this.ringGrow.push(1);
    }
  }

  /** Living palette darkens the screen on a huge hit instead of whitening it. */
  setFlashDark(on: boolean) {
    this.flashEl.style.background = on ? '#04050a' : '#fff';
  }

  /** Additive FX vanish on white paper, so flip them to normal blending. */
  setInkMode(on: boolean) {
    const pm = this.points.material as THREE.PointsMaterial;
    pm.blending = on ? THREE.NormalBlending : THREE.AdditiveBlending;
    pm.opacity = on ? 0.7 : 0.9;
    for (const r of this.rings) {
      const rm = r.material as THREE.MeshBasicMaterial;
      rm.blending = on ? THREE.NormalBlending : THREE.AdditiveBlending;
    }
    this.flashEl.style.background = on ? '#2a2430' : '#fff';
  }

  shake(amount: number) {
    this.shakeAmount = Math.min(1.4, this.shakeAmount + amount);
  }

  stop(seconds: number) {
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  screenFlash(a: number) {
    this.flash = Math.min(0.55, this.flash + a);
  }

  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: THREE.ColorRepresentation,
    speed = 6,
    life = 0.5,
  ) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const i3 = this.pCursor * 3;
      this.pPos[i3] = x;
      this.pPos[i3 + 1] = y;
      this.pPos[i3 + 2] = z;
      const th = Math.random() * Math.PI * 2;
      const ph = (Math.random() - 0.3) * 1.2;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.pVel[i3] = Math.cos(th) * Math.cos(ph) * s;
      this.pVel[i3 + 1] = Math.sin(ph) * s * 0.7 + 1.5;
      this.pVel[i3 + 2] = Math.sin(th) * Math.cos(ph) * s;
      this.pBase[i3] = c.r;
      this.pBase[i3 + 1] = c.g;
      this.pBase[i3 + 2] = c.b;
      this.pCol[i3] = c.r;
      this.pCol[i3 + 1] = c.g;
      this.pCol[i3 + 2] = c.b;
      const l = life * (0.6 + Math.random() * 0.7);
      this.pLife[this.pCursor] = l;
      this.pMax[this.pCursor] = l;
      this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    }
  }

  ring(
    x: number,
    z: number,
    from: number,
    to: number,
    life: number,
    color: THREE.ColorRepresentation,
    y = 0.06,
  ) {
    for (let i = 0; i < this.rings.length; i++) {
      if (this.ringLife[i] > 0) continue;
      const r = this.rings[i];
      r.visible = true;
      r.position.set(x, y, z);
      r.scale.setScalar(from);
      (r.material as THREE.MeshBasicMaterial).color.set(color);
      this.ringLife[i] = life;
      this.ringMaxLife[i] = life;
      this.ringGrow[i] = (to - from) / life;
      return;
    }
  }

  damageNumber(
    world: THREE.Vector3,
    camera: THREE.Camera,
    text: string,
    kind: 'normal' | 'big' | 'guard' | 'light' = 'normal',
  ) {
    this.ndc.copy(world).project(camera);
    if (this.ndc.z > 1) return;
    const el = document.createElement('div');
    el.className = 'dn' + (kind === 'normal' ? '' : ' ' + kind);
    el.textContent = text;
    const x = (this.ndc.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.ndc.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = x.toFixed(0) + 'px';
    el.style.top = y.toFixed(0) + 'px';
    this.dmgLayer.appendChild(el);
    const dx = (Math.random() - 0.5) * 44;
    requestAnimationFrame(() => {
      el.style.transform = `translate(-50%,-50%) translate(${dx.toFixed(0)}px,-58px) scale(${
        kind === 'big' ? 1.15 : 1
      })`;
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 700);
  }

  /** Advance FX with UNSCALED time so hit stop does not freeze its own recovery. */
  update(dt: number) {
    this.shakeAmount *= Math.exp(-7 * dt);
    if (this.shakeAmount < 0.001) this.shakeAmount = 0;
    this.hitStop = Math.max(0, this.hitStop - dt);

    this.flash *= Math.exp(-9 * dt);
    if (this.flash < 0.004) this.flash = 0;
    this.flashEl.style.opacity = this.flash.toFixed(3);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) {
        this.pPos[i3 + 1] = -999;
        this.pCol[i3] = this.pCol[i3 + 1] = this.pCol[i3 + 2] = 0;
        continue;
      }
      this.pVel[i3 + 1] -= 9 * dt;
      const drag = Math.exp(-2.2 * dt);
      this.pVel[i3] *= drag;
      this.pVel[i3 + 2] *= drag;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      // PointsMaterial has one global size, so fade by dimming the colour.
      const t = this.pLife[i] / this.pMax[i];
      this.pCol[i3] = this.pBase[i3] * t;
      this.pCol[i3 + 1] = this.pBase[i3 + 1] * t;
      this.pCol[i3 + 2] = this.pBase[i3 + 2] * t;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    for (let i = 0; i < this.rings.length; i++) {
      if (this.ringLife[i] <= 0) continue;
      this.ringLife[i] -= dt;
      const r = this.rings[i];
      if (this.ringLife[i] <= 0) {
        r.visible = false;
        continue;
      }
      const t = this.ringLife[i] / this.ringMaxLife[i];
      r.scale.setScalar(r.scale.x + this.ringGrow[i] * dt);
      (r.material as THREE.MeshBasicMaterial).opacity = t * 0.75;
    }
  }

  applyShake(camera: THREE.Camera, t: number) {
    if (this.shakeAmount <= 0) return;
    const a = this.shakeAmount;
    camera.position.x += Math.sin(t * 61) * a * 0.85;
    camera.position.y += Math.sin(t * 47.3) * a * 0.5;
    camera.position.z += Math.cos(t * 53.7) * a * 0.85;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.scene.remove(this.points);
    for (const r of this.rings) {
      (r.material as THREE.Material).dispose();
      this.scene.remove(r);
    }
    this.rings[0]?.geometry.dispose();
    this.dmgLayer.innerHTML = '';
    this.flashEl.style.opacity = '0';
  }
}

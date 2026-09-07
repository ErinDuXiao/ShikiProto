import * as THREE from 'three';

const MAX_PARTICLES = 700;
const MAX_RINGS = 16;
/** impact flashes alive at once; a big recall lands a dozen in one frame */
const MAX_IMPACTS = 18;
/** the camera's fixed tilt, so a flat quad can fake a billboard for free */
const CAMERA_TILT = -Math.atan2(22, 28);

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

  private impacts: THREE.Mesh[] = [];
  private impactLife: number[] = [];
  private impactMax: number[] = [];
  private impactGrow: number[] = [];
  private impactCursor = 0;

  /**
   * Camera response to a hit, kept separate from `shakeAmount`.
   *
   * Shake is noise -- it says "something happened" but not what or where. A
   * kick pushes the view along the direction the blow travelled, and a punch
   * dollies in for a fraction of a second. Both decay fast and both are applied
   * on top of the rig's own position, which restore() puts back every frame.
   */
  private kickX = 0;
  private kickZ = 0;
  private punchAmount = 0;
  private fwd = new THREE.Vector3();

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

    const impactGeo = new THREE.PlaneGeometry(1, 1);
    const impactMat = new THREE.MeshBasicMaterial({
      map: impactTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // A flash sits ON the target, so it must not be depth-tested against it.
      // Placed at the contact point it lands inside the body and was being
      // rejected outright -- the effect fired and nothing appeared.
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    for (let i = 0; i < MAX_IMPACTS; i++) {
      const mesh = new THREE.Mesh(impactGeo, impactMat.clone());
      mesh.rotation.x = CAMERA_TILT;
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.impacts.push(mesh);
      this.impactLife.push(0);
      this.impactMax.push(1);
      this.impactGrow.push(1);
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

  /** Shove the view along the direction a blow travelled. */
  kick(dx: number, dz: number, amount: number) {
    this.kickX += dx * amount;
    this.kickZ += dz * amount;
    const l = Math.hypot(this.kickX, this.kickZ);
    if (l > 2.4) {
      this.kickX = (this.kickX / l) * 2.4;
      this.kickZ = (this.kickZ / l) * 2.4;
    }
  }

  /** Snap the camera in a little. Reads as weight rather than as motion. */
  punch(amount: number) {
    this.punchAmount = Math.min(2.8, this.punchAmount + amount);
  }

  /**
   * The moment of contact, at the point of contact.
   *
   * Two things the omnidirectional burst could not say: WHERE the blow landed,
   * and which way it was going. Sparks are thrown in a cone along the travel
   * direction with a little back-spray, and a flash quad opens on the spot for
   * about a tenth of a second.
   */
  impact(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    strength: number,
    color: THREE.ColorRepresentation = 0xfff2d0,
  ) {
    const st = Math.max(0.15, Math.min(1, strength));

    const i = this.impactCursor;
    this.impactCursor = (this.impactCursor + 1) % MAX_IMPACTS;
    const m = this.impacts[i];
    m.position.set(x, y, z);
    // spin each one differently so a run of hits does not look stamped
    m.rotation.z = Math.random() * Math.PI * 2;
    // Sized against the target rather than the screen. An earlier pass grew
    // these to ~8 units across, which stopped reading as an impact and started
    // reading as a white blob over the fight.
    const size = 1.2 + st * 3.0;
    m.scale.setScalar(size * 0.55);
    m.visible = true;
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    // Full bright on its OWN frame. Opacity was only being set in update(), so
    // the first of a nine-frame effect rendered at whatever the pooled slot had
    // left over -- usually near zero, which is the frame that matters most.
    mat.opacity = 1;
    this.impactLife[i] = 0.085 + st * 0.07;
    this.impactMax[i] = this.impactLife[i];
    this.impactGrow[i] = size * 2.6;

    this.spray(x, y, z, dx, dz, Math.round(4 + st * 14), st, color);
  }

  /** sparks thrown along a direction rather than in all of them */
  private spray(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    count: number,
    strength: number,
    color: THREE.ColorRepresentation,
  ) {
    const c = new THREE.Color(color);
    const base = Math.atan2(dz, dx);
    for (let k = 0; k < count; k++) {
      const i3 = this.pCursor * 3;
      this.pPos[i3] = x;
      this.pPos[i3 + 1] = y;
      this.pPos[i3 + 2] = z;
      // most of it continues along the blow, a quarter sprays back off it
      const back = Math.random() < 0.25;
      const spread = back ? 1.5 : 0.55;
      const a = base + (back ? Math.PI : 0) + (Math.random() - 0.5) * spread * 2;
      const sp = (7 + strength * 26) * (0.4 + Math.random() * 0.9) * (back ? 0.5 : 1);
      this.pVel[i3] = Math.cos(a) * sp;
      this.pVel[i3 + 1] = (Math.random() - 0.15) * 5 + 2;
      this.pVel[i3 + 2] = Math.sin(a) * sp;
      this.pBase[i3] = c.r;
      this.pBase[i3 + 1] = c.g;
      this.pBase[i3 + 2] = c.b;
      this.pCol[i3] = c.r;
      this.pCol[i3 + 1] = c.g;
      this.pCol[i3 + 2] = c.b;
      const life = 0.16 + Math.random() * 0.22;
      this.pLife[this.pCursor] = life;
      this.pMax[this.pCursor] = life;
      this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    }
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

    // faster than the shake: a kick that lingers reads as a camera fault
    const k = Math.exp(-13 * dt);
    this.kickX *= k;
    this.kickZ *= k;
    if (Math.abs(this.kickX) < 0.0005) this.kickX = 0;
    if (Math.abs(this.kickZ) < 0.0005) this.kickZ = 0;
    this.punchAmount *= Math.exp(-10 * dt);
    if (this.punchAmount < 0.002) this.punchAmount = 0;

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

    for (let i = 0; i < this.impacts.length; i++) {
      if (this.impactLife[i] <= 0) continue;
      this.impactLife[i] -= dt;
      const m = this.impacts[i];
      if (this.impactLife[i] <= 0) {
        m.visible = false;
        continue;
      }
      const t = this.impactLife[i] / this.impactMax[i];
      m.scale.setScalar(m.scale.x + this.impactGrow[i] * dt);
      // full bright the instant it lands, then straight out
      (m.material as THREE.MeshBasicMaterial).opacity = t * t;
    }

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
    if (this.shakeAmount > 0) {
      const a = this.shakeAmount;
      camera.position.x += Math.sin(t * 61) * a * 0.85;
      camera.position.y += Math.sin(t * 47.3) * a * 0.5;
      camera.position.z += Math.cos(t * 53.7) * a * 0.85;
    }
    if (this.kickX !== 0 || this.kickZ !== 0) {
      camera.position.x += this.kickX;
      camera.position.z += this.kickZ;
    }
    if (this.punchAmount > 0) {
      camera.getWorldDirection(this.fwd);
      camera.position.addScaledVector(this.fwd, this.punchAmount);
    }
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
    for (const m of this.impacts) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      this.scene.remove(m);
    }
    this.impacts[0]?.geometry.dispose();
    this.dmgLayer.innerHTML = '';
    this.flashEl.style.opacity = '0';
  }
}

/**
 * A bright core with four tapered spikes -- the shape an impact reads as at a
 * glance, drawn once and shared by every flash quad.
 */
function impactTexture(): THREE.CanvasTexture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const h = N / 2;

  const g = ctx.createRadialGradient(h, h, 0, h, h, h * 0.42);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(h, h);
    ctx.rotate((k * Math.PI) / 2 + Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.96);
    ctx.lineTo(h * 0.075, 0);
    ctx.lineTo(0, h * 0.16);
    ctx.lineTo(-h * 0.075, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

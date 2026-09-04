import * as THREE from 'three';
import { SHIKIGAMI_Y } from './params';

/**
 * Keyboard + mouse input. Mouse position is raycast onto the shikigami plane so
 * the aim vector lives in world space (spec 7).
 */
export class Input {
  private keys = new Set<string>();
  private ndc = new THREE.Vector2(0, 0);
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SHIKIGAMI_Y);

  /** world point under the cursor, on the shikigami plane */
  readonly aimPoint = new THREE.Vector3(0, SHIKIGAMI_Y, -10);

  rmb = false;
  private lmbEdge = false;
  private dashEdge = false;
  private skill1Edge = false;
  private skill2Edge = false;
  private disposers: Array<() => void> = [];

  constructor(private dom: HTMLElement) {
    this.on(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      const k = ev.code;
      if (k === 'Space') {
        ev.preventDefault();
        if (!this.keys.has(k)) this.skill1Edge = true;
      }
      if (k === 'KeyQ' && !this.keys.has(k)) this.skill2Edge = true;
      if ((k === 'ShiftLeft' || k === 'ShiftRight') && !this.keys.has(k)) this.dashEdge = true;
      this.keys.add(k);
    });
    this.on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.on(window, 'blur', () => {
      this.keys.clear();
      this.rmb = false;
    });
    this.on(dom, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      if (ev.button === 0) this.lmbEdge = true;
      if (ev.button === 2) this.rmb = true;
    });
    this.on(window, 'pointerup', (e) => {
      if ((e as PointerEvent).button === 2) this.rmb = false;
    });
    this.on(window, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      this.ndc.x = (ev.clientX / window.innerWidth) * 2 - 1;
      this.ndc.y = -(ev.clientY / window.innerHeight) * 2 + 1;
    });
    this.on(dom, 'contextmenu', (e) => e.preventDefault());
  }

  private on(t: EventTarget, type: string, fn: (e: Event) => void) {
    t.addEventListener(type, fn);
    this.disposers.push(() => t.removeEventListener(type, fn));
  }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  get shift(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** SPACE — Divine Core */
  consumeSkill1(): boolean {
    const v = this.skill1Edge;
    this.skill1Edge = false;
    return v;
  }

  /** Q — Spider Bind */
  consumeSkill2(): boolean {
    const v = this.skill2Edge;
    this.skill2Edge = false;
    return v;
  }

  /** WASD as a normalised world-space direction (camera has no yaw, so axes map directly). */
  moveVector(out: THREE.Vector3): THREE.Vector3 {
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    out.set(x, 0, z);
    if (out.lengthSq() > 0) out.normalize();
    return out;
  }

  consumeLmb(): boolean {
    const v = this.lmbEdge;
    this.lmbEdge = false;
    return v;
  }

  consumeDash(): boolean {
    const v = this.dashEdge;
    this.dashEdge = false;
    return v;
  }

  updateAim(camera: THREE.Camera) {
    this.ray.setFromCamera(this.ndc, camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.aimPoint)) {
      // camera ray parallel to the plane -- keep the previous aim point
    }
  }
}

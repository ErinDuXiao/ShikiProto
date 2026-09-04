import * as THREE from 'three';

const OFFSET = new THREE.Vector3(0, 28, 22);
/** how much further back the view sits when nothing is trying to kill you */
const CALM_PULL = 1.22;

/** a hidden tab reports 0x0, which would make the projection matrix NaN */
function safeAspect(a: number): number {
  return Number.isFinite(a) && a > 0 ? a : 16 / 9;
}

/**
 * Quarter view. It does not sit rigidly on the player: it leans toward the
 * swarm centroid so scattered shikigami stay on screen (spec 4).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private base = new THREE.Vector3();
  private offset = OFFSET.clone();
  private calm = 0;
  private ahead = new THREE.Vector3();
  private aheadTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(48, safeAspect(aspect), 0.5, 900);
    this.camera.position.copy(OFFSET);
    this.camera.lookAt(0, 0, 0);
  }

  resize(aspect: number) {
    this.camera.aspect = safeAspect(aspect);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Out of combat the camera eases back a notch, which is the entire licence
   * spec 29 gives: no new angle, no cutscene framing -- just enough room to see
   * the street and the whole flock while walking.
   */
  setCalm(on: boolean, dt: number) {
    const target = on ? 1 : 0;
    this.calm += (target - this.calm) * (1 - Math.exp(-1.6 * dt));
    const s = 1 + (CALM_PULL - 1) * this.calm;
    this.offset.set(OFFSET.x, OFFSET.y * s, OFFSET.z * s);
  }

  /**
   * Nudge the framing down the road while walking. At this pitch the view only
   * reaches about 45 units past the player, so without this you cannot see the
   * street you are walking into at all -- the licence spec 29 gives for
   * "widening forward visibility a little", and nothing more.
   */
  setLookAhead(x: number, z: number, dt: number) {
    this.aheadTarget.set(x, 0, z);
    this.ahead.lerp(this.aheadTarget, 1 - Math.exp(-2.2 * dt));
  }

  update(dt: number, playerPos: THREE.Vector3, swarmCenter: THREE.Vector3) {
    // 35% toward the swarm, capped so a far-flung group never yanks the view
    this.desired.copy(swarmCenter).sub(playerPos);
    this.desired.y = 0;
    const len = this.desired.length();
    if (len > 9) this.desired.multiplyScalar(9 / len);
    this.desired.multiplyScalar(0.35).add(playerPos);
    this.desired.add(this.ahead);
    this.desired.y = 0;

    const k = 1 - Math.exp(-5.5 * dt);
    this.look.lerp(this.desired, k);
    this.base.copy(this.look).add(this.offset);
    this.camera.position.copy(this.base);
    this.camera.lookAt(this.look);
  }

  /** re-apply the un-shaken transform (fx adds shake on top each frame) */
  restore() {
    this.camera.position.copy(this.base);
  }
}

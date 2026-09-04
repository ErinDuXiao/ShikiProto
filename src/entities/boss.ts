import * as THREE from 'three';
import { EnemyBase, type EnemyWorld } from './enemy';

type BossState = 'idle' | 'slam' | 'charge' | 'vacuum';

/**
 * The Oni. Guards its front, so hammering it head-on with shikigami is a waste
 * -- the player has to walk around it and recall THROUGH it (spec 19).
 */
export class Oni extends EnemyBase {
  phase = 1;
  private state: BossState = 'idle';
  private timer = 1.6;
  private sub = 0;
  private chargeDir = new THREE.Vector3(0, 0, 1);
  private body: THREE.Mesh;
  private shield: THREE.Mesh;
  private tell: THREE.Mesh;
  private core: THREE.Mesh;
  private baseScale = 1;

  /** set by GameManager so it can react to phase transitions */
  onPhase?: (phase: number) => void;

  constructor(scene: THREE.Scene, x: number, z: number) {
    super(scene);
    this.isBoss = true;
    this.maxHp = this.hp = 1800;
    this.mass = 30;
    this.maxKnock = 3.2;
    this.radius = 3.0;
    this.hitHeight = 3.2;
    this.pos.set(x, 0, z);

    this.body = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.6, 4.6, 6),
      new THREE.MeshStandardMaterial({
        color: 0xa8202c,
        emissive: 0x40060e,
        emissiveIntensity: 1,
        roughness: 0.42,
        flatShading: true,
      }),
    );
    this.body.position.y = 2.4;
    this.group.add(this.body);

    const hornMat = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 5), hornMat);
      horn.position.set(s * 0.95, 5.0, 0.2);
      horn.rotation.z = s * -0.35;
      this.group.add(horn);
    }

    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffcf5a }),
    );
    this.core.position.set(0, 3.1, -1.6); // the exposed back core
    this.group.add(this.core);

    // front guard plate -- a visual promise that the front is bad news
    const sg = new THREE.CylinderGeometry(3.05, 3.05, 3.6, 24, 1, true, -0.95, 1.9);
    this.shield = new THREE.Mesh(
      sg,
      new THREE.MeshBasicMaterial({
        color: 0x5fd8ff,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.shield.position.y = 2.4;
    this.group.add(this.shield);

    const tg = new THREE.RingGeometry(0.8, 1.0, 40);
    tg.rotateX(-Math.PI / 2);
    this.tell = new THREE.Mesh(
      tg,
      new THREE.MeshBasicMaterial({
        color: 0xff2a1a,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.tell.position.y = 0.07;
    scene.add(this.tell);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** front = heavily reduced, back = big bonus. */
  damageMultiplier(dir: THREE.Vector3): number {
    // dir is the shikigami travel direction; a hit "into the face" travels
    // opposite to where the boss is looking.
    const facingDot = -(dir.x * this.facing.x + dir.z * this.facing.z);
    if (facingDot > 0.45) return this.phase >= 3 ? 0.05 : 0.18; // front
    if (facingDot < -0.3) return this.phase >= 3 ? 3.0 : 2.4; // back
    return this.phase >= 3 ? 0.85 : 1.0; // flank
  }

  update(dt: number, world: EnemyWorld) {
    const hpFrac = this.hp / this.maxHp;
    if (this.phase === 1 && hpFrac <= 0.6) this.setPhase(2, world);
    else if (this.phase === 2 && hpFrac <= 0.25) this.setPhase(3, world);

    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;

    // turn toward the player, slowly enough that flanking works
    if (this.state !== 'charge') {
      const want = Math.atan2(dx, dz);
      const cur = Math.atan2(this.facing.x, this.facing.z);
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const turnRate = this.state === 'idle' ? 1.5 + this.phase * 0.25 : 0.45;
      const step = THREE.MathUtils.clamp(d, -turnRate * dt, turnRate * dt);
      const na = cur + step;
      this.facing.set(Math.sin(na), 0, Math.cos(na));
    }

    const tellMat = this.tell.material as THREE.MeshBasicMaterial;

    switch (this.state) {
      case 'idle': {
        this.timer -= dt;
        // drift toward the player so it never turtles in a corner
        if (dist > 7) {
          this.pos.x += (dx / dist) * 2.6 * dt;
          this.pos.z += (dz / dist) * 2.6 * dt;
        }
        tellMat.opacity = 0;
        if (this.timer <= 0) this.pickAttack(world, dist);
        break;
      }
      case 'slam': {
        this.timer -= dt;
        const total = 0.85;
        const t = 1 - this.timer / total;
        this.tell.position.set(
          this.pos.x + this.facing.x * 4.6,
          0.07,
          this.pos.z + this.facing.z * 4.6,
        );
        this.tell.scale.setScalar(5.6);
        tellMat.color.setHex(0xff2a1a);
        tellMat.opacity = 0.2 + t * 0.55;
        this.body.rotation.x = -t * 0.28;
        if (this.timer <= 0) {
          this.body.rotation.x = 0;
          tellMat.opacity = 0;
          const cx = this.pos.x + this.facing.x * 4.6;
          const cz = this.pos.z + this.facing.z * 4.6;
          world.fx.ring(cx, cz, 1.5, 8.5, 0.34, 0xff5533);
          world.fx.burst(cx, 0.4, cz, 42, 0xff6a3a, 13, 0.55);
          world.fx.shake(0.5);
          world.sfx.hit(1);
          const pd = Math.hypot(world.playerPos.x - cx, world.playerPos.z - cz);
          if (pd < 5.6) world.hitPlayer(11, this.pos);
          this.state = 'idle';
          this.timer = this.restTime();
        }
        break;
      }
      case 'charge': {
        this.timer -= dt;
        if (this.sub === 0) {
          // wind up
          tellMat.color.setHex(0xffaa22);
          tellMat.opacity = 0.55;
          this.tell.position.set(
            this.pos.x + this.chargeDir.x * 7,
            0.07,
            this.pos.z + this.chargeDir.z * 7,
          );
          this.tell.scale.setScalar(2.4);
          if (this.timer <= 0) {
            this.sub = 1;
            this.timer = 0.6;
            world.sfx.dash();
          }
        } else {
          tellMat.opacity = 0;
          const sp = 30;
          this.pos.x += this.chargeDir.x * sp * dt;
          this.pos.z += this.chargeDir.z * sp * dt;
          if (dist < 3.4) world.hitPlayer(12, this.pos);
          if (this.timer <= 0) {
            world.fx.shake(0.3);
            this.state = 'idle';
            this.sub = 0;
            this.timer = this.restTime();
          }
        }
        break;
      }
      case 'vacuum': {
        this.timer -= dt;
        const total = 1.0;
        const t = 1 - this.timer / total;
        tellMat.color.setHex(0xb06bff);
        tellMat.opacity = 0.25 + t * 0.5;
        this.tell.position.set(this.pos.x, 0.07, this.pos.z);
        this.tell.scale.setScalar(14 * (1 - t * 0.55));
        if (this.timer <= 0) {
          tellMat.opacity = 0;
          world.fx.ring(this.pos.x, this.pos.z, 12, 1.5, 0.4, 0xb06bff);
          world.fx.burst(this.pos.x, 2.4, this.pos.z, 50, 0x9a4dff, 10, 0.7);
          world.fx.shake(0.32);
          world.vacuum(this, 10 + Math.floor(Math.random() * 11));
          this.state = 'idle';
          this.timer = this.restTime();
        }
        break;
      }
    }

    this.integrateKnock(dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(this.facing.x, this.facing.z);

    this.flash = Math.max(0, this.flash - dt * 5);
    const m = this.body.material as THREE.MeshStandardMaterial;
    const p3 = this.phase >= 3 ? 0.35 : 0;
    m.color.setRGB(0.34, 0.05, 0.1);
    m.emissive.setRGB(0.16 + p3 * 0.5 + this.flash * 1.1, 0.014 + this.flash * 0.5, 0.04 + this.flash * 0.5);
    const pulse = this.phase >= 3 ? 1 + Math.sin(performance.now() * 0.006) * 0.03 : 1;
    this.group.scale.setScalar(this.baseScale * pulse);
    (this.shield.material as THREE.MeshBasicMaterial).opacity =
      this.phase >= 3 ? 0.34 + Math.sin(performance.now() * 0.005) * 0.08 : 0.16;
    (this.core.material as THREE.MeshBasicMaterial).color.setRGB(
      1,
      0.78 + Math.sin(performance.now() * 0.004) * 0.15,
      0.3,
    );
  }

  private restTime(): number {
    return this.phase === 1 ? 2.6 : this.phase === 2 ? 2.1 : 1.75;
  }

  private pickAttack(world: EnemyWorld, dist: number) {
    const roll = Math.random();
    if (this.phase >= 2 && roll < 0.32) {
      this.state = 'vacuum';
      this.timer = 1.0;
      world.sfx.hurt();
      return;
    }
    if (dist > 9 || roll > 0.68) {
      this.state = 'charge';
      this.sub = 0;
      this.timer = 0.7;
      const dx = world.playerPos.x - this.pos.x;
      const dz = world.playerPos.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.chargeDir.set(dx / d, 0, dz / d);
      this.facing.copy(this.chargeDir);
    } else {
      this.state = 'slam';
      this.timer = 0.85;
    }
  }

  private setPhase(p: number, world: EnemyWorld) {
    this.phase = p;
    this.state = 'idle';
    this.sub = 0;
    this.timer = 1.1;
    if (p === 3) this.baseScale = 1.2;
    world.fx.ring(this.pos.x, this.pos.z, 2, 20, 0.7, p === 3 ? 0xff2a1a : 0xb06bff);
    world.fx.shake(0.7);
    world.fx.screenFlash(0.2);
    world.sfx.bigHit(20);
    this.onPhase?.(p);
  }

  override dispose() {
    this.scene.remove(this.tell);
    this.tell.geometry.dispose();
    (this.tell.material as THREE.Material).dispose();
    super.dispose();
  }
}

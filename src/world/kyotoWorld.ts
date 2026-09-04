import * as THREE from 'three';
import { LOCATIONS, START, type LocationId } from './locations';

/**
 * The night city (spec 26/27).
 *
 * Low-poly on purpose. The brief is not a historical reconstruction -- it is
 * "one look and you know it is an old Japanese capital at night", built from a
 * handful of primitives so the frame budget stays with the swarm.
 *
 * Everything repeated is an InstancedMesh; the whole city is a little over a
 * dozen draw calls.
 */

const NIGHT = 0x05060a;
const STONE = 0x1a1d26;
const WOOD = 0x22181a;
const PLASTER = 0x2b2c33;
const WATER = 0x070a14;
const LANTERN = 0xffb46a;
/**
 * Height of every walkable surface. Anything the player walks ON must top out
 * below SHIKIGAMI_Y (0.95) or it hides the flock inside itself.
 */
const DECK_TOP = 0.15;

interface Box {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  ry: number;
}

/** the walked route, in order, used to lay paving and lanterns */
export const ROAD_PATH: Array<{ x: number; z: number }> = [];

function seg(a: { x: number; z: number }, b: { x: number; z: number }) {
  return { a, b, len: Math.hypot(b.x - a.x, b.z - a.z) };
}

export class KyotoWorld {
  readonly group = new THREE.Group();
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor(private scene: THREE.Scene) {
    this.buildGround();
    this.buildRoads();
    this.buildBridge();
    this.buildAlley();
    this.buildShrine();
    this.buildGraveyard();
    this.buildMansion();
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ ground

  private buildGround() {
    const g = new THREE.PlaneGeometry(1700, 1700);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: NIGHT });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(-190, -0.02, -140);
    this.group.add(mesh);
    this.keep(g, m);

    // the river the bridge crosses: a dark band, slightly reflective-looking
    const rg = new THREE.PlaneGeometry(760, 46);
    rg.rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({ color: WATER });
    const river = new THREE.Mesh(rg, rm);
    river.position.set(0, -0.9, 62);
    this.group.add(river);
    this.keep(rg, rm);

    // faint current lines so the water is not a flat hole
    const lines: number[] = [];
    for (let i = 0; i < 26; i++) {
      const z = 62 + (Math.random() - 0.5) * 40;
      const x = -360 + Math.random() * 720;
      const len = 12 + Math.random() * 26;
      lines.push(x, -0.85, z, x + len, -0.85, z + (Math.random() - 0.5) * 2);
    }
    this.addLines(lines, 0x1d2c40, 0.5);
  }

  // ------------------------------------------------------------------- roads

  private buildRoads() {
    const L = LOCATIONS;
    const path = [
      START,
      { x: L.bridge.x, z: L.bridge.z },
      { x: L.alley.x, z: L.alley.z },
    ];
    ROAD_PATH.length = 0;
    ROAD_PATH.push(...path);

    const segs = [
      seg(START, { x: L.bridge.x, z: L.bridge.z }),
      seg({ x: L.bridge.x, z: L.bridge.z }, { x: L.alley.x, z: L.alley.z }),
      seg({ x: L.alley.x, z: L.alley.z }, { x: L.shrine.x, z: L.shrine.z }),
      seg({ x: L.alley.x, z: L.alley.z }, { x: L.graveyard.x, z: L.graveyard.z }),
      seg({ x: L.shrine.x, z: L.shrine.z }, { x: L.mansion.x, z: L.mansion.z }),
      seg({ x: L.graveyard.x, z: L.graveyard.z }, { x: L.mansion.x, z: L.mansion.z }),
    ];

    // paving: one flat quad per segment
    const paving: Box[] = [];
    const lanterns: Array<{ x: number; z: number }> = [];
    for (const s of segs) {
      const ang = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
      paving.push({
        x: (s.a.x + s.b.x) / 2,
        z: (s.a.z + s.b.z) / 2,
        w: 15,
        h: 0.12,
        d: s.len,
        ry: ang,
      });
      // stone lanterns down both sides, roughly every 26 units
      const n = Math.max(2, Math.floor(s.len / 26));
      const px = Math.cos(ang);
      const pz = -Math.sin(ang);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const cx = s.a.x + (s.b.x - s.a.x) * t;
        const cz = s.a.z + (s.b.z - s.a.z) * t;
        const side = i % 2 === 0 ? 1 : -1;
        lanterns.push({ x: cx + px * 9.5 * side, z: cz + pz * 9.5 * side });
      }
    }
    this.addBoxes(paving, STONE);
    this.addLanterns(lanterns);

    // low earthen walls flanking the long stretches, so the road reads as a street
    const walls: Box[] = [];
    for (const s of segs.slice(0, 2)) {
      const ang = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
      const px = Math.cos(ang);
      const pz = -Math.sin(ang);
      const n = Math.floor(s.len / 18);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const cx = s.a.x + (s.b.x - s.a.x) * t;
        const cz = s.a.z + (s.b.z - s.a.z) * t;
        for (const side of [-1, 1]) {
          // a gap here and there, so it is a town and not a tunnel
          if ((i + (side > 0 ? 1 : 0)) % 5 === 0) continue;
          walls.push({
            x: cx + px * 13 * side,
            z: cz + pz * 13 * side,
            w: 1.1,
            h: 3.2 + Math.random() * 1.6,
            d: 14,
            ry: ang,
          });
        }
      }
    }
    this.addBoxes(walls, PLASTER);
  }

  // ------------------------------------------------------------------ bridge

  private buildBridge() {
    const b = LOCATIONS.bridge.ground;
    const ang = Math.atan2(b.bx - b.ax, b.bz - b.az);
    const len = Math.hypot(b.bx - b.ax, b.bz - b.az) + 24;
    const cx = (b.ax + b.bx) / 2;
    const cz = (b.az + b.bz) / 2;

    // The deck's walking surface sits at DECK_TOP, level with the road paving.
    // Resting on y=0 it stood 1.1 units proud, and since shikigami fly at
    // SHIKIGAMI_Y = 0.95 the whole flock was inside the slab and invisible for
    // the entire first encounter. Kept thin so it stays clear of the river.
    const DECK_H = 0.6;
    this.addBoxes([{ x: cx, z: cz, w: 24, h: DECK_H, d: len, ry: ang }], WOOD, DECK_TOP - DECK_H);

    // railings: two rails plus posts, the thing that makes the line read
    const posts: Box[] = [];
    const n = Math.floor(len / 6);
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5;
      const px = Math.cos(ang);
      const pz = -Math.sin(ang);
      const ax = cx + Math.sin(ang) * len * t;
      const az = cz + Math.cos(ang) * len * t;
      for (const side of [-1, 1]) {
        posts.push({ x: ax + px * 11 * side, z: az + pz * 11 * side, w: 0.7, h: 2.6, d: 0.7, ry: ang });
      }
    }
    // Railings stand ON the deck. They used to be pinned to the old deck top of
    // 1.1, so lowering the deck left them floating in mid-air and the bridge
    // read as though it were hovering.
    this.addBoxes(posts, WOOD, DECK_TOP);
    const rails: Box[] = [];
    for (const side of [-1, 1]) {
      const px = Math.cos(ang) * 11 * side;
      const pz = -Math.sin(ang) * 11 * side;
      rails.push({ x: cx + px, z: cz + pz, w: 0.5, h: 0.4, d: len, ry: ang });
    }
    this.addBoxes(rails, WOOD, DECK_TOP + 2.0);
  }

  // ------------------------------------------------------------------- alley

  private buildAlley() {
    const a = LOCATIONS.alley.ground;
    const ang = Math.atan2(a.bx - a.ax, a.bz - a.az);
    const len = Math.hypot(a.bx - a.ax, a.bz - a.az) + 30;
    const cx = (a.ax + a.bx) / 2;
    const cz = (a.az + a.bz) / 2;
    const px = Math.cos(ang);
    const pz = -Math.sin(ang);

    // paving
    this.addBoxes([{ x: cx, z: cz, w: 22, h: 0.14, d: len, ry: ang }], STONE);

    // machiya on both sides: tall, close, uneven -- the walls ARE the fight
    const houses: Box[] = [];
    const n = Math.floor(len / 13);
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5;
      const bx = cx + Math.sin(ang) * len * t;
      const bz = cz + Math.cos(ang) * len * t;
      for (const side of [-1, 1]) {
        houses.push({
          x: bx + px * 13.5 * side,
          z: bz + pz * 13.5 * side,
          w: 12,
          h: 7 + Math.random() * 4,
          d: 12,
          ry: ang + (Math.random() - 0.5) * 0.1,
        });
      }
    }
    this.addBoxes(houses, WOOD, 0.5, true);

    // one side passage, because the alley teaches "dash sideways" (spec 12)
    this.addBoxes(
      [{ x: cx + px * 26, z: cz + pz * 26, w: 26, h: 0.14, d: 9, ry: ang }],
      STONE,
    );
  }

  // ------------------------------------------------------------------ shrine

  private buildShrine() {
    const L = LOCATIONS.shrine;
    const cx = L.x;
    const cz = L.z;
    this.addDisc(cx, cz, 30, STONE);

    // torii on the approach side
    const ang = Math.atan2(LOCATIONS.alley.x - cx, LOCATIONS.alley.z - cz);
    const tx = cx + Math.sin(ang) * 30;
    const tz = cz + Math.cos(ang) * 30;
    const px = Math.cos(ang);
    const pz = -Math.sin(ang);
    const torii: Box[] = [
      { x: tx + px * 5, z: tz + pz * 5, w: 1.2, h: 9, d: 1.2, ry: ang },
      { x: tx - px * 5, z: tz - pz * 5, w: 1.2, h: 9, d: 1.2, ry: ang },
    ];
    this.addBoxes(torii, 0x5a1f22);
    this.addBoxes(
      [{ x: tx, z: tz, w: 15, h: 0.9, d: 1.4, ry: ang }],
      0x5a1f22,
      8.1,
    );
    this.addBoxes(
      [{ x: tx, z: tz, w: 12, h: 0.7, d: 1.1, ry: ang }],
      0x5a1f22,
      9.0,
    );

    // the hall, opposite the torii
    const hx = cx - Math.sin(ang) * 20;
    const hz = cz - Math.cos(ang) * 20;
    this.addBoxes([{ x: hx, z: hz, w: 16, h: 6, d: 12, ry: ang }], WOOD);
    this.addBoxes([{ x: hx, z: hz, w: 19, h: 1.1, d: 15, ry: ang }], 0x161018, 6);

    // stone lanterns around the yard
    const lan: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      lan.push({ x: cx + Math.cos(a) * 24, z: cz + Math.sin(a) * 24 });
    }
    this.addLanterns(lan);
  }

  // --------------------------------------------------------------- graveyard

  private buildGraveyard() {
    const L = LOCATIONS.graveyard;
    const cx = L.x;
    const cz = L.z;
    this.addDisc(cx, cz, 34, 0x10121a);

    // Blockers, laid out in rough rows. These are the whole point of the
    // location: a straight recall line will not clear them (spec 14).
    const stones: Box[] = [];
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        if (Math.abs(row) + Math.abs(col) < 2) continue; // keep the middle walkable
        const jx = (Math.random() - 0.5) * 3;
        const jz = (Math.random() - 0.5) * 3;
        const x = cx + col * 8.5 + jx;
        const z = cz + row * 8.5 + jz;
        if (Math.hypot(x - cx, z - cz) > 31) continue;
        stones.push({
          x,
          z,
          w: 1.6 + Math.random() * 0.8,
          h: 2.4 + Math.random() * 2.2,
          d: 1.6,
          ry: Math.random() * 0.5,
        });
      }
    }
    this.addBoxes(stones, 0x33363f);

    // willows on the rim
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      this.addWillow(cx + Math.cos(a) * 30, cz + Math.sin(a) * 30);
    }
  }

  // ----------------------------------------------------------------- mansion

  private buildMansion() {
    const L = LOCATIONS.mansion;
    const cx = L.x;
    const cz = L.z;
    this.addDisc(cx, cz, 40, 0x0d0b12);

    // outer wall, broken open on the approach side
    const wall: Box[] = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      // the gap the player walks in through
      if (a > 1.0 && a < 1.9) continue;
      wall.push({
        x: cx + Math.cos(a) * 40,
        z: cz + Math.sin(a) * 40,
        w: 1.4,
        h: 5 + Math.random() * 2,
        d: 11,
        ry: -a,
      });
    }
    this.addBoxes(wall, PLASTER);

    // a veranda and four pillars: something to fight around, not a bare circle
    // same reason as the bridge deck: a raised veranda would hide the flock
    this.addBoxes([{ x: cx, z: cz + 26, w: 40, h: 1.2, d: 12, ry: 0 }], WOOD, DECK_TOP - 1.2);
    const pillars: Box[] = [];
    for (const [dx, dz] of [
      [-15, -12],
      [15, -12],
      [-15, 14],
      [15, 14],
      [-26, 2],
      [26, 2],
    ]) {
      pillars.push({ x: cx + dx, z: cz + dz, w: 2.2, h: 11, d: 2.2, ry: 0 });
    }
    this.addBoxes(pillars, WOOD);

    // the corridor that does not end where the wall is (spec 15)
    this.addBoxes([{ x: cx - 2, z: cz - 46, w: 13, h: 0.2, d: 44, ry: 0 }], WOOD, DECK_TOP - 0.2);
    const corridor: Box[] = [];
    for (let i = 0; i < 7; i++) {
      const z = cz - 30 - i * 8;
      for (const side of [-1, 1]) {
        corridor.push({ x: cx - 2 + side * 7, z, w: 1, h: 6 - i * 0.6, d: 7, ry: 0 });
      }
    }
    this.addBoxes(corridor, WOOD);
  }

  // ------------------------------------------------------------------ pieces

  private addWillow(x: number, z: number) {
    const trunk: Box[] = [{ x, z, w: 1.4, h: 7, d: 1.4, ry: 0 }];
    this.addBoxes(trunk, 0x1d1517);
    const strands: number[] = [];
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 4;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      strands.push(sx, 7.4, sz, sx + (Math.random() - 0.5) * 1.4, 2 + Math.random() * 2.4, sz);
    }
    this.addLines(strands, 0x243026, 0.65);
  }

  private addDisc(x: number, z: number, r: number, color: number) {
    const g = new THREE.CircleGeometry(r, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, 0.02, z);
    this.group.add(mesh);
    this.keep(g, m);
  }

  private addBoxes(boxes: Box[], color: number, yBase = 0, jitterShade = false) {
    if (!boxes.length) return;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.InstancedMesh(g, m, boxes.length);
    mesh.frustumCulled = false;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      d.position.set(b.x, yBase + b.h / 2, b.z);
      d.rotation.set(0, b.ry, 0);
      d.scale.set(b.w, b.h, b.d);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      if (jitterShade) {
        c.setHex(color).multiplyScalar(0.75 + Math.random() * 0.5);
        mesh.setColorAt(i, c);
      }
    }
    this.group.add(mesh);
    this.keep(g, m);
  }

  private addLanterns(pts: Array<{ x: number; z: number }>) {
    if (!pts.length) return;
    // post
    this.addBoxes(
      pts.map((p) => ({ x: p.x, z: p.z, w: 0.55, h: 2.2, d: 0.55, ry: 0 })),
      0x2a2b33,
    );
    // the light itself
    const g = new THREE.BoxGeometry(1.15, 1.3, 1.15);
    const m = new THREE.MeshBasicMaterial({ color: LANTERN, toneMapped: false });
    const mesh = new THREE.InstancedMesh(g, m, pts.length);
    mesh.frustumCulled = false;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < pts.length; i++) {
      d.position.set(pts[i].x, 2.85, pts[i].z);
      d.rotation.set(0, Math.random(), 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      c.setHex(LANTERN).multiplyScalar(0.55 + Math.random() * 0.45);
      mesh.setColorAt(i, c);
    }
    this.group.add(mesh);
    this.keep(g, m);

    // a soft pool of light on the ground under each
    const gg = new THREE.CircleGeometry(3.4, 16);
    gg.rotateX(-Math.PI / 2);
    const gm = new THREE.MeshBasicMaterial({
      color: LANTERN,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.InstancedMesh(gg, gm, pts.length);
    glow.frustumCulled = false;
    for (let i = 0; i < pts.length; i++) {
      d.position.set(pts[i].x, 0.09, pts[i].z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      glow.setMatrixAt(i, d.matrix);
    }
    this.group.add(glow);
    this.keep(gg, gm);
  }

  private addLines(coords: number[], color: number, opacity: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const lines = new THREE.LineSegments(g, m);
    lines.frustumCulled = false;
    this.group.add(lines);
    this.keep(g, m);
  }

  private keep(...items: Array<THREE.BufferGeometry | THREE.Material>) {
    this.disposables.push(...items);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

export function locationCenter(id: LocationId) {
  const l = LOCATIONS[id];
  return { x: l.x, z: l.z };
}

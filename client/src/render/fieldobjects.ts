// Interactive set-data objects of a game floor: warps, doors, switches and
// boxes. Behaviour decoded from PsoBB.exe (Ephinea 1.25.13); the object
// factory is a per-area table of {u32 type, create function, f32 250000.0, 0}
// (pointer array at 0x00a06be0, e.g. Forest 1 at 0x00a0db20). The models are
// built by render/objectview.ts from formats/objectmodels.ts.
//
// Warps (radius, destination):
//   0x0002 TObjAreaWarpForest  create FUN_007bac58, base ctor FUN_00668b74:
//          radius 10.0, destination param4 (FUN_0066982c)
//   0x0140 TObjGoalWarpAncient Ruins floor warp, destination param4 (newserv)
//   0x0280 (after Barba Ray): same parameters (newserv); radius taken from
//          TObjAreaWarpForest (not traced)
//   0x0201 TObjWarpJung        create 0x0066d4c4: radius 15.0 (+0xac),
//          destination param4; param6 = |param6| & 1 picks the beam color
//          (objectmodels.ts) and, in Challenge mode (get_room_type() == 1),
//          1 removes the object
//   0x020A TObjWarpJungMain    create 0x0066d840 (CCA main gate): radius
//          15.0, a menu of three destinations (warpmenu.ts ccaWarpItems); in
//          Challenge mode it is removed unless param6 is odd
//   0x0019 TObjWarpBoss        create FUN_0066c4b4: radius 19.0, destination
//          floor from the table at 0x0097f380 (18 floors per episode,
//          FUN_0080c340); param5 = switch flag that unlocks it (not on
//          Pioneer 2: FUN_00807ac0() == 0 skips it, FUN_0066c838)
//   0x0043 TObjCityMainWarp    create FUN_0064a8dc: radius 25.0, menu of
//          destinations (warpmenu.ts), param5 = Episode 2 warp type
//   0x0044 TObjCityAreaWarp    create FUN_0064ad68 -> FUN_0064ade4: radius
//          23.0, destination 0x0F (the lobby: ends the game)
// Doors open when their switch flag is set:
//   0x0080 TObjDoor (Forest)   ctor FUN_006573d4, update FUN_00656e28 ->
//          FUN_00656eb4: flag = param4 & 0xff; state 0 locked until the flag
//          is set (FUN_00816eec), 2 closed: opens when a player on the floor
//          is within 70.0 (0x00937964), 4 opening (+1.8 motion frames per
//          frame, 0x0093795c), 5 open until nobody is within 100.0
//          (0x0093796c), 3 closing (-1.8 per frame). The collision is on
//          while closed (FUN_007b52c4) and off while open (FUN_007b52ec).
//          While locked, the laser plays motion 1 at +1.0 per frame
//          (0x00937990) and the sign fades in (FUN_006569cf).
//   Cave / Mine / Ruins doors take a switch flag in param4 (negative =
//   always unlocked, > 0x100 = always locked) or a base flag plus a count
//   (newserv Map.cc); they use the Forest door's distances here.
// Switches set their flag when the player steps on them and send 6x05
// (G_WriteSwitchFlag_6x05: entity 0x4000 + object index, flag, floor,
// flags 1), as in newserv's captures of real clients:
//   0x0081 TObjDoorKey (Forest/Cave) ctor FUN_00658b0c on the generic switch
//          FUN_0062998c (radius 20.0 at +0xcc)
// Wave event triggers:
//   0x0008 TObjEvtCollision    ctor FUN_00659ebc, update FUN_00659d98:
//          radius param1 (+0xac), event id param4 (+0xb0), and it is idle for
//          3 frames (+0xb4). When the local player is within the radius (3D
//          distance) it sends 6x67 {entity, floor, event id, client id} and
//          sets its own set flag 8, so it only fires once.

import * as THREE from 'three';
import type { PlacedEntity, ObjectSet } from '../formats/setdata.ts';
import type { CollisionWorld, Obstacle } from './collision.ts';
import type { MapViewer } from './mapviewer.ts';
import type { ObjectLayer } from './objectview.ts';

export type WarpKind = 'area' | 'boss' | 'main' | 'cca' | 'lobby';

export interface FieldWarp {
  kind: WarpKind;
  index: number; // object index on the floor
  x: number;
  y: number;
  z: number;
  radius: number;
  floor: number; // destination (-1 = menu, 0x0f = lobby)
  flag: number; // switch flag required (-1 = none)
  warpType: number; // TObjCityMainWarp param5 clamped to 0..2
}

export interface FieldDoor {
  index: number;
  type: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  flags: number[]; // all must be set; empty = always unlocked
  locked: boolean; // permanently locked (flag > 0x100)
  lamps: boolean; // four-light door: lamp i waits for flags[i] (objectmodels.ts lamps)
  state: number; // FUN_00656eb4 states: 0 locked, 2 closed, 4 opening, 5 open, 3 closing
  frame: number; // open motion frame
  laserFrame: number; // locked laser motion frame
  mesh: THREE.Object3D | null; // stand-in panel when the model is missing
}

export interface FieldSwitch {
  index: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  flag: number;
}

// A wave event trigger area (TObjEvtCollision).
export interface FieldEventTrigger {
  index: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  eventId: number;
  fired: boolean;
  age: number; // frames since construction (idle for 3)
}

// A box. The drops agent breaks them; this module only places and reports them.
export interface FieldBox {
  index: number;
  type: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  broken: boolean;
}

const DOOR_OPEN_DISTANCE = 70; // 0x00937964
const DOOR_CLOSE_DISTANCE = 100; // 0x0093796c
const DOOR_STEP = 1.8; // 0x0093795c / 0x00937960
const DOOR_LASER_STEP = 1.0; // 0x00937990
// Fallback length of the door motion when the model has none (the panel).
const DOOR_FRAMES = 30;
const EVENT_TRIGGER_IDLE = 3; // FUN_00659d98: +0xb4 counts down from 3

// Boss warp destination by episode index (0 = Ep1, 1 = Ep2, 2 = Ep4) * 18 + floor (0x0097f380).
export const BOSS_WARP_FLOOR = [
  0x0, 0xb, 0xb, 0xc, 0xc, 0xc, 0xd, 0xd, 0xe, 0xe, 0xe, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0xe, 0xe, 0xf, 0xf, 0xc, 0xc, 0xc, 0xc, 0xc, 0xd, 0xd, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
  0x0, 0x9, 0x9, 0x9, 0x9, 0x9, 0x9, 0x9, 0x9, 0x0, 0x9, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
];

export function bossWarpFloor(episode: number, floor: number): number {
  const e = episode === 2 ? 1 : episode === 3 ? 2 : 0;
  return BOSS_WARP_FLOOR[e * 18 + floor] ?? 0;
}

const DOOR_TYPES = new Set([
  0x0080, 0x00c1, 0x00c2, 0x00ce, 0x0100, 0x0102, 0x0144, 0x0145, 0x0146, 0x0147, 0x0148, 0x0149, 0x014a, 0x014b,
  // Episode 2 and the Lab: VR door, four-light doors, the laser door and the
  // jungle main gate, the Seabed doors and the Lab doors.
  0x0192, 0x01a0, 0x01ab, 0x01c0, 0x0202, 0x0204, 0x0221, 0x0222, 0x0056, 0x02bb, 0x0130,
]);

const LAMP_DOORS = new Set([0x01ab, 0x01c0, 0x0221, 0x0222]);

// Lamps of a four-light door while it is closed: all lit once it is
// unlocked, else lamp i when it waits for no flag or its flag is set.
export function doorLamps(d: FieldDoor, unlocked: boolean, flags: ReadonlySet<number>): boolean[] {
  return [0, 1, 2, 3].map((i) => unlocked || i >= d.flags.length || flags.has(d.flags[i]));
}

// Boxes (newserv Map.cc names): item boxes, enemy boxes, the rare ones and
// their jungle / Ruins / VR counterparts.
const BOX_TYPES = new Set([0x0088, 0x0091, 0x0092, 0x0093, 0x0161, 0x0162, 0x0200, 0x0203, 0x02b0]);

const SWITCH_RADIUS: Record<number, number> = {
  0x0081: 20, // FUN_0062998c: +0xcc = 20.0
  0x0101: 10, // newserv: "The activation radius is always 10 units"
  0x0143: 10,
};

// Switch flags a door waits for (newserv Map.cc parameter notes; TObjDoor from FUN_006573d4).
export function doorFlags(o: ObjectSet): { flags: number[]; locked: boolean } {
  const p4 = o.params[3];
  const p5 = o.params[4];
  const range = (base: number, n: number) => Array.from({ length: n }, (_, i) => base + i);
  switch (o.type) {
    case 0x0080:
      return { flags: [p4 & 0xff], locked: false };
    case 0x00c1:
    case 0x0100:
      if (p4 < 0) return { flags: [], locked: false };
      return { flags: range(p4, 4 - Math.min(4, Math.max(0, p5))), locked: false };
    case 0x014a:
      return { flags: range(Math.min(0xfc, Math.max(0, p4)), 4), locked: false };
    case 0x014b:
      return { flags: range(Math.min(0xfe, Math.max(0, p4)), 2), locked: false };
    // Four-light doors (init_map_object_door_switch_type, vtable +0x44
    // 0x0061c84c: param4 > 0x100 never opens, < 0 is always open): the flags
    // param4 .. param4 + n - 1, n = param5 for Ruins / Space (0x0061fce0) and
    // param5 clamped to 0..4 for the Seabed doors (DoorSetState_00620d70,
    // checked by 0x00620d98).
    case 0x01ab:
    case 0x01c0:
    case 0x0221:
    case 0x0222: {
      if (p4 > 0x100) return { flags: [], locked: true };
      if (p4 < 0) return { flags: [], locked: false };
      const n = o.type === 0x0221 || o.type === 0x0222 ? Math.min(4, Math.max(0, Math.trunc(p5))) : Math.max(0, Math.trunc(p5));
      return { flags: range(p4, n), locked: false };
    }
    default: // TODoorCave02 parameters (0x00C2, 0x00CE, 0x0102, 0x0144-0x0149)
      if (p4 < 0 || p4 === 0x100) return { flags: [], locked: false };
      if (p4 > 0x100) return { flags: [], locked: true };
      return { flags: [p4], locked: false };
  }
}

export interface FieldContext {
  episode: number;
  floor: number;
  area: number;
}

export function collectFieldObjects(
  placed: PlacedEntity[],
  ctx: FieldContext,
): { warps: FieldWarp[]; doors: FieldDoor[]; switches: FieldSwitch[]; triggers: FieldEventTrigger[]; boxes: FieldBox[] } {
  const warps: FieldWarp[] = [];
  const doors: FieldDoor[] = [];
  const switches: FieldSwitch[] = [];
  const triggers: FieldEventTrigger[] = [];
  const boxes: FieldBox[] = [];
  for (const p of placed) {
    if (p.entity.kind !== 'object') continue;
    const o = p.entity;
    const [x, y, z] = p.world;
    const base = { index: o.index, x, y, z };
    switch (o.type) {
      case 0x0002:
      case 0x0140:
      case 0x0280:
        warps.push({ ...base, kind: 'area', radius: 10, floor: o.params[3], flag: -1, warpType: 0 });
        break;
      case 0x0201:
        warps.push({ ...base, kind: 'area', radius: 15, floor: o.params[3], flag: -1, warpType: 0 });
        break;
      case 0x020a:
        warps.push({ ...base, kind: 'cca', radius: 15, floor: -1, flag: -1, warpType: 0 });
        break;
      case 0x0008:
        triggers.push({ ...base, radius: o.params[0], eventId: Math.trunc(o.params[3]), fired: false, age: 0 });
        break;
      case 0x0019: {
        const flag = ctx.area === 0 || o.params[4] < 0 || o.params[4] > 0xff ? -1 : o.params[4];
        warps.push({ ...base, kind: 'boss', radius: 19, floor: bossWarpFloor(ctx.episode, ctx.floor), flag, warpType: 0 });
        break;
      }
      case 0x0043:
        warps.push({ ...base, kind: 'main', radius: 25, floor: -1, flag: -1, warpType: Math.min(2, Math.max(0, o.params[4])) });
        break;
      case 0x0044:
        warps.push({ ...base, kind: 'lobby', radius: 23, floor: 0x0f, flag: -1, warpType: 0 });
        break;
      default:
        if (DOOR_TYPES.has(o.type)) {
          const { flags, locked } = doorFlags(o);
          doors.push({ ...base, type: o.type, yaw: p.yaw, flags, locked, lamps: LAMP_DOORS.has(o.type), state: 0, frame: 0, laserFrame: 0, mesh: null });
        } else if (BOX_TYPES.has(o.type)) {
          boxes.push({ ...base, type: o.type, yaw: p.yaw, broken: false });
        } else if (SWITCH_RADIUS[o.type] !== undefined && o.params[3] >= 0 && o.params[3] < 0x100) {
          switches.push({ ...base, radius: SWITCH_RADIUS[o.type], flag: o.params[3] });
        }
    }
  }
  return { warps, doors, switches, triggers, boxes };
}

const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// One frame of a door (FUN_00656eb4 without the unlock camera of state 1).
// `nearest` gives the distance of the nearest player on the floor, `frames`
// the length of the door's open motion.
export function stepDoor(d: FieldDoor, unlocked: boolean, nearest: number, frames = DOOR_FRAMES): void {
  switch (d.state) {
    case 0:
      d.laserFrame += DOOR_LASER_STEP;
      if (unlocked) d.state = 2;
      break;
    case 2:
      if (nearest < DOOR_OPEN_DISTANCE) d.state = 4;
      break;
    case 4:
      d.frame += DOOR_STEP;
      if (d.frame >= frames - 1) {
        d.frame = frames - 1;
        d.state = 5;
      }
      break;
    case 5:
      if (nearest >= DOOR_CLOSE_DISTANCE) d.state = 3;
      break;
    case 3:
      d.frame -= DOOR_STEP;
      if (d.frame < 0) {
        d.frame = 0;
        d.state = 2;
      }
      break;
  }
}

// Door stand-in for the few door types without a decoded model: a panel 40
// wide and 30 tall facing the object's Y angle, red while locked, blue when
// unlocked; it sinks into the floor as the door opens.
function doorMesh(d: FieldDoor): THREE.Object3D {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 3), new THREE.MeshBasicMaterial({ color: 0xc04040, transparent: true, opacity: 0.7, depthWrite: false }));
  panel.position.y = 15;
  g.add(panel);
  g.position.set(d.x, d.y, d.z);
  g.rotation.y = d.yaw;
  return g;
}

export class FieldObjects {
  warps: FieldWarp[] = [];
  doors: FieldDoor[] = [];
  switches: FieldSwitch[] = [];
  triggers: FieldEventTrigger[] = [];
  boxes: FieldBox[] = [];
  private viewer: MapViewer;
  private group = new THREE.Group();
  private flags: Set<number>; // switch flags of this floor
  private pressed = new Set<number>(); // switches the local player stands on
  private models: ObjectLayer | null;
  private collision: CollisionWorld | null;
  onSwitch: (sw: FieldSwitch) => void = () => {};
  onEventTrigger: (t: FieldEventTrigger) => void = () => {};

  constructor(
    viewer: MapViewer,
    placed: PlacedEntity[],
    ctx: FieldContext,
    flags: Set<number>,
    models: ObjectLayer | null = null,
    collision: CollisionWorld | null = null,
  ) {
    this.viewer = viewer;
    this.flags = flags;
    this.models = models;
    this.collision = collision;
    Object.assign(this, collectFieldObjects(placed, ctx));
    for (const d of this.doors) {
      if (models?.models.has(d.index)) {
        models.setState(d.index, 'locked');
        continue;
      }
      d.mesh = doorMesh(d);
      this.group.add(d.mesh);
    }
    for (const s of this.switches) models?.setState(s.index, 'off');
    this.group.name = 'field-objects';
    viewer.scene.add(this.group);
  }

  unlocked(d: FieldDoor): boolean {
    return !d.locked && d.flags.every((f) => this.flags.has(f));
  }

  // Collision boxes of the doors that are closed right now (the client turns
  // the door's box on in states 0 and 2 and off in states 4 and 5).
  obstacles(): Obstacle[] {
    const out: Obstacle[] = [];
    for (const d of this.doors) {
      if (d.state === 4 || d.state === 5) continue;
      const box = this.models?.models.get(d.index)?.spec.collision;
      const halfX = box && box.type === 1 ? box.halfX : 20;
      const halfZ = box && box.type === 1 ? box.halfZ : 10;
      const off = box?.offset ?? [0, 20, 0];
      const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
      out.push({
        key: d.index,
        x: d.x + off[0] * c + off[2] * s,
        y: d.y + off[1],
        z: d.z - off[0] * s + off[2] * c,
        yaw: d.yaw,
        halfX,
        halfZ,
        height: 50,
      });
    }
    return out;
  }

  // One game frame: switches under the local player, event triggers, door states.
  frame(self: { x: number; y: number; z: number } | null, others: Array<{ x: number; y: number; z: number }>): void {
    if (self) {
      for (const s of this.switches) {
        const on = dist3(s, self) < s.radius;
        if (on && !this.pressed.has(s.index) && !this.flags.has(s.flag)) {
          this.flags.add(s.flag);
          this.onSwitch(s);
        }
        if (on) this.pressed.add(s.index);
        else this.pressed.delete(s.index);
      }
      for (const t of this.triggers) {
        if (t.fired) continue;
        if (t.age++ < EVENT_TRIGGER_IDLE) continue;
        if (dist3(t, self) < t.radius) {
          t.fired = true;
          this.onEventTrigger(t);
        }
      }
    }
    for (const s of this.switches) this.models?.setState(s.index, this.flags.has(s.flag) ? 'on' : 'off');
    const players = self ? [self, ...others] : others;
    for (const d of this.doors) {
      const nearest = players.reduce((m, p) => Math.min(m, dist3(d, p)), Infinity);
      const frames = this.models?.doorFrames(d.index) || DOOR_FRAMES;
      stepDoor(d, this.unlocked(d), nearest, frames);
      if (this.models?.models.has(d.index)) {
        if (d.lamps) this.models.setLamps(d.index, d.state === 0 || d.state === 2 ? doorLamps(d, this.unlocked(d), this.flags) : null);
        else this.models.setState(d.index, d.state === 0 ? 'locked' : 'unlocked');
        this.models.setDoorFrame(d.index, d.frame);
        this.models.setLaserFrame(d.index, d.laserFrame);
        continue;
      }
      const m = d.mesh as THREE.Group | null;
      if (!m) continue;
      const panel = m.children[0] as THREE.Mesh;
      (panel.material as THREE.MeshBasicMaterial).color.setHex(d.state === 0 ? 0xc04040 : 0x4080d0);
      panel.position.y = 15 - 30 * (d.frame / Math.max(1, frames - 1));
      panel.visible = d.state !== 5;
    }
    if (this.collision) this.collision.obstacles = this.obstacles();
  }

  // The items agent breaks boxes: it gets the box list and hides a broken one.
  breakBox(index: number): FieldBox | null {
    const b = this.boxes.find((x) => x.index === index);
    if (!b || b.broken) return null;
    b.broken = true;
    this.models?.setVisible(index, false);
    return b;
  }

  dispose(): void {
    if (this.collision) this.collision.obstacles = [];
    this.viewer.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

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
//          is set (FUN_00816eec), 1 unlock camera (param6 odd, 80 frames),
//          2 closed: opens when a player on the floor
//          is within 70.0 (0x00937964), 4 opening (+1.8 motion frames per
//          frame, 0x0093795c), 5 open until nobody is within 100.0
//          (0x0093796c), 3 closing (-1.8 per frame). The collision is on
//          while closed (FUN_007b52c4) and off while open (FUN_007b52ec).
//          While locked, the laser plays motion 1 at +1.0 per frame
//          (0x00937990) and the sign fades in (FUN_006569cf).
//   Pioneer 2 doors (0x0046 shop, 0x0047 guild, 0x0048 Ragol warp, 0x0049
//   medical center) have no flag: a shared class (vtables 0x00b2f700 /
//   0x00b2f760 / 0x00b2f7c0 / 0x00b2f820, state at +0xac dispatched by
//   0x00645fb8) opens for the players near it, with per-type numbers in
//   CITY_DOORS (stepCityDoor).
//   Cave / Mine / Ruins doors take a switch flag in param4 (negative =
//   always unlocked, > 0x100 = always locked) or a base flag plus a count
//   (newserv Map.cc); they use the Forest door's distances here.
// Not a door: 0x0103 (creator 0x00615a9c, ctor InitializeMapObjectDoor_00615b14, vtable 0x00b256a0;
//   newserv's TOCapsuleMachine01) draws the shared CapMoto model (bm_fs_obj_cap_moto.bml, loader
//   0x00615bec) and has a box (0x009c4a5c: y 32, halfX 13, halfZ 20). Its vtable has no lock slot
//   and no icon: slot 1 (0x00615a2c) only tells the shared model the frame counter changed, slot 2
//   (0x006159b0) draws it inside the view distance. No state, no lock, no minimap icon.
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
import { OBJECT_BOX_FLAGS, type CollisionWorld, type Obstacle } from './collision.ts';
import { objectModelFor, type ObjectCollision, type ObjectModelContext } from '../formats/objectmodels.ts';
import type { MapViewer } from './mapviewer.ts';
import type { ObjectLayer } from './objectview.ts';
import { SEAL_DOOR, SealDoor, type CaptureDraw } from './traps.ts';

export type WarpKind = 'area' | 'boss' | 'main' | 'cca' | 'map' | 'lobby';

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
  // Intra-floor (map) warps: where the player lands, facing `angle`
  // (radians), and the menu item's unitxt group 10 index.
  dest?: { x: number; y: number; z: number };
  angle?: number;
  text?: number;
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
  city: CityDoor | null; // Pioneer 2 door: opened by distance alone (stepCityDoor)
  // The +0xd0 bit 0 unlock of the beam-family doors (0x0202, 0x0204; stepBitDoor). null for the
  // other doors, whose unlock is `flags`. `bit0` is the unlock (and the minimap colour) for both.
  bitRule: 'switches' | 'beam' | null;
  bit0: boolean;
  // Collision flag 8 of the door's box (FUN_007b52c4 sets it, FUN_007b52ec clears it, on hitbox
  // [0].unknown_flags). boxPairActive reads 8 as "no collision with a player (0x2000)": the door
  // is passable while it is set. Beam-family doors only (the other doors use their state).
  passable: boolean;
  // 0x0204 (update BeamDoorMapObjectUpdate_00657e00, lock 0x00658410): the motion frame (+0xb4,
  // advanced by +0xb8 = 1.0 per tick while bit 0 is set), the count of the flags 0x46..0x48 seen by
  // the lock (+0xd4) and the ticks counted for the particles (+0xd8).
  beamFrame: number;
  lockCount: number;
  beamTicks: number;
  state: number; // FUN_00656eb4 states: 0 locked, 1 unlock camera, 2 closed, 4 opening, 5 open, 3 closing
  // TObjDoor (0x0080) with param6 odd (ctor FUN_006573d4: +0xbc = clamp(param6 % 2, 0, 1)):
  // on unlock the camera looks from (param1, param2, param3) at the door
  // for 80 frames (state 1) before the door closes normally.
  camera: [number, number, number] | null;
  cameraCount: number; // +0xc0, 0x50 from the ctor
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

// Komo variant 6 (type 0x0082, MapObjectKomoVariant6Constructor_0065db10, dump
// 524188): the state at +0xb4 is 0 (active, the switch is locked) or 1 (idle,
// unlocked); its switch flag is +0xb0 = (short) param4 (+0x84). The update
// (MapObjectKomoVariant6Update_0065d89c, dump 524037) takes the colour of the
// state it finds at the start of the frame, then runs the state's handler:
// StateActive (0065d954) moves to 1 when the flag is set, StateIdle (0065d924)
// moves back to 0 when it is not. `shown` keeps that start-of-frame state for
// the minimap icon (the colour is red at 0, green at 1).
export interface FieldKomo {
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number; // +0x60, the heading of the icon
  flag: number; // +0xb0, the switch flag (signed short)
  value: number; // +0x8c (param6), the icon's scale parity
  state: 0 | 1; // +0xb4
  shown: 0 | 1; // the state the frame's icon was drawn with
}

// One frame of a Komo variant 6 object: returns the state its icon takes and
// moves the state on (the handlers above).
export function stepKomo(k: FieldKomo, switchOn: boolean): 0 | 1 {
  k.shown = k.state;
  if (k.state === 0) {
    if (switchOn) k.state = 1;
  } else if (!switchOn) {
    k.state = 0;
  }
  return k.shown;
}

const DOOR_OPEN_DISTANCE = 70; // 0x00937964
const DOOR_CLOSE_DISTANCE = 100; // 0x0093796c
const DOOR_STEP = 1.8; // 0x0093795c / 0x00937960
const DOOR_LASER_STEP = 1.0; // 0x00937990
// Fallback length of the door motion when the model has none (the panel).
const DOOR_FRAMES = 30;
export const DOOR_CAMERA_FRAMES = 0x50; // +0xc0 in the ctor FUN_006573d4
const DOOR_CAMERA_LOCKED = 0x3c; // render FUN_00656a50 keeps the locked look while +0xc0 >= 0x3c
const EVENT_TRIGGER_IDLE = 3; // FUN_00659d98: +0xb4 counts down from 3
// Beam door (0x0204, ctor 0x00658294, lock slot 0x00658410): the three switch flags
// 0x46..0x48 (table 0x00937b60) and a player within 50 units of the door in XZ
// (the squared distance against 2500.0 at 0x00937b78).
const BEAM_DOOR_FLAGS = [0x46, 0x47, 0x48];
const BEAM_DOOR_RANGE_SQ = 2500;
const BEAM_LOCK_SE = 0x4df; // lock 0x00658410: when the count of the flags changes to a value above 0
const BEAM_MOTION_SE = 0x4dc; // update 0x00657e00: every tick the motion runs (the door's own position)
const BEAM_PARTICLE = 0x229; // create_particle_effect_3(..., 0x229, 0x800) at (+-40, 0, 0) of the door
const BEAM_PARTICLE_EVERY = 30; // ticks (the counter +0xd8 % 30)
const BEAM_PARTICLE_OFFSET = 40; // the literal 40.0 stored in the update's two points (+-40 on x)
const BEAM_STEP = 1.0; // +0xb8 (base ctor 0x00619e24: 0x3f800000)
const BEAM_WINDOW = 70; // DAT_00937b98 (70.0): the last 70 frames of the motion make the door passable

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
  // Pioneer 2 (CITY_DOORS).
  0x0046, 0x0047, 0x0048, 0x0049,
]);

const LAMP_DOORS = new Set([0x01ab, 0x01c0, 0x0221, 0x0222]);

// Pioneer 2 doors: the data block each constructor hands to
// InitializeHuntersGuildDoorEntity_006460d8 ({f32 step, f32 open distance^2,
// f32 close distance^2, ...}). The Ragol warp door's step is 0.0 in the
// image and set to 1.0 by the static initializer 0x006470b4.
export interface CityDoor {
  step: number; // motion frames per tick
  open: number; // a player within this distance opens it (closed / closing)
  close: number; // it closes once nobody is within this distance (opening / open)
}

export const CITY_DOORS: Record<number, CityDoor> = {
  0x0046: { step: 1, open: 60, close: 80 }, // 0x00935ac4
  0x0047: { step: 2, open: 60, close: 80 }, // 0x00935a78
  0x0048: { step: 1, open: 90, close: 120 }, // 0x009c7114
  0x0049: { step: 1, open: 60, close: 80 }, // 0x00935a54
};

// Lamps of a four-light door while it is closed: all lit once it is
// unlocked, else lamp i when it waits for no flag or its flag is set.
export function doorLamps(d: FieldDoor, unlocked: boolean, flags: ReadonlySet<number>): boolean[] {
  return [0, 1, 2, 3].map((i) => unlocked || i >= d.flags.length || flags.has(d.flags[i]));
}

// Boxes (newserv Map.cc names): item boxes, enemy boxes, the rare ones and
// their jungle / Ruins / VR counterparts.
const BOX_TYPES = new Set([0x0088, 0x0091, 0x0092, 0x0093, 0x0161, 0x0162, 0x0200, 0x0203, 0x02b0]);

// Field objects that block the player without being doors: the containers
// (BOX_TYPES, a breakable one stops blocking once broken), the jungle rocks and
// the Ancient pillar traps. The pillars' box (0x009c684c, sphere r2 at 8.5 up,
// flags 0x38003) is set once by InitializeDerolleEnemyBase_0063c638 and never
// moves or toggles with the rise (the rise only lifts the model's nodes): so a
// pillar blocks in both its lowered and its raised state, as the exe does.
// The ancient nest container (0x0152, box 0x009c7868), the info capsule (0x0229,
// box 0x009c4a14) and the Wilds poison plant (0x0380, box 0x009c9f18): each is a
// model in the port whose constructor sets a box that passes the flag gate (depth 0
// of TYPE_COLLISION_TABLES in collisionboxes.gen.ts; ASSUMED that a static box is a block).
// The desert crystal box (0x038d, box 0x009c9ce8: the container's sphere r9, flags 0x38003)
// is added the same way; it is not in BOX_TYPES, so it has no broken state here (ASSUMED).
const SOLID_TYPES = new Set([...BOX_TYPES, 0x0206, 0x0207, 0x0208, 0x0154, 0x0167, 0x0152, 0x0229, 0x0380, 0x038d]);

// A non-door field object with a collision box: its set entry's world place and
// the box table it was built with (objectmodels.ts ObjectCollision).
export interface FieldSolid {
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  collision: ObjectCollision;
}

// The solids of a floor (the placed objects whose model has a box and which are
// not doors). Doors have their own list (collectFieldObjects).
export function collectFieldSolids(placed: PlacedEntity[], ctx: ObjectModelContext): FieldSolid[] {
  const out: FieldSolid[] = [];
  for (const p of placed) {
    if (p.entity.kind !== 'object' || !SOLID_TYPES.has(p.entity.type)) continue;
    const spec = objectModelFor(p.entity, ctx);
    if (!spec?.collision || spec.door) continue;
    const [x, y, z] = p.world;
    out.push({ index: p.entity.index, x, y, z, yaw: p.yaw, collision: spec.collision });
  }
  return out;
}

// The collision box of a solid in world space (the same frame as the doors':
// the table's offset turned by the entity's yaw).
export function solidObstacle(s: FieldSolid): Obstacle {
  const c = s.collision;
  const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
  return {
    key: s.index,
    x: s.x + c.offset[0] * cos + c.offset[2] * sin,
    y: s.y + c.offset[1],
    z: s.z - c.offset[0] * sin + c.offset[2] * cos,
    yaw: s.yaw,
    halfX: c.halfX,
    halfZ: c.halfZ,
    height: 50,
    sphere: c.type === 0,
    flags: c.flags,
    ex: s.x,
    ez: s.z,
  };
}

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
  if (CITY_DOORS[o.type]) return { flags: [], locked: false };
  switch (o.type) {
    case 0x0080:
      return { flags: [p4 & 0xff], locked: false };
    case 0x00c1:
    case 0x0100:
      if (p4 < 0) return { flags: [], locked: false };
      return { flags: range(p4, 4 - Math.min(4, Math.max(0, p5))), locked: false };
    // TObjDoorJung (ctor 0x00657a80 on the boss-door base; vtable+0x44 = 0x0061c84c
    // stores +0xc8 = param4). Lock slot 0x00657b20: bit 0 is set while every flag
    // +0xc8 + i (16-bit, i < +0xd4 = clamp(param5, 0..4)) is set; none = set.
    case 0x0202: {
      const n = Math.min(4, Math.max(0, Math.trunc(p5)));
      return { flags: range(Math.trunc(p4) & 0xffff, n), locked: false };
    }
    // TODoorJungleMain's beam (0x0204): its unlock is stepBitDoor's rule, not a flag.
    case 0x0204:
      return { flags: [], locked: false };
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
): { warps: FieldWarp[]; doors: FieldDoor[]; switches: FieldSwitch[]; triggers: FieldEventTrigger[]; boxes: FieldBox[]; komos: FieldKomo[] } {
  const warps: FieldWarp[] = [];
  const doors: FieldDoor[] = [];
  const switches: FieldSwitch[] = [];
  const triggers: FieldEventTrigger[] = [];
  const boxes: FieldBox[] = [];
  const komos: FieldKomo[] = [];
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
      case 0x0003:
      case 0x0045:
      case 0x0141:
      case 0x02bd: {
        if (o.type === 0x0141 && o.params[4] < 0) break; // no warp lines, no warp (0x006408d8)
        const city = o.type === 0x0045 || o.type === 0x02bd;
        warps.push({ ...base, kind: 'map', radius: city ? 23 : 10, floor: -1, flag: -1, warpType: 0, ...mapWarpTarget(o, p.yaw), text: city ? CITY_MAP_WARP_TEXT[cityMapWarpText(o)] : MAP_WARP_TEXT });
        break;
      }
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
      case 0x0082:
        komos.push({ ...base, yaw: p.yaw, flag: (Math.trunc(o.params[3]) << 16) >> 16, value: o.params[5], state: 0, shown: 0 });
        break;
      default:
        if (DOOR_TYPES.has(o.type)) {
          const { flags, locked } = doorFlags(o);
          const camera = o.type === 0x0080 && Math.trunc(o.params[5]) % 2 === 1 ? ([o.params[0], o.params[1], o.params[2]] as [number, number, number]) : null;
          const bitRule = o.type === 0x0202 ? 'switches' : o.type === 0x0204 ? 'beam' : null;
          doors.push({ ...base, type: o.type, yaw: p.yaw, flags, locked, lamps: LAMP_DOORS.has(o.type), city: CITY_DOORS[o.type] ?? null, bitRule, bit0: false, passable: false, beamFrame: 0, lockCount: 0, beamTicks: 0, state: 0, frame: 0, laserFrame: 0, mesh: null, camera, cameraCount: DOOR_CAMERA_FRAMES });
        } else if (BOX_TYPES.has(o.type)) {
          boxes.push({ ...base, type: o.type, yaw: p.yaw, broken: false });
        } else if (SWITCH_RADIUS[o.type] !== undefined && o.params[3] >= 0 && o.params[3] < 0x100) {
          switches.push({ ...base, radius: SWITCH_RADIUS[o.type], flag: o.params[3] });
        }
    }
  }
  return { warps, doors, switches, triggers, boxes, komos };
}

// Map warps (TObjMapWarpForest 0x0003, TObjCityMapWarp 0x0045,
// TObjMapWarpAncient 0x0141, TObjLaboMapWarp 0x02BD). Their base constructor
// MapObjectBaseInitialize_00668ad8 turns four per-player offsets
// (0x009c955c: (-10, 0, -10), (-15, 0, -15), (-5, 0, -15), (-10, 0, -20)) by
// the object's own Y angle and adds them to the destination param1..3, but
// the update (0x00669048) always hands the first one to
// warp_player_from_source_to_dest (0x0069b184), with param4 as the angle:
// the bug newserv documents (every player lands on the same spot). The menu
// (+0x34: 0x00668e20, city / Lab 0x0064af7c / 0x0064b2d0) is one item at
// position-table entry 0x35, sized like an area warp's: unitxt group 10 index
// 0x30, or for the city / Lab warps 0x009363d0[param6] (param6 < 0 -> 0,
// > 2 -> 1: 0x0064b038). Radius 10.0 from the base, 23.0 for the city and Lab
// warps (0x0064b0d4, 0x0064b428).
const MAP_WARP_OFFSET = [-10, 0, -10] as const;
export const MAP_WARP_TEXT = 0x30;
export const CITY_MAP_WARP_TEXT = [44, 45, 16] as const; // The Principal, Pioneer 2, Lab

export function cityMapWarpText(o: ObjectSet): number {
  const v = Math.trunc(o.params[5]);
  return v < 0 ? 0 : v > 2 ? 1 : v;
}

export function mapWarpTarget(o: ObjectSet, yaw: number): { dest: { x: number; y: number; z: number }; angle: number } {
  const [ox, oy, oz] = MAP_WARP_OFFSET;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dest = { x: o.params[0] + ox * c + oz * s, y: o.params[1] + oy, z: o.params[2] - ox * s + oz * c };
  return { dest, angle: (Math.trunc(o.params[3]) & 0xffff) * ((Math.PI * 2) / 0x10000) };
}

const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// One frame of a Pioneer 2 door, in the FieldDoor states (2 closed, 4
// opening, 5 open, 3 closing). The client's handlers (vtable +0x34..+0x40):
//   closed  0x00645eb0  a player within `open` -> opening (collision off)
//   opening 0x00646410  nobody within `close` -> closing; else frame += step,
//                       open at the last frame
//   open    0x00645f5c  nobody within `close` -> closing
//   closing 0x00645eec  a player within `open` -> opening; else frame -= step,
//                       closed at frame 0 (collision on)
// `nearest` is the distance of the nearest player on the floor (the check
// 0x006470e0 goes through the four player slots).
export function stepCityDoor(d: FieldDoor, nearest: number, frames: number): void {
  const c = d.city!;
  const last = Math.max(0, frames - 1);
  switch (d.state) {
    case 0:
    case 2:
      d.state = 2;
      if (nearest < c.open) d.state = 4;
      break;
    case 4:
      if (nearest >= c.close) d.state = 3;
      else if (last <= d.frame + c.step) {
        d.frame = last;
        d.state = 5;
      } else d.frame += c.step;
      break;
    case 5:
      if (nearest >= c.close) d.state = 3;
      break;
    case 3:
      if (nearest < c.open) d.state = 4;
      else if (d.frame - c.step <= 0) {
        d.frame = 0;
        d.state = 2;
      } else d.frame -= c.step;
      break;
  }
}

// Locked look of a door (laser and sign): state 0, and the first 20 frames of
// the unlock camera (FUN_00656a50: +0xc0 >= 0x3c).
export function lockedLook(d: FieldDoor): boolean {
  return d.state === 0 || (d.state === 1 && d.cameraCount >= DOOR_CAMERA_LOCKED);
}

// One frame of a beam-family door's +0xd0 bit 0 (its lock slot runs before its update).
// 'switches' (0x0202, FUN_00657b20): bit 0 = every flag of the door is set (none: set).
// 'beam' (0x0204, slot 0x00658410): once set it stays set; it is set when the flags 0x46..0x48
// are all on and a player (`players`, the floor's) is within 50 units of the door in XZ.
// ASSUMED: `players` are the local floor's players (the exe loops GetPlayer 0..3 on the floor).
// The 0x0202 lock (0x00657b20) also sets / clears collision flag 8 on the unlock (passable = bit 0).
// The 0x0204 lock (0x00658410) returns at once once bit 0 is set. Otherwise it counts the three
// quest flags 0x46..0x48 (flagOn; the difficulty's bits) into +0xd4 and plays SFX 0x4df when the count changes to a value above 0; at a count of 3 a
// player of the floor within 50 (XZ) sets bit 0 and the unlock event runs (`unlocked`; the
// network part is NotifyDoorStateChange_007b5038, FieldObjects.onBeamUnlock).
export interface BitDoorEvents {
  se: number[]; // sound effects to play at the door
  unlocked: boolean; // the beam door's unlock event ran this step
}

export function stepBitDoor(d: FieldDoor, flagOn: (f: number) => boolean, players: ReadonlyArray<{ x: number; y: number; z: number }>): BitDoorEvents {
  const ev: BitDoorEvents = { se: [], unlocked: false };
  if (d.bitRule === 'switches') {
    d.bit0 = d.flags.every((f) => flagOn(f));
    d.passable = d.bit0;
  } else if (d.bitRule === 'beam' && !d.bit0) {
    const n = BEAM_DOOR_FLAGS.filter((f) => flagOn(f)).length;
    if (n > 0 && n !== d.lockCount) ev.se.push(BEAM_LOCK_SE);
    d.lockCount = n;
    if (n !== BEAM_DOOR_FLAGS.length) return ev;
    for (const p of players) {
      const dx = p.x - d.x, dz = p.z - d.z;
      if (dx * dx + dz * dz < BEAM_DOOR_RANGE_SQ) {
        d.bit0 = true;
        ev.unlocked = true;
        break;
      }
    }
  }
  return ev;
}

// A point sx along the door's x axis, in the door's yaw (the update's matrix: the position, then
// the heading's rotation; ASSUMED the rotation convention of objectmodels.ts).
function beamPoint(d: FieldDoor, sx: number): { x: number; y: number; z: number } {
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  return { x: d.x + sx * c, y: d.y, z: d.z - sx * s };
}

// One game tick of the 0x0204 update (BeamDoorMapObjectUpdate_00657e00) once bit 0 is set: the
// motion frame +0xb4 += 1.0; in the last 70 frames (last - 70 < t < last, last = the motion's
// frame count - 1) the door is passable (flag 8, and the "unknown" +0xdc notice is not modelled);
// otherwise the counter +0xd8 counts the ticks, SFX 0x4dc plays at the door every tick the motion
// runs, and every 30th counted tick two particles 0x229 stand at (+-40, 0, 0) of the door. Past
// the last frame the frame is held at last. Bit 0 clear: the door is not passable and does not move.
export function stepBeamMotion(d: FieldDoor, frames: number): { se: boolean; burst: boolean } {
  const last = frames - 1;
  const t = d.beamFrame + BEAM_STEP;
  const inWindow = t > last - BEAM_WINDOW && t < last;
  if (inWindow) d.passable = true;
  let se = false;
  let burst = false;
  if (t <= last) {
    se = true;
    if (!inWindow) {
      d.beamTicks += 1;
      burst = d.beamTicks % BEAM_PARTICLE_EVERY === 0;
    }
    d.beamFrame = t;
  } else {
    d.beamFrame = last;
  }
  return { se, burst };
}

// The minimap colour of a door: red while locked. The beam-family doors (0x0202, 0x0204)
// draw bit 0 (TObjDoorJung's and the beam's icon, dump 519977 / 0x00657e00); the others
// draw their state (TObjDoor, UpdatePlayerActionState_00656e28).
export function doorMapLocked(d: FieldDoor): boolean {
  return d.bitRule ? !d.bit0 : d.state === 0;
}

// One frame of a door (FUN_00656eb4).
// `nearest` gives the distance of the nearest player on the floor, `frames`
// the length of the door's open motion.
export function stepDoor(d: FieldDoor, unlocked: boolean, nearest: number, frames = DOOR_FRAMES): void {
  switch (d.state) {
    case 0:
      d.laserFrame += DOOR_LASER_STEP;
      if (unlocked) d.state = d.camera ? 1 : 2;
      break;
    case 1:
      // SetDefaultNpcCamera(9) + SetDefaultNPCCameraView_004d33c0 on entry
      // (FieldObjects.unlockCameraView), then InitializeDefaultNPC() when the
      // count runs out; the laser keeps playing while the count is above 0x3c.
      if (--d.cameraCount <= 0) {
        d.cameraCount = 0;
        d.state = 2;
      } else if (d.cameraCount > DOOR_CAMERA_LOCKED) d.laserFrame += DOOR_LASER_STEP;
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

// Delayed objects. The floor loader (0x008129b0) skips an object whose
// group (set entry +0x0a) is not 0, unless its set flags hold 0x01 or 0x10
// (synced from the other clients); construct_objects (event action 08 /
// quest construct_delayed_object, 0x00810ae8) later creates every object of
// the floor whose room (+0x0c) and group match and whose flags have neither
// 2 (created) nor 8, and sets flags 0x12. A boss floor's exit warp is one of
// these: group 1, constructed by the event that ends the fight.
export const constructKey = (room: number, group: number) => `${room}/${group}`;

export function isDelayedObject(o: ObjectSet, constructed: ReadonlySet<string>): boolean {
  return o.group !== 0 && !constructed.has(constructKey(o.section, o.group));
}

export class FieldObjects {
  // The objects that exist now (delayed ones join once constructed).
  warps: FieldWarp[] = [];
  doors: FieldDoor[] = [];
  switches: FieldSwitch[] = [];
  triggers: FieldEventTrigger[] = [];
  boxes: FieldBox[] = [];
  komos: FieldKomo[] = [];
  private all: ReturnType<typeof collectFieldObjects>;
  private solids: FieldSolid[];
  private sets = new Map<number, ObjectSet>(); // object index -> set entry
  private delayed = new Set<number>(); // object indices not constructed yet
  private constructed: Set<string>;
  private viewer: MapViewer;
  private group = new THREE.Group();
  private flags: Set<number>; // switch flags of this floor
  private pressed = new Set<number>(); // switches the local player stands on
  private models: ObjectLayer | null;
  // Quest flags of the current difficulty (Vol Opt's seal door reads 0x2c..0x2f).
  questFlag: (flag: number) => boolean = () => false;
  private seals = new Map<number, SealDoor>();
  private readonly playersBuf: Array<{ x: number; y: number; z: number }> = []; // the players frame() looks at, refilled every frame
  private collision: CollisionWorld | null;
  // The boss warp the local player is using and its 6x6A state
  // (render/bosswarp.ts); the other boss warps sit in state 0, or 4 while
  // their switch flag is not set.
  private drivenWarp: { index: number; state: number } | null = null;
  onSwitch: (sw: FieldSwitch) => void = () => {};
  onEventTrigger: (t: FieldEventTrigger) => void = () => {};
  // Sound and particle effects of the beam door (positional; the caller plays / spawns them).
  onSe: (id: number, at: { x: number; y: number; z: number }) => void = () => {};
  onParticles: (id: number, at: { x: number; y: number; z: number }) => void = () => {};
  // The beam door's unlock event (NotifyDoorStateChange_007b5038: the object's box-status packet).
  onBeamUnlock: (d: FieldDoor) => void = () => {};

  constructor(
    viewer: MapViewer,
    placed: PlacedEntity[],
    ctx: FieldContext,
    flags: Set<number>,
    models: ObjectLayer | null = null,
    collision: CollisionWorld | null = null,
    constructed: Set<string> = new Set(),
  ) {
    this.viewer = viewer;
    this.flags = flags;
    this.models = models;
    this.collision = collision;
    this.constructed = constructed;
    this.all = collectFieldObjects(placed, ctx);
    this.solids = collectFieldSolids(placed, { area: ctx.area, episode: ctx.episode });
    for (const p of placed) {
      if (p.entity.kind !== 'object') continue;
      this.sets.set(p.entity.index, p.entity);
      if (isDelayedObject(p.entity, constructed)) this.delayed.add(p.entity.index);
    }
    for (const d of this.all.doors) {
      if (models?.models.has(d.index)) {
        models.setState(d.index, 'locked');
        continue;
      }
      d.mesh = doorMesh(d);
      this.group.add(d.mesh);
    }
    for (const i of this.delayed) {
      models?.setVisible(i, false);
      const d = this.all.doors.find((x) => x.index === i);
      if (d?.mesh) d.mesh.visible = false;
    }
    this.refreshLists();
    for (const s of this.all.switches) models?.setState(s.index, 'off');
    this.group.name = 'field-objects';
    viewer.scene.add(this.group);
  }

  // The object indices this field changes after placement through more than
  // visibility: everything its state machines drive (doors, switches, warps,
  // event triggers). `extra`: indices the caller drives itself (the pillar traps).
  dynamicIndices(extra: Iterable<number> = []): Set<number> {
    const out = new Set<number>(extra);
    for (const list of [this.all.warps, this.all.doors, this.all.switches, this.all.triggers]) for (const x of list) out.add(x.index);
    return out;
  }

  // The object indices that only appear and disappear: boxes (breakBox) and
  // the delayed objects (construct).
  hideableIndices(): Set<number> {
    const out = new Set<number>(this.delayed);
    for (const b of this.all.boxes) out.add(b.index);
    return out;
  }

  // Merges the models of the objects that stay as placed (ObjectLayer.batchStatic).
  batchStatic(extra: Iterable<number> = []): void {
    this.models?.batchStatic(this.dynamicIndices(extra), this.hideableIndices());
  }

  private refreshLists(): void {
    const live = <T extends { index: number }>(list: T[]) => list.filter((x) => !this.delayed.has(x.index));
    this.warps = live(this.all.warps);
    this.doors = live(this.all.doors);
    this.switches = live(this.all.switches);
    this.triggers = live(this.all.triggers);
    this.boxes = live(this.all.boxes);
    this.komos = live(this.all.komos);
  }

  isDelayed(index: number): boolean {
    return this.delayed.has(index);
  }

  // A switch flag of this floor is set (IsSwitchUnlockedOnCurrentFloor_00816eec).
  switchOn(flag: number): boolean {
    return this.flags.has(flag);
  }

  // construct_objects(room, group) on this floor: the delayed objects of that
  // room and group appear. Returns how many did.
  construct(room: number, group: number): number {
    this.constructed.add(constructKey(room, group));
    let n = 0;
    for (const i of [...this.delayed]) {
      const o = this.sets.get(i)!;
      if (o.section !== room || o.group !== group) continue;
      this.delayed.delete(i);
      this.models?.setVisible(i, true);
      const d = this.all.doors.find((x) => x.index === i);
      if (d?.mesh) d.mesh.visible = true;
      n++;
    }
    if (n) this.refreshLists();
    return n;
  }

  unlocked(d: FieldDoor): boolean {
    if (d.bitRule) return d.bit0;
    return !d.locked && d.flags.every((f) => this.flags.has(f));
  }

  // Collision boxes of the blocking objects right now: the doors that are closed
  // (the client turns the door's box on in states 0 and 2 and off in states 4 and
  // 5), and the containers and rocks that are constructed and not broken.
  obstacles(): Obstacle[] {
    const out: Obstacle[] = [];
    for (const d of this.doors) {
      // Beam-family doors: passable while flag 8 of the box is set (passable), not by their state.
      if (d.bitRule ? d.passable : d.state === 4 || d.state === 5) continue;
      if (!d.bitRule && d.city && d.state !== 2) continue; // the box is back on only once it is shut
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
        flags: box?.flags ?? OBJECT_BOX_FLAGS,
        ex: d.x,
        ez: d.z,
      });
    }
    const broken = new Set(this.all.boxes.filter((b) => b.broken).map((b) => b.index));
    for (const s of this.solids) {
      if (this.delayed.has(s.index) || broken.has(s.index)) continue;
      out.push(solidObstacle(s));
    }
    return out;
  }

  // The view of a door's unlock camera (state 1): source at the door's
  // param1..3, target at the door (FUN_00656eb4 -> SetDefaultNPCCameraView_004d33c0),
  // or null when no door is showing its unlock.
  unlockCameraView(): { source: [number, number, number]; target: [number, number, number] } | null {
    const d = this.doors.find((x) => x.state === 1 && x.camera);
    return d?.camera ? { source: d.camera, target: [d.x, d.y, d.z] } : null;
  }

  // A pillar trap's rise and spin (render/traps.ts).
  setTrapPose(index: number, rise1: number, rise2: number, spin: number): void {
    this.models?.setTrapPose(index, rise1, rise2, spin);
  }

  // A Seabed capture trap's draw (render/traps.ts captureTrapDraw).
  setCaptureDraw(index: number, draw: CaptureDraw): void {
    this.models?.setCaptureDraw(index, draw);
  }

  // The spring's njm frame (0..frames-1) of a capture trap; its frame count (0 when unknown).
  setCaptureFrame(index: number, frame: number): void {
    this.models?.setSpringFrame(index, frame);
  }

  springFrames(index: number): number {
    return this.models?.springFrames(index) ?? 0;
  }

  // The nodes the pillar traps move on the ticks.
  trapNodes(): ReadonlySet<THREE.Object3D> | null {
    return this.models?.trapNodes ?? null;
  }

  setBossWarpState(index: number | null, state: number): void {
    this.drivenWarp = index === null ? null : { index, state };
  }

  // Boss warp state as its parts show it (objectmodels.ts, case 0x0019): the
  // idle beam in state 0, the active one in states 1 and 2, the base alone
  // in states 3 and 4.
  private showBossWarps(): void {
    for (const w of this.warps) {
      if (w.kind !== 'boss') continue;
      const locked = w.flag >= 0 && !this.flags.has(w.flag);
      const state = this.drivenWarp?.index === w.index ? this.drivenWarp.state : locked ? 4 : 0;
      this.models?.setState(w.index, state === 0 ? 'idle' : state === 1 || state === 2 ? 'active' : 'off');
    }
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
    for (const k of this.komos) stepKomo(k, this.flags.has(k.flag));
    const players = this.playersBuf;
    players.length = 0;
    if (self) players.push(self);
    for (const o of others) players.push(o);
    for (const d of this.doors) {
      if (d.type === SEAL_DOOR) {
        // Not a door state machine: sealed (box on) until quest flag 0x2f.
        let seal = this.seals.get(d.index);
        if (!seal) this.seals.set(d.index, (seal = new SealDoor(this.questFlag)));
        seal.frame(this.questFlag);
        d.state = seal.sealed ? 0 : 5;
        this.models?.setVisible(d.index, seal.sealed);
        this.models?.setSealLamps(d.index, seal.lamps(), seal.alpha);
        if (d.mesh) d.mesh.visible = seal.sealed;
        continue;
      }
      const frames = this.models?.doorFrames(d.index) || DOOR_FRAMES;
      if (d.bitRule === 'beam') {
        // The beam's lock and motion run per game tick (tickBeamDoors); here its frame is drawn.
        d.frame = d.beamFrame;
      } else {
        stepBitDoor(d, (f) => this.switchOn(f), players);
        if (d.city) {
          let flat = Infinity;
          for (const p of players) flat = Math.min(flat, Math.hypot(d.x - p.x, d.z - p.z));
          stepCityDoor(d, flat, frames);
        } else {
          let nearest = Infinity;
          for (const p of players) nearest = Math.min(nearest, dist3(d, p));
          stepDoor(d, this.unlocked(d), nearest, frames);
        }
      }
      if (this.models?.models.has(d.index)) {
        if (d.lamps) this.models.setLamps(d.index, d.state <= 2 ? doorLamps(d, this.unlocked(d), this.flags) : null);
        else this.models.setState(d.index, lockedLook(d) ? 'locked' : 'unlocked');
        this.models.setDoorFrame(d.index, d.frame);
        this.models.setLaserFrame(d.index, d.laserFrame);
        continue;
      }
      const m = d.mesh as THREE.Group | null;
      if (!m) continue;
      const panel = m.children[0] as THREE.Mesh;
      (panel.material as THREE.MeshBasicMaterial).color.setHex(lockedLook(d) ? 0xc04040 : 0x4080d0);
      panel.position.y = 15 - 30 * (d.frame / Math.max(1, frames - 1));
      panel.visible = d.state !== 5;
    }
    this.showBossWarps();
    if (this.collision) this.collision.obstacles = this.obstacles();
  }

  // The beam-family object update runs once per game tick (30/s), as the exe's object update does:
  // the 0x0204 lock and motion (0x00658410 / 0x00657e00). `self` / `others` are the floor's players.
  tickBeamDoors(ticks: number, self: { x: number; y: number; z: number } | null, others: ReadonlyArray<{ x: number; y: number; z: number }>): void {
    for (let i = 0; i < ticks; i++) {
      const players: Array<{ x: number; y: number; z: number }> = [];
      if (self) players.push(self);
      for (const o of others) players.push(o);
      for (const d of this.doors) {
        if (d.bitRule !== 'beam') continue;
        // The lock reads the quest flags of the current difficulty (GetQuestFlagBit_006bb450(difficulty, flag)).
        const ev = stepBitDoor(d, (f) => this.questFlag(f), players);
        d.state = d.bit0 ? 5 : 0; // the state reads as open once bit 0 is set (lockedLook, the mesh colour)
        for (const id of ev.se) this.onSe(id, d);
        if (ev.unlocked) this.onBeamUnlock(d);
        if (!d.bit0) {
          d.passable = false; // the update clears flag 8 while bit 0 is clear
          continue;
        }
        const m = stepBeamMotion(d, this.models?.doorFrames(d.index) || DOOR_FRAMES);
        if (m.se) this.onSe(BEAM_MOTION_SE, d);
        if (m.burst) for (const sx of [BEAM_PARTICLE_OFFSET, -BEAM_PARTICLE_OFFSET]) this.onParticles(BEAM_PARTICLE, beamPoint(d, sx));
      }
    }
    if (ticks && this.collision) this.collision.obstacles = this.obstacles();
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

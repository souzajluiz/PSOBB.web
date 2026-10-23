// Object set entry (map_*o.dat) -> model archive, model entries, textures and
// motions, reverse-engineered from PsoBB.exe (Ephinea 1.25.13; addresses are
// VAs).
//
// - 0x00a06be0: per-area pointer table to {u32 type, create, f32 dist^2, 0}
//   rows (the object factory). `create` allocates the object and runs its
//   constructor; the vtable's slot 1 is the update, slot 2 the render.
// - Each class has a loader run when the area loads that reads one BML with
//   LoadBML_005b7a84 (entries by position: models first, then motions, as for
//   enemies, see render/enemymodel.ts) into a global, and often a separate
//   texture archive with FUN_008009dc("<name>.gvm"); on Blue Burst the file is
//   <name>.xvm. FUN_005b8610(i) / FUN_005b8624(i) / FUN_005b8638(i) return
//   model i, its texture list and motion i of that archive (thiscall on the
//   archive global).
// - Renders draw a model with FUN_00835090 (static) or FUN_00835574 (with a
//   motion at a frame); FUN_00829cc8 selects the texture list; FUN_0081a588
//   (model, id) sets the texture id of every mesh of an XJ model (used for
//   digits and lamp colors).
//
// The tables below name, for each class, the loader and the constructor /
// render that pick the entries. Objects whose drawing is not reproduced in
// detail draw the constructor's model with its motion looping; those are
// marked "generic".

import type { ObjectSet } from './setdata.ts';
import { COLLISION_TABLES } from './collisionboxes.gen.ts';

export interface ObjectModelContext {
  area: number;
  episode: number; // 1, 2, 3 (= Episode 4)
  ultimate?: boolean; // Ultimate Episode 1 online loads the *_a archives
  event?: number; // the session's seasonal event (the 64 join's event byte; 0 = none)
}

// When a part is drawn.
export type PartShow = 'always' | 'locked' | 'unlocked' | 'on' | 'off' | 'idle' | 'active';

// How a part's motion is advanced: loop adds `speed` frames per game tick,
// restart too but goes back to frame 0 once past the last frame instead of
// wrapping the overshoot (restart-last: once it reaches the last frame),
// loop-last wraps at the last frame instead of the frame count, door follows
// the door state machine, laser the fence's own one.
export type PartDrive = 'loop' | 'loop-last' | 'restart' | 'restart-last' | 'door' | 'laser' | 'spring';

interface ObjectPartBase {
  model: number; // model entry (BML position)
  show?: PartShow; // locked/unlocked: doors; on/off: switches; idle/active: boss warps
  textureId?: number; // FUN_0081a588: every mesh uses this texture id
  // Texture id -> texture id of the list, for the ids it names (the others
  // keep theirs): how the client's per-node FUN_0081a588 calls come out when
  // the ids they replace occur only on the nodes they touch.
  texIds?: Readonly<Record<number, number>>;
  tint?: readonly [number, number, number]; // constant color (render flag 0x10 + FUN_0082d710), 0..1
}

// A part either plays a motion and says how it is driven, or holds its bind
// pose: a `drive` or a `speed` without a `motion` does not compile. `shape`
// is a .njs entry (motion index) drawn at the motion's frame
// (njDrawShapeMotion), so it needs a motion too.
// keys16: the motion's angle keys are the 16-byte form (render/enemymodel.ts motion()).
type PartMotion = { motion?: never; drive?: never; speed?: never; shape?: never; keys16?: never } | { motion: number; drive: PartDrive; speed?: number; shape?: number; keys16?: true };

// The texture list is the archive entry's own, or one model entry's embedded
// list, or a separate archive - never two of them at once.
type PartTextures = { textures?: never; texlistOf?: never } | { textures: string; texlistOf?: never } | { texlistOf: number; textures?: never };

export type ObjectPartSpec = ObjectPartBase & PartMotion & PartTextures;

// Object collision box (InitEnemyCollisionBoxes_007b9a88 entry, 0x2c bytes):
// type 1 = box of half extents (halfX, halfZ) in the object's frame
// (FUN_008443d8: x in +-unk1, z in +-radius, y +-50); type 0 = sphere.
// flags: the table's flag word (+0x18, read from PsoBB.exe at `address`); see
// render/collision.ts boxPairActive for what the bits do to a player.
export interface ObjectCollision {
  address: number;
  offset: [number, number, number];
  type: 0 | 1;
  halfX: number; // type 1: unk1 (+0x10); type 0: radius
  halfZ: number; // type 1: radius (+0x0c); type 0: radius
  flags: number;
}

export interface ObjectModelSpec {
  name: string;
  bml: string;
  parts: ObjectPartSpec[];
  collision?: ObjectCollision;
  door?: boolean; // runs the door state machine (fieldobjects.ts)
  // Four-light doors: the node indices (depth first, as
  // MapObject_InitializeGeneric_0078e9b0 counts them) of each lamp. Parts
  // 0 and 1 are the door with its own list and with the lit list; while the
  // door is closed, lamp i is drawn from part 1 when lit and from part 0
  // otherwise (render/objectview.ts setLamps).
  lamps?: ReadonlyArray<readonly number[]>;
}

const p4 = (o: ObjectSet) => Math.trunc(o.params[3]);
const p6 = (o: ObjectSet) => Math.trunc(o.params[5]);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(Math.trunc(v), lo), hi);

// Beam texture of the jungle warps: ids 1 and 8 of list 0 drawn as
// ts064_beam_aka (8) or ts064_beam_ao (9) by |param6| & 1.
const jungBeam = (o: ObjectSet): Record<number, number> => {
  const t = Math.abs(p6(o)) & 1 ? 9 : 8;
  return { 1: t, 8: t };
};

// Digit colors of the Forest door signs and switches (0x009c7b04 / 0x009c7ce0:
// {a, r, g, b} floats per digit 0..9).
export const DIGIT_COLORS: ReadonlyArray<[number, number, number]> = [
  [0.824, 0.098, 0.098],
  [0.098, 0.098, 0.824],
  [0.824, 0.824, 0.098],
  [0.098, 0.824, 0.824],
  [0.824, 0.098, 0.824],
  [0.824, 0.502, 0.098],
  [0.098, 0.502, 0.824],
  [0.706, 0.902, 0.098],
  [0.824, 0.098, 0.392],
  [1, 1, 1],
];

// Collision boxes read from the constructors' FUN_007b9a88 arguments.
// Box tables read from the exe: flags 0x10003 (bit 0 enabled, bits 1 and 0x10000).
const BOX = (address: number, halfX: number, halfZ: number, y = 20, z = 0): ObjectCollision => ({ address, offset: [0, y, z], type: 1, halfX, halfZ, flags: 0x10003 });
const DOOR_BOX_20 = (address: number) => BOX(address, 20, 10);
// 0x009c77ac: sphere r9 at (0, 6, 0), flags 0x38003.
const CONTAINER_SPHERE: ObjectCollision = { address: 0x009c77ac, offset: [0, 6, 0], type: 0, halfX: 9, halfZ: 9, flags: 0x38003 };
// A box table read from the exe by tools/gen-collision-boxes.py (collisionboxes.gen.ts),
// for a constructor whose table has one row: a sphere's halfX is its radius, a box's halfZ.
function generatedBox(address: number): ObjectCollision {
  const rows = COLLISION_TABLES[address];
  if (!rows || rows.length !== 1) throw new Error(`box table ${address.toString(16)} is not a single row`);
  const r = rows[0];
  const type = r.shape === 1 ? 1 : 0;
  return { address, offset: [r.offset[0], r.offset[1], r.offset[2]], type, halfX: type === 1 ? r.halfX : r.radius, halfZ: r.radius, flags: r.flags };
}

const spec = (name: string, bml: string, parts: ObjectPartSpec[], extra: Partial<ObjectModelSpec> = {}): ObjectModelSpec => ({ name, bml, parts, ...extra });

// A door whose single model opens with motion 0 (Cave, Mine, Ruins, VR, Seabed,
// Lab, Episode 4): locked/unlocked texture lists as the loaders set them up.
function simpleDoor(name: string, bml: string, collision: ObjectCollision, lockedTex?: string, unlockedTex?: string): ObjectModelSpec {
  // Built per branch instead of spreading an optional `textures` in: a part
  // either names a texture archive or takes the entry's own list.
  const leaf = (show: PartShow, textures?: string): ObjectPartSpec =>
    textures ? { model: 0, motion: 0, drive: 'door', show, textures } : { model: 0, motion: 0, drive: 'door', show };
  const parts: ObjectPartSpec[] = lockedTex || unlockedTex ? [leaf('locked', lockedTex), leaf('unlocked', unlockedTex)] : [{ model: 0, motion: 0, drive: 'door' }];
  return spec(name, bml, parts, { collision, door: true });
}

// Box archives by area (FUN_0064f674, normal; FUN_0064f448, red): Seabed and
// Olga Flow (0x1c, 0x1d, 0x1f), Episode 4 (0x24..0x2c), everything else.
function containerSpec(name: string, area: number, red: boolean, ultimate: boolean): ObjectModelSpec {
  if (area === 0x1c || area === 0x1d || area === 0x1f) {
    return red
      ? spec(name, 'bm_obj_seabed_con_rare.bml', [{ model: 2, textures: 'obj_seabed_con_rare.xvm' }], { collision: CONTAINER_SPHERE })
      : spec(name, 'bm_obj_seabed_con.bml', [{ model: 1, textures: 'obj_seabed_con.xvm' }], { collision: CONTAINER_SPHERE });
  }
  if (area >= 0x24 && area <= 0x2c) {
    return red
      ? spec(name, 'bm_obj_ep4_container_red.bml', [{ model: 2 }], { collision: CONTAINER_SPHERE })
      : spec(name, 'bm_obj_ep4_container.bml', [{ model: 1 }], { collision: CONTAINER_SPHERE });
  }
  return red
    ? spec(name, 'fe_obj_con_hahen1.bml', [{ model: 2, textures: 'obj_abecon.xvm' }], { collision: CONTAINER_SPHERE })
    : spec(name, 'fe_obj_hako01_hahen02.bml', [{ model: 1, textures: ultimate ? 'fs_obj_hako01_a.xvm' : 'fs_obj_hako01_n.xvm' }], { collision: CONTAINER_SPHERE });
}

// Classes that draw nothing: volumes and markers the client reads but never
// renders. TObjRoomId only has a debug display in the binary
// (TObjRoomId_debug_display, create_TObjRoomId); the others drive the fog
// (render/mapviewer.ts setFogRegions), the wave events (render/waves.ts), the
// spawn points (render/lobbyview.ts), ambient sound and the camera.
// Keyed by class name, not by type: the same type is a different class in
// another area (0x0160 is TObjWarpBoss03 in the Ruins and
// TObjFogCollisionPoison in Episode 4).
const INVISIBLE_OBJECTS = new Set([
  'TObjPlayerSet', // a spawn point
  'TObjEnvSound',
  'TObjEnvSoundEx',
  'TObjEnvSoundGlobal',
  'TObjFogCollision',
  'TObjFogCollisionSwitch',
  'TObjFogCollisionPoison',
  'TObjEvtCollision', // the volume that triggers a wave event
  'TObjRoomId',
  'TObjCamera',
  // TObjCityDoor_Lobby (0x0054, create 0x00646874, ctor 0x006468f0): its
  // render slot is the empty 0x0061cdb0 and, online, the update
  // (0x00646d10) does nothing; offline the ctor adds a wall of eight
  // triangles to the map collision.
  'TObjCityDoor_Lobby',
  // TShopGenerator (0x0040, create 0x006d71e4, ctor 0x006d725c, vtable
  // 0x00b3c780): render slot 0x0061cdb0; it only clears the shop's menu
  // flag param1 (0..8) at +0x84.
  'TShopGenerator',
]);

// True when the class has no model on purpose, so a missing one is not a gap.
export function isInvisibleObject(name: string): boolean {
  return INVISIBLE_OBJECTS.has(name);
}

// TObjLobbyMain (0x0182; create 0x00672254, ctor 0x006722d0, vtable 0x00b35ea8,
// BML bm_obj_lobby_main.bml, loader 0x006724b4). Its dump names say Lobby2Plant /
// Derolle: copied from other classes, the code is this object's.
// The BML's models are entries 0..17 (.xj) and its motions 18..22 (.njm, motion
// index 0..4). The render draws model `chunk` and its motion from the table
// below (5 = no motion: 0x0093a4c0, read by hand with exedata).
// The chunk is the seasonal event's (DerolleSetNjmChunkIdBasedOnSeason_00671e1c
// after DerolleGetMappedSeasonalEventID_00671d78, which maps 0x0c to 0 and 0x0d
// to 8, so 0x0d shows the Sakura model). An event with no case (none, 0x0c)
// takes the set entry's initdata_param4 when it is 1..9, else 0
// (DerolleSetStateID_00672410 reads +0x84 = initdata_param4 of
// ApplyObjectInitData_007ba33c).
const LOBBY_MAIN_EVENT_CHUNK: Readonly<Record<number, number>> = { 1: 12, 3: 16, 4: 14, 5: 15, 7: 10, 8: 11, 9: 17, 10: 1, 11: 13 };
const LOBBY_MAIN_MOTION: Readonly<Record<number, number>> = { 7: 0, 8: 1, 9: 2, 15: 3, 16: 4, 17: 4 };
// The round box 0x009c9778 (InitEnemyCollisionBoxes entry: radius 32 at the
// object, flags 0x10003); the lobby's players are stopped by it in lobbyview.ts.
const LOBBY_MAIN_COLLISION: ObjectCollision = { address: 0x009c9778, offset: [0, 0, 0], type: 0, halfX: 32, halfZ: 32, flags: 0x10003 };

export function lobbyMainChunk(event: number, param4: number): number {
  const mapped = event === 0x0c ? 0 : event === 0x0d ? 8 : event;
  const seasonal = LOBBY_MAIN_EVENT_CHUNK[mapped];
  if (seasonal !== undefined) return seasonal;
  return param4 >= 1 && param4 <= 9 ? param4 : 0;
}

function lobbyMainSpec(o: ObjectSet, event: number): ObjectModelSpec {
  const chunk = lobbyMainChunk(event, Math.trunc(o.params[3]));
  const motion = LOBBY_MAIN_MOTION[chunk];
  // The animation advances one frame a tick and wraps at the last frame
  // (FUN_00672008: frame + 1, minus the last frame when it passes it).
  const part: ObjectPartSpec =
    motion === undefined
      ? { model: chunk, textures: 'obj_lobby_main.xvm' }
      : { model: chunk, textures: 'obj_lobby_main.xvm', motion, drive: 'loop-last', speed: 1 };
  return spec('TObjLobbyMain', 'bm_obj_lobby_main.bml', [part], { collision: LOBBY_MAIN_COLLISION });
}

export function objectModelFor(o: ObjectSet, ctx: ObjectModelContext): ObjectModelSpec | null {
  const { area, episode } = ctx;
  const ult = !!ctx.ultimate && episode === 1;
  const a = (name: string) => (ult ? name.replace(/\.bml$/, '_a.bml') : name);
  const ax = (name: string) => (ult ? name.replace(/\.xvm$/, '_a.xvm') : name);
  switch (o.type) {
    // ---- lobby ----
    case 0x0182:
      return lobbyMainSpec(o, ctx.event ?? 0);
    // ---- warps ----
    // TObjAreaWarpForest (and the quest copy 0x001B): create 0x007bac58, ctor
    // FUN_006696a4: model 0 (+0xd0, warp base, all nodes FUN_00835120), model 1
    // (+0xd4, beam) with motion 0 (+0xd8); textures fs_obj_warp.xvm
    // (DAT_00a8fcb8, loader 0x0066ad38). Update FUN_00669884: frame += 4.0
    // (0x00939a2c) and wraps. Render FUN_00669ab0 sets the beam's texture id
    // from {3, 2}[param6 & 1].
    case 0x0002:
    case 0x001b:
    case 0x0280: // __BARBA_RAY_TELEPORTER__ (create 0x004be0f0, same archive)
      return spec('TObjAreaWarpForest', 'fs_obj_warp.bml', [
        { model: 0, textures: 'fs_obj_warp.xvm' },
        { model: 1, textures: 'fs_obj_warp.xvm', motion: 0, drive: 'loop', speed: 4, textureId: (p6(o) & 1) === 0 ? 3 : 2 },
      ]);
    // TObjMapWarpForest: create 0x007babdc, ctor FUN_00668ec8: models 4, 5 and
    // motion 2 of fs_obj_warp.bml (generic: beam speed taken from the area warp).
    case 0x0003:
      return spec('TObjMapWarpForest', 'fs_obj_warp.bml', [
        { model: 4, textures: 'fs_obj_warp.xvm' },
        { model: 5, textures: 'fs_obj_warp.xvm', motion: 2, drive: 'loop', speed: 4 },
      ]);
    // TObjWarpBoss: create 0x0066c4b4, ctor 0x0066c6cc; models from FUN_0066cc28:
    // Ruins (areas 8-10) bm_obj_warpboss_ancient, Episode 2 / Seabed
    // bm_obj_warpboss_jungle, else bm_obj_warpboss. Fields +0xd8 = model 0,
    // +0xdc = model 2 (jungle: 1), +0xe0 = model 1, +0xe4 = motion 1 (jungle: 0),
    // +0xe8 = motion 0; texture lists +0xec / +0xf0 = model 2's (jungle: 0's).
    // Render FUN_0066cadc: base, then +0xdc (with +0xe4) or +0xe0 (with +0xe8)
    // depending on +0xf4 (FUN_0066c838: 0 when the warp waits for a switch
    // flag, 1 otherwise), frame +0xfc (speed +0x100 = 4.0).
    // TObjWarpBoss03 (0x0160 outside Episode 4, where the same type is the
    // poison fog volume): its init, InitializeSeabedTuriganeWarpObject_0066c89c,
    // fills the same fields from the same globals that init_bosswarp_assets
    // loads, so it draws like TObjWarpBoss. Its render,
    // SeabedTuriganeMapObjectRender_0066c38c, draws the base and then the
    // animated model when +0xd4 is set.
    case 0x0160: {
      if (episode === 3) return null; // TObjFogCollisionPoison
      if (area >= 8 && area <= 10) {
        return spec('TObjWarpBoss03', 'bm_obj_warpboss_ancient.bml', [
          { model: 0, texlistOf: 2 },
          { model: 2, texlistOf: 2, motion: 1, drive: 'loop', speed: 4, show: 'locked' },
          { model: 1, texlistOf: 2, motion: 0, drive: 'loop', speed: 4, show: 'unlocked' },
        ]);
      }
      return spec('TObjWarpBoss03', 'bm_obj_warpboss.bml', [
        { model: 0, texlistOf: 2 },
        { model: 2, texlistOf: 2, motion: 1, drive: 'loop', speed: 4, show: 'locked' },
        { model: 1, texlistOf: 2, motion: 0, drive: 'loop', speed: 4, show: 'unlocked' },
      ]);
    }
    // Online, CreateWarpMapObject_0066c4b4 builds the 6x6A boss warp (0x1e8
    // bytes, vtable 0x00b35440; the 0x0066c6cc object above is the offline /
    // Episode 4 one). Its render SeabedTuriganeMapObjectRender_0066c38c draws
    // model 0 and, when +0xd4 is set, the model at +0xd4 with the motion at
    // +0xd8 at frame +0xc8, without fog, both with the texture list of model 2
    // (jungle: 0). The update 0x0066aeec adds 4.0 (0x00939c14) to the frame
    // and sets it back to 0 once frame + 1.0 reaches the motion's frame count.
    // The state handlers set +0xd4 / +0xd8 (loader init_bosswarp_assets):
    //   state 0 (idle, 0x0066b9e0 sub 0)       model 2 + motion 1 (jungle: model 1 + motion 0)
    //   states 1 and 2 (gather 0x0066b5f8, warp 0x0066b4fc, sub 0)
    //                                          model 1 + motion 0
    //   state 3 (occupied 0x0066b370), state 4 (locked 0x0064bc3c): +0xd4 = 0,
    //                                          the base alone
    // so the parts are shown by the warp's state: 'idle', 'active', or
    // neither (render/fieldobjects.ts setBossWarpState).
    case 0x0019: {
      const ancient = area >= 8 && area <= 10;
      if (!ancient && (episode === 2 || area === 0x1c || area === 0x1d)) {
        return spec('TObjWarpBoss', 'bm_obj_warpboss_jungle.bml', [
          { model: 0, texlistOf: 0 },
          { model: 1, texlistOf: 0, motion: 0, drive: 'restart-last', speed: 4, show: 'idle' },
          { model: 1, texlistOf: 0, motion: 0, drive: 'restart-last', speed: 4, show: 'active' },
        ]);
      }
      return spec('TObjWarpBoss', ancient ? 'bm_obj_warpboss_ancient.bml' : 'bm_obj_warpboss.bml', [
        { model: 0, texlistOf: 2 },
        { model: 2, texlistOf: 2, motion: 1, drive: 'restart-last', speed: 4, show: 'idle' },
        { model: 1, texlistOf: 2, motion: 0, drive: 'restart-last', speed: 4, show: 'active' },
      ]);
    }
    // Pioneer 2 warps, bm_obj_city_common.bml + bm_obj_city_common.xvm (loader
    // FUN_00645b18, DAT_00a8f434 / DAT_00a8f430). The loader is in the asset
    // lists of Pioneer 2 of every episode (per-area list table 0x00a05d60:
    // entries 0, 0x12 = the Lab, 0x2d), so the Lab's warps use it too. Renders
    // read the model array (+0x42c, 0x10 per model, +8) and motion array
    // (+0x430, 8 per motion, +4) directly:
    //   0x0043 TObjCityMainWarp, render 0x0064abe0: model 12 (fd_obj_warp_big)
    //          and model 0 (de_obj_bigbeam) with motion 5, frame +0xc8;
    //   0x0044 TObjCityAreaWarp, render FUN_0064aeac: model 1 (de_obj_citybeam)
    //          with motion 6, frame +0xc8;
    //   0x0045 TObjCityMapWarp, render 0x0064b190: model 13 (fd_obj_warp_small)
    //          only when param5 is 0, and model 3 (de_obj_smallbeam) with
    //          motion 7, frame +0x100.
    // The updates (0x0064ab90, 0x0064ae2c, 0x0064b118) add 4.0 (0x009363f4)
    // and wrap at motion 7's last frame: frame -= count - 1 once frame >=
    // count - 1. Motions 5, 6 and 7 all have 30 frames, so each beam wraps at
    // its own last frame (drive loop-last).
    case 0x0043:
      if (area !== 0 && area !== 0x12 && area !== 0x2d) return null;
      return spec('TObjCityMainWarp', 'bm_obj_city_common.bml', [
        { model: 12, textures: 'bm_obj_city_common.xvm' },
        { model: 0, textures: 'bm_obj_city_common.xvm', motion: 5, drive: 'loop-last', speed: 4 },
      ]);
    case 0x0044:
      if (area !== 0 && area !== 0x12 && area !== 0x2d) return null;
      return spec('TObjCityAreaWarp', 'bm_obj_city_common.bml', [{ model: 1, textures: 'bm_obj_city_common.xvm', motion: 6, drive: 'loop-last', speed: 4 }]);
    case 0x0045: {
      if (area !== 0 && area !== 0x12 && area !== 0x2d) return null;
      const beam: ObjectPartSpec = { model: 3, textures: 'bm_obj_city_common.xvm', motion: 7, drive: 'loop-last', speed: 4 };
      return spec('TObjCityMapWarp', 'bm_obj_city_common.bml', Math.trunc(o.params[4]) === 0 ? [{ model: 13, textures: 'bm_obj_city_common.xvm' }, beam] : [beam]);
    }
    // TObjLaboMapWarp (0x02BD): create 0x0064b3ac, ctor 0x0064b428 (radius
    // 23.0 at +0xac), loader LoadWarpLaboBMLData_0064b688:
    // bm_obj_warp_labo.bml. Render 0x0064b508 (vtable 0x00b30300): texture
    // list of model 1; model 1 (warp_obj01) only when param5 is 0, then model 0
    // (warp_citybeam) with motion 0 at frame +0x100. Update 0x0064b48c: +4.0
    // per tick, wrapping at the last frame like the city warps.
    case 0x02bd: {
      const beam: ObjectPartSpec = { model: 0, texlistOf: 1, motion: 0, drive: 'loop-last', speed: 4 };
      return spec('TObjLaboMapWarp', 'bm_obj_warp_labo.bml', Math.trunc(o.params[4]) === 0 ? [{ model: 1, texlistOf: 1 }, beam] : [beam]);
    }
    // Pioneer 2 doors (Episodes 1 and 4), bm_obj_city_common.bml: a shared
    // class (ctor InitializeHuntersGuildDoorEntity_006460d8) whose per-type
    // data block gives the speed, the open / close distances and the box
    // (render/fieldobjects.ts CITY_DOORS):
    //   0x0046 TObjCityDoor_Shop   create 0x00646000, render 0x006461f8:
    //          model 11 (fd_obj_shopdoor_01) with motion 10, frame +0xb4
    //   0x0047 TObjCityDoor_Guild  create 0x00646258, render 0x00646360:
    //          model 21 (hunter_door) with motion 12
    //   0x0048 TObjCityDoor_Warp   create 0x006464d0, render 0x00646670:
    //          model 9 with motion 8 and model 10 with motion 9 (the shutter's
    //          two halves, fd_obj_n_tobira_shut_sita / _ue)
    //   0x0049 TObjCityDoor_Med    create 0x006466f4, render 0x00646804:
    //          model 20 (fe_obj_o_medical_door01l) with motion 11
    // Box: InitEnemyCollisionBoxes_007b9a88 with offset 0 (0x00935a94..) and
    // the block's +0x0c (radius) / +0x10 (unk1).
    case 0x0046:
      return spec('TObjCityDoor_Shop', 'bm_obj_city_common.bml', [{ model: 11, textures: 'bm_obj_city_common.xvm', motion: 10, drive: 'door' }], {
        collision: BOX(0x00935ac4, 25, 2, 0),
        door: true,
      });
    case 0x0047:
      return spec('TObjCityDoor_Guild', 'bm_obj_city_common.bml', [{ model: 21, textures: 'bm_obj_city_common.xvm', motion: 12, drive: 'door' }], {
        collision: BOX(0x00935a78, 24, 2, 0),
        door: true,
      });
    case 0x0048:
      return spec(
        'TObjCityDoor_Warp',
        'bm_obj_city_common.bml',
        [
          { model: 9, textures: 'bm_obj_city_common.xvm', motion: 8, drive: 'door' },
          { model: 10, textures: 'bm_obj_city_common.xvm', motion: 9, drive: 'door' },
        ],
        { collision: BOX(0x009c7114, 6.5, 50, 0), door: true },
      );
    // The Medical Center door's motion 11 (fe_obj_o_medical_door01l.njm, 30
    // frames, two leaves) has 16-byte angle keys: 30 consecutive frames on each
    // of its 2 nodes (node 0 turns to -3094 BAMS, node 1 to +6189 BAMS by frame
    // 29). Read as the short form it keeps only frame 0, so the leaves never
    // swing while the box is already off (the player walks through a shut-looking
    // door). ASSUMED: the exe's key size per motion (the same header as the
    // short-form enemy motions); the other object motions are unchanged.
    case 0x0049:
      return spec('TObjCityDoor_Med', 'bm_obj_city_common.bml', [{ model: 20, textures: 'bm_obj_city_common.xvm', motion: 11, drive: 'door', keys16: true }], {
        collision: BOX(0x00935a54, 25, 4, 0),
        door: true,
      });
    // TObjGoalWarpAncient (0x0140) / TObjMapWarpAncient (0x0141): ctors
    // 0x00640d84 / 0x00640a80 use models 1, 3, 5 with motions 0, 2 and models
    // 0, 2, 4 with motion 1 of bm_o_warp_ancient.bml (generic).
    case 0x0140:
      return spec('TObjGoalWarpAncient', 'bm_o_warp_ancient.bml', [
        { model: 3 },
        { model: 1, motion: 0, drive: 'loop', speed: 1 },
        { model: 5, motion: 2, drive: 'loop', speed: 1 },
      ]);
    case 0x0141:
      return spec('TObjMapWarpAncient', 'bm_o_warp_ancient.bml', [{ model: 0 }, { model: 4 }, { model: 2, motion: 1, drive: 'loop', speed: 1 }]);
    // TObjWarpJung (create 0x0066d4c4) and TObjWarpJungMain (create
    // 0x0066d840): loader CreateSeabedTuriganeWarpObjectModel_0066db88,
    // bm_obj_warp_jung.bml: model 0 (base, with the archive's texture list 0)
    // and model 1 (beam) with motion 0. The update (0x0066d28c / 0x0066d6b4)
    // adds 4.0 (0x00939df8) to the frame at +0xc8 and sets it back to 0 once
    // it is past the last frame. The render (0x0066d2d8) first sets the
    // texture of the six beam nodes (model 1: the five children of node 1 and
    // node 7) to ts064_beam_aka (red) when param6 is 0 or ts064_beam_ao
    // (blue) when it is 1 (the constructors keep |param6| & 1). Those nodes
    // are the only ones using ids 1 and 8 of list 0, so the swap is an id remap.
    case 0x0201:
    case 0x020a:
      return spec(o.type === 0x0201 ? 'TObjWarpJung' : 'TObjWarpJungMain', 'bm_obj_warp_jung.bml', [
        { model: 0, texlistOf: 0 },
        { model: 1, texlistOf: 0, motion: 0, drive: 'restart', speed: 4, texIds: jungBeam(o) },
      ]);

    // ---- doors ----
    // TObjDoor (Forest): create 0x00657358, ctor FUN_006573d4; archive
    // fe_obj_doa_kanban.bml + fe_obj_door.xvm (loader FUN_0065753c: model 4
    // DAT_00a8f74c door, 3 DAT_00a8f750 laser, 0 DAT_00a8f754 sign, 1 and 2
    // DAT_00a8f758/75c lamps, motion 0 DAT_00a8f760 door, 1 DAT_00a8f764
    // laser). Render FUN_006571f4 -> table 0x009c7ad8 by state:
    //   locked (state 0, FUN_00656a68): door static, laser with motion 1 at
    //     +0xb8, sign with texture id = +0xd0 (((param4 >> 8) & 0xff) % 10) in
    //     the digit color, lamps with texture 0x15;
    //   unlocked (states 2-5, FUN_00656c88): door with motion 0 at +0xb4,
    //     lamps with texture 0x16.
    // Collision box 0x009c7bd8: 40 x 10 half extents.
    case 0x0080: {
      const digit = ((p4(o) >> 8) & 0xff) % 10;
      const tex = 'fe_obj_door.xvm';
      return spec(
        'TObjDoor',
        'fe_obj_doa_kanban.bml',
        [
          { model: 4, textures: tex, show: 'locked' },
          { model: 4, textures: tex, motion: 0, drive: 'door', show: 'unlocked' },
          { model: 3, textures: tex, motion: 1, drive: 'laser', show: 'locked' },
          { model: 0, textures: tex, textureId: digit, tint: DIGIT_COLORS[digit], show: 'locked' },
          { model: 1, textures: tex, textureId: 0x15, show: 'locked' },
          { model: 2, textures: tex, textureId: 0x15, show: 'locked' },
          { model: 1, textures: tex, textureId: 0x16, show: 'unlocked' },
          { model: 2, textures: tex, textureId: 0x16, show: 'unlocked' },
        ],
        { collision: BOX(0x009c7bd8, 40, 10, 0), door: true },
      );
    }
    // Cave doors (loaders FUN_0061dac0, FUN_0061e110, FUN_0061e6dc; Ultimate
    // Episode 1 online loads the *_a archives): model 0 + motion 0 with the
    // archive's textures; the r.gvm texture list is used while locked
    // (render FUN_0061ddcc). Collision boxes 20 x 10.
    case 0x00c1:
      return simpleDoor('TODoorCave01', a('bm_fs_obj_do_doa01.bml'), DOOR_BOX_20(0x009c5224), ax('fs_obj_do_doa01r.xvm'));
    case 0x00c2:
      return simpleDoor('TODoorCave02', a('bm_fs_obj_do_doa02.bml'), DOOR_BOX_20(0x009c5294), ax('fs_obj_do_doa02r.xvm'));
    case 0x00ce:
      return simpleDoor('TODoorCave03', a('bm_fs_obj_do_doa03.bml'), DOOR_BOX_20(0x009c5304));
    // Mine doors (loaders FUN_0061f014, FUN_0061f61c), Episode 4 door
    // (ctor 0x00677afc, bm_obj_ep4_door.bml).
    case 0x0100:
      return simpleDoor('TODoorMachine01', a('bm_fs_obj_ki_doa.bml'), DOOR_BOX_20(0x009c5374), ax('fs_obj_ki_doa_r.xvm'));
    case 0x0102:
      if (episode === 3) return simpleDoor('TODoorMachine02', 'bm_obj_ep4_door.bml', DOOR_BOX_20(0x009c9d38));
      return simpleDoor('TODoorMachine02', a('bm_fs_obj_ki_doa2.bml'), DOOR_BOX_20(0x009c53e4), ax('fs_obj_ki_doa2_r.xvm'));
    // Ruins doors: loaders 0x0061a248 .. 0x0061d1f4, each with its .gvm.
    case 0x0144:
      return simpleDoor('TODoorAncient01', 'bm_fe_obj_o_door01l.bml', DOOR_BOX_20(0x009c4fc4), undefined, 'fe_obj_o_door01g.xvm');
    case 0x0145:
      return simpleDoor('TODoorAncient03', 'bm_fe_obj_o_door03l.bml', DOOR_BOX_20(0x009c5014), undefined, 'fe_obj_o_door03g.xvm');
    case 0x0146:
      return simpleDoor('TODoorAncient04', 'bm_fe_obj_o_door04l.bml', DOOR_BOX_20(0x009c5064), undefined, 'fe_obj_o_door04g.xvm');
    case 0x0147:
      return simpleDoor('TODoorAncient05', 'fs_obj_door07_m.bml', DOOR_BOX_20(0x009c5094));
    case 0x0148:
      return simpleDoor('TODoorAncient06', 'fs_obj_door07_m.bml', DOOR_BOX_20(0x009c50c4), undefined, 'fs_obj_door07_m_02_g.xvm');
    case 0x0149:
      return simpleDoor('TODoorAncient07', 'fs_obj_door07_m.bml', DOOR_BOX_20(0x009c5114), 'fs_obj_door07_m_03_r.xvm', 'fs_obj_door07_m_03_g.xvm');
    case 0x014a:
      return simpleDoor('TODoorAncient08', 'fs_obj_o_door06l.bml', DOOR_BOX_20(0x009c5164), 'fs_obj_o_door06l_r.xvm');
    case 0x014b:
      return simpleDoor('TODoorAncient09', 'fs_obj_o_door05l.bml', DOOR_BOX_20(0x009c51b4), undefined, 'fs_obj_o_door05l_g.xvm');
    // Episode 2 doors.
    // TODoorVS2Door01 (VR Temple, loader FUN_00622df0): model 0, no motion in
    // the archive (opens by sinking, as before: generic).
    case 0x01a0:
      return spec('TODoorVS2Door01', 'fs_obj_o_vs2door01l.bml', [{ model: 0, textures: 'fs_obj_o_vs2door01lr.xvm' }], { collision: DOOR_BOX_20(0x009c55bc), door: true });
    // Four-light doors (create 0x007bb130 / 0x007bb1ac, loader FUN_00620450:
    // bm_obj_door_ruins / bm_obj_door_space, green texture list when open).
    // Four-light doors. TODoorFourLightRuins / TODoorFourLightSpace share the
    // loader LoadDoorAssetsForCurrentMap_00620450, which picks the archive by
    // map, not by type: 0x15/0x16 (Spaceship) bm_obj_door_space.bml +
    // obj_door_space_green.gvm, any other map bm_obj_door_ruins.bml +
    // obj_door_ruins_green.gvm. The constructors (Ruins 0x0061f8c4, Space
    // 0x0061fed8) keep two nodes per lamp; the render (vtable 0x00b27a20 slot
    // 2, 0x0061fa60) draws the door with the green list while it opens, is
    // open or closes, and while it is closed draws the body with its own list
    // and lamp i with the green list when it is lit: always once the door is
    // unlocked, else when i >= param5 or switch flag param4 + i is set.
    case 0x01ab:
    case 0x01c0: {
      const space = area === 0x15 || area === 0x16;
      return {
        ...simpleDoor(o.type === 0x01ab ? 'TODoorFourLightRuins' : 'TODoorFourLightSpace', space ? 'bm_obj_door_space.bml' : 'bm_obj_door_ruins.bml', DOOR_BOX_20(0x009c5458), undefined, space ? 'obj_door_space_green.xvm' : 'obj_door_ruins_green.xvm'),
        lamps: o.type === 0x01ab ? [[3, 2], [4, 5], [6, 7], [8, 9]] : [[4, 5], [6, 7], [8, 9], [10, 11]],
      };
    }
    case 0x0192:
      return simpleDoor('TObjDoaEx01', 'fs_obj_ex_doa01.bml', BOX(0x009c798c, 20, 10, 20, -5));
    // TObjDoorJung (laser door, loader FUN_00657bac: bm_obj_beamdoa.bml, model
    // 0 frame and model 1 beam, embedded texture list 0).
    case 0x0202:
      return spec(
        'TObjDoorJung',
        'bm_obj_beamdoa.bml',
        [{ model: 0, texlistOf: 0 }, { model: 1, texlistOf: 0, show: 'locked' }],
        { collision: BOX(0x009c7c40, 30, 10), door: true },
      );
    case 0x0204:
      return spec('TODoorJungleMain', 'bm_o_jungle_doormain.bml', [{ model: 3, textures: 'o_jungle_doormain.xvm', motion: 0, drive: 'door' }], {
        collision: BOX(0x009c7c9c, 80, 20, 0),
        door: true,
      });
    // TODoorFourLightSeabed (ctor InitializeItemDoor_00620f90, loader
    // InitializeDoorAssetsStandard_006220fc) and TODoorFourLightSeabedU (ctor
    // 0x006211b8, loader InitializeDoorAssetsUpper_00621f2c): the lists are
    // fs_obj_doorx4_atui / _u (+0x50) and their _green (+0x54), the _02 ones
    // on Seabed Lower (0x1d). Same lamps as above (RenderDoorSub_006209dc),
    // with the count clamped to 0..4 (DoorSetState_00620d70).
    case 0x0221: {
      const lower = area === 0x1d ? '_02' : '';
      return {
        ...simpleDoor('TODoorFourLightSeabed', 'bm_o_door_seabed01.bml', DOOR_BOX_20(0x009c551c), `fs_obj_doorx4_atui${lower}.xvm`, `fs_obj_doorx4_atui_green${lower}.xvm`),
        lamps: [[2, 3], [4, 5], [9, 10], [11, 12]],
      };
    }
    case 0x0222: {
      const lower = area === 0x1d;
      return {
        ...simpleDoor('TODoorFourLightSeabedU', 'bm_o_door_seabed01_u.bml', DOOR_BOX_20(0x009c551c), lower ? 'fs_obj_doorx4_usui_02.xvm' : 'fs_obj_doorx4_u.xvm', lower ? 'fs_obj_doorx4_usui_green_02.xvm' : 'fs_obj_doorx4_u_green.xvm'),
        lamps: [[2, 3], [4, 5], [7, 8], [9, 10]],
      };
    }
    case 0x0056:
      return simpleDoor('TODoorLabo', 'bm_obj_door_labo.bml', DOOR_BOX_20(0x009c551c), 'obj_o_labodoor_l_red.xvm', 'obj_o_labodoor_l_grn.xvm');
    case 0x02bb:
      return simpleDoor('TODoorLaboNormal', 'bm_obj_labodoor_nrm.bml', DOOR_BOX_20(0x009c551c), 'o_labodoor_nrm_red.xvm', 'o_labodoor_nrm_green.xvm');
    // TODoorVoShip (Vol Opt's seal door, area 0x0d): create 0x006225cc, ctor
    // InitializeLabodoorMapObject_00622648, loader LoadLabodoorBMLData_00622844
    // (bm_o_door_vo_ship.bml: two NJ chunk models, fe_obj_fuuin_singo_moto and
    // fe_obj_fuuin_doa, the door's .njm and .njs). The ctor keeps model 1 with
    // its own texture list 1 and motion 0 (+0x34 / +0x24 / +0xbc), whose frame
    // +0xb0 grows by 1.0 (+0xb8) and wraps at the last frame (0x0061347c: limit
    // = frame count - 1), and model 0 with list 0 (+0xd4 / +0xd8, the seal
    // lamps). Box 0x009c5574: 20 x 10, 20 up. The render 0x00622358 (vtable
    // 0x00b27fc0) draws nothing once the three seal bits of +0xcc (0xe; quest
    // flags 0x2c / 0x2d / 0x2e clear one each, 0x2f all three and turns the
    // box off) are gone; while sealed it draws the door with both motions and
    // the lamp root, then each lamp child whose bit is still set, in a color
    // whose alpha +0xdc swings between -1 and 0 by 0.05 a frame (render flag
    // 0x20). The seals, lamps and color: render/traps.ts SealDoor. The door is
    // drawn by NJCM_SetMinimapRenderStates_008304e0(+0x34 model, +0xbc motion
    // 0, +0xd0 motion 1 = fe_obj_fuuin_doa.njs, +0xb0 frame): the shape motion
    // plays at motion 0's frame (formats/njshape.ts).
    case 0x0130:
      return spec(
        'TODoorVoShip',
        'bm_o_door_vo_ship.bml',
        [
          { model: 1, texlistOf: 1, motion: 0, drive: 'loop-last', speed: 1, shape: 1 },
          { model: 0, texlistOf: 0 },
        ],
        { collision: BOX(0x009c5574, 20, 10, 20) },
      );

    // ---- switches ----
    // TObjDoorKey (Forest/Cave switch): create 0x00658a90, ctor FUN_00658b0c;
    // loader FUN_00658d00: abeno_fs_obj001_fosuno.bml + fe_obj_switch.xvm,
    // model 1 (DAT_00a8f7f4) base, 2 (DAT_00a8f7f8) glow, 0 (DAT_00a8f7fc)
    // digit with texture id = clamp(param6, 0, 9) in color 0x009c7ce0[digit].
    // Render FUN_006587c8: state 0 FUN_0065893c (base + digit), state 1
    // FUN_00658824 (base + glow + digit).
    case 0x0081: {
      const digit = clamp(p6(o), 0, 9);
      const tex = 'fe_obj_switch.xvm';
      return spec('TObjDoorKey', 'abeno_fs_obj001_fosuno.bml', [
        { model: 1, textures: tex },
        { model: 2, textures: tex, show: 'on' },
        { model: 0, textures: tex, textureId: digit, tint: DIGIT_COLORS[digit] },
      ]);
    }
    // TOKeyCave01: ctor FUN_0062af80, model 0 of DAT_00a8ee2c (loader
    // 0x0062b0c8: fs_obj_key_jungle.bml + fs_obj_key_jungle_red.xvm in Episode 2
    // and the Seabed, else bm_fs_obj_do_doa_panel.bml + fs_obj_do_doa_panelr.xvm).
    case 0x00c0:
      if (episode === 2 || area === 0x1c || area === 0x1d) return spec('TOKeyCave01', 'fs_obj_key_jungle.bml', [{ model: 0, textures: 'fs_obj_key_jungle_red.xvm' }]);
      return spec('TOKeyCave01', 'bm_fs_obj_do_doa_panel.bml', [{ model: 0, textures: 'fs_obj_do_doa_panelr.xvm' }]);
    // TLazerFenceSw (the laser fence with its switch motor). Loader (the one
    // that fills g_SwitchLaserBMLAsset): fe_obj_switch_laz_j.bml when the map
    // is a CCA tower / Seabed one (is_cca_tower_seanight_map_(), seabed_upper,
    // seabed_lower), else fe_obj_switch_laz.bml, with the GVM (here XVM) of
    // the same name, _a in Ultimate. It takes NJCM chunk 0 (the fence, whose
    // child nodes are the up-to-three laser segments) and chunk 1 (the motor),
    // and the two NJM chunks.
    // Render MapObjectKomoVariant6Render_0065d9d0: while the switch is locked
    // (state 0, MapObjectKomoVariant6StateIdle_0065d924 keeps it there until
    // IsSwitchUnlockedOnCurrentFloor_00816eec) it draws the four laser nodes,
    // tinted through laser_fence_xvm_color_indexes[+0xac], the static model at
    // +0xbc and the animated one at +0xc0 with its motion at the frame in
    // +0xb8, advanced by g_KomoVariant6AnimSpeed_00938adc.
    // Which of the two motor models sits in +0xbc and which in +0xc0 is taken
    // from their own names (…_moto animated, …_moto_taiki standing by) -
    // ASSUMED; the laser tint table is data, not read here.
    case 0x0084: {
      const cca = area === 0x1c || area === 0x1d || (episode === 2 && area >= 0x11 && area <= 0x13);
      const bml = cca ? 'fe_obj_switch_laz_j.bml' : 'fe_obj_switch_laz.bml';
      const tex = cca ? 'fe_obj_switch_laz_j.xvm' : ax('fe_obj_switch_laz.xvm');
      return spec('TLazerFenceSw', bml, [
        { model: 1, textures: tex, motion: 1, drive: 'loop', speed: 1 },
        { model: 2, textures: tex },
        { model: 0, textures: tex, show: 'off' },
      ]);
    }
    // TObjLazerFenceExtra: the laser fence without its own switch. Its loader
    // (the one that fills generic_laser_fence_bml) takes fe_obj_lazer2_2.bml in
    // the Episode 2 outdoor maps, the Seabed, the Tower and CCA, and
    // fe_obj_lazer2_4m.bml everywhere else, both with the generic fence texture
    // archive; MapObjectKomoVariant6Render_0065d9d0 draws its nodes with that
    // list while the fence is on.
    case 0x0096: {
      const ep2 = episode === 2 || area === 0x1c || area === 0x1d;
      return ep2
        ? spec('TObjLazerFenceExtra', 'fe_obj_lazer2_2.bml', [{ model: 0, textures: 'fe_obj_lazer2_2.xvm', show: 'off' }])
        : spec('TObjLazerFenceExtra', 'fe_obj_lazer2_4m.bml', [{ model: 0, textures: 'fe_obj_lazer2.xvm', show: 'off' }]);
    }
    // TOHealGeneral (the recovery ring): one model, loaded with LoadBML(.., 1,
    // ..) from fe_obj_kaifuku_moto_2.bml in the maps of the loader's first
    // branch and bm_fe_obj_kaifuku_moto.bml by default.
    case 0x0013:
      return episode === 2 || area === 0x1c || area === 0x1d
        ? spec('TOHealGeneral', 'fe_obj_kaifuku_moto_2.bml', [{ model: 0 }])
        : spec('TOHealGeneral', 'bm_fe_obj_kaifuku_moto.bml', [{ model: 0 }]);
    // TOKeyMachine01: ctor FUN_0062bf0c, loader FUN_0062c050.
    case 0x0101:
      return spec('TOKeyMachine01', 'bm_fs_obj_ki_doa_panel.bml', [{ model: 0, textures: 'fs_obj_ki_doa_panel_r.xvm' }]);
    // Ruins switches: 0x0142 ctor 0x0062a520 model 1 of
    // bm_fs_obj_o_doorswitch01.bml; 0x0143 loader FUN_0062ab64; 0x014D loader
    // FUN_0062a0a8 (texture lists: embedded, o_key_ancient01{b,g,p}).
    case 0x0142:
      return spec('TOKeyAncient02', 'bm_fs_obj_o_doorswitch01.bml', [{ model: 1 }]);
    case 0x0143:
      return spec('TOKeyAncient03', 'bm_fs_obj_o_doorpanel.bml', [{ model: 0, textures: 'fs_obj_o_doorpanelg.xvm' }]);
    case 0x014d:
      return spec('TOKeyAncient01', 'bm_fd_obj_n_switch.bml', [{ model: 0 }]);

    // ---- boxes ----
    // TObjContainerItem / TObjContainerEnemy: ctor FUN_0064deb4 (model 1 of
    // DAT_00a8f604); TObjContainerBase / TObjContainerAbeEnemy and the Episode
    // 4 TObjContainerJungEx: ctor FUN_0064ee44 (model 2 of DAT_00a8f5dc).
    // Collision sphere 0x009c77ac (radius 9, 6 up).
    case 0x0088:
    case 0x0091:
      return containerSpec(o.type === 0x0088 ? 'TObjContainerItem' : 'TObjContainerEnemy', area, false, ult);
    case 0x0092:
    case 0x0093:
      return containerSpec(o.type === 0x0092 ? 'TObjContainerBase' : 'TObjContainerAbeEnemy', area, true, ult);
    case 0x0203:
      if (area >= 0x24) return containerSpec('TObjContainerJungEx', area, true, ult);
      return spec('TObjContainerJungEx', 'bm_obj_hako01.bml', [{ model: 0, texlistOf: 0 }], { collision: CONTAINER_SPHERE });
    // TObjContainerJung: loader FUN_00652f18, bm_obj_hako01.bml model 0 with
    // texture list 0 (DAT_00a8f694).
    case 0x0200:
      return spec('TObjContainerJung', 'bm_obj_hako01.bml', [{ model: 0, texlistOf: 0 }], { collision: CONTAINER_SPHERE });
    // Ruins / VR boxes (loader FUN_00618668, DAT_00a8eb40): generic.
    case 0x0161:
    case 0x0162: {
      const name = o.type === 0x0161 ? 'TOContainerAncientItemCommon' : 'TOContainerAncientItemRare';
      if (area >= 0x13 && area <= 0x16) return spec(name, 'fe_obj_o_vs2container.bml', [{ model: 0 }], { collision: CONTAINER_SPHERE });
      if (area === 0x10 || area === 0x11 || area === 0x20 || area === 0x21) return spec(name, 'fe_obj_ex_box1.bml', [{ model: 0 }], { collision: CONTAINER_SPHERE });
      return spec(name, 'bm_o_container_ancient.bml', [{ model: 0 }], { collision: CONTAINER_SPHERE });
    }

    // ---- other common objects (generic: the constructor's model, its motion looping) ----
    case 0x000a:
      return spec('TOMineIcon01', 'bm_o_mine.bml', [{ model: 1 }]);
    case 0x000b:
      return spec('TOMineIcon02', 'bm_o_mine.bml', [{ model: 0 }]);
    case 0x000c:
      return spec('TOMineIcon03', 'bm_o_mine.bml', [{ model: 2 }]);
    case 0x000d:
      return spec('TOMineIcon04', 'bm_o_mine.bml', [{ model: 3 }]);
    case 0x0082: // TObjLazerFenceNorm, ctor uses models 0-3 of DAT_00a8f9b8 (fe_obj_lazer2_2.bml / fe_obj_lazer2.xvm)
      return spec('TObjLazerFenceNorm', 'fe_obj_lazer2_2.bml', [{ model: 1, textures: 'fe_obj_lazer2_2.xvm' }, { model: 0, textures: 'fe_obj_lazer2_2.xvm', motion: 0, drive: 'loop', speed: 1 }]);
    case 0x0083: // TObjLazerFence4: models 4-7
      return spec('TObjLazerFence4', 'fe_obj_lazer2_2.bml', [{ model: 5, textures: 'fe_obj_lazer2_2.xvm' }, { model: 4, textures: 'fe_obj_lazer2_2.xvm', motion: 2, drive: 'loop', speed: 1 }]);
    case 0x008e:
      return spec('TOBarrierEnergy01', 'bm_fs_obj_lazerguard.bml', [{ model: 0 }, { model: 1, motion: 0, drive: 'loop', speed: 1 }]);
    case 0x008f:
      return spec('TObjHashi', 'fe_obj_hashi.bml', [{ model: 0 }]);
    case 0x008b:
      return spec('TObjComputer', episode === 1 ? 'fe_obj_tanmatu02.bml' : 'fs_obj_tanmatu02.bml', [{ model: 0, textures: episode === 1 ? 'fe_obj_computer.xvm' : 'fs_obj_tanmatu02.xvm' }]);
    case 0x0089:
      return spec('TObjTank', 'fs_obj_tank.bml', [{ model: 0, textures: 'fs_obj_tank.xvm' }]);
    case 0x008d:
      return spec('TOCapsuleAncient01', 'bm_fe_obj_o_capsule01.bml', [{ model: 0 }]);
    case 0x00c4:
      return spec('TOSignCave01', 'bm_fs_obj_dokanban01.bml', [{ model: 0 }]);
    case 0x00c5:
      return spec('TOSignCave02', 'bm_fs_obj_dokanban02.bml', [{ model: 0 }]);
    case 0x00c6:
      return spec('TOSignCave03', 'bm_fs_obj_dokanban03.bml', [{ model: 0 }]);
    case 0x00d1:
    case 0x00d4:
      return spec('TORockCaveS', area === 4 ? 'bm_o_rock_cave02.bml' : 'bm_o_rock_cave01.bml', [{ model: 2 }]);
    case 0x00d2:
    case 0x00d5:
      return spec('TORockCaveM', area === 4 ? 'bm_o_rock_cave02.bml' : 'bm_o_rock_cave01.bml', [{ model: 1 }]);
    case 0x00d3:
      return spec('TORockCaveL01', 'bm_o_rock_cave01.bml', [{ model: 0 }]);
    case 0x00d7:
      return spec('TORockCaveSS02', 'bm_o_rock_cave02.bml', [{ model: 5 }]);
    case 0x00d8:
      return spec('TORockCaveSM02', 'bm_o_rock_cave02.bml', [{ model: 4 }]);
    case 0x00d9:
      return spec('TORockCaveSL02', 'bm_o_rock_cave02.bml', [{ model: 3 }]);
    case 0x00db:
      return spec('TORockCaveM03', 'bm_o_rock_cave03.bml', [{ model: 1 }]);
    case 0x00dc:
      return spec('TORockCaveL03', 'bm_o_rock_cave03.bml', [{ model: 0 }]);
    case 0x014e:
      return spec('TOFenceAncient01', 'bm_fd_obj_n_saku_4x2.bml', [{ model: 0 }]);
    case 0x014f:
      return spec('TOFenceAncient02', 'bm_fd_obj_n_saku_6x2.bml', [{ model: 0 }]);
    case 0x0150:
      return spec('TOFenceAncient03', 'bm_fd_obj_n_saku_4x4.bml', [{ model: 0 }]);
    case 0x0151:
      return spec('TOFenceAncient04', 'bm_fd_obj_n_saku_6x4.bml', [{ model: 0 }]);
    case 0x0152:
      // Box 0x009c7868 (sphere r10, 8 up, flags 0x38003): depth 0 of the type table
      // (collisionboxes.gen.ts), so the constructor itself sets it.
      return spec('TContainerAncient01', 'bm_obj_geenest.bml', [{ model: 0 }], { collision: generatedBox(0x009c7868) });
    case 0x0153:
      return spec('TOTrapAncient01', 'bm_o_trap_ancient01.bml', [{ model: 3 }]);
    // TOTrapAncient02 (0x0154, create 0x0063bfd4, ctor
    // InitializeDerolleEnemyBase_0063c638) and TOTrapAncient02R (0x0167,
    // create 0x0063b4e8, ctor 0x0063b5b4 on the same base): model 0 of
    // g_pTreeBMLData (0x00a8f1d0) and that entry's own texture list
    // (model array +0x42c, +8 / +0xc). The loader 0x0063c08c picks the archive
    // by map (switch table 0x00933ff4): VR Temple (0x13, 0x14)
    // bm_obj_ruins_pillar.bml; CCA, Jungle, Mountain, Seaside, Seabed and
    // the Episode 2 towers (0x17..0x1d, 0x22, 0x23) bm_obj_seabed_pillar.bml;
    // everywhere else (the Mines, the Ruins, the Spaceship)
    // bm_fs_obj_o_torabasami.bml. Box 0x009c684c: a sphere of radius 2, 8.5
    // up, flags 0x38003, set by InitializeDerolleEnemyBase_0063c638
    // (UpdateCollisionBoxPosition only rotates it by the yaw and adds the
    // entity origin; no pillar code writes its flags or position), so it is
    // on in every state. The state machine (rise, hold / technique, sink) and
    // the node lifts are render/traps.ts PillarTrap.
    case 0x0154:
    case 0x0167: {
      const name = o.type === 0x0154 ? 'TOTrapAncient02' : 'TOTrapAncient02R';
      const collision: ObjectCollision = { address: 0x009c684c, offset: [0, 8.5, 0], type: 0, halfX: 2, halfZ: 2, flags: 0x38003 };
      const bml =
        area === 0x13 || area === 0x14
          ? 'bm_obj_ruins_pillar.bml'
          : (area >= 0x17 && area <= 0x1d) || area === 0x22 || area === 0x23
            ? 'bm_obj_seabed_pillar.bml'
            : 'bm_fs_obj_o_torabasami.bml';
      return spec(name, bml, [{ model: 0, texlistOf: 0 }], { collision });
    }
    case 0x0155:
      return spec('TOMonumentAncient01', 'bm_fs_obj_o_sekihi01.bml', [{ model: 2 }]);
    case 0x0159:
      return spec('TOWreckAncient01', 'bm_o_wreck_ancient.bml', [{ model: 1 }]);
    case 0x015c:
      return spec('TOWreckAncient04', 'bm_o_wreck_ancient.bml', [{ model: 4 }]);
    case 0x015d:
      return spec('TOWreckAncient05', 'bm_o_wreck_ancient.bml', [{ model: 3 }]);
    case 0x015e:
      return spec('TOWreckAncient06', 'bm_o_wreck_ancient.bml', [{ model: 6 }]);
    case 0x015f:
      return spec('TOWreckAncient07', 'bm_o_wreck_ancient.bml', [{ model: 5 }]);
    case 0x0229:
      // Box 0x009c4a14 (sphere r3, 10 up, flags 0x30003), depth 0 of the type table.
      return spec('TOCapsuleLabo', 'bm_obj_labo_infocapsule.bml', [{ model: 0 }], { collision: generatedBox(0x009c4a14) });
    // TOTrapSeabed01 (the Seabed capture trap): CreateDerolleTrapEntity 0x0063ee10 /
    // InitializeDerolleTrapEntity 0x0063ec24 build it; LoadSeabedTuriganeBMLData 0x0063eeec
    // loads bm_obj_seabed_turigane.bml (exe string) and the texture archive, which the exe names
    // obj_seabed_turigane.gvm; the web's data archive is .xvm (ASSUMED the same archive under
    // the BB name). The draw rule (hidden / plain / cloak) and the reveal are render/traps.ts
    // CaptureTrap, driven by render/gamefield.ts.
    case 0x0228:
      // The spring is motion 0 (get_njm_chunk(bml, 0) in InitializeDerolleTrapEntity), driven by render/traps.ts CaptureTrap.
      return spec('TOTrapSeabed01', 'bm_obj_seabed_turigane.bml', [{ model: 0, textures: 'obj_seabed_turigane.xvm', motion: 0, drive: 'spring' }]);
    // Jungle rocks: TORockJungleS01 (0x0206, create 0x00635040, ctor
    // 0x006350b8), M01 (0x0207, 0x0063540c / 0x00635484) and L01 (0x0208,
    // 0x006358b8 / 0x00635930) take models 0, 2 and 4 of
    // bm_o_rock_jungle.bml (g_DerollePartBMLData_00a8f0b0; models 1 and 3
    // are the pieces a broken rock leaves, 0x00635260 / 0x00635664) with the
    // texture archive the loader LoadDerollePartBMLData_00635b6c picks by
    // map: o_rock_jungle_04 in the Mountain (0x1a), o_rock_jungle_05 at the
    // Seaside (0x1b), o_rock_jungle_123 elsewhere. Boxes: 0x009c63a0 (sphere,
    // radius 5), 0x009c63cc (12 x 8), 0x009c63f8 (20 x 10). Breaking them
    // is left out.
    case 0x0206:
    case 0x0207:
    case 0x0208: {
      const tex = area === 0x1a ? 'o_rock_jungle_04.xvm' : area === 0x1b ? 'o_rock_jungle_05.xvm' : 'o_rock_jungle_123.xvm';
      if (o.type === 0x0206) return spec('TORockJungleS01', 'bm_o_rock_jungle.bml', [{ model: 0, textures: tex }], { collision: { address: 0x009c63a0, offset: [0, 0, 0], type: 0, halfX: 5, halfZ: 5, flags: 0x10003 } });
      if (o.type === 0x0207) return spec('TORockJungleM01', 'bm_o_rock_jungle.bml', [{ model: 2, textures: tex }], { collision: BOX(0x009c63cc, 12, 8, 0) });
      return spec('TORockJungleL01', 'bm_o_rock_jungle.bml', [{ model: 4, textures: tex }], { collision: BOX(0x009c63f8, 20, 10, 0) });
    }
    case 0x0213:
      return spec('TOJungleDesign', 'bm_obj_jungle_tree.bml', [{ model: 0, texlistOf: 0 }]);
    case 0x0090: // TOKeyGenericSw: body of DAT_00a8ee48 (the lamp of DAT_00a8ee4c is not drawn here)
      return spec('TOKeyGenericSw', 'fs_obj_hanyousu_body1.bml', [{ model: 0 }]);
    case 0x00c3: // TOHangceilingCave01: ctor 0x00626dc8, model of DAT_00a8ed80 with its motion
      if (episode === 2 || area === 0x23) return spec('TOHangceilingCave01', 'bm_obj_ruins_turiten.bml', [{ model: 0, motion: 0, drive: 'loop', speed: 1 }]);
      return spec('TOHangceilingCave01', 'fe_obj_turiten_moto.bml', [{ model: 1, motion: 1, drive: 'loop', speed: 1 }]);
    case 0x010c:
      return spec('TOHangerMachine01', 'bm_fs_obj_hanger_moto.bml', [{ model: 0 }]);
    case 0x0156: // TOMonumentAncient02: one of the three monument archives (ctor 0x00631e38)
      return spec('TOMonumentAncient02', 'bm_fs_obj_o_monument02.bml', [{ model: 0 }]);
    case 0x0210: // TOTrapChainSawKey: ctor 0x0063d134 picks the model from the stack (not traced); the 2 m saw
      return spec('TOTrapChainSawKey', 'bm_obj_jungle_nokogiri.bml', [{ model: 0, motion: 0, drive: 'loop', speed: 1 }]);
    // Episode 4 scenery: the constructors read the model index from the
    // object's param4 (dword [EBX + 0x84]).
    case 0x0301:
      return spec('__WILDS_CRATER_CACTUS__', 'bm_obj_ep4_sabotena.bml', [{ model: clamp(p4(o), 0, 2) }]);
    case 0x0302:
      return spec('__WILDS_CRATER_BROWN_ROCK__', 'bm_obj_ep4_iwa_crater.bml', [{ model: clamp(p4(o), 0, 2) }]);
    case 0x0303:
      return spec('__WILDS_CRATER_BROWN_ROCK_DESTRUCTIBLE__', 'bm_obj_ep4_iwa_crater_brk.bml', [{ model: clamp(p4(o), 0, 1) }]);
    case 0x0386:
      return spec('__WILDS_CRATER_BLACK_ROCKS__', 'bm_obj_ep4_iwa_desert.bml', [{ model: clamp(p4(o), 0, 2) }]);
    case 0x038b:
      return spec('__FALLING_STALACTITE__', 'bm_obj_ep4_syounyuuseki.bml', [{ model: 3 }]);
    case 0x038f:
      return spec('__BEEHIVE__', 'bm_obj_ep4_bee_nest.bml', [{ model: clamp(p4(o), 0, 1), motion: clamp(p4(o), 0, 1), drive: 'loop', speed: 1 }]);
    case 0x038d:
      return spec('__DESERT_CRYSTALS_BOX__', 'bm_obj_ep4_crystal.bml', [{ model: 3 }]);
    case 0x0380:
      // Box 0x009c9f18 (sphere r14, flags 0x10003), depth 0 of the type table.
      return spec('__POISON_PLANT__', 'bm_obj_ep4_flower.bml', [{ model: 0, motion: 0, drive: 'loop', speed: 1 }], { collision: generatedBox(0x009c9f18) });
    default:
      return null;
  }
}

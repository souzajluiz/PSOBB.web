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

export interface ObjectModelContext {
  area: number;
  episode: number; // 1, 2, 3 (= Episode 4)
  ultimate?: boolean; // Ultimate Episode 1 online loads the *_a archives
}

// When a part is drawn.
export type PartShow = 'always' | 'locked' | 'unlocked' | 'on' | 'off';

export interface ObjectPartSpec {
  model: number; // model entry (BML position)
  show?: PartShow; // locked/unlocked: doors and boss warps; on/off: switches
  motion?: number; // motion entry, relative to the first motion
  drive?: 'loop' | 'door' | 'laser'; // loop: frame += speed; door: frame of the door state machine
  speed?: number; // frames per game tick (loop)
  texlistOf?: number; // draw with this model entry's embedded texture list
  textures?: string; // separate texture archive (.xvm) used as the texture list
  textureId?: number; // FUN_0081a588: every mesh uses this texture id
  tint?: [number, number, number]; // constant color (render flag 0x10 + FUN_0082d710), 0..1
}

// Object collision box (InitEnemyCollisionBoxes_007b9a88 entry, 0x2c bytes):
// type 1 = box of half extents (halfX, halfZ) in the object's frame
// (FUN_008443d8: x in +-unk1, z in +-radius, y +-50); type 0 = sphere.
export interface ObjectCollision {
  address: number;
  offset: [number, number, number];
  type: 0 | 1;
  halfX: number; // type 1: unk1 (+0x10); type 0: radius
  halfZ: number; // type 1: radius (+0x0c); type 0: radius
}

export interface ObjectModelSpec {
  name: string;
  bml: string;
  parts: ObjectPartSpec[];
  collision?: ObjectCollision;
  door?: boolean; // runs the door state machine (fieldobjects.ts)
}

const p4 = (o: ObjectSet) => Math.trunc(o.params[3]);
const p6 = (o: ObjectSet) => Math.trunc(o.params[5]);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(Math.trunc(v), lo), hi);

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
const BOX = (address: number, halfX: number, halfZ: number, y = 20, z = 0): ObjectCollision => ({ address, offset: [0, y, z], type: 1, halfX, halfZ });
const DOOR_BOX_20 = (address: number) => BOX(address, 20, 10);
const CONTAINER_SPHERE: ObjectCollision = { address: 0x009c77ac, offset: [0, 6, 0], type: 0, halfX: 9, halfZ: 9 };

const spec = (name: string, bml: string, parts: ObjectPartSpec[], extra: Partial<ObjectModelSpec> = {}): ObjectModelSpec => ({ name, bml, parts, ...extra });

// A door whose single model opens with motion 0 (Cave, Mine, Ruins, VR, Seabed,
// Lab, Episode 4): locked/unlocked texture lists as the loaders set them up.
function simpleDoor(name: string, bml: string, collision: ObjectCollision, lockedTex?: string, unlockedTex?: string): ObjectModelSpec {
  const base = { model: 0, motion: 0, drive: 'door' as const };
  const parts: ObjectPartSpec[] =
    lockedTex || unlockedTex
      ? [
          { ...base, show: 'locked', ...(lockedTex ? { textures: lockedTex } : {}) },
          { ...base, show: 'unlocked', ...(unlockedTex ? { textures: unlockedTex } : {}) },
        ]
      : [base];
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

export function objectModelFor(o: ObjectSet, ctx: ObjectModelContext): ObjectModelSpec | null {
  const { area, episode } = ctx;
  const ult = !!ctx.ultimate && episode === 1;
  const a = (name: string) => (ult ? name.replace(/\.bml$/, '_a.bml') : name);
  const ax = (name: string) => (ult ? name.replace(/\.xvm$/, '_a.xvm') : name);
  switch (o.type) {
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
    case 0x0019: {
      if (area >= 8 && area <= 10) {
        return spec('TObjWarpBoss', 'bm_obj_warpboss_ancient.bml', [
          { model: 0, texlistOf: 2 },
          { model: 2, texlistOf: 2, motion: 1, drive: 'loop', speed: 4, show: 'locked' },
          { model: 1, texlistOf: 2, motion: 0, drive: 'loop', speed: 4, show: 'unlocked' },
        ]);
      }
      if (episode === 2 || area === 0x1c || area === 0x1d) {
        return spec('TObjWarpBoss', 'bm_obj_warpboss_jungle.bml', [
          { model: 0, texlistOf: 0 },
          { model: 1, texlistOf: 0, motion: 0, drive: 'loop', speed: 4 },
        ]);
      }
      return spec('TObjWarpBoss', 'bm_obj_warpboss.bml', [
        { model: 0, texlistOf: 2 },
        { model: 2, texlistOf: 2, motion: 1, drive: 'loop', speed: 4, show: 'locked' },
        { model: 1, texlistOf: 2, motion: 0, drive: 'loop', speed: 4, show: 'unlocked' },
      ]);
    }
    // Pioneer 2 warps, bm_obj_city_common.bml + bm_obj_city_common.xvm (loader
    // FUN_00645b18, DAT_00a8f434 / DAT_00a8f430). Renders read the model array
    // (+0x42c, 0x10 per model, +8) and motion array (+0x430, 8 per motion, +4)
    // directly:
    //   0x0043 TObjCityMainWarp, render 0x0064abe0: model 12 (fd_obj_warp_big)
    //          and model 0 (de_obj_bigbeam) with motion 5, frame +0xc8;
    //   0x0044 TObjCityAreaWarp, render FUN_0064aeac: model 1 (de_obj_citybeam)
    //          with motion 6, frame +0xc8;
    //   0x0045 TObjCityMapWarp, render 0x0064b190: model 13 (fd_obj_warp_small)
    //          and model 3 (de_obj_smallbeam) with motion 7, frame +0x100.
    // Beam speed 1 frame per tick (fitted, the updates were not traced).
    case 0x0043:
      if (area !== 0 && area !== 0x2d) return null;
      return spec('TObjCityMainWarp', 'bm_obj_city_common.bml', [
        { model: 12, textures: 'bm_obj_city_common.xvm' },
        { model: 0, textures: 'bm_obj_city_common.xvm', motion: 5, drive: 'loop', speed: 1 },
      ]);
    case 0x0044:
      if (area !== 0 && area !== 0x2d) return null;
      return spec('TObjCityAreaWarp', 'bm_obj_city_common.bml', [{ model: 1, textures: 'bm_obj_city_common.xvm', motion: 6, drive: 'loop', speed: 1 }]);
    case 0x0045:
      if (area !== 0 && area !== 0x2d) return null;
      return spec('TObjCityMapWarp', 'bm_obj_city_common.bml', [
        { model: 13, textures: 'bm_obj_city_common.xvm' },
        { model: 3, textures: 'bm_obj_city_common.xvm', motion: 7, drive: 'loop', speed: 1 },
      ]);
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
    // TObjWarpJung: loader FUN_0066db88, bm_obj_warp_jung.bml: model 0 (base,
    // with the archive's texture list 0) and model 1 (beam) with motion 0.
    case 0x0201:
    case 0x020a:
      return spec(o.type === 0x0201 ? 'TObjWarpJung' : 'TObjWarpJungMain', 'bm_obj_warp_jung.bml', [
        { model: 0, texlistOf: 0 },
        { model: 1, texlistOf: 0, motion: 0, drive: 'loop', speed: 1 },
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
    case 0x01ab:
      return simpleDoor('TODoorFourLightRuins', 'bm_obj_door_ruins.bml', DOOR_BOX_20(0x009c5458), undefined, 'obj_door_ruins_green.xvm');
    case 0x01c0:
      return simpleDoor('TODoorFourLightSpace', 'bm_obj_door_space.bml', DOOR_BOX_20(0x009c5458), undefined, 'obj_door_space_green.xvm');
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
    case 0x0221:
      return simpleDoor('TODoorFourLightSeabed', 'bm_o_door_seabed01.bml', DOOR_BOX_20(0x009c551c), 'fs_obj_doorx4_atui.xvm', 'fs_obj_doorx4_atui_green.xvm');
    case 0x0222:
      return simpleDoor('TODoorFourLightSeabedU', 'bm_o_door_seabed01_u.bml', DOOR_BOX_20(0x009c551c), 'fs_obj_doorx4_u.xvm', 'fs_obj_doorx4_u_green.xvm');
    case 0x0056:
      return simpleDoor('TODoorLabo', 'bm_obj_door_labo.bml', DOOR_BOX_20(0x009c551c), 'obj_o_labodoor_l_red.xvm', 'obj_o_labodoor_l_grn.xvm');
    case 0x02bb:
      return simpleDoor('TODoorLaboNormal', 'bm_obj_labodoor_nrm.bml', DOOR_BOX_20(0x009c551c), 'o_labodoor_nrm_red.xvm', 'o_labodoor_nrm_green.xvm');
    // 0x0130 TODoorVoShip (Vol Opt's room, loader FUN_00622844) is left for
    // the boss pass: its two models do not parse as XJ or NJ chunk files yet.

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
      return spec('TContainerAncient01', 'bm_obj_geenest.bml', [{ model: 0 }]);
    case 0x0153:
      return spec('TOTrapAncient01', 'bm_o_trap_ancient01.bml', [{ model: 3 }]);
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
      return spec('TOCapsuleLabo', 'bm_obj_labo_infocapsule.bml', [{ model: 0 }]);
    case 0x0228:
      return spec('TOTrapSeabed01', 'bm_obj_seabed_turigane.bml', [{ model: 0, textures: 'obj_seabed_turigane.xvm' }]);
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
      return spec('__POISON_PLANT__', 'bm_obj_ep4_flower.bml', [{ model: 0, motion: 0, drive: 'loop', speed: 1 }]);
    default:
      return null;
  }
}

// Minimap: the map_*r.rel rooms (formats/minimap.ts), the radar / full map
// state (classic/minimap.ts), the Area Map window (classic/areamap.ts) and
// its wiring into the field menu and the status window (classic/fieldmenu.ts,
// classic/hud.ts).
// Run: node tests/minimap.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { minimapFileFor, modelTriangles, parseMinimapRel } from '../client/src/formats/minimap.ts';
import { collectFieldObjects, doorMapLocked, stepBeamMotion, stepBitDoor, stepKomo, type FieldDoor } from '../client/src/render/fieldobjects.ts';
import { objectModelFor } from '../client/src/formats/objectmodels.ts';
import type { PlacedEntity } from '../client/src/formats/setdata.ts';
import {
  cameraUp,
  clampPan,
  DEFAULT_HEIGHT,
  ICON_RANGE_SQ,
  MAX_HEIGHT,
  MAX_ICONS,
  MIN_HEIGHT,
  MINIMAP_RECT,
  MinimapFloors,
  minimapFovy,
  MinimapState,
  PLAYER_COLORS,
  ROOM_ALPHA_MAX,
  START_DELAY,
  unitsPerPixel,
  type MinimapRoomInput,
  doorIcon,
  enemyIconRule,
  komoVariant6Icon,
  falz3Icons,
  falz3TargetColor,
  F1_MINIMAP_COLOUR,
  form1Icons,
  fadeColor,
  FALZ3_DEFAULT_COLOR,
  teamColour,
  ICON_GREEN,
  ICON_RED,
  raderHideInside,
  raderIconColour,
  raderIconIcon,
  raderIconObject,
  BASE_ICON_HIDDEN_FLAGS,
  BOOMA_ICON_STATES,
  baseIconShown,
  boomaIconShown,
  boomaBrainIconShown,
  darkGunnerBrainIconShown,
  darkGunnerIconShown,
  BOOMA_BRAIN_TYPES,
  ENEMY_RADAR_SOURCE,
  radarSourceOf,
} from '../client/src/classic/minimap.ts';
import { AREA_MAP_MENU_ID, AREA_MAP_WINDOW, AreaMapWindow, type AreaMapEnv, type AreaMapInput } from '../client/src/classic/areamap.ts';
import { FieldMenu, validateMenuEntry, type FieldMenuEnv, type MenuRules } from '../client/src/classic/fieldmenu.ts';
import { StatusWindow, STATUS_HIDING_FLAGS } from '../client/src/classic/hud.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const near = (a: number, b: number, eps: number, what: string) => {
  if (!(Math.abs(a - b) <= eps)) {
    failures++;
    console.log(`FAIL ${what}: ${a} != ${b} (+-${eps})`);
  }
};

// --- formats/minimap.ts against the client's map_forest01r.rel ---
const SCENE = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'scene');
eq(minimapFileFor('map_forest01n.rel'), 'map_forest01r.rel', 'r.rel name of a map');
eq(minimapFileFor('map_aancient01_00n.rel'), 'map_aancient01_00r.rel', 'r.rel name of a layout map');
eq(minimapFileFor('map_forest01c.rel'), null, 'only n.rel names map');
let rooms: MinimapRoomInput[] = [];
const forest = join(SCENE, 'map_forest01r.rel');
if (existsSync(forest)) {
  const data = parseMinimapRel(new Uint8Array(readFileSync(forest)));
  eq(data.rooms.length, 17, 'Forest 1: 17 rooms');
  eq(data.textured, false, 'no texture list');
  const r0 = data.rooms[0];
  eq(r0.index, 2, 'first room: section 2');
  eq(r0.flags, 1, 'stored undiscovered');
  near(r0.position[0], -519.9, 0.1, 'room 0 x');
  near(r0.position[2], -560, 0.1, 'room 0 z');
  near(r0.radius, 92.576, 0.01, 'room 0 discovery radius');
  near(r0.radius, r0.model.radius, 1e-4, 'radius = mesh radius');
  eq(modelTriangles(r0.model).length, 0, 'room 0 has no strips');
  const tris = modelTriangles(data.rooms[1].model);
  eq(tris.length > 0 && tris.length % 9 === 0, true, 'room 1 triangles');
  eq([...tris].filter((_, i) => i % 3 === 1).every((y) => y === 0), true, 'flat plates (y = 0)');
  rooms = data.rooms;
} else {
  console.log(`skip: no ${forest}`);
}

// --- projection and viewport ---
near((minimapFovy() * 180) / Math.PI, 57.5, 0.05, 'fovy of angle 0x3555');
near(unitsPerPixel(DEFAULT_HEIGHT), 4.57, 0.01, 'units per pixel at 2000');
eq(MINIMAP_RECT[0], { x: 480, y: 64, w: 128, h: 128 }, 'radar rect (544, 128) 128x128');
eq(MINIMAP_RECT[1], { x: 32, y: 288, w: 448, h: 128 }, 'full map rect (256, 352) 448x128');
const up = cameraUp(0x8000);
near(up.x, 0, 1e-9, 'yaw 0x8000: up x');
near(up.z, -1, 1e-9, 'yaw 0x8000: north (-z) up');
near(cameraUp(0).z, 1, 1e-9, "yaw 0 (De Rol Le): +z up");

// --- pan clamp (Minimap_ClampPlayerPosition_008058b4) ---
const p = { x: 7000, z: -7000 };
clampPan(1, p);
eq(p, { x: 6000, z: -6000 }, 'Forest: +-6000');
const w = { x: -5000, z: 5000 };
clampPan(36, w);
eq(w, { x: -3000, z: 3000 }, 'Wilds: x -3000..9000, z -9000..3000');
const v = { x: 9999, z: 9999 };
clampPan(13, v);
eq(v, { x: 9999, z: 9999 }, 'Vol Opt: not clamped');

// --- state: delay, discovery, fade, persistence ---
const fake: MinimapRoomInput[] = rooms.length
  ? rooms
  : [{ index: 2, flags: 1, position: [-519.9, 0, -560], radius: 92.6, model: { center: [0.4, 0, -10] } }];
const floors = new MinimapFloors();
const st = new MinimapState();
st.enterFloor(1, 1, fake, floors);
eq(st.rooms.every((r) => r.flags & 1), true, 'first visit: all undiscovered');
const centre = { slot: 0, x: fake[0].position[0] + fake[0].model.center[0], z: fake[0].position[2] + fake[0].model.center[2], heading: 0x4000 };
for (let i = 0; i < START_DELAY - 1; i++) st.update(centre, [], 0);
eq(st.ready, false, 'waits 60 frames');
st.update(centre, [], 0);
eq(st.rooms[0].flags & 1, 1, 'no discovery during the wait');
st.update(centre, [{ slot: 2, x: 10, z: 20, heading: 0 }], 0);
eq(st.ready, true, 'running after 60 frames');
eq(st.rooms[0].flags & 1, 0, 'room under the player discovered');
eq(st.markers.map((m) => [m.slot, m.color, m.size]), [[0, PLAYER_COLORS[0], 22], [2, PLAYER_COLORS[2], 22]], 'markers: self then others, 22 units');
eq([st.radar.x, st.radar.z], [centre.x, centre.z], 'radar centred on the player');
eq(st.radar.y, DEFAULT_HEIGHT, 'radar height 2000');
eq(st.radar.yaw, 0x8000, 'radar north up');
for (let i = 0; i < 12; i++) st.fadeRooms();
near(st.rooms[0].alpha, ROOM_ALPHA_MAX, 1e-9, 'alpha capped at 0.8');
st.turning = true;
st.update(centre, [], 0x1000);
eq([st.radar.yaw, st.full.yaw, st.heading], [0x7000, 0x8000, 0xf000], 'turning radar: yaw 0x8000 - camera, compass -camera');
st.turning = false;
// TObjRaderCol: a held room is not discovered by walking, only revealed.
if (fake.length > 1) {
  const r1 = fake[1];
  st.holdRoom(r1.index);
  st.discover(r1.position[0] + r1.model.center[0], r1.position[2] + r1.model.center[2]);
  eq(st.rooms[1].flags & 1, 1, 'held room stays hidden');
  eq(st.revealRoom(r1.index), true, 'revealed by its TObjRaderCol');
  eq(st.rooms[1].flags & 1, 0, 'revealed room discovered');
}
// Leaving saves the flags; coming back restores them.
const discovered = st.rooms.filter((r) => !(r.flags & 1)).length;
st.enterFloor(2, 2, fake, floors);
eq(st.rooms.filter((r) => !(r.flags & 1)).length, 0, 'another floor starts undiscovered');
st.enterFloor(1, 1, fake, floors);
eq(st.rooms.filter((r) => !(r.flags & 1)).length, discovered, 'floor 1 keeps its discovered rooms');
// Saved flags are keyed by floor and minimap file; another layout (another
// room count) on the same floor starts over.
if (fake.length > 1) {
  st.enterFloor(1, 1, fake.slice(1), floors);
  eq(st.rooms.every((r) => r.flags & 1), true, 'room count mismatch: saved flags dropped');
  st.enterFloor(3, 1, fake, floors, '3:map_a.rel');
  st.discover(centre.x, centre.z);
  st.enterFloor(3, 1, fake, floors, '3:map_b.rel');
  eq(st.rooms.every((r) => r.flags & 1), true, 'another file on the floor: own flags');
}
eq(st.rooms.every((r) => r.alpha === 0), true, 'alpha restarts');

// --- icons ---
const ic = new MinimapState();
ic.enterFloor(1, 1, fake, floors);
eq(ic.addIcon({ x: 299, z: 0, color: 0, shape: 1, scale: 1, heading: 0 }), true, 'icon within 300');
eq(ic.addIcon({ x: Math.sqrt(ICON_RANGE_SQ) + 1, z: 0, color: 0, shape: 1, scale: 1, heading: 0 }), false, 'icon beyond 300 dropped');
eq(ic.addIcon({ x: 1000, z: 0, color: 0, shape: 1, scale: 1, heading: 0 }, true), true, 'forced icon kept');
for (let i = 0; i < 200; i++) ic.addIcon({ x: 0, z: 0, color: 0, shape: 1, scale: 1, heading: 0 });
eq(ic.takeIcons().length, MAX_ICONS, 'at most 128 icons a frame');
eq(ic.icons.length, 0, 'icons cleared once drawn');

// --- zoom / pan (MinimapZoomIn_00802b44, MinimapZoomOutZ_00802b78, MinimapMoveY_00802bac) ---
const z = new MinimapState();
z.enterFloor(1, 1, fake, floors);
z.pan(10, 10);
eq([z.full.x, z.full.z], [0, 0], 'no pan on the radar');
z.type = 1;
z.pan(10, -20);
eq([z.full.x, z.full.z], [-10, 20], 'x -= dx, z -= dz');
z.moveHeight(-5000);
eq(z.full.y, MIN_HEIGHT, 'height floor 1200');
z.moveHeight(5000);
eq(z.full.y, MAX_HEIGHT, 'height ceiling 3500');

// --- the Area Map window ---
const input: AreaMapInput = { up: false, down: false, left: false, right: false, zoomIn: false, zoomOut: false, mouse: null };
let flags = 0;
const mm = new MinimapState();
mm.enterFloor(1, 1, fake, floors);
for (let i = 0; i <= START_DELAY; i++) mm.update({ slot: 0, x: 100, z: 200, heading: 0 }, [], 0);
const env: AreaMapEnv = {
  minimap: () => mm,
  input: () => input,
  setHudFlag: (bit, on) => (flags = on ? flags | bit : flags & ~bit),
  title: () => 'Forest 1',
  text: () => '',
};
const sounds: number[] = [];
const win = new AreaMapWindow(env, 1, (id) => sounds.push(id));
eq(sounds, [0x572], 'opens with SE 0x572');
win.tick();
eq(win.active, false, 'not active while opening');
for (let i = 0; i < 4; i++) win.tick();
eq(win.active, true, 'active once open');
eq(mm.type, 1, 'full map');
eq([mm.full.x, mm.full.z], [100, 200], 'centred on the player');
eq(flags & 1, 1, 'HUD flag bit 1 set');
input.up = true;
win.tick();
eq(mm.full.z, 194, 'Up: z speed +6, z -= 6');
input.up = false;
win.tick();
near(mm.full.z, 194 - 4.8, 1e-9, 'speed decays by 0.8');
input.zoomIn = true;
const y0 = mm.full.y;
win.tick();
near(mm.full.y, y0 - 6, 1e-9, 'Shift: height -6 (zoom in)');
input.zoomIn = false;
// Drag: grab inside the window, the pan follows 3 units per pixel.
const sx = mm.full.x;
const sz = mm.full.z;
input.mouse = { down: true, x: AREA_MAP_WINDOW.x + 100, y: AREA_MAP_WINDOW.y + 50 };
win.tick();
input.mouse = { down: true, x: AREA_MAP_WINDOW.x + 110, y: AREA_MAP_WINDOW.y + 45 };
win.tick();
eq([mm.full.x, mm.full.z], [sx - 30, sz + 15], 'drag: pan = grab - 3 * move');
input.mouse = { down: false, x: 0, y: 0 };
win.tick();
eq(win.key({ key: 'ArrowLeft' } as KeyboardEvent), true, 'arrows belong to the map');
eq(win.key({ key: 'Backspace' } as KeyboardEvent), false, 'Backspace closes');
win.anim.close();
win.tick();
eq([win.active, mm.type, flags & 1], [false, 0, 0], 'closing: radar again, HUD flag cleared');

// --- status window closes on HUD flag bit 1 (0x0071a838) ---
const status = new StatusWindow();
const values = { name: 'A', slot: 0, level: 1, hp: 10, maxHp: 10, tp: 0, maxTp: 0, pb: 0, dead: false };
for (let i = 0; i < 10; i++) status.tick(values);
eq(status.anim.isOpen, true, 'status window open');
status.hudFlags = 1;
for (let i = 0; i < 10; i++) status.tick(values);
eq(status.anim.visible, false, 'closed while the full map is up');
eq(STATUS_HIDING_FLAGS, 0x11, 'bits 1 and 0x10');
status.hudFlags = 0;
for (let i = 0; i < 10; i++) status.tick(values);
eq(status.anim.isOpen, true, 'reopens afterwards');

// --- menu wiring (ValidateMenuItemCondition_00732620, handle_player_menu_select) ---
const rules = (safe: boolean): MenuRules => ({ lobby: false, safe, online: true, questStarted: false, inTeam: false });
eq(validateMenuEntry(AREA_MAP_MENU_ID, rules(true)), { id: 0xd, enabled: false }, 'Area Map off on a safe map');
eq(validateMenuEntry(AREA_MAP_MENU_ID, rules(false)), { id: 0xc, enabled: true }, 'Area Map in the field');
const menuEnv = {
  text: () => '',
  rules: () => rules(false),
  android: () => false,
  itemPack: {},
  equip: {},
  tech: {},
  mag: {},
  areaMap: env,
  options: { text: () => '', flags: () => null, setFlags: () => {}, send: () => {}, padConnected: () => false },
} as unknown as FieldMenuEnv;
const fm = new FieldMenu(menuEnv);
const press = (key: string) => fm.key({ key } as KeyboardEvent);
fm.toggle();
// the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
fm.tick(); fm.tick();
press('Enter'); // Item Pack
for (let i = 0; i < 4; i++) press('ArrowDown'); // Equip, Items, MAG, Trade, Area Map
press('Enter');
eq(fm.areaMap !== null, true, 'Item Pack > Area Map opens the window');
for (let i = 0; i < 6; i++) fm.tick();
eq([fm.areaMap?.active, mm.type, flags & 1], [true, 1, 1], 'the menu runs it to the full map');
press('Backspace');
for (let i = 0; i < 10; i++) fm.tick();
eq([fm.areaMap, mm.type, flags & 1, fm.isOpen], [null, 0, 0, true], 'Backspace: back to the menu, radar again');
// A floor change destroys the window: the full map must not come back.
press('Enter');
for (let i = 0; i < 6; i++) fm.tick();
eq([fm.areaMap?.active, flags & 1], [true, 1], 'Area Map open again');
fm.closeAreaMap();
for (let i = 0; i < 6; i++) fm.tick();
eq([fm.areaMap, mm.type, flags & 1], [null, 0, 0], 'closeAreaMap: gone, radar, flag cleared');
const gone = new AreaMapWindow(env, 3);
gone.dispose();
gone.tick();
eq([gone.active, flags & 1], [false, 0], 'a disposed window never starts the full map');

// --- a bad file: rooms pointer null with a room count ---
const bad = new Uint8Array(0x40);
const bdv = new DataView(bad.buffer);
bdv.setUint32(0, 0, true); // rooms = null
bdv.setUint32(8, 3, true); // count = 3
bdv.setUint32(bad.length - 0x10, 0, true); // root = 0
let threw = false;
try {
  parseMinimapRel(bad);
} catch {
  threw = true;
}
eq(threw, true, 'null rooms pointer with rooms: rejected');

// --- object icons: TObjRaderIcon (0x27), TObjDoor icons, TObjRaderHideCol (0x1f) ---
const pos = { x: 10, y: 0, z: -20 };
const allOn = () => true;
const someOff = (f: number) => f !== 0x42;
// Params as the object sees them: [param1 scale, p2, p3, param4 mode, param5 (count << 16 | base), param6 colour].
const sw = raderIconObject([2.5, 0, 0, 0, (2 << 16) | 0x41, 0], pos, 0x4000);
eq(sw.mode, 0, 'TObjRaderIcon: param4 0 is the switch mode');
eq([sw.count, sw.base], [2, 0x41], 'TObjRaderIcon: switch count and first flag from param5');
eq(sw.scale, 2.5, 'TObjRaderIcon: scale is param1');
eq(sw.heading, 0x4000, 'TObjRaderIcon: heading is the yrot');
eq(raderIconColour(sw, allOn), ICON_GREEN, 'TObjRaderIcon: green while its switches are set');
eq(raderIconColour(sw, someOff), ICON_RED, 'TObjRaderIcon: red while one of its switches is not set');
const noSw = raderIconObject([1, 0, 0, 0, 0, 0], pos, 0);
eq(raderIconColour(noSw, () => false), ICON_GREEN, 'TObjRaderIcon: no switch range is green');
const big = raderIconObject([1, 0, 0, 0, (20 << 16) | 0xf0, 0], pos, 0);
eq([big.count, big.base], [12, 0xf0], 'TObjRaderIcon: count clamps to 12, base to 0xff - count');
const col = raderIconObject([1, 0, 0, 3, 0, 0xffff00ff], pos, 0);
eq([col.mode, raderIconColour(col, someOff)], [1, 0xffff00ff], 'TObjRaderIcon: a positive param4 is mode 1, its colour is param6');
eq(raderIconObject([-4, 0, 0, 0, 0, 0], pos, 0).scale, 0, 'TObjRaderIcon: a scale at or below 0 is 0.0');
const rIcon = raderIconIcon(sw, allOn);
eq([rIcon.shape, rIcon.scale, rIcon.x, rIcon.z, rIcon.color], [0, 2.5, 10, -20, ICON_GREEN], 'TObjRaderIcon: a shape 0 icon at its position');
eq(doorIcon(1, 2, 0x100, true).color, ICON_RED, 'TObjDoor: red while locked');
eq(doorIcon(1, 2, 0x100, false).color, ICON_GREEN, 'TObjDoor: green once unlocked');
eq([doorIcon(1, 2, 0x100, true).shape, doorIcon(1, 2, 0x100, true).scale, doorIcon(1, 2, 0x100, true).heading], [0, 1, 0x100], 'TObjDoor: shape 0, scale 1, the door heading');
const hide = { x: 0, y: 0, z: 0, radius: 10, inside: false };
eq(raderHideInside(hide, { x: 6, y: 0, z: 7 }), true, 'TObjRaderHideCol: squared distance 85 is inside radius 10');
eq(raderHideInside(hide, { x: 8, y: 0, z: 7 }), false, 'TObjRaderHideCol: squared distance 113 is outside');
eq(raderHideInside(hide, { x: 6, y: 0, z: 6 }), true, 'TObjRaderHideCol: squared distance 72 is inside');
eq(raderHideInside(hide, { x: 10, y: 0, z: 0 }), false, 'TObjRaderHideCol: exactly the radius is outside (d^2 < r^2)');
eq(raderHideInside(hide, { x: 0, y: 9, z: 0 }), true, 'TObjRaderHideCol: the distance is 3D (height counts)');
eq(raderHideInside(hide, { x: 0, y: 9, z: 5 }), false, 'TObjRaderHideCol: height and XZ together outside');

// --- battle team colours (MinimapCheckBattleOrSpawnItem_00803180; dump lines 817265-817415) ---
eq([teamColour(1), teamColour(2), teamColour(0), teamColour(3)], [0xffff0000, 0xff00ff00, 0xffffff00, 0xffffff00], 'battle: team 1 red, team 2 green, others yellow');
{
  const m = new MinimapState();
  m.enterFloor(0, 0, [], new MinimapFloors());
  m.delay = 0;
  const me = { slot: 0, x: 5, z: 5, heading: 0 };
  const mate = { slot: 1, x: 6, z: 6, heading: 0, team: 1 };
  const foe = { slot: 2, x: 7, z: 7, heading: 0, team: 2 };
  m.update(me, [mate, foe], 0x8000, null);
  eq(m.markers.map((x) => [x.slot, x.color]), [[0, PLAYER_COLORS[0]], [1, PLAYER_COLORS[1]], [2, PLAYER_COLORS[2]]], 'battle off: the slot colours, every player drawn');
  m.update(me, [mate, foe], 0x8000, 1);
  eq(m.markers.map((x) => [x.slot, x.color]), [[0, 0xffff0000], [1, 0xffff0000]], 'battle team 1: the self and the teammate red, the other team hidden');
  m.update(me, [mate, foe], 0x8000, 0);
  eq(m.markers.map((x) => x.slot), [0], 'battle team 0: no other marker is drawn');
  m.update(me, [mate, foe], 0x8000, 2);
  eq(m.markers.map((x) => [x.slot, x.color]), [[0, 0xff00ff00], [2, 0xff00ff00]], 'battle team 2: green for the same team only');
}
// --- enemy icon rules: the Olga Flow phase 1 is forced at 5.0 (icon3 flag 1), the rest are plain ---
eq(enemyIconRule('OLGA_FLOW_1'), { scale: 5, color: 0xffffa24c, forced: true }, 'boss icon: Olga Flow phase 1 is forced at scale 5.0');
eq(enemyIconRule('HILDEBLUE'), { scale: 1, color: 0xffffa24c, forced: false }, 'enemy icon: the plain icon, range checked');
eq(enemyIconRule('OLGA_FLOW_2'), { scale: 4, color: 0xffffa24c, forced: true }, 'boss icon: Olga Flow phase 2 is forced at scale 4.0 (unknown_olga_related)');
eq(enemyIconRule('DE_ROL_LE'), { scale: 2, color: 0xffffa24c, forced: true }, 'boss icon: De Rol Le is forced at scale 2.0 (UpdateDerolle)');
eq(enemyIconRule('GAL_GRYPHON'), { scale: 2, color: 0xffffa24c, forced: true }, 'boss icon: Gal Gryphon is forced at scale 2.0 (update_gal_gryphon)');
eq(enemyIconRule('SINOW_BERILL'), { scale: 2, color: 0xffffa24c, forced: true }, 'enemy icon: Sinow Berill is forced at scale 2.0 (UpdateSinowberillEntity_004addc0)');
eq(enemyIconRule('SINOW_GOLD'), { scale: 1, color: 0xffffa24c, forced: false }, 'enemy icon: Sinow Gold keeps the plain icon');
eq(enemyIconRule('DRAGON'), { scale: 2, color: 0xffffa24c, forced: true }, 'boss icon: the Dragon is forced at scale 2.0 (OlgaUpdateMainLoop_00423b7c, dump 165532)');
eq(enemyIconRule('DE_ROL_LE_BODY'), { scale: 1.2, color: 0xffffa24c, forced: true }, 'boss icon: a De Rol Le shell segment is forced at scale 1.2 (exe 0x00435294 = handle_derolle_shell_behavior, dump 176968)');
eq(enemyIconRule('DE_ROL_LE_MINE'), { scale: 1, color: 0xffffa24c, forced: false }, 'enemy icon: a De Rol Le mine keeps the plain icon (no forced icon traced for it)');
{
  const m = new MinimapState();
  m.enterFloor(0, 0, [], new MinimapFloors());
  m.delay = 0;
  m.update({ slot: 0, x: 0, z: 0, heading: 0 }, [], 0x8000, null);
  const far = { x: 1000, z: 0, color: 0xffffa24c, shape: 1 as const, scale: 5, heading: 0 };
  eq(m.addIcon(far, false), false, 'icon: a plain icon beyond the radar range is not added');
  eq(m.addIcon(far, true), true, 'icon: a forced icon beyond the radar range is added');
}
// --- Komo variant 6 icons (MapObjectKomoVariant6Update_0065d89c, Episode 2) ---
const komoA = komoVariant6Icon(3, 0, 0x4000, { x: 1, z: 2 });
eq([komoA.shape, komoA.color, komoA.scale, komoA.heading], [3, 0xffff0000, 1, 0x4000], 'Komo variant 6: shape 3, red while active, odd value is scale 1, heading yrot');
eq(komoVariant6Icon(-3, 1, 0, { x: 0, z: 0 }).scale, -1, 'Komo variant 6: a negative odd value is scale -1');
eq(komoVariant6Icon(4, 1, 0, { x: 0, z: 0 }).scale, 0, 'Komo variant 6: an even value is scale 0');
eq(komoVariant6Icon(0, 1, 0, { x: 0, z: 0 }).color, ICON_GREEN, 'Komo variant 6: green at state 1 (idle)');

// --- Dark Falz form 3 body (dark_falz_form3_minimap_icons, dump 198990) ---
eq(FALZ3_DEFAULT_COLOR, 0xffffa24c, 'Dark Falz form 3: the body starts at 0xffffa24c (ctor, dump 200031)');
eq(falz3TargetColor(-1), 0xffffa24c, 'Dark Falz form 3: nobody held fades toward the default colour');
eq(falz3TargetColor(1), 0xff00ff00, 'Dark Falz form 3: slot 1 fades toward the table colour (green)');
eq(falz3TargetColor(4), null, 'Dark Falz form 3: a slot above 3 draws nothing (dump 199013)');
eq(fadeColor(0xffffa24c, 0xffff0000), 0xffff923c, 'fade: blue (76) steps down to 60, green (162) to 146, red at its target stays');
eq(fadeColor(0xffffa24c, 0xff00ff00), 0xffefb23c, 'fade: red (255) steps down to 239, green (162) up to 178, blue down to 60');
eq(fadeColor(0xff000005, 0xff000000), 0xff000000, 'fade: a channel stops at its target');
eq(fadeColor(0xffffffff, 0xffff0000), 0xffffefef, 'fade: green and blue (255) step down to 239, red at its target stays');
{
  const body = falz3Icons({ x: 10, z: 20 }, 0xffffa24c, -1, null);
  eq(body.length, 1, 'Dark Falz form 3: nobody held draws only the body');
  eq([body[0].shape, body[0].scale, body[0].color, body[0].x, body[0].z], [1, 5, 0xffffa24c, 10, 20], 'Dark Falz form 3: the body is shape 1 at 5.0 in the current colour');
  eq(falz3Icons({ x: 0, z: 0 }, 0xffffa24c, -1, null, true)[0].color, 0xffffffff, 'Dark Falz form 3: white while the scale is 0 with flag 4');
  eq(falz3Icons({ x: 0, z: 0 }, 0xffffa24c, 4, null).length, 0, 'Dark Falz form 3: a slot above 3 draws nothing');
  const near = falz3Icons({ x: 0, z: 0 }, 0xff0000ff, 2, { x: 60, z: 0 });
  eq(near.length, 1 + 2, 'Dark Falz form 3: a prisoner 60 away gets 2 trail icons (round(60 / 25))');
  eq([near[1].x, near[1].z, near[1].scale, near[1].color], [25, 0, 2.5, 0xffffff00], 'Dark Falz form 3: the trail is 2.5 in the prisoner colour, 25 along toward the prisoner');
  const far = falz3Icons({ x: 0, z: 0 }, 0xffffa24c, 0, { x: 0, z: 1000 });
  eq(far.length, 1 + 14, 'Dark Falz form 3: the trail stops at 14 icons (360 / 25)');
  eq(falz3Icons({ x: 0, z: 0 }, 0xffffa24c, 0, { x: 5, z: 0 }).length, 1, 'Dark Falz form 3: a prisoner within 25 draws no trail');
}
// --- Dark Falz form 1 (UpdateVoloptForm7Behavior, dump 195879; the update 0x00454838) ---
{
  const body = { x: 100, z: 200 };
  const heads = [[1, 25, 2], [3, 25, 4], [5, 25, 6]] as const;
  const yaw0 = form1Icons(body, heads, 0, 1);
  eq(yaw0.length, 4 + 4 + 4 + 3, 'Dark Falz form 1: body, three heads, then 4 + 4 + 3 ring icons (11)');
  eq(yaw0.every((ic) => ic.color === F1_MINIMAP_COLOUR && ic.scale === 5 && ic.shape === 1), true, 'Dark Falz form 1: every icon is 5.0 in 0xffffa24c, shape 1');
  eq([yaw0[0].x, yaw0[0].z], [100, 200], 'Dark Falz form 1: the first icon is the body');
  eq([yaw0[1].x, yaw0[1].z, yaw0[2].x, yaw0[2].z, yaw0[3].x, yaw0[3].z], [1, 2, 3, 4, 5, 6], 'Dark Falz form 1: the three heads are the given points, in order');
  // Yaw 0: the ring at 38 is the four cardinal points, at 76 and 114 likewise.
  const ring = yaw0.slice(4);
  const at = (x: number, z: number) => ring.some((ic) => Math.abs(ic.x - x) < 1e-6 && Math.abs(ic.z - z) < 1e-6);
  eq(at(100 - 38, 200) && at(100, 200 + 38) && at(100 + 38, 200) && at(100, 200 - 38), true, 'Dark Falz form 1: the ring at radius 38 sits on the four cardinal points at yaw 0');
  eq(at(100 - 76, 200) && at(100 + 76, 200) && at(100, 200 - 76), true, 'Dark Falz form 1: the ring steps to radius 76 (ROUND(37.5 + 38))');
  eq(at(100 - 114, 200) && at(100, 200 + 114) && at(100 + 114, 200) && !at(100, 200 - 114), true, 'Dark Falz form 1: the last ring is radius 114 (ROUND(37.5 + 76)) with three icons (no fourth, dump iVar6 < 2)');
  eq(ring.length, 11, 'Dark Falz form 1: the ring holds 11 icons');
  // Yaw 0x4000 (a quarter turn): the ring's points rotate with the body.
  const q = form1Icons(body, heads, 1, 0);
  eq(Math.abs(q[4].x - 100) < 1e-6 && Math.abs(q[4].z - 238) < 1e-6, true, 'Dark Falz form 1: a quarter turn (0x4000) puts the first ring icon at (body.x, body.z + 38)');
}
// Dark Falz form 3: white and the trail's frame flag (the frame counter +0x3c8).
{
  eq(falz3Icons({ x: 0, z: 0 }, 0xffffa24c, -1, null, false, false).length, 1, 'Dark Falz form 3: the trail is off on a frame with bit 0 set');
  eq(falz3Icons({ x: 0, z: 0 }, 0xffffa24c, 0, { x: 60, z: 0 }, true, false)[0].color, 0xffffffff, 'Dark Falz form 3: white with the trail off on the same frame');
}
// Komo variant 6 state (MapObjectKomoVariant6Update_0065d89c, dump 524037): the icon takes the
// state the frame starts with; the handler moves the state after it (1 when the flag is set, 0 when not).
{
  const k = { index: 1, x: 0, y: 0, z: 0, yaw: 0, flag: 5, value: 3, state: 0 as 0 | 1, shown: 0 as 0 | 1 };
  eq(stepKomo(k, false), 0, 'Komo: the first frame draws state 0 (red) with the switch off');
  eq(k.state, 0, 'Komo: the switch off keeps state 0');
  eq(stepKomo(k, true), 0, 'Komo: the frame the switch comes on still draws red');
  eq(k.state, 1, 'Komo: StateActive moves to 1 once the flag is set');
  eq(stepKomo(k, true), 1, 'Komo: the next frame draws state 1 (green)');
  eq(stepKomo(k, false), 1, 'Komo: a frame with the flag off still draws green');
  eq(k.state, 0, 'Komo: StateIdle moves back to 0 when the flag is not set');
  eq(komoVariant6Icon(k.value, k.shown, 0, k).color, ICON_GREEN, 'Komo: the last frame drew state 1, so its icon is green');
}
// Beam-family doors (0x0202 TObjDoorJung, 0x0204 beam): bit 0 of +0xd0 is the unlock and the
// minimap colour (lock slots 0x00657b20 / 0x00658410, update 0x00657718 / 0x00657e00).
{
  const door = (type: number, p4: number, p5: number, x = 0, z = 0): FieldDoor => {
    const placed = {
      entity: { kind: 'object', index: 7, type, floor: 0, section: 0, position: [x, 0, z], rotation: [0, 0, 0], group: 0, unknownA3: 0, params: [0, 0, 0, p4, p5, 0] },
      name: 'x',
      category: 'object',
      world: [x, 0, z],
      yaw: 0,
      sectionFound: true,
    } as unknown as PlacedEntity;
    const found = collectFieldObjects([placed], { episode: 0, floor: 0, area: 0x17 }).doors;
    return found[0]!;
  };
  // 0x0202: the flags p4 .. p4 + n - 1 (n = clamp(param5, 0..4)); bit 0 follows them every frame.
  const a = door(0x0202, 3, 2);
  eq(a.bitRule, 'switches', 'beam-family: 0x0202 uses the switch rule');
  eq(a.flags, [3, 4], 'beam-family: 0x0202 waits for flags p4 and p4 + 1 (param5 = 2)');
  eq(doorMapLocked(a), true, 'beam-family: 0x0202 is red at bit 0 clear');
  stepBitDoor(a, (f) => f === 3, []);
  eq(a.bit0, false, 'beam-family: 0x0202 bit 0 stays clear with one of two flags');
  stepBitDoor(a, (f) => f === 3 || f === 4, []);
  eq([a.bit0, doorMapLocked(a)], [true, false], 'beam-family: 0x0202 bit 0 set once both flags are on, green');
  stepBitDoor(a, (f) => f === 3, []);
  eq(a.bit0, false, 'beam-family: 0x0202 bit 0 follows the flags back down (the lock slot clears it)');
  const none = door(0x0202, 3, 0);
  stepBitDoor(none, () => false, []);
  eq(none.bit0, true, 'beam-family: 0x0202 with param5 0 has no flags, so bit 0 is set');
  // 0x0204: flags 0x46..0x48 and a player within 50 (XZ, squared 2500) of the door; then latched.
  const beam = door(0x0204, 0, 0, 100, 100);
  const all = (f: number) => f >= 0x46 && f <= 0x48;
  stepBitDoor(beam, all, [{ x: 100 + 60, y: 0, z: 100 }]);
  eq(beam.bit0, false, 'beam: 60 units away does not open the beam door');
  stepBitDoor(beam, (f) => f !== 0x48, [{ x: 100 + 10, y: 0, z: 100 }]);
  eq(beam.bit0, false, 'beam: two of the three flags do not open it');
  stepBitDoor(beam, all, [{ x: 100 + 10, y: 900, z: 100 }]);
  eq(beam.bit0, true, 'beam: the three flags and a player 10 units away in XZ (height ignored) open it');
  stepBitDoor(beam, () => false, []);
  eq([beam.bit0, doorMapLocked(beam)], [true, false], 'beam: once open, bit 0 is latched (the lock slot returns early)');
  // 0x658410: SFX 0x4df when the flag count changes to above 0; at 3 with a player near, the unlock event once.
  const lock = door(0x0204, 0, 0, 100, 100);
  const flagsOn = (n: number) => (f: number) => f >= 0x46 && f < 0x46 + n;
  eq(stepBitDoor(lock, flagsOn(1), []).se, [0x4df], 'beam lock: one flag on plays SFX 0x4df');
  eq(stepBitDoor(lock, flagsOn(1), []).se, [], 'beam lock: the count is unchanged, no SFX');
  eq(stepBitDoor(lock, flagsOn(2), []).se, [0x4df], 'beam lock: the count going to 2 plays SFX again');
  const far = stepBitDoor(lock, flagsOn(3), [{ x: 100 + 60, y: 0, z: 100 }]);
  eq([far.unlocked, lock.bit0], [false, false], 'beam lock: three flags with the player out of range do not unlock');
  const near = stepBitDoor(lock, flagsOn(3), [{ x: 100, y: 0, z: 100 + 49 }]);
  eq([near.unlocked, lock.bit0], [true, true], 'beam lock: three flags and a player 49 away unlock once (the event runs)');
  eq(stepBitDoor(lock, flagsOn(3), []).unlocked, false, 'beam lock: the latched door raises no second event');
  // 0x657e00 motion, one call per tick while bit 0 is set: +1.0 a tick, the last 70 frames passable,
  // SFX 0x4dc each tick, a pair of 0x229 every 30 counted ticks, held at the last frame.
  const mv = door(0x0204, 0, 0, 0, 0);
  mv.bit0 = true;
  const frames = 200; // last = 199, the window (129, 199)
  let bursts = 0;
  let sfx = 0;
  for (let i = 0; i < 29; i++) {
    const r = stepBeamMotion(mv, frames);
    if (r.burst) bursts++;
    if (r.se) sfx++;
  }
  eq([mv.beamFrame, mv.beamTicks, bursts, sfx, mv.passable], [29, 29, 0, 29, false], 'beam motion: 29 ticks advance the frame, count and SFX; no burst yet');
  eq(stepBeamMotion(mv, frames).burst, true, 'beam motion: the 30th counted tick makes the first particle pair');
  while (mv.beamFrame < 129) stepBeamMotion(mv, frames);
  eq([mv.beamFrame, mv.passable], [129, false], 'beam motion: not passable before the last 70 frames');
  const inWin = stepBeamMotion(mv, frames);
  eq([mv.passable, inWin.se, inWin.burst, mv.beamTicks], [true, true, false, 129], 'beam motion: inside the window the door is passable, the SFX goes on, the count stops');
  while (mv.beamFrame < 199) stepBeamMotion(mv, frames);
  const end = stepBeamMotion(mv, frames);
  eq([mv.beamFrame, end.se, end.burst], [199, false, false], 'beam motion: past the last frame the frame is held at 199 and the motion SFX stops');
  // 0x615a2c / ctor: the capsule (0x0103) is not a door: no lock, no icon, a box of table 0x009c4a5c.
  const capsule = objectModelFor({ kind: 'object', index: 3, type: 0x0103, floor: 0, section: 0, position: [0, 0, 0], rotation: [0, 0, 0], group: 0, unknownA3: 0, params: [0, 0, 0, 0, 0, 0] } as never, { area: 0x06, episode: 1 });
  eq([capsule?.name, !!capsule?.door, capsule?.collision?.address], ['TOCapsuleMachine01', false, 0x009c4a5c], '0x0103: a capsule machine (CapMoto model, box 0x009c4a5c), not a door');
  const capsuleDoors = collectFieldObjects([{ entity: { kind: 'object', index: 3, type: 0x0103, floor: 0, section: 0, position: [0, 0, 0], rotation: [0, 0, 0], group: 0, unknownA3: 0, params: [0, 0, 0, 0, 0, 0] }, name: 'x', category: 'object', world: [0, 0, 0], yaw: 0, sectionFound: true } as unknown as PlacedEntity], { episode: 0, floor: 0, area: 0x06 }).doors;
  eq(capsuleDoors.length, 0, '0x0103 is not in the door list (no lock, no state, no minimap icon)');
}

// --- Pioneer 2 (floor 0): no radar, no lock-on enemies (DEVLOG 2026-10-24) ---
// load_minimap_data (PsoBB.exe, dump 819156) loads the floor's `<prefix>r.rel`; the
// city maps have none (only `map_city00_00n.rel`), so minimap_current_map_data stays null and
// unknown_render_minimap returns at once: no radar, no icons, no compass. The port's
// classic/minimap.ts `loaded` is `rooms !== null`, so a floor without rooms draws nothing.
{
  eq(minimapFileFor('map_city00_00n.rel'), 'map_city00_00r.rel', 'the Pioneer 2 radar file name (absent in the data)');
  const floors = new MinimapFloors();
  const radar = new MinimapState();
  radar.enterFloor(0, 0, null, floors);
  eq([radar.loaded, radar.ready], [false, false], 'Pioneer 2 has no minimap rooms: nothing is loaded or drawn');
}

// --- Ordinary enemies' radar baseline (PsoBB.exe enemy-base slot 0x00520618, DEVLOG 2026-10-25) ---
// The shared slot adds the icon unless (flags+0x30) has 0x800 (dead) or 0x40000 (radar hidden).
eq(BASE_ICON_HIDDEN_FLAGS, 0x40800, 'the slot mask 0x40800 (0x00520618: test ((flags+0x30) & 0x40800))');
eq(baseIconShown(0), true, 'a plain living enemy is on the radar');
eq(baseIconShown(0x40000), false, '0x40000 (radar / lock-on bit, set by +0x184) hides the icon');
eq(baseIconShown(0x800), false, '0x800 (dead) hides the icon');
eq(baseIconShown(0x40800), false, 'both bits hide it');
eq(baseIconShown(0x4000000), true, '0x4000000 (invulnerable, +0x174) alone does not hide the radar icon');
eq(baseIconShown(0x2000000 | 0x4040000), false, '+0x184 flags (0x4040000) hide the icon');
eq(baseIconShown(0x20 | 0x100000), true, 'unrelated entity bits keep the icon');

// --- Booma family per-state radar icons (vtable 0x00b01fc0, handlers 0x0052a6e4..0x0052b518) ---
// Spawn (state 0) adds none; states 1-5 and 7 add their own icon; 6 and 8 add none.
eq(BOOMA_ICON_STATES.join(','), '1,2,3,4,5,7', 'the Booma states that add a radar icon');
eq(boomaIconShown(0), false, 'Booma spawn (0x00535a6c) has no icon');
eq(boomaIconShown(1), true, 'Booma walk (0x0052a6e4, icon 0x0052ab6b)');
eq(boomaIconShown(3), true, 'Booma chase (0x0052afe4, icon 0x0052b148)');
eq(boomaIconShown(6), false, 'state 6 is an empty slot');
eq(boomaIconShown(8), false, 'state 8 (0x0052b518) adds no icon');
eq(boomaIconShown(9), false, 'state 9 (0x0073d160) adds no icon');

// The port's Booma brain states map to the exe's state numbers (classic/minimap.ts BOOMA_BRAIN_EXE_STATE).
eq(boomaBrainIconShown('spawn'), false, 'Booma brain spawn (exe state 0, 0x00535a6c) hides the icon');
eq(boomaBrainIconShown('idle'), true, 'Booma brain idle = exe state 1 (wander, icon 0x0052ab6b)');
eq(boomaBrainIconShown('notice'), true, 'Booma brain notice = exe state 3 (war cry, icon 0x0052b148)');
eq(boomaBrainIconShown('chase'), true, 'Booma brain chase = exe state 3');
eq(boomaBrainIconShown('attack'), true, 'Booma brain attack = exe state 5 (icon 0x0052b330)');
eq(boomaBrainIconShown('recover'), true, 'Booma brain recover = exe state 5 substate 2');
eq(boomaBrainIconShown('dead'), false, 'Booma brain dead = exe state 8 (0x0052b518) adds none');
eq(boomaBrainIconShown('unknown-brain'), true, 'an unmapped brain state keeps the default icon');

// Dark Gunner (vtable 0x00b03400, dispatcher 0x005443c4 on +0x32e): states 1, 2, 3, 4, 6 add the icon; 0, 5, 8 do not.
for (const s of [1, 2, 3, 4, 6]) eq(darkGunnerIconShown(s), true, `Dark Gunner exe state ${s} adds the icon`);
for (const s of [0, 5, 7, 8]) eq(darkGunnerIconShown(s), false, `Dark Gunner exe state ${s} adds no icon`);
// The port's GunnerAi states mapped to the exe's state word (classic/minimap.ts DARK_GUNNER_BRAIN_EXE_STATE).
eq(darkGunnerBrainIconShown('dormant'), false, 'Dark Gunner dormant = exe state 0 (idle, 0x00545a64): no icon');
eq(darkGunnerBrainIconShown('idle'), false, 'Dark Gunner idle = exe state 0: no icon');
for (const b of ['drop', 'hover', 'turn', 'dash']) eq(darkGunnerBrainIconShown(b), true, `Dark Gunner ${b} = exe state 1 (active): icon`);
eq(darkGunnerBrainIconShown('shoot'), true, 'Dark Gunner shoot = exe state 2: icon');
eq(darkGunnerBrainIconShown('stun'), true, 'Dark Gunner stun = exe state 6 (0x00544518): icon');
eq(darkGunnerBrainIconShown('home'), false, 'Dark Gunner home = exe state 8 (0x00544410): no icon');
eq(darkGunnerBrainIconShown('dead'), false, 'Dark Gunner dead = exe state 5 (0x00544634): no icon');
eq(darkGunnerBrainIconShown('unknown-brain'), true, 'an unmapped Dark Gunner state keeps the default icon');

// Per-enemy radar source (vtable survey, DEVLOG 2026-10-25).
// Booma table families: Booma, Gobooma, Gigobooma (ctor 0x00535f1c, vtable 0x00b01fc0).
for (const t of ['BOOMA', 'GOBOOMA', 'GIGOBOOMA']) eq(radarSourceOf(t), 'booma', `${t}: the Booma table (no shared slot in 0x00b01fc0)`);
// Evil / Pal / Guil Shark (ctor 0x00512bd0, vtable 0x00aff860): states 1-8 are the Booma handlers.
for (const t of ['EVIL_SHARK', 'PAL_SHARK', 'GUIL_SHARK']) eq(radarSourceOf(t), 'booma', `${t}: states 1-8 are the Booma handlers (vtable 0x00aff860)`);
// Dimenian / La / So (ctor 0x00551d3c, vtable 0x00b041e0): states 1-8 are the Booma handlers, state 9 differs.
for (const t of ['DIMENIAN', 'LA_DIMENIAN', 'SO_DIMENIAN']) eq(radarSourceOf(t), 'booma', `${t}: states 1-8 are the Booma handlers (vtable 0x00b041e0)`);
eq([...BOOMA_BRAIN_TYPES].sort().join(','), ['BOOMA', 'DIMENIAN', 'EVIL_SHARK', 'GIGOBOOMA', 'GOBOOMA', 'GUIL_SHARK', 'LA_DIMENIAN', 'PAL_SHARK', 'SO_DIMENIAN'].join(','), 'the brain-gated families are the Booma-table families');
// The shared slot 0x00520618 at +0x198 of the vtable (PROVEN by read, DEVLOG 2026-10-25): Savage Wolf (0x00b00260),
// Chaos Sorcerer (0x00b09c60), Chaos Bringer (0x00b026e0), Dark Belra (0x00b02280), Canadine (0x00b02be0), Poison Lily
// and Del Lily (0x00b00fe0), Dubchic (0x00b04a40 / 0x00b04cc0).
for (const t of ['SAVAGE_WOLF', 'CHAOS_SORCERER', 'CHAOS_BRINGER', 'DARK_BELRA', 'CANADINE', 'POISON_LILY', 'DEL_LILY', 'DUBCHIC']) eq(radarSourceOf(t), 'slot', `${t}: the enemy-base slot 0x00520618 is in its vtable`);
eq(baseIconShown(0), true, 'a slot family with no hidden bits is on the radar (the default)');
// Rappy (update_rappy, dump 308039): the icon is unconditional in the alive branch.
eq(radarSourceOf('RAPPY'), 'rappy', 'Rappy: unconditional icon in its alive update (dump 308039)');
// Own icon families (no 0x40800 test on the icon's path): the default (alive and visible) stays.
for (const t of ['HILDEBEAR', 'GRASS_ASSASSIN', 'NANO_DRAGON', 'DELSABER', 'BULCLAW', 'NAR_LILY', 'SINOW_BEAT']) {
  eq(radarSourceOf(t), 'own', `${t}: its own icon call, no 0x40800 test (default kept)`);
}
eq(radarSourceOf('DARK_GUNNER'), 'gunner', 'Dark Gunner: the per-state icon (darkGunnerIconShown)');
// Garanz: no slot and no icon call (E8 scan of 0x56f8b8..0x571000): no icon.
eq(radarSourceOf('GARANZ'), 'none', 'Garanz: no radar icon (no slot, no icon call)');
// Claw: its own icon, off while +0x390 bit 0x10000000 (hidden) is set.
eq(radarSourceOf('CLAW'), 'gated', 'Claw: own icon gated by +0x390 bit 0x10000000');
eq(radarSourceOf('GILLCHIC'), 'own', 'Gillchic: vtable 0x00b04760 (gilchic_constructor), icon unconditional in its update 0x005548f0');
eq(radarSourceOf('SINOW_GOLD'), 'own', 'Sinow Gold: the Sinow Beat constructor with subtype 1 (ASSUMED the same icon path)');
// Episode 2 (2026-10-25): the enemy-base slot families and the own-icon families.
for (const t of ['MERICAROL', 'UL_GIBBON', 'ZOL_GIBBON', 'GEE', 'DELBITER', 'EPSILON', 'SINOW_ZOA', 'SINOW_ZELE', 'MORFOS', 'RECOBOX', 'DORPHON', 'DORPHON_ECLAIR']) {
  eq(radarSourceOf(t), 'slot', `${t}: vtable +0x198 is the enemy-base slot, called by its update`);
}
for (const t of ['DELDEPTH', 'GI_GUE', 'GIBBLES', 'MERILLIA', 'MERILTAS', 'GORAN', 'GORAN_DETONATOR', 'PYRO_GORAN']) {
  eq(radarSourceOf(t), 'own', `${t}: its own icon call, no 0x40800 test (default kept)`);
}
eq(radarSourceOf('CANADINE_NOT_A_TYPE'), null, 'an unknown type has no radar source');
eq(Object.keys(ENEMY_RADAR_SOURCE).length, 9 + 8 + 1 + 8 + 1 + 1 + 2 + 12 + 8, 'the survey table has 50 enemy rows');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('minimap: all checks passed');

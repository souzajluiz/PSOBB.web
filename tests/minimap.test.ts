// Minimap: the map_*r.rel rooms (formats/minimap.ts), the radar / full map
// state (classic/minimap.ts), the Area Map window (classic/areamap.ts) and
// its wiring into the field menu and the status window (classic/fieldmenu.ts,
// classic/hud.ts).
// Run: node tests/minimap.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { minimapFileFor, modelTriangles, parseMinimapRel } from '../client/src/formats/minimap.ts';
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
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('minimap: all checks passed');

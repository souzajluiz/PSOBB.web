// The minimap of PsoBB.exe (Ephinea 1.25.13): the radar in the field HUD
// (minimap_type 0) and the full map the Area Map window switches to
// (minimap_type 1; 2 is the split-screen map of the console versions,
// update_unknown_minimap_coop, which Blue Burst never selects:
// CreateItemObject_006dc358 is 0 there). This module keeps the state and
// the rules; render/minimap.ts draws them.
//
// Object: Minimap_CreateObject_00804d94 creates it with each floor (vtable
// g_MapObjectDerivedVtable; update unknown_minimap_update, render
// unknown_render_minimap), sets minimap_type = 0 and, per camera slot i =
// 0..2 of the table at 0x00aafb00 (0x40 bytes each: eye x, y, z, look offset
// x, y, z, yaw): InitMinimapMatrix_0083a57c, eye y = 2000 (0x00a11460), look
// offset (0, -1, 0), yaw 0x8000. Slot 0 is the radar (minimap1_xyz), slot 1
// the full map (minimap2_xyz). Object fields: +0x90 = 60 (the update and the
// render wait 60 frames after the floor loads), +0x168 = 2 (the height
// animation runs), +0x16c = 0 (zoom mode), +0x170 = 80 (0x00a11444, the
// height step), +0x174 = 0 (compass heading), +0x1a0 = 0.8 (room alpha cap).
//
// Update (after the 60 frames):
//   unknown_minimap_related: bit 1 of +0x168 = character option 1 (option
//     flags +0x4ec bit 0, get_character_option): the radar turns with the
//     camera.
//   unknown_minimap_update_players: marker 0 = the local player (x, z,
//     heading, colour unknown_minimap_player_colors[slot] = table 0x0097eaa0
//     {a, r, g, b}: red, green, yellow, blue), then the other players on the
//     same floor (floor_id_2 == g_CurrentFloor) in slot order; markers are
//     22.0 units (15.4 in zoom mode 2).
//   update_minimap_center_rotation: radar eye x, z = marker 0; radar yaw =
//     0x8000 (0 on De Rol Le's map, 12) or, turning, 0x8000 - camera
//     y_rotation; full map yaw 0x8000 (0 on De Rol Le); compass heading
//     +0x174 = 0 or, turning, -y_rotation (0x8000 - y_rotation on De Rol Le).
//     Height: +0x170 *= 1.2 (0x0097ecc8) each frame and the radar eye y
//     moves by it toward 2000 (mode 0) / 3500 (mode 1, 0x00a11464) / 1200
//     (mode 2, 0x00a11468), clamped there.
//   Room discovery: every room with flag 1 and without flag 2 whose centre
//     (room position + mesh centre) is within its radius (XZ) of marker 0
//     loses flag 1 and restarts its alpha at 0.
//   update_minimap_compass: +0x198 += 0x888; alpha +0x19c = (sin + 1.0) *
//     64 + 127 (0x0097ecc0 / 0x0097ecbc / 0x0097ecc4).
// Render (unknown_render_minimap): nothing while the local player's menu is
// open, unless the map is the full map; nothing while the player's UI
// blocks input unless HUD flag bit 1 is set; nothing with the talk
// cameras (5, 9). Order: the background (render_minimap_background: a quad
// of colour alpha << 24 over the rect, alphas 64 / 64 / 128 at
// FLOAT_ARRAY_00a11418), then the camera (Minimap_SetViewportAndLight
// _008047b4: viewport, unknown_size_minimaps, light (0, -1, 0) white, fog
// off), the discovered rooms (alpha += 0.08 (0x0097ec9c) each frame, capped
// at 0.8; colour minimap_ground_colors {1, 0.3, 0.3, 0.3} at 0x00a11450 with
// that alpha), the icons, the player markers (obj_f_player of
// obj_f_enemy.bml), then the compass (MinimapRenderIcon_00804b24).
//
// Viewport (CalculateMinimapViewport_00804844, table 0x00a11324 of {centre
// x, centre y, width, height, 500}): radar (544, 128) 128 x 128, full map
// (256, 352) 448 x 128; the background rects (0x00a113e8 / 0x00a11400) are
// the same. Camera (unknown_size_minimaps): eye = slot xyz * 1.0
// (0x00a1144c), target = eye + look offset, up = rotY(0x8000 - yaw) (0, 0,
// -1); the perspective is the game's default one (angle round-down(75 *
// 65536 / 360) = 0x3555, near 1, far 10000) and set_d3d_projection_matrix
// scales it by the full screen over the viewport, so the viewport shows its
// own part of a full-screen view: k = 2 * eye height * tan(fovy / 2) / 480
// world units per 640x480 pixel.

export type MinimapType = 0 | 1;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// Viewport / background per minimap_type (0x00a11324, 0x00a113e8 / 0x00a11400).
export const MINIMAP_RECT: readonly Rect[] = [
  { x: 480, y: 64, w: 128, h: 128 },
  { x: 32, y: 288, w: 448, h: 128 },
];
export const BACKGROUND_ALPHA = [64, 64] as const; // FLOAT_ARRAY_00a11418

export const START_DELAY = 60; // +0x90
export const DEFAULT_HEIGHT = 2000; // 0x00a11460
export const MAX_HEIGHT = 3500; // 0x00a11464 (g_MinimapYBounds)
export const MIN_HEIGHT = 1200; // 0x00a11468
export const HEIGHT_STEP = 80; // 0x00a11444
export const HEIGHT_RATE = 1.2; // 0x0097ecc8
export const ROOM_ALPHA_STEP = 0.08; // 0x0097ec9c
export const ROOM_ALPHA_MAX = 0.8; // +0x1a0 (0x3f4ccccd)
export const GROUND_COLOR = [0.3, 0.3, 0.3] as const; // 0x00a11454..0x00a1145c
export const MARKER_SIZE = 22; // modes 0 and 1
export const MARKER_SIZE_SMALL = 15.4; // mode 2
export const COMPASS_STEP = 0x888;
// unknown_minimap_player_colors (0x0097eaa0), ARGB by client slot.
export const PLAYER_COLORS = [0xffff0000, 0xff00ff00, 0xffffff00, 0xff0000ff] as const;

// Icons (unknown_add_minimap_icon*: at most 128 a frame; unless forced, only
// within 300 units (90000 = 0x0097ecf8, squared, XZ) of the radar centre).
export const MAX_ICONS = 0x80;
export const ICON_RANGE_SQ = 90000;
// The enemies' icon: shape 1 (the disc of obj_f_enemy, scale 8 x 8 x 8 =
// minimap_circle_size 0x0097ec98), colour 0xffffa24c, scale 1.
export const ENEMY_ICON_COLOR = 0xffffa24c;
export const CIRCLE_SIZE = 8;
// Shape 0 (switches, TObjRaderIcon): the gate box scaled 13.6 x 8 x 5.6
// (0x0097ec90 / 0x0097ec94) times the icon scale.
export const SWITCH_SIZE = [13.6, 5.6] as const;

// Full-map pan bounds (Minimap_ClampPlayerPosition_008058b4, filled in by the
// static initializer 0x008059dc / data 0x00a11434): {min x, max x, min z,
// max z}; the second row is for the Wilds (map type 8, table 0x0097f040);
// Vol Opt, Dark Falz, Olga Flow and the Tower (13, 14, 31, 35) are not clamped.
export const PAN_BOUNDS = [
  [-6000, 6000, -6000, 6000],
  [-3000, 9000, -9000, 3000],
] as const;
const UNCLAMPED_MAPS: ReadonlySet<number> = new Set([13, 14, 31, 35]);
const WILDS_MAPS: ReadonlySet<number> = new Set([36, 37, 38, 39]);
export const DE_ROL_LE = 12;

// Compass sprites (MinimapRenderIcon_00804b24, texlist RaderMapFrame.xvm,
// sprite table 0x00a113c0 {w, h, pivot x, pivot y, u0, v0, u1, v1, ...}):
// texture 1 (32 x 32, pivot 16, 16) at 0x00a11398 + pivot, its alpha the
// compass pulse; texture 0 (32 x 32, pivot 16, 27) at 0x00a11390 + pivot,
// turned by the compass heading (RenderMinimapIcon_00819f7c flag 1).
export interface CompassSprite {
  texture: 0 | 1;
  x: number; // top-left before rotation
  y: number;
  pivotX: number;
  pivotY: number;
}
export const COMPASS: readonly (readonly [CompassSprite, CompassSprite])[] = [
  [
    { texture: 1, x: 575, y: 159, pivotX: 16, pivotY: 16 },
    { texture: 0, x: 575, y: 149, pivotX: 16, pivotY: 27 },
  ],
  [
    { texture: 1, x: 450, y: 383, pivotX: 16, pivotY: 16 },
    { texture: 0, x: 450, y: 373, pivotX: 16, pivotY: 27 },
  ],
];
export const COMPASS_SIZE = 32;

const BAMS = 0x10000;
const TWO_PI = 6.283184051513672; // the exe's float 2*pi
export const bamsToRad = (b: number): number => (b * TWO_PI) / BAMS;
export const radToBams = (r: number): number => Math.round((r * BAMS) / TWO_PI) & 0xffff;
// int_sin: the exe reads a 4096-entry table; Math.sin of the angle is close.
const intSin = (b: number): number => Math.sin(bamsToRad(b & 0xffff));

// fovy (radians) of the default perspective, angle 0x3555 (SetupD3DProjection
// Matrix_0082eea0; the same formula as classic/playerview.ts njPerspectiveFovy).
export const PERSPECTIVE_ANGLE = Math.trunc((75 * BAMS) / 360); // 0x3555
export function minimapFovy(): number {
  const a = Math.trunc(Math.trunc((PERSPECTIVE_ANGLE * 85) / 100) / 2);
  const t = Math.tan((a * TWO_PI) / BAMS) / Math.fround(1.1333334);
  const n = Math.trunc((Math.atan(t) * BAMS) / TWO_PI);
  return (n * 2 * TWO_PI) / BAMS;
}

// World units per 640x480 pixel at an eye height.
export function unitsPerPixel(height: number): number {
  return (2 * height * Math.tan(minimapFovy() / 2)) / 480;
}

export function clampPan(map: number, p: { x: number; z: number }): void {
  if (UNCLAMPED_MAPS.has(map)) return;
  const [x0, x1, z0, z1] = PAN_BOUNDS[WILDS_MAPS.has(map) ? 1 : 0];
  if (p.x < x0) p.x = x0;
  if (p.x > x1) p.x = x1;
  if (p.z < z0) p.z = z0;
  if (p.z > z1) p.z = z1;
}

// One room's runtime state (flags / alpha of minimap_room_data).
export interface RoomState {
  index: number;
  flags: number;
  alpha: number;
  cx: number; // discovery centre (room position + mesh centre)
  cz: number;
  radius: number;
}

export interface MinimapRoomInput {
  index: number;
  flags: number;
  position: readonly [number, number, number];
  radius: number;
  model: { center: readonly [number, number, number] };
}

export interface Marker {
  slot: number;
  x: number;
  z: number;
  heading: number; // BAMS
  color: number; // ARGB
  size: number;
}

export interface Icon {
  x: number;
  z: number;
  color: number; // ARGB
  shape: 0 | 1 | 2 | 3;
  scale: number;
  heading: number; // BAMS
}

export interface MinimapPlayer {
  slot: number;
  x: number;
  z: number;
  heading: number; // BAMS
}

// The camera of the slot drawn this frame.
export interface MinimapCamera {
  x: number;
  y: number;
  z: number;
  yaw: number; // BAMS: up = rotY(0x8000 - yaw) (0, 0, -1)
}

// Up vector on the XZ plane for a slot yaw.
export function cameraUp(yaw: number): { x: number; z: number } {
  const a = bamsToRad((0x8000 - yaw) & 0xffff);
  // rotY(a) applied to (0, 0, -1).
  return { x: -Math.sin(a), z: -Math.cos(a) };
}

// Saved room flags of every floor of the game (floor_minimap_room_flags,
// Minimap_InitArena_00805a24: 18 floors, cleared when a game starts). The
// client keys them by floor; here the key is the floor's minimap file as well
// (a quest can put another layout on the same floor), and a saved array whose
// length does not match the rooms is dropped.
export class MinimapFloors {
  private saved = new Map<string, Uint16Array>();
  load(key: string, rooms: number): Uint16Array | null {
    const flags = this.saved.get(key);
    if (flags && flags.length !== rooms) {
      this.saved.delete(key);
      return null;
    }
    return flags ?? null;
  }
  save(key: string, flags: Uint16Array): void {
    this.saved.set(key, flags);
  }
}

export class MinimapState {
  type: MinimapType = 0;
  rooms: RoomState[] = [];
  map = 0;
  floor = -1;
  private key = '';
  delay = START_DELAY; // +0x90
  turning = false; // +0x168 bit 1
  zoomMode: 0 | 1 | 2 = 0; // +0x16c
  heightStep = HEIGHT_STEP; // +0x170
  radar: MinimapCamera = { x: 0, y: DEFAULT_HEIGHT, z: 0, yaw: 0x8000 };
  full: MinimapCamera = { x: 0, y: DEFAULT_HEIGHT, z: 0, yaw: 0x8000 };
  heading = 0; // +0x174
  compassPhase = 0; // +0x198
  compassAlpha = 0; // +0x19c, 0..255
  markers: Marker[] = [];
  icons: Icon[] = [];
  loaded = false; // minimap_current_map_data present

  // load_minimap_data: a floor's rooms, with the flags saved from an earlier
  // visit, or every room undiscovered on the first one.
  // Minimap_CreateObject_00804d94 resets the object; the full map pan
  // (minimap2_xyz) is a global and keeps its values.
  // `key`: the floor and its minimap file (MinimapFloors).
  enterFloor(floor: number, map: number, rooms: readonly MinimapRoomInput[] | null, saved: MinimapFloors, key = String(floor)): void {
    this.leaveFloor(saved);
    this.floor = floor;
    this.key = key;
    this.map = map;
    this.type = 0;
    this.delay = START_DELAY;
    this.zoomMode = 0;
    this.heightStep = HEIGHT_STEP;
    this.radar = { x: 0, y: DEFAULT_HEIGHT, z: 0, yaw: 0x8000 };
    this.full.yaw = 0x8000;
    this.heading = 0;
    this.compassPhase = 0;
    this.compassAlpha = 0;
    this.markers = [];
    this.icons = [];
    this.loaded = rooms !== null;
    const flags = rooms ? saved.load(key, rooms.length) : null;
    this.rooms = (rooms ?? []).map((r, i) => ({
      index: r.index,
      flags: flags ? flags[i] : r.flags | 1,
      alpha: 0,
      cx: r.position[0] + r.model.center[0],
      cz: r.position[2] + r.model.center[2],
      radius: r.radius,
    }));
  }

  // uninit_minimap_data: the room flags go back to the floor's array.
  leaveFloor(saved: MinimapFloors): void {
    if (this.loaded && this.floor >= 0) saved.save(this.key, Uint16Array.from(this.rooms.map((r) => r.flags)));
    this.loaded = false;
    this.rooms = [];
  }

  get ready(): boolean {
    return this.loaded && this.delay <= 0;
  }

  // Minimap_MarkRoomDiscovered_00805400 (a TObjRaderCol's first frame):
  // the room stays hidden until revealed.
  holdRoom(index: number): boolean {
    const r = this.rooms.find((x) => x.index === index);
    if (!r) return false;
    r.flags |= 2;
    return true;
  }

  // mark_minimap_room_as_discovered.
  revealRoom(index: number): boolean {
    const r = this.rooms.find((x) => x.index === index && x.flags & 1);
    if (!r) return false;
    r.flags &= ~1;
    r.alpha = 0;
    return true;
  }

  // Minimap_UpdateRoomDiscoveryState_00804d58 (a Challenge stage restart: 1).
  setAllRooms(flag: number): void {
    for (const r of this.rooms) r.flags |= flag;
  }

  // unknown_minimap_update. `self`: the local player (null = none or
  // invisible); `others`: the other players on this floor; `cameraYaw`: the
  // camera's y_rotation (BAMS).
  update(self: MinimapPlayer | null, others: readonly MinimapPlayer[], cameraYaw: number): void {
    if (!this.loaded) return;
    if (this.delay > 0) {
      this.delay--;
      return;
    }
    this.markers = [];
    const size = this.zoomMode === 2 ? MARKER_SIZE_SMALL : MARKER_SIZE;
    if (self) this.markers.push({ slot: self.slot, x: self.x, z: self.z, heading: self.heading, color: PLAYER_COLORS[self.slot & 3], size });
    for (const p of others) this.markers.push({ slot: p.slot, x: p.x, z: p.z, heading: p.heading, color: PLAYER_COLORS[p.slot & 3], size });
    // update_minimap_center_rotation.
    if (self) {
      this.radar.x = self.x;
      this.radar.z = self.z;
    }
    const derolle = this.map === DE_ROL_LE;
    if (this.turning) {
      this.radar.yaw = (0x8000 - cameraYaw) & 0xffff;
      this.full.yaw = derolle ? 0 : 0x8000;
      this.heading = (derolle ? 0x8000 - cameraYaw : -cameraYaw) & 0xffff;
    } else {
      this.radar.yaw = derolle ? 0 : 0x8000;
      this.full.yaw = this.radar.yaw;
      this.heading = 0;
    }
    this.stepHeight();
    if (self) this.discover(self.x, self.z);
    this.compassPhase = (this.compassPhase + COMPASS_STEP) & 0xffff;
    this.compassAlpha = (intSin(this.compassPhase) + 1) * 64 + 127;
  }

  private stepHeight(): void {
    this.heightStep *= HEIGHT_RATE;
    const y = this.radar.y;
    if (this.zoomMode === 0) this.radar.y = Math.min(y + this.heightStep, DEFAULT_HEIGHT);
    else if (this.zoomMode === 1) this.radar.y = Math.min(y + this.heightStep, MAX_HEIGHT);
    else this.radar.y = Math.max(y - this.heightStep, MIN_HEIGHT);
  }

  // The discovery loop of unknown_minimap_update (vec3f_xz_dist_squared <
  // radius^2).
  discover(x: number, z: number): number {
    let n = 0;
    for (const r of this.rooms) {
      if (r.flags & 2 || !(r.flags & 1)) continue;
      const dx = r.cx - x;
      const dz = r.cz - z;
      if (dx * dx + dz * dz < r.radius * r.radius) {
        r.alpha = 0;
        r.flags &= ~1;
        n++;
      }
    }
    return n;
  }

  // The rooms' fade-in, once per drawn frame.
  fadeRooms(): void {
    for (const r of this.rooms) if (!(r.flags & 1)) r.alpha = Math.min(r.alpha + ROOM_ALPHA_STEP, ROOM_ALPHA_MAX);
  }

  // unknown_add_minimap_icon / icon2 / icon3: false when full or (unless
  // forced) out of range of the radar centre.
  addIcon(icon: Icon, force = false): boolean {
    if (this.icons.length >= MAX_ICONS) return false;
    if (!force) {
      const dx = icon.x - this.radar.x;
      const dz = icon.z - this.radar.z;
      if (dx * dx + dz * dz > ICON_RANGE_SQ) return false;
    }
    this.icons.push(icon);
    return true;
  }

  // The icons are drawn once and cleared (minimap_object_count = 0 at the end
  // of unknown_render_minimap).
  takeIcons(): Icon[] {
    const out = this.icons;
    this.icons = [];
    return out;
  }

  get camera(): MinimapCamera {
    return this.type === 1 ? this.full : this.radar;
  }

  // Minimap_GetPlayerPosition2D_008054fc: the full map, centred on marker 0.
  openFullMap(): void {
    this.type = 1;
    const m = this.markers[0];
    this.full.x = m ? m.x : 0;
    this.full.z = m ? m.z : 0;
  }

  closeFullMap(): void {
    this.type = 0;
  }

  // MinimapZoomIn_00802b44 / MinimapZoomOutZ_00802b78 (both pan, despite
  // the names) and MinimapMoveY_00802bac (the height), full map only.
  pan(dx: number, dz: number): void {
    if (this.type !== 1) return;
    this.full.x -= dx;
    this.full.z -= dz;
    clampPan(this.map, this.full);
  }

  moveHeight(dy: number): void {
    if (this.type !== 1) return;
    this.full.y = Math.min(Math.max(this.full.y + dy, MIN_HEIGHT), MAX_HEIGHT);
  }

  // Minimap_SetPlayer2Position_00805568 / Minimap_GetPlayer2Position_00805598.
  setPan(x: number, z: number): void {
    if (this.type !== 1) return;
    this.full.x = x;
    this.full.z = z;
    clampPan(this.map, this.full);
  }
}

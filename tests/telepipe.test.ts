// Telepipes (net/telepipe.ts): the 6x68 and 6x2C bytes, the state store and
// its 6x68 rule (ProcessTelepipeTeleportRequest_006e9410), where Ryuker / the
// Telepipe may open a pipe, the Pioneer 2 arrival spots, the 6x70 field and
// the Telepipe item's use rule (net/items.ts).
// Run: node tests/telepipe.test.ts
import { buildPlayerSync } from '../client/src/net/game.ts';
import { GameItems } from '../client/src/net/items.ts';
import type { Game } from '../client/src/net/game.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import { isSafeMap } from '../client/src/classic/fieldmenu.ts';
import { NT_LAYOUT, ParticleSystem, parseParticleEntry, particleQuad, particleShade } from '../client/src/classic/particles.ts';
import {
  BOSS_AREAS,
  buildImposeHold,
  buildTelepipeState,
  NO_OWNER,
  nearestPipe,
  noTelepipe,
  parseTelepipeState,
  pioneer2Arrival,
  PIPE_COLORS,
  PIPE_PARTICLES,
  readTelepipe,
  samePipe,
  TelepipeStore,
  telepipeAllowed,
  telepipeOpen,
  USE_FRAMES_CITY,
  USE_FRAMES_FIELD,
} from '../client/src/net/telepipe.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// --- 6x68 (SendTelepipeStatePacket_006e90b8) ---
const pipe = { owner: 1, floor: 2, room: 7, x: 10.5, y: -2, z: 300, angle: 0x4000 };
const b68 = buildTelepipeState(pipe);
eq(b68.length, 0x1c, '6x68 is 0x1C bytes');
eq(hex(b68.subarray(0, 8)), '6807000001000200', '6x68 header, owner, floor');
eq(parseTelepipeState(b68), pipe, '6x68 round trip');
eq(parseTelepipeState(new Uint8Array(0x1c)), null, 'not 6x68');
eq(hex(buildImposeHold(2, 10, 1, -1)), '2c050200' + '0a000000' + '0000803f' + '000080bf' + '00000000', '6x2C {client, 10 frames, x, z, 0}');

// --- state rules ---
eq([telepipeOpen(pipe), telepipeOpen({ ...pipe, floor: 0 }), telepipeOpen(noTelepipe())], [true, false, false], 'open while floor != 0 (0x006e839c)');
eq([samePipe(pipe, 2, 10.6, 300.1), samePipe(pipe, 2, 10.8, 300), samePipe(pipe, 3, 10.5, 300)], [true, false, false], 'same pipe: same floor, within 0.2 (0x0096d920)');

const store = new TelepipeStore();
eq(store.receive(pipe) !== null, true, 'a new pipe is stored');
eq(store.receive({ ...pipe, room: 9 }), null, 'the pipe already known is ignored');
eq(store.receive({ ...pipe, x: 50 })?.x, 50, 'a pipe elsewhere replaces it');
eq(store.receive({ ...pipe, owner: 4 }), null, 'owner 4 and up is ignored');
const closed = store.close(1);
eq([closed.floor, closed.room, closed.x, store.get(1)?.floor], [0, 0, 50, 0], 'closing keeps the position (0x006e8388)');
eq(store.receive({ ...pipe, x: 50 })?.floor, 2, 'reopened at the same spot after closing');

// --- where a pipe may be opened (0x00688b4c) ---
const allowed = (area: number, o = {}) => telepipeAllowed(area, isSafeMap(area), o);
eq([allowed(1), allowed(0), allowed(0x0f), allowed(0x12), allowed(0x0b), allowed(0x2c), allowed(0x13)], [true, false, false, false, false, false, true], 'field yes; safe maps and boss maps no');
eq([allowed(1, { battle: true }), allowed(1, { challenge: true })], [false, false], 'not in battle or challenge');
eq(BOSS_AREAS, [0x0b, 0x0c, 0x0d, 0x0e, 0x1e, 0x1f, 0x20, 0x21, 0x2c], 'map type 0x0B (0x0097f040)');

// --- arrival (0x006e9630) ---
eq(pioneer2Arrival(0, 1), { x: -312, y: 0, z: -113, angle: 0x4000 }, 'Pioneer 2, client 0 (0x0096d8a0)');
eq(pioneer2Arrival(3, 3), { x: -249, y: 0, z: -190, angle: 0x4000 }, 'Episode 4 uses the Episode 1 table');
eq(pioneer2Arrival(1, 2), { x: 300, y: -30, z: -220, angle: 0x4000 }, 'Episode 2 (0x0096d8d0)');
eq([USE_FRAMES_FIELD, USE_FRAMES_CITY], [11, 12], 'frames from the key to the warp');
eq([...PIPE_PARTICLES, PIPE_COLORS[0].toString(16), PIPE_COLORS[3]], [0xb1, 0xb2, 0xb0, 'ffb2b2', 0], 'particles 0x0096d800, colours 0x0096d928');

// --- 6x70 carries the pipe at +0x80 ---
const self = { disp: new Uint8Array(0x3e8), inventory: new Uint8Array(4 + 30 * 0x1c) } as never;
const state = { clientId: 1, floor: 2, position: { x: 0, y: 0, z: 0 }, angle: 0 };
const s70 = buildPlayerSync(self, state, 42, pipe);
eq(readTelepipe(new DataView(s70.buffer), 0x80), pipe, '6x70 with our pipe');
eq(new DataView(buildPlayerSync(self, state, 42).buffer).getUint16(0x80, true), NO_OWNER, '6x70 without one');

// --- the Telepipe item (ValidateItemForEquip_005c9e40, use_telepipe) ---
{
  const sent: string[] = [];
  const game = {
    on: () => {},
    conn: { onCommand: () => {}, send: () => {} },
    info: null,
    players: new Map(),
    selfId: 0,
    leaderId: 0,
    active: true,
    sendSubcommand: (sub: number) => sent.push(sub.toString(16)),
  } as unknown as Game;
  const tp: InventoryItem = { index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: itemFromHex('030700000002000000000000 00000100 00000000') };
  const ch = { meseta: 0, inventory: [tp], techLevels: [], stats: {} } as unknown as CharacterFile;
  const items = new GameItems(game, { character: () => ch, fullCharacter: () => null } as never);
  let opened = 0;
  items.onTelepipe = () => opened++;
  eq([items.canUse(tp, { telepipe: () => false }), items.canUse(tp, {}), items.canUse(tp, { telepipe: () => true })], [false, false, true], 'Telepipe usable only where a pipe may open');
  items.use(tp.data.id, { telepipe: () => false });
  eq([opened, sent], [0, []], 'not used in Pioneer 2');
  items.use(tp.data.id, { telepipe: () => true });
  eq([opened, sent, ch.inventory[0]?.data.data1[5]], [1, ['27'], 1], 'used: 6x27, the pipe opens, one less');
}

// --- particle quads (render_particle_renderer3 / 4, NT_LAYOUT 0x00a101c0) ---
{
  const streak = { e: { entry: { flags: 4, streak: [0.0399, 1] } }, step: [0, 1.5, 0], size: 0.05 } as never;
  const q24 = particleQuad(streak, 24); // gate_yurayura's texture (GBIX 700420), renderer 3
  eq([+q24.hw.toFixed(3), +q24.hh.toFixed(3), q24.rotated], [0.958, 24, false], '0xB2 streak: thin and tall, not turned');
  const q5 = particleQuad(streak, 5); // renderer 4 (the title's streaks)
  eq(q5.rotated, true, 'renderer 4 turns with the step');
  const sprite = particleQuad({ e: { entry: { flags: 0 } }, step: [0, 0, 0], size: 0.1 } as never, 25);
  eq([sprite.hw, sprite.hh, sprite.rotated], [3.2, 3.2, false], 'a sprite: half size x size (slot 25: 32)');
  eq([NT_LAYOUT.length, NT_LAYOUT[24], NT_LAYOUT[0]], [54, [16, 3], [4, 4]], 'effect_nt_metadata');
}

// --- 0xB0 gate_circle, a type 1 ring (ParticleEffectInstance_Update_0050f3fc) ---
{
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  dv.setInt32(0x10, 1, true);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  f(0x24, 0.2); f(0x28, 0.1); f(0x2c, 1); f(0x30, 1); f(0x34, 0.1); f(0x74, 2);
  dv.setInt32(0x48, 15, true); dv.setInt32(0x4c, 4, true);
  f(0x44, 1.5); f(0x58, 0.1); f(0x5c, 0.5); f(0x60, 10); f(0x64, 1);
  f(0x7c, 0.4); f(0x80, 0.5); f(0x84, 1);
  const e = parseParticleEntry(dat, 0);
  eq([e.kind, e.ring.radius, e.ring.omega, e.ring.rise], [1, [10, 1], [1, 2], [Math.fround(0.1), 0]], 'type 1 fields');
  const sys = new ParticleSystem();
  sys.add(e, [100, 5, -40], 0);
  for (let i = 0; i < 6; i++) sys.step();
  const q = sys.live[0]!;
  const dist = Math.hypot(q.p[0] - 100, q.p[2] + 40);
  eq([sys.count > 0, dist >= 10 - 1e-6 && dist <= 11 + 1e-6], [true, true], 'the ring orbits at radius 10..11 around the pipe');
  eq(+(q.p[1] - 5).toFixed(3), +(0.1 * q.age / q.dt).toFixed(3), 'it rises 0.1 per frame');
  eq(particleShade(q).rgb[0] > 0.39 && particleShade(q).rgb[0] < 0.41, true, 'blue-white colour is the base (slopes +0x50 / +0x38 / +0x3c are 0)');
}

// The loop voice (SE 0xA0) goes to the open pipe nearest the local player.
{
  const pipes = [
    { x: 0, z: 0 },
    { x: 30, z: 0 },
    { x: 8, z: 3 },
  ];
  eq(nearestPipe(pipes, { x: 9, z: 3 }), 2, 'the loop voice is at the nearest pipe');
  eq(nearestPipe(pipes, { x: 29, z: 1 }), 1, 'the voice moves when another pipe is nearer');
  eq(nearestPipe([], { x: 0, z: 0 }), -1, 'no open pipe, no loop');
  eq(nearestPipe(pipes, null), 0, 'without a listener the first pipe is taken');
}

if (failures) {
  console.log(`telepipe: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('telepipe: all checks passed');

// Floor item presentation (render/flooritems.ts, net/items.ts): where an
// item's origin sits (set_item_y_floating), the local drop's spot search,
// the pickup hook of 6x59 and the 6x2A height / amount.
// Run: node tests/drops.test.ts

import { floorItemHeight, ITEM_GROUND_OFFSET, ITEM_GROUND_PROBE, SE_PICKUP } from '../client/src/render/flooritems.ts';
import { canPickUp, GameItems, PICKUP_LOCK_FRAMES, type FloorItem } from '../client/src/net/items.ts';
import { DropSearch, DROP_HOLD_FRAMES, DROP_RING_STEP } from '../client/src/net/dropspot.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import type { Game } from '../client/src/net/game.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const r3 = (p: { x: number; y: number; z: number } | null) => p && [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];

eq([ITEM_GROUND_OFFSET, ITEM_GROUND_PROBE, SE_PICKUP, DROP_RING_STEP], [6, 300, 0x571, 6], 'constants 0x0092bb6c / 0x0092bb70, SE 0x571, ring step 0x0093db68');

// --- set_item_y_floating ---
{
  const probes: number[] = [];
  const ground = (_x: number, _z: number, fromY: number) => (probes.push(fromY), 20);
  eq(floorItemHeight({ x: 1, z: 2 }, ground), 26, '6x5F: ground under 0 + 300, plus 6');
  eq(floorItemHeight({ x: 1, z: 2, y: 50 }, ground), 26, '6x2A: probed from its own y');
  eq(probes, [300, 350], 'probe heights');
  eq(floorItemHeight({ x: 1, z: 2, y: 7 }, () => null), 7, 'no ground: y kept');
}

// --- the drop's spot search (net/dropspot.ts, FUN_006a44fc) ---
{
  const run = (me: { x: number; y: number; z: number; angle: number }, ground: (x: number, z: number, fromY: number) => number | null, wallBlocks = (): boolean => false) => {
    const s = new DropSearch(me, { ground, wallBlocks });
    for (let steps = 1; steps <= 200; steps++) {
      const r = s.search();
      if (r.status !== 'searching') return { status: r.status, steps, at: r.status === 'found' ? r.at : null };
    }
    return { status: 'stuck', steps: 200, at: null };
  };
  const me = { x: 10, y: 0, z: 10, angle: 0 };
  eq(DROP_HOLD_FRAMES, 900, '6x2C hold 900 frames');
  const first = run(me, () => 0);
  eq([first.status, first.steps, r3(first.at)], ['found', 1, [10, 6, 16]], 'first spot: 6 in front (sin, cos), y = ground + 6');
  // Only ground beyond 10 units: ring 2 (12 units) after the four spots of ring 1.
  const far = (x: number, z: number) => (Math.hypot(x - 10, z - 10) > 10 ? 3 : null);
  const ring2 = run(me, far);
  eq([ring2.status, ring2.steps, r3(ring2.at)], ['found', 5, [10, 9, 22]], 'ring 2 when ring 1 has no ground');
  // No ground at all: rings 1..5 (60 spots), the first spot of ring 6, then the failure.
  eq([run(me, () => null).status, run(me, () => null).steps], ['failed', 62], 'no ground: 61 spots, then failed');
  // The wall on the first spot's line: the second spot (90 degrees, x + 6) is taken.
  const walled = run(me, () => 0, () => true);
  eq(walled.status, 'failed', 'a wall on every line: failed');
  const wall16 = run(me, () => 0, (_a, b) => b.z === 16);
  eq([wall16.status, wall16.steps, r3(wall16.at)], ['found', 2, [16, 6, 10]], 'a blocked spot goes to the next one');
  // The eye: ground under the player probed from y + 10, plus 6.
  let eye: { x: number; y: number; z: number } | null = null;
  const probes: number[] = [];
  run(me, (_x, _z, fromY) => (probes.push(fromY), fromY === 10 ? 4 : 0), (a) => ((eye = a), false));
  eq(eye && [eye.x, eye.y, eye.z], [10, 10, 10], 'the eye is the ground under the player + 6');
  eq(probes.includes(10), true, 'the eye probe starts at the player + 10');
  // Heading 90 degrees (BAMS 0x4000): ring 1 starts at x + 6.
  eq(r3(run({ ...me, angle: Math.PI / 2 }, () => 0).at), [16, 6, 10], 'the first angle is the player heading');
}

// --- GameItems: 6x59 hook, 6x2A height, our drop ---
{
  const sent: Array<[number, Uint8Array]> = [];
  let onSub: (sub: number, clientId: number, body: Uint8Array) => void = () => {};
  const holds: number[][] = [];
  let releases = 0;
  const self = { clientId: 0, floor: 1, position: { x: 0, y: 0, z: 0 }, angle: 0 };
  const game = {
    on: (ev: string, f: never) => {
      if (ev === 'subcommand') onSub = f;
    },
    conn: { onCommand: () => {}, send: () => {} },
    info: null,
    players: new Map([[0, self]]),
    self,
    selfId: 0,
    active: true,
    sendSubcommand: (sub: number, body: Uint8Array) => sent.push([sub, body]),
    sendImposeHold: (frames: number, particle: number, x: number, z: number, r2: number) => holds.push([frames, particle, x, z, r2]),
    sendReleaseHold: () => (releases += 1),
  } as unknown as Game;
  const inv = (h: string, id: number): InventoryItem => ({ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { ...itemFromHex(h), id } });
  const ch = { meseta: 0, inventory: [inv('030000000005000000000000', 0x10)], techLevels: [], stats: {} } as unknown as CharacterFile;
  const items = new GameItems(game, { character: () => ch, fullCharacter: () => null } as never);
  const added: FloorItem[] = [];
  const picked: Array<[number, number]> = [];
  items.onFloorItemAdded = (it) => added.push(it);
  items.onPickedUp = (it, p) => picked.push([it.id, p]);
  const holdsOn: number[] = [];
  let released = 0;
  items.onDropHold = (f) => holdsOn.push(f);
  items.onDropRelease = () => (released += 1);
  items.dropSearch = (me) => new DropSearch(me, { ground: () => 2, wallBlocks: () => false });
  items.drop(0x10);
  eq([holds, holdsOn, sent.length], [[[900, 0, 0, 0, 0]], [900], 0], '6x2C hold at the player; nothing sent until the spot');
  items.tickDrops();
  const b = new DataView(sent[0][1].buffer, sent[0][1].byteOffset);
  eq([sent[0][0], b.getUint16(0, true), b.getFloat32(8, true), b.getFloat32(12, true), b.getFloat32(16, true)], [0x2a, 5, 0, 8, 6], '6x2A: the stack count and the spot (ground + 6)');
  eq([added[0].x, added[0].y, added[0].z], [0, 8, 6], 'our floor item at the spot');
  eq([releases, released], [1, 1], '6x2D after the 6x2A');
  // 6x59 {picker, floor, item id}
  const p = new Uint8Array(0x0c);
  const pv = new DataView(p.buffer);
  pv.setUint16(4, 0, true);
  pv.setUint16(6, 1, true);
  pv.setUint32(8, 0x10, true);
  onSub(0x59, 0, p);
  eq(picked, [[0x10, 0]], 'pickup hook with the picker');

  // RequestItemPickup_005c49ec / UpdateGroundItem_005c4010: one request at a
  // time per item, released after 900 frames.
  const fi: FloorItem = { id: 0x20, floor: 1, x: 0, z: 0, data: { ...itemFromHex('030000000001000000000000'), id: 0x20 }, source: 'enemy', entityIndex: 0xffff };
  sent.length = 0;
  items.pickUp(fi);
  items.pickUp(fi);
  eq(sent.filter((x) => x[0] === 0x5a).length, 1, 'a pending pickup ignores new requests');
  for (let i = 0; i < PICKUP_LOCK_FRAMES; i++) items.tickPickups();
  items.pickUp(fi);
  eq(sent.filter((x) => x[0] === 0x5a).length, 1, 'still locked after 900 ticks');
  items.tickPickups();
  items.pickUp(fi);
  eq(sent.filter((x) => x[0] === 0x5a).length, 2, 'the lock lets go on the 901st frame');
  // The answer (6x59) releases it at once.
  const ans = new Uint8Array(0x0c);
  const av = new DataView(ans.buffer);
  av.setUint16(4, 0, true);
  av.setUint16(6, 1, true);
  av.setUint32(8, 0x20, true);
  onSub(0x59, 0, ans);
  eq(items.pickupLock.has(0x20), false, '6x59 clears the lock');

  // No spot: nothing is sent, no release, the item stays ours (the hold runs down).
  ch.inventory.length = 0;
  ch.inventory.push(inv('030000000005000000000000', 0x11));
  items.dropSearch = (me) => new DropSearch(me, { ground: () => null, wallBlocks: () => false });
  sent.length = 0;
  items.drop(0x11);
  for (let i = 0; i < 70; i++) items.tickDrops();
  eq([sent.length, releases, holds.length, ch.inventory.some((i) => i.data.id === 0x11)], [0, 1, 2, true], 'no spot: no 6x2A, no 6x2D, the item stays');
}

// --- can_pickup_item ---
{
  const mk = (h: string, id: number): InventoryItem => ({ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { ...itemFromHex(h), id } });
  const mate = (n: number) => itemFromHex(`0300000000${n.toString(16).padStart(2, '0')}000000000000`);
  const c = { meseta: 0, inventory: [mk('030000000005000000000000', 1)] } as unknown as CharacterFile;
  eq(canPickUp(c, mate(5)), true, 'a stack with room (5 + 5 <= 10)');
  eq(canPickUp(c, mate(6)), false, 'a stack without room');
  c.inventory = Array.from({ length: 30 }, (_, i) => mk('000100000000000000000000', i + 1));
  eq(canPickUp(c, itemFromHex('000200000000000000000000')), false, 'a full inventory takes no weapon');
  c.inventory[0] = mk('030000000001000000000000', 99);
  eq(canPickUp(c, mate(1)), true, 'but a stack it has room for');
  c.meseta = 999999;
  eq(canPickUp(c, itemFromHex('040000000000000000000000')), false, 'meseta at the cap');
  c.meseta = 999998;
  eq(canPickUp(c, itemFromHex('040000000000000000000000')), true, 'meseta below the cap');
}

if (failures) {
  console.log(`drops: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('drops: all checks passed');

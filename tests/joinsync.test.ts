// Join sync tables and commands (net/joinsync.ts): the saved enemy / object
// tables follow 6x0A / 6x0B / 6x5F as in PsoBB.exe, 6x6B / 6x6C / 6x6E / 6x6F
// build in the exe's layout (sizes, header, the 6x6E truncation, the 6x6F
// apply list) and a joiner reads back what the leader had.
// Run: node tests/joinsync.test.ts
import { bc0Decompress } from '../client/src/net/items.ts';
import {
  buildSyncLayout,
  JoinSyncState,
  QUEST_FLAG_APPLY_LIST,
  questFlagGet,
  questFlagSet,
  syncStateData,
} from '../client/src/net/joinsync.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// 1. reset_box_enemy_rare_status: drop ids 0x100 + i (objects), then
// 0x100 + 0xBA0 + i (enemies).
{
  const s = new JoinSyncState();
  check(s.objectDropId(0) === 0x100 && s.objectDropId(0xb9f) === 0xc9f, `object drop ids 0x${s.objectDropId(0).toString(16)}..0x${s.objectDropId(0xb9f).toString(16)}`);
  check(s.enemyDropId(0) === 0xca0 && s.enemyDropId(1) === 0xca1, `enemy drop ids start at 0x${s.enemyDropId(0).toString(16)}`);
  check(s.enemyFlags(5) === 0 && s.objectFlags(5) === 0, 'flags start at zero');
}

// 2. 6x0A / 6x0B / 6x5F into the tables.
{
  const s = new JoinSyncState();
  s.recordEnemyState(3, 0x800 | 0x05, 120, false, true); // sent: full flags
  check(s.enemyFlags(3) === 0x805 && s.enemyDamage(3) === 120, 'sent 6x0A stores flags and damage');
  s.recordEnemyState(3, 0x200 | 0x10, 130, true, true); // received in Ultimate: low 6 bits stay
  check(s.enemyFlags(3) === 0x205, `received 6x0A in Ultimate keeps the low 6 bits (0x${s.enemyFlags(3).toString(16)})`);
  s.recordEnemyState(4, 0x12, 1, true, false);
  check(s.enemyFlags(4) === 0x12, 'received 6x0A elsewhere stores the flags');
  s.recordObjectState(7, 1);
  check(s.objectFlags(7) === 1 && s.objectDropId(7) === 0x107, '6x0B stores the object flags, keeps its drop id');
  s.recordDrop(true, 3);
  check(s.enemyDropId(3) === 0xffff && s.enemyDamage(3) === 130, '6x5F from an enemy: drop id 0xFFFF, damage unchanged');
  s.recordDrop(false, 7);
  check(s.objectDropId(7) === 0xffff && s.objectFlags(7) === 1, '6x5F from a box: drop id 0xFFFF');
}

// 3. 6x6B / 6x6C: header and round trip.
{
  const s = new JoinSyncState();
  s.recordEnemyState(10, 0x800, 77, false, false);
  s.enemyStatus[10 * 12 + 8] = 9; // red buff type
  s.recordObjectState(2, 1);
  const b = s.build6x6B(20);
  check(b[0] === 0x6b && b[1] === 0 && u16(b, 2) === 0, '6x6B extended header');
  check(u32(b, 4) === b.length && b.length % 4 === 0 && u32(b, 4) === ((u32(b, 12) + 8 + 3) & ~3) + 8, `6x6B size ${b.length} = ((compressed + 8 + 3) & ~3) + 8`);
  check(u32(b, 8) === 20 * 12 && bc0Decompress(b.subarray(0x10, 0x10 + u32(b, 12))).length === 240, '6x6B decompressed size = slots * 0x0C');
  const j = new JoinSyncState();
  check(j.apply6x6B(b) === 20 && j.enemyFlags(10) === 0x800 && j.enemyDamage(10) === 77 && j.enemyStatus[10 * 12 + 8] === 9, 'joiner reads 6x6B back');
  const c = s.build6x6C(30);
  check(c[0] === 0x6c && u32(c, 8) === 30 * 4, '6x6C header, objects * 4');
  check(j.apply6x6C(c) === 30 && j.objectFlags(2) === 1 && j.objectDropId(29) === 0x100 + 29, 'joiner reads 6x6C back');
}

// 4. 6x6E: CollectMapObjectAndMonsterFlags / AggregateMapEventIds /
// CopyFloorSwitchesBitmap, the size fields and the lost last 8 switch bytes.
{
  const s = new JoinSyncState();
  const counts = { objects: 5, enemySets: 4, enemySlots: 9, events: 3 };
  s.objectSetFlags[1] = 0x12; // constructed (0x10) + built (2, masked)
  s.enemySetFlags[2] = 0x0a; // dead + built
  s.eventFlags[0] = 0x1c;
  s.eventFlags[2] = 0x06; // active + handler built
  s.setSwitchFlag(1, 7, true);
  s.setSwitchFlag(0x11, 0xff, true); // in the last 8 bytes
  const { buffer, size } = s.build6x6EData(counts);
  const entity = (5 + 4) * 2 + 0x10;
  check(u16(buffer, 0) === size && size === entity + 6 + 0x240, `6x6E total size 0x${size.toString(16)} = entity + events + switches`);
  check(u16(buffer, 2) === entity && u16(buffer, 4) === 6 && u16(buffer, 6) === 0x240, 'section sizes');
  check(u32(buffer, 8) === 0x10 && u32(buffer, 12) === 5 && u32(buffer, 16) === 5 * 2 + 0x10 && u32(buffer, 20) === 4, 'entity set flags header {0x10, objects, objects * 2 + 0x10, enemy sets}');
  check(u16(buffer, 8 + 0x10 + 2) === 0x10 && u16(buffer, 8 + 0x10 + 10 + 4) === 0x08, 'flag 2 masked out of object and enemy set flags');
  check(u16(buffer, 8 + entity) === 0x1c && u16(buffer, 8 + entity + 4) === 0x04, 'event flags in file order, flag 2 masked');
  const cmd = s.build6x6E(counts);
  const data = syncStateData(cmd)!;
  check(u32(cmd, 8) === size && data.length === size, 'compressed from the buffer start for `total size` bytes (the 8-byte head pushes 8 switch bytes out)');
  const j = new JoinSyncState();
  check(j.apply6x6E(cmd), 'joiner applies 6x6E');
  check(j.objectSetFlags[1] === 0x10 && j.enemySetFlags[2] === 0x08 && j.eventFlags[0] === 0x1c && j.eventFlags[2] === 0x04, 'joiner reads set and event flags back');
  check(j.switchFlag(1, 7) && !j.switchFlag(0x11, 0xff), 'switch flag 7 of floor 1 arrives; the last 8 bytes do not');
  check(j.received.enemySets === 4 && j.received.events === 3, 'received counts');
}

// 5. 6x6F and the apply list (0x00969c60).
{
  check(QUEST_FLAG_APPLY_LIST.length === 282 && QUEST_FLAG_APPLY_LIST[0] === 10 && QUEST_FLAG_APPLY_LIST.at(-1) === 708, `apply list: ${QUEST_FLAG_APPLY_LIST.length} flags, 10..708`);
  const s = new JoinSyncState();
  questFlagSet(s.questFlags, 0, 10, true);
  questFlagSet(s.questFlags, 2, 0x2c, true); // Vol Opt seal lamp flag, in the list
  questFlagSet(s.questFlags, 1, 9, true); // not in the list
  const f = s.build6x6F();
  check(f.length === 0x208 && f[0] === 0x6f && f[1] === 0x82 && u32(f, 0x204) === 1, '6x6F {6F, 82, ...}, 0x200 bytes, use_apply_mask 1');
  check(f[4] === 0x00 && f[4 + 1] === 0x20, 'flag 10 at byte 1, bit 0x80 >> 2 (MSB first)');
  const j = new JoinSyncState();
  questFlagSet(j.questFlags, 3, 0x2ff, true); // own flag outside the list
  j.apply6x6F(f);
  check(questFlagGet(j.questFlags, 0, 10) && questFlagGet(j.questFlags, 2, 0x2c), 'listed flags copied (every difficulty)');
  check(!questFlagGet(j.questFlags, 1, 9) && questFlagGet(j.questFlags, 3, 0x2ff), 'flags outside the list keep the joiner value');
  const all = f.slice();
  all[0x204] = 0;
  j.apply6x6F(all);
  check(questFlagGet(j.questFlags, 1, 9) && !questFlagGet(j.questFlags, 3, 0x2ff), 'without the mask the whole table is copied');
}

// 6. Layout bases.
{
  const L = buildSyncLayout([
    { floor: 0, objects: [{ section: 0, group: 0 }, { section: 1, group: 0 }], setFirstSlots: [0, 1], enemySlots: 3, eventIds: [] },
    { floor: 1, objects: [{ section: 2, group: 1 }], setFirstSlots: [0], enemySlots: 31, eventIds: [100, 101] },
    { floor: 2, objects: [], setFirstSlots: [], enemySlots: 0, eventIds: [5] },
  ]);
  const f1 = L.floors[1];
  check(f1.objectBase === 2 && f1.enemySetBase === 2 && f1.enemySlotBase === 3 && f1.eventBase === 0 && L.floors[2].eventBase === 2, 'per-floor bases');
  check(L.counts.objects === 3 && L.counts.enemySets === 3 && L.counts.enemySlots === 34 && L.counts.events === 3, 'game-wide counts');
}

console.log(failures ? `${failures} failures` : 'join sync: all checks passed');
process.exit(failures ? 1 : 0);

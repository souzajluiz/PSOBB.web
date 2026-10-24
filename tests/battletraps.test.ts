// Battle Mode traps (client/src/quest/battletraps.ts): the 6x83 / 6x80 subcommand
// layouts (also the builders in battle.ts), the trap effect table, the counters, the
// placement and the arm / fuse / blast state machine, the chain hit, the hit report,
// the kill rule and the respawn pick. Pure, no network.
//
// Run: node tests/battletraps.test.ts
import { build6x80, build6x83, trapNumber as battleTrapNumber } from '../client/src/quest/battle.ts';
import { STATUS } from '../client/src/combat/status.ts';
import {
  BattleTrap, TRAP_BLAST_RADIUS, TRAP_CHAIN_FUSE, TRAP_EFFECTS, TrapCounters, TrapField, hitReport, killCounts, parse6x80,
  parse6x83, pickRespawn, trapAnnouncement, trapDamage, trapNumber, trapVisible, placeRequest, trapPaletteType,
  TRAP_GATE_ADDRESS, TRAP_GATE_VALUE, TRAP_DEATH_PARTICLE, trapDrawn, trapModelParts, trapRevealed, TRAP_REVEAL_RANGE_SQ,
  type PlaceContext, type TrapTarget,
} from '../client/src/quest/battletraps.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const ctx = (over: Partial<PlaceContext> = {}): PlaceContext => ({
  floor: 3, gate: TRAP_GATE_VALUE, bossMap: false, fieldMap: true, ownerFloor: 3, ownerPos: { x: 0, y: 0, z: 0 }, ownerAngle: 0, ...over,
});
const tgt = (over: Partial<TrapTarget>): TrapTarget => ({ id: 1, x: 0, z: 0, floor: 3, dead: false, local: false, ...over });

// --- 6x83 / 6x80 layouts -------------------------------------------------------
{
  // The 8-byte subcommand: 0x83, size 2, client id, type, count (exe: handle_packet0x60_subcommand0x83).
  const b = build6x83(2, 3, 5);
  eq(Array.from(b), [0x83, 2, 2, 0, 3, 0, 5, 0], '6x83 bytes');
  eq(parse6x83(b), { clientId: 2, type: 3, count: 5 }, '6x83 parse round trip');
  eq(parse6x83(new Uint8Array([0x80, 2, 0, 0, 0, 0, 0, 0])), null, '6x83 rejects another subcommand id');
  eq(parse6x83(new Uint8Array(4)), null, '6x83 short body');
  // A negative count is refused by the exe's validator (count >= 0); the parse keeps it signed.
  eq(parse6x83(build6x83(1, 0, -1))?.count, -1, '6x83 count is signed');
  // 6x80: trap number at +4, what at +6 (exe: handle_packet0x60_subcommand0x80).
  const c = build6x80(4, 0x1234, 2);
  eq(Array.from(c), [0x80, 2, 4, 0, 0x34, 0x12, 2, 0], '6x80 bytes');
  eq(parse6x80(c), { trapNumber: 0x1234, what: 2 }, '6x80 parse round trip');
  eq(parse6x80(build6x83(1, 0, 1)), null, '6x80 rejects another subcommand id');
}

// --- trap numbers and the effect table -----------------------------------------
{
  eq(trapNumber(2, 3, 5), 2 * 0x50 + 3 * 0x14 + 5, 'trap number formula');
  eq(trapNumber(2, 3, 5), battleTrapNumber(2, 3, 5), 'trap number matches battle.ts');
  // Internal types: 0 damage, 1 freeze, 2 slow, 3 confusion (newserv's remap of the quest args).
  eq(TRAP_EFFECTS[0], { kind: 'damage' }, 'type 0 is damage');
  eq(TRAP_EFFECTS[1], { kind: 'status', status: STATUS.freeze }, 'type 1 is freeze');
  eq(TRAP_EFFECTS[2], { kind: 'status', status: STATUS.slow }, 'type 2 is slow');
  eq(TRAP_EFFECTS[3], { kind: 'status', status: STATUS.confusion }, 'type 3 is confusion');
}

// --- counters -------------------------------------------------------------------
{
  const k = new TrapCounters();
  k.setFromRules([2, 0, 25, -4]);
  eq(k.n, [2, 0, 20, 0], 'rule counts clamp to 0..20');
  eq(placeRequest(k, 0, true), { clientId: -1, type: 0, count: 2 }, 'palette sends the count before the decrement');
  eq(placeRequest(k, 1, true), null, 'no stock, no request');
  eq(placeRequest(k, 0, false), null, 'cannot act, no request');
  eq(placeRequest(k, 9, true), null, 'bad type, no request');
  k.n[0] = 0x21;
  eq(k.get(0), 0, 'out of range count reads as 0 and is reset');
  eq(k.decrement(2), true, 'decrement with stock');
  eq(k.n[2], 19, 'decrement lowers the count');
  k.n[1] = 0;
  eq(k.decrement(1), false, 'decrement at zero stays at zero');
  eq(k.n[1], 0, 'stock is not negative');
}

// --- placement ------------------------------------------------------------------
{
  const f = new TrapField();
  const k = new TrapCounters();
  k.setFromRules([1, 1, 1, 1]);
  const t = f.place({ clientId: 2, type: 0, count: 1 }, ctx(), k);
  check(t !== null, 'placed a trap');
  eq(t?.number, trapNumber(2, 0, 1), 'placed trap number');
  eq(k.n[0], 0, 'owner counter decremented once');
  // The handler does not check the stock: a count 0 placement is accepted, the counter stays at 0.
  const t0 = f.place({ clientId: 2, type: 0, count: 0 }, ctx(), k);
  check(t0 !== null, 'count 0 placement accepted by the handler');
  eq(k.n[0], 0, 'decrement at zero stays at zero');
  eq(f.place({ clientId: 2, type: 4, count: 1 }, ctx(), k), null, 'type out of 0..3 refused');
  eq(f.place({ clientId: 2, type: 0, count: -1 }, ctx(), k), null, 'negative count refused');
  eq(f.place({ clientId: 2, type: 0, count: 1 }, ctx({ ownerFloor: 4 }), k), null, 'owner on another floor refused');
  eq(f.place({ clientId: 2, type: 0, count: 1 }, ctx({ bossMap: true }), k), null, 'boss map refused');
  eq(f.place({ clientId: 2, type: 0, count: 1 }, ctx({ fieldMap: false }), k), null, 'lobby refused');
  eq(f.traps.length, 2, 'only the accepted placements are kept');
}

// --- the state machine -----------------------------------------------------------
{
  // Arming: the delay counts down, then a player in the trigger radius stuns the trap.
  const f = new TrapField();
  const k = new TrapCounters();
  k.setFromRules([1, 0, 0, 0]);
  const t = f.place({ clientId: 1, type: 0, count: 1 }, ctx(), k)!;
  t.delay = 2;
  const near = [tgt({ id: 2, x: 10, z: 0 })];
  f.tick(near, { trapsHitOwner: false });
  eq(t.state, 0, 'still arming (delay 2 -> 1)');
  f.tick(near, { trapsHitOwner: false });
  eq(t.state, 0, 'still arming (delay 1 -> 0)');
  f.tick(near, { trapsHitOwner: false });
  eq(t.state, 3, 'stunned by a player within the trigger radius');
}
{
  // The owner is ignored unless trapsHitOwner.
  const f = new TrapField();
  const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t.delay = 0;
  f['traps'].push(t);
  f.tick([tgt({ id: 1, x: 0, z: 0 })], { trapsHitOwner: false });
  eq(t.state, 0, 'owner does not trigger its own trap');
  f.tick([tgt({ id: 1, x: 0, z: 0 })], { trapsHitOwner: true });
  eq(t.state, 3, 'owner triggers when the rule allows it');
}
{
  // Fuse: counts down from 0x1e; at a negative value it blasts and asks for 6x80 what 2.
  const f = new TrapField();
  const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t.state = 3;
  t.fuse = 0;
  f['traps'].push(t);
  f.tick([], { trapsHitOwner: false });
  eq(t.state, 3, 'fuse 0 is not yet negative');
  const ev = f.tick([], { trapsHitOwner: false });
  eq(ev.map((e) => e.kind), ['send80'], 'negative fuse sends 6x80');
  eq(t.state, 4, 'state 4 after the fuse');
}
{
  // Blast: a local player in range gets the hit once and the trap announces itself once.
  const f = new TrapField();
  const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t.state = 4;
  f['traps'].push(t);
  const inRange = tgt({ id: 2, x: TRAP_BLAST_RADIUS - 1, z: 0, local: true });
  const ev = f.tick([inRange], { trapsHitOwner: false });
  eq(ev.map((e) => e.kind), ['hit', 'announce', 'burst'], 'blast hits, announces, bursts');
  eq(f.traps.length, 0, 'the spent trap is removed');
}
{
  // A remote player in range is not hit locally (its own client applies the effect).
  const f = new TrapField();
  const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t.state = 4;
  f['traps'].push(t);
  const ev = f.tick([tgt({ id: 2, x: 1, z: 1, local: false })], { trapsHitOwner: false });
  check(!ev.some((e) => e.kind === 'hit'), 'remote player gets no local hit');
}
{
  // Chain: a state 0 trap in the blast is stunned and its fuse is capped at 0xf.
  const f = new TrapField();
  const blast = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  blast.state = 4;
  const other = new BattleTrap(2, 1, 1, 5, 0, 0, 3, 0);
  other.fuse = 0x1e;
  other.delay = 999;
  f['traps'].push(other, blast); // the chained trap is ticked first, so the blast's stun is the last word
  f.tick([], { trapsHitOwner: false });
  eq(other.state, 3, 'chained trap is stunned');
  eq(other.fuse, TRAP_CHAIN_FUSE, 'chained trap fuse capped at 0xf');
}
{
  // Chain: a state 3 trap in the blast goes to state 4 at once and sends its own 6x80.
  const f = new TrapField();
  const blast = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  blast.state = 4;
  const other = new BattleTrap(2, 1, 1, 5, 0, 0, 3, 0);
  other.state = 3;
  other.fuse = 10;
  f['traps'].push(other, blast); // the chained trap is ticked first, so the blast's stun is the last word
  const ev = f.tick([], { trapsHitOwner: false });
  check(ev.some((e) => e.kind === 'send80' && e.trap === other && e.what === 2), 'state 3 chain sends 6x80 what 2');
  eq(other.state, 4, 'state 3 chain goes to state 4');
}
{
  // 6x80 from a remote client: what 1 stuns a state 0 trap, what 2 detonates a state 3 trap.
  const f = new TrapField();
  const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  f['traps'].push(t);
  f.receiveCall({ trapNumber: t.number, what: 1 });
  eq(t.state, 3, '6x80 what 1 stuns');
  f.receiveCall({ trapNumber: t.number, what: 2 });
  eq(t.state, 4, '6x80 what 2 detonates a stunned trap');
  f.receiveCall({ trapNumber: 0xffff, what: 2 });
  eq(f.traps.length, 1, 'unknown trap number is ignored');
}

// --- the rest of the rules --------------------------------------------------------
{
  eq(trapVisible(new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0), 2, true, false), true, 'trap vision shows others');
  eq(trapVisible(new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0), 2, false, false), false, 'no vision, no trap');
  eq(trapVisible(new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0), 1, false, true), true, 'owner sees own trap when shown');
  eq(trapAnnouncement('Ann'), '\tC4Ann TRAP', 'announcement text');
  eq(trapDamage(700, 0), 700 * 0.002 * 100, 'damage with EFR 0 (ASSUMED formula)');
  eq(hitReport('trap', 3, 9), { attacker: 3, send6x8F: true }, 'trap hit is credited to its owner');
  eq(hitReport('enemy', null, 9), { attacker: null, send6x8F: false }, 'enemy hit is not scored');
  eq(hitReport('player', null, 9), { attacker: 9, send6x8F: true }, 'player hit is scored');
  eq(killCounts(true, 1, 1), false, 'no kill score for a teammate with teams on');
  eq(killCounts(true, 1, 2), true, 'kill score across teams');
  eq(killCounts(false, 1, 1), true, 'kill score with teams off');
}
{
  // The respawn pick: at most 5 candidates; the index is ROUND(count * rnd / 32768 * 0.99).
  const pts = Array.from({ length: 7 }, (_, i) => ({ x: i, y: 0, z: 0, angle: 0 }));
  eq(pickRespawn(pts, 0)?.x, 0, 'raw 0 picks the first candidate');
  eq(pickRespawn(pts, 32767)?.x ?? null, null, 'raw max rounds past the 5-entry list: stays where it died');
  eq(pickRespawn(pts, 16384)?.x, 2, 'raw half: 5 * 0.5 * 0.99 = 2.475 rounds to 2');
  eq(pickRespawn(pts.slice(0, 2), 32767)?.x ?? null, null, 'two candidates, high roll: 2 * 0.99 rounds to 2, past the list');
  eq(pickRespawn([], 100), null, 'no candidates');
}

{
  // The palette slot that places a trap: group 2 0x0d..0x10 -> type 0..3 (HandlePaletteInput
  // jump table 0x0093c5c0, entries 0x0d..0x10 push 0..3 then call 0x006959c0).
  eq([0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11].map(trapPaletteType), [null, 0, 1, 2, 3, null], 'palette group 2 to trap type');
}

{
  // The client's placement body (the payload after the 4-byte header, as sendSubcommand writes it)
  // and the receiver's parse: the sender's count is the one before the decrement.
  const counters = new TrapCounters();
  counters.setFromRules([0, 2, 0, 0]);
  const req = placeRequest(counters, 1, true);
  eq(req && req.count, 2, 'palette press sends the stock before the decrement');
  const body = build6x83(5, 1, 2);
  const payload = body.subarray(4);
  eq([...payload], [1, 0, 2, 0], 'payload: type 1, count 2 (little-endian i16)');
  const parsed = parse6x83(build6x83(5, 1, 2));
  eq(parsed && [parsed.clientId, parsed.type, parsed.count], [5, 1, 2], 'receiver parses the 6x83 sender and fields');
  const cleared = new TrapCounters();
  cleared.setFromRules([0, 0, 0, 0]);
  eq(placeRequest(cleared, 0, true), null, 'no stock: no placement request');
  const field = new TrapField();
  eq(field.place({ clientId: 1, type: 0, count: 0x15 }, ctx(), new TrapCounters()), null, 'a count of 0x15 is refused (safe_create)');
  check(field.place({ clientId: 1, type: 0, count: 0x14 }, ctx(), new TrapCounters()) !== null, 'a count of 0x14 is placed');
}

// The gate of safe_create_trap_object and the trap constructor: the global at 0x009f9860 must be 1.
{
  eq(TRAP_GATE_ADDRESS, 0x009f9860, 'gate address');
  eq(TRAP_GATE_VALUE, 1, 'gate value');
  const field = new TrapField();
  const k = new TrapCounters();
  eq(field.place({ clientId: 1, type: 0, count: 1 }, ctx({ gate: 0 }), k), null, 'gate 0 refused');
  eq(field.place({ clientId: 1, type: 0, count: 1 }, ctx({ gate: 2 }), k), null, 'gate 2 refused');
  eq(field.traps.length, 0, 'nothing placed while the gate is shut');
  eq(k.n[0], 0, 'the stock is not decremented while the gate is shut');
  check(field.place({ clientId: 1, type: 0, count: 1 }, ctx({ gate: TRAP_GATE_VALUE }), k) !== null, 'gate 1 places');
}

// The trap model and its draw state (EnemyDraw_0062e014 draws only at +0x32e == 3).
{
  eq(trapModelParts(0), { primary: 4, secondary: 1 }, 'damage trap model chunks');
  eq(trapModelParts(1), { primary: 4, secondary: 1 }, 'freeze trap model chunks');
  eq(trapModelParts(2), { primary: 5, secondary: 0 }, 'slow trap model chunks');
  eq(trapModelParts(3), { primary: 5, secondary: 0 }, 'confusion trap model chunks');
  eq(TRAP_DEATH_PARTICLE, 0x47, 'death particle');
  const f = new TrapField();
  const t = f.place({ clientId: 1, type: 0, count: 1 }, ctx(), new TrapCounters())!;
  check(!trapDrawn(t), 'an armed trap (state 0) is not drawn');
  t.state = 3;
  check(trapDrawn(t), 'a trap in the fuse state (3) is drawn');
  t.state = 4;
  check(!trapDrawn(t), 'a trap in the blast state is not drawn');
}

// --- the reveal to the owner (TrapProcessHitbox_0062ea74) ---------------------------
{
  const owner = (over: Partial<TrapTarget> = {}): TrapTarget => tgt({ id: 2, x: 0, z: 0, trapVision: true, challengeOne: true, ...over });
  const trap = () => new BattleTrap(2, 0, 1, 0, 0, 0, 3, 0);
  eq(TRAP_REVEAL_RANGE_SQ, 40000, 'g_TrapHitboxRangeSq is 40000 (exe 0x00932bc0)');
  eq(trapRevealed(trap(), owner(), false), true, 'owner with vision and challenge 1 on the trap reveals it');
  eq(trapRevealed(trap(), owner({ trapVision: false }), false), false, 'no vision bit: no reveal');
  eq(trapRevealed(trap(), owner({ challengeOne: false }), false), false, 'challenge word other than 1: no reveal');
  eq(trapRevealed(trap(), undefined, false), false, 'owner not in the game: no reveal');
  eq(trapRevealed(trap(), owner({ x: 200, z: 0 }), false), true, 'distance squared equal to the range is in reach');
  eq(trapRevealed(trap(), owner({ x: 201, z: 0 }), false), false, 'beyond the range and another room: no reveal');
  eq(trapRevealed(trap(), owner({ x: 201, z: 0 }), true), true, 'beyond the range but in the same room: reveal');

  // The field's tick sets the hitbox to 2 once, and only for the owner's checks.
  const field = new TrapField();
  const placed = field.place({ clientId: 2, type: 0, count: 1 }, ctx({ ownerPos: { x: 0, y: 0, z: 0 }, ownerAngle: 0 }), new TrapCounters());
  check(placed !== null && placed.hitbox === 0, 'a placed trap starts hidden (hitbox 0)');
  field.tick([owner({ x: 500, z: 0 })], { trapsHitOwner: false });
  eq(placed?.hitbox, 0, 'a far owner (no room data) does not reveal the trap');
  field.tick([owner({ x: 10, z: 0 })], { trapsHitOwner: false });
  eq(placed?.hitbox, 2, 'the owner within range reveals the trap on the tick');
  field.tick([owner({ x: 10, z: 0, trapVision: false })], { trapsHitOwner: false });
  eq(placed?.hitbox, 2, 'the reveal is sticky (nothing hides it again)');
  const roomField = new TrapField();
  const roomTrap = roomField.place({ clientId: 2, type: 1, count: 1 }, ctx({ ownerPos: { x: 0, y: 0, z: 0 }, ownerAngle: 0 }), new TrapCounters());
  roomField.tick([owner({ x: 900, z: 0 })], { trapsHitOwner: false, sameRoom: () => true });
  eq(roomTrap?.hitbox, 2, 'the same room reveals the trap beyond the range');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

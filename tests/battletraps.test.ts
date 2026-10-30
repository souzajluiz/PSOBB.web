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
  parse6x83, pickRespawn, respawnCandidates, respawnTarget, RESPAWN_PLAYER_DISTANCE_SQ, trapAnnouncement, trapDamage, trapNumber, trapVisible, placeRequest, trapPaletteType,
  TRAP_GATE_ADDRESS, TRAP_GATE_VALUE, TRAP_DEATH_PARTICLE, trapDrawn, trapModelParts, trapRevealed, TRAP_REVEAL_RANGE_SQ,
  MAP_ACTION_PERMISSION, TRAP_ACTION_PERMISSION, TRAP_ARM_FRAMES, TRAP_FUSE_FRAMES, TRAP_TRIGGER_RADIUS,
  trapPlacePermitted, triggerSkipsOwner, blastRoomMatch, challengeFlagValue,
  TRAP_ULTIMATE_ARM_FRAMES, TRAP_ULTIMATE_BLAST_RADIUS, DIFFICULTY_ULTIMATE,
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
  // trap_is_primed_and_has_target (dump 492890..492898, VERIFIED): the owner is skipped only when the rule
  // is off AND is_value_less_than_2(g_Pioneer2MapInitData) is non-zero (byte 1). The port's byte is 0 in a
  // battle (ASSUMED), so the owner triggers its own trap whatever g_BATrapsCanTargetOwnerPlayer is.
  eq(triggerSkipsOwner(false, 0), false, 'byte 0: the owner is not skipped with the rule off');
  eq(triggerSkipsOwner(false, 1), true, 'byte 1 and the rule off: the owner is skipped');
  eq(triggerSkipsOwner(true, 1), false, 'byte 1 and the rule on: the owner is not skipped');
  const f = new TrapField();
  const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t.delay = 0;
  f['traps'].push(t);
  f.tick([tgt({ id: 1, x: 0, z: 0 })], { trapsHitOwner: false });
  eq(t.state, 3, 'battle (byte 0): the owner triggers its own trap with the rule off');
  const g = new TrapField();
  const t2 = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t2.delay = 0;
  g['traps'].push(t2);
  g.tick([tgt({ id: 1, x: 0, z: 0 })], { trapsHitOwner: false, challengeFlag: 1 });
  eq(t2.state, 0, 'challenge byte 1 with the rule off: the owner does not trigger');
  g.tick([tgt({ id: 1, x: 0, z: 0 })], { trapsHitOwner: true, challengeFlag: 1 });
  eq(t2.state, 3, 'challenge byte 1 with the rule on: the owner triggers');
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
  const ev = f.tick([inRange, tgt({ id: 1, x: 900, z: 900 })], { trapsHitOwner: false });
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
  // The fallback (decompile 2026-10-30): no candidate, or a roll past the list, sends the own pose.
  const own = { x: 7, y: 1, z: 9, angle: 1.5 };
  const sp = [{ x: 0, y: 0, z: 0, angle: 0 }];
  const t1 = respawnTarget(sp, [{ x: 0, z: 0 }], 100, own);
  eq([t1.fallback, t1.spawn.x, t1.spawn.z, t1.spawn.angle], [true, 7, 9, 1.5], 'every spawn taken: own position and angle');
  eq(respawnTarget([], [], 0, own).fallback, true, 'no spawns on the floor: fallback');
  eq(respawnTarget(sp, [], 32767, own).fallback, true, 'roll past the list (1 * 0.99 rounds to 1): fallback');
  const t2 = respawnTarget(sp, [], 0, own);
  eq([t2.fallback, t2.spawn.x], [false, 0], 'a free spawn, low roll: the spawn');
}
{
  // SendTeleportRequestToPlayer (0x00695444), VERIFIED 2026-10-30: a spawn is skipped when a player
  // other than the respawning one is within the distance (0x007a9180 = dx^2 + dz^2, no y; the
  // compare at 0x006954f2's jump is `fVar6 < _DAT_0093c68c`, 0x0093c68c = 2500.0, so the skip is strict).
  eq(RESPAWN_PLAYER_DISTANCE_SQ, 2500, 'the respawn distance is 50 (squared 2500, 0x0093c68c)');
  const spawn = (x: number, y: number, z: number) => ({ x, y, z, angle: 0 });
  const pts = [spawn(0, 0, 0), spawn(100, 0, 0), spawn(0, 0, 100)];
  eq(respawnCandidates(pts, [{ x: 0, z: 49.9 }]).map((p) => [p.x, p.z]), [[100, 0], [0, 100]], 'a player 49.9 from spawn 0 skips it (dist^2 < 2500)');
  eq(respawnCandidates(pts, [{ x: 0, z: 50 }]).length, 3, 'a player exactly 50 away does not skip (strict <)');
  eq(respawnCandidates(pts, [{ x: 30, z: 39 }]).map((p) => [p.x, p.z]), [[100, 0], [0, 100]], 'the diagonal (30, 39), dist^2 2421, skips spawn 0');
  eq(respawnCandidates([spawn(0, 0, 0)], [{ x: 0, z: 0 }]).length, 0, 'a player on the spawn skips it');
  eq(respawnCandidates([spawn(0, 500, 0)], [{ x: 0, z: 0 }]).length, 0, 'only x and z count: a spawn 500 up at the player xz is skipped');
  const many = Array.from({ length: 9 }, (_, i) => spawn(i * 1000, 0, 0));
  eq(respawnCandidates(many, []).map((p) => p.x), [0, 1000, 2000, 3000, 4000], 'the first 5 spawns in list order');
  eq(respawnCandidates(many, [{ x: 0, z: 0 }, { x: 2000, z: 0 }]).map((p) => p.x), [1000, 3000, 4000, 5000, 6000], 'skips in list order, still 5 at most');
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

// --- the placing permission and the constructor's constants (2026-10-24) ----------
{
  // map_action_permission_levels[48] (.data 0x00a10160): the 0x83 row's perm 0x6 is refused only by 15 and 47.
  eq(MAP_ACTION_PERMISSION.length, 48, 'the permission table has one byte per map (48)');
  eq(TRAP_ACTION_PERMISSION, 0x06, 'the 0x83 row permission is 0x06 (table row 95)');
  const refused = MAP_ACTION_PERMISSION.map((_, i) => i).filter((i) => !trapPlacePermitted(i));
  eq(refused, [15, 47], 'only maps 15 and 47 refuse the trap placement');
  check(trapPlacePermitted(16) && trapPlacePermitted(17), 'the battle arena maps 16 and 17 permit it');
  check(trapPlacePermitted(0x2c), 'Saint-Milion (0x2c) permits it');
  check(!trapPlacePermitted(-1) && !trapPlacePermitted(48) && !trapPlacePermitted(1.5), 'out-of-range or non-integer maps refuse');
  // trap_constructor's stores (dump 492906..493000): arm 0x96, fuse 0x1e, trigger and blast 50.0.
  eq([TRAP_ARM_FRAMES, TRAP_FUSE_FRAMES, TRAP_TRIGGER_RADIUS, TRAP_BLAST_RADIUS], [0x96, 0x1e, 50, 50], 'the constructor stores 0x96, 0x1e, 50, 50');
}

// --- the receive gate (2026-10-24): the 0x83 row is checked on the receiving client's map -----
{
  // TeamQuest_ProcessSubcommands (dump 815369) runs the remote handler only when the map permits; map 15
  // and 47 refuse. A refused remote 6x83 places nothing and decrements nothing (the handler never runs).
  const f = new TrapField();
  const k = new TrapCounters();
  k.setFromRules([2, 2, 2, 2]);
  eq(f.place({ clientId: 2, type: 0, count: 2 }, ctx({ map: 15 }), k), null, 'remote 6x83 on map 15 is not placed');
  eq(f.place({ clientId: 2, type: 0, count: 2 }, ctx({ map: 47 }), k), null, 'remote 6x83 on map 47 is not placed');
  eq(k.n[0], 2, 'a refused placement does not decrement the owner counter');
  check(f.place({ clientId: 2, type: 0, count: 2 }, ctx({ map: 16 }), k) !== null, 'remote 6x83 on map 16 is placed');
  eq(k.n[0], 1, 'an accepted placement decrements once');
  check(f.place({ clientId: 2, type: 0, count: 2 }, ctx(), k) !== null, 'no map given: no permission gate (test default)');
}

// --- the Ultimate branch of trap_constructor (dump 492994..493002, 2026-10-24) -------------
{
  eq(DIFFICULTY_ULTIMATE, 3, 'difficulty_level ultimate = 3');
  eq(challengeFlagValue(1), 1, 'is_value_less_than_2: byte 1 gives 1');
  eq(challengeFlagValue(0), 0, 'is_value_less_than_2: byte 0 gives 0');
  eq(challengeFlagValue(2), 0, 'is_value_less_than_2: byte 2 or more gives 0');
  const f = new TrapField();
  const k = new TrapCounters();
  k.setFromRules([1, 1, 1, 1]);
  const u = f.place({ clientId: 2, type: 0, count: 1 }, ctx({ difficulty: 3 }), k)!;
  eq([u.delay, u.blast, u.ultimate], [TRAP_ULTIMATE_ARM_FRAMES, TRAP_ULTIMATE_BLAST_RADIUS, true], 'Ultimate: arm 0x3c, blast 80, branch taken');
  eq([TRAP_ULTIMATE_ARM_FRAMES, TRAP_ULTIMATE_BLAST_RADIUS], [0x3c, 80], 'Ultimate constants 0x3c and 80.0 (0x42a00000)');
  const n = f.place({ clientId: 2, type: 1, count: 1 }, ctx({ difficulty: 2 }), k)!;
  eq([n.delay, n.blast, n.ultimate], [0x96, 50, false], 'Hard: the normal arm 0x96 and blast 50');
  const c1 = f.place({ clientId: 2, type: 2, count: 1 }, ctx({ difficulty: 3, pioneer2Byte: 1 }), k)!;
  eq([c1.delay, c1.blast, c1.ultimate], [0x96, 50, false], 'Ultimate with the challenge byte 1: no branch');
  const c2 = f.place({ clientId: 2, type: 3, count: 1 }, ctx({ difficulty: 3, pioneer2Byte: 2 }), k)!;
  eq(c2.ultimate, true, 'Ultimate with the challenge byte 2: the branch runs (is_value returns 0)');
  // The Ultimate blast reaches 80 (not 50): a target at 60 is hit by the 80 blast only.
  const ub = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  ub.state = 4;
  ub.blast = TRAP_ULTIMATE_BLAST_RADIUS;
  const fb = new TrapField();
  fb['traps'].push(ub);
  const hitEv = fb.tick([tgt({ id: 2, x: 60, z: 0, local: true })], { trapsHitOwner: false });
  check(hitEv.some((e) => e.kind === 'hit'), 'Ultimate blast (80) reaches a target at 60');
  const sb = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  sb.state = 4;
  const fs = new TrapField();
  fs['traps'].push(sb);
  check(!fs.tick([tgt({ id: 2, x: 60, z: 0, local: true })], { trapsHitOwner: false }).some((e) => e.kind === 'hit'), 'normal blast (50) does not reach 60');
  // The ownerRoom copy (+0x28, +0x2e) and the owner-targeting clear are reported on the trap.
  const r = new TrapField().place({ clientId: 2, type: 0, count: 1 }, ctx({ ownerRoom: { room1: 7, room2: 9 } }), new TrapCounters());
  eq([r?.room1, r?.room2], [7, 9], 'trap keeps the owner room words');
}

// --- the blast's checks (update_trap state 4, dump 492596..492700, 2026-10-24) ---------------
{
  const blastOne = (target: Partial<TrapTarget>, room?: { room1: number; room2: number }) => {
    const f = new TrapField();
    const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
    t.state = 4;
    if (room) {
      t.room1 = room.room1;
      t.room2 = room.room2;
    }
    f['traps'].push(t);
    return f.tick([tgt({ id: 2, x: 1, z: 0, local: true, ...target }), tgt({ id: 1, x: 900, z: 900 })], { trapsHitOwner: false });
  };
  eq(blastOne({ dead: true }).map((e) => e.kind), ['burst'], 'dead player: no hit, no announce (the burst still runs)');
  eq(blastOne({ invulnerable: true }).map((e) => e.kind), ['burst'], 'maybe_invuln player: skipped');
  eq(blastOne({ challengeTwo: true }).map((e) => e.kind), ['announce', 'burst'], '+0x32c == 2: the hit is refused, the announce still runs');
  eq(blastOne({}).map((e) => e.kind), ['hit', 'announce', 'burst'], 'plain local player is hit');
  eq(blastOne({ room1: 5, room2: 6 }, { room1: 1, room2: 2 }).map((e) => e.kind), ['burst'], 'room test: no shared word, no hit, no announce');
  eq(blastOne({ room1: 1, room2: 6 }, { room1: 1, room2: 2 }).map((e) => e.kind), ['hit', 'announce', 'burst'], 'room test: target room_id_1 == trap room_id_1 passes');
  eq(blastOne({ room1: 2, room2: 6 }, { room1: 1, room2: 2 }).map((e) => e.kind), ['hit', 'announce', 'burst'], 'room test: target room_id_1 == trap room_id_2 passes');
  eq(blastOne({ room1: 9, room2: 2 }, { room1: 1, room2: 2 }).map((e) => e.kind), ['hit', 'announce', 'burst'], 'room test: target room_id_2 == trap room_id_2 passes');
  eq(blastOne({}, { room1: 1, room2: 2 }).map((e) => e.kind), ['hit', 'announce', 'burst'], 'no room data on the target: the test passes (ASSUMED)');
  check(blastRoomMatch(new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0), tgt({ room1: 3, room2: 4 })), 'no room data on the trap: the test passes (ASSUMED)');
  // Owner: skipped while the rule is off, as in the range loop.
  const fo = new TrapField();
  const ot = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  ot.state = 4;
  fo['traps'].push(ot);
  eq(fo.tick([tgt({ id: 1, x: 0, z: 0, local: true })], { trapsHitOwner: false }).map((e) => e.kind), ['burst'], 'blast: the owner is skipped with the rule off');
  eq(fo.tick([], { trapsHitOwner: false }).length, 0, 'no further events once the trap is removed');
}

// --- the announce's owner check (Trap_CheckPlayerInBattleAndGetName, dump 492456, 2026-10-25) --------
{
  // The caller stores the function's result in +0x388 and runs it again on each in-range player hit
  // until it returns 1. It returns 0 when the owner's player is gone, so the blast still hits and the
  // announce waits for a later hit with the owner present.
  const f = new TrapField();
  const t = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t.state = 4;
  f['traps'].push(t);
  const hitter = tgt({ id: 2, x: 1, z: 0, local: true });
  const ev1 = f.tick([hitter], { trapsHitOwner: false });
  eq(ev1.map((e) => e.kind), ['hit', 'burst'], 'owner absent: the hit lands, no announce');
  eq(t.announced, false, 'owner absent: the announce flag stays 0 (retried)');
  const t2 = new BattleTrap(1, 0, 1, 0, 0, 0, 3, 0);
  t2.state = 4;
  f['traps'].push(t2);
  const ev2 = f.tick([hitter, tgt({ id: 1, x: 900, z: 900 })], { trapsHitOwner: false });
  eq(ev2.map((e) => e.kind), ['hit', 'announce', 'burst'], 'owner present: the announce runs on the hit');
  eq(t2.announced, true, 'owner present: the flag is set');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

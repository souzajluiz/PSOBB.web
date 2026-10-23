// The trade zone bits (client/src/net/tradezone.ts): the exe's DerolleMapObjectVisibilityCheck_00667bb5
// (dump 531369, disassembly 0x667bb5..0x667c3a) for TObjTradeCollision objects, the reads in
// IsTradeStateFlagSet_00825ac0, and their wiring into the trade IO (net/tradeio.ts).
// Run: node tests/tradezone.test.ts
import { TradeZone, TRADE_COLLISION_TYPE, tradeZoneCheck, tradeZoneObject, type TradeZoneObject, type TradeZoneWorld } from '../client/src/net/tradezone.ts';
import { tradeIO } from '../client/src/net/tradeio.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

// A world where every slot holds a player on floor 3 at the given XZ positions (null: empty slot).
function world(players: ({ x: number; z: number; floor?: number } | null)[], over: Partial<TradeZoneWorld> = {}): TradeZoneWorld {
  return {
    floor: 3,
    counts: true,
    player: (slot) => {
      const p = players[slot];
      return p ? { x: p.x, z: p.z, floor: p.floor ?? 3 } : null;
    },
    ...over,
  };
}

const ORIGIN: TradeZoneObject = { x: 0, z: 0, radius: 10, param4: 1 };
const ALL_SET = 0xf;

// ---- The check (DerolleMapObjectVisibilityCheck_00667bb5) -----------------

// Slots 0..3 outside the radius (XZ distance 20 > 10) with param 4 set: all four bits set.
const far = [{ x: 20, z: 0 }, { x: 0, z: 20 }, { x: 14, z: 14 }, { x: -30, z: 0 }];
check('outside the radius with param 4 set, every slot gets its bit', tradeZoneCheck(0, ORIGIN, world(far)) === ALL_SET);

// Inside the radius (distance 5 < 10): the bit is cleared, even when it was set.
const near = [{ x: 5, z: 0 }, { x: 0, z: 5 }, { x: 1, z: 1 }, { x: -3, z: -4 }];
check('inside the radius the bits are cleared (set bits too)', tradeZoneCheck(ALL_SET, ORIGIN, world(near)) === 0);

// The boundary: distance exactly 10 is not "< radius^2", so the outside rule applies (set).
check('exactly on the radius counts as outside (exe jb is a strict <)', tradeZoneCheck(0, ORIGIN, world([{ x: 10, z: 0 }])) === 1);

// param 4 zero: outside, nothing is set and nothing is cleared (the exe skips the setter).
check('param 4 zero: outside sets nothing', tradeZoneCheck(0, { ...ORIGIN, param4: 0 }, world(far)) === 0);
check('param 4 zero: outside leaves an existing bit alone', tradeZoneCheck(0x2, { ...ORIGIN, param4: 0 }, world(far)) === 0x2);

// An empty slot clears its bit; the other slots keep theirs.
check('an empty slot clears only its own bit', tradeZoneCheck(ALL_SET, ORIGIN, world([far[0]!, null, far[2]!, far[3]!])) === 0b1101);

// Another floor clears the bit, as does a running quest (g_QuestStarted) or a scene other than logged_in.
check('a player on another floor clears its bit', tradeZoneCheck(ALL_SET, ORIGIN, world([far[0]!, { ...far[1]!, floor: 4 }, far[2]!, far[3]!])) === 0b1101);
check('a running quest clears every bit (counts false)', tradeZoneCheck(ALL_SET, ORIGIN, world(far, { counts: false })) === 0);

// The radius is squared in float32 (the exe's fmul then fstps); with radius 0 no distance is inside (0 < 0 is false).
check('radius 0: any distance is outside', tradeZoneCheck(0, { ...ORIGIN, radius: 0 }, world([{ x: 0.5, z: 0 }])) === 1);

// ---- The zone bits (TradeZone) and the reads ------------------------------

const zone = new TradeZone();
check('outside a field the zone is permissive (lobby: no collision objects loaded)', zone.inZone(0) && zone.inZone(3));
zone.enterField();
check('in a field with no bits set, the trade is cancelled (inZone false)', !zone.inZone(0) && !zone.inZone(1));
zone.check(ORIGIN, world([far[0]!, near[1]!, far[2]!, null]));
check('check: slot 0 outside (set), slot 1 inside (clear)', zone.inZone(0) && !zone.inZone(1));
check('check: slot 2 outside (set), slot 3 empty (clear)', zone.inZone(2) && !zone.inZone(3));
zone.leaveField();
check('leaving the field is permissive again', zone.inZone(1) && zone.inZone(3));

// The collision object of a set record: radius = params[0] (+0x28), param 4 = params[3] (+0x34).
const obj = tradeZoneObject([12, 0, -7], [9.5, 0, 0, 1, 0, 0]);
check('tradeZoneObject: XZ from the world position, radius from param 1, param 4 from param 4', obj.x === 12 && obj.z === -7 && obj.radius === 9.5 && obj.param4 === 1, JSON.stringify(obj));
check('the object type is TObjTradeCollision (0x57)', TRADE_COLLISION_TYPE === 0x57);

// ---- The trade IO -----------------------------------------------------------

const io = tradeIO({ send: () => {}, host: () => null, isPresent: () => true, inTradeZone: (id) => id === 2 });
check('tradeIO passes the link zone reading through', io.inTradeZone(2) && !io.inTradeZone(1));
const plain = tradeIO({ send: () => {}, host: () => null, isPresent: () => true });
check('tradeIO without a zone reading keeps the permissive default', plain.inTradeZone(0) && plain.inTradeZone(3));

console.log(failures ? `${failures} FAILED` : 'all tradezone checks passed');
if (failures) process.exit(1);

// The Scape Doll in the death flow (combat/playerdamage.ts): the death check's
// item triples, the 6x89 / 6x4D death flags, and the fade's end, where a held
// Scape Doll is used up (6x29) and the player is revived instead of going to the
// revivable marker (6x4E). The exe side: DROP_CHECK_ITEMS, dispatch_actions_0x89_0x4d,
// unknown_dead_player_return_to_p2_related and HandleDropItemAction_006923dc.
// Run: node tests/scapedoll.test.ts
import {
  DEATH_FADE_TICKS,
  DEATH_FLAG_NO_DROP,
  DROP_CHECK_ITEMS,
  PlayerDamage,
  SCAPE_DOLL_CLASS,
  dropCheckClass,
  type PlayerDamageEvents,
} from '../client/src/combat/playerdamage.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL: ${what}`);
  }
};

// The exe's triples, in FUN_0069248c's order: the Scape Doll (tool 9) first.
check(DROP_CHECK_ITEMS.length === 3, 'three drop-check triples');
check(DROP_CHECK_ITEMS[0].join(',') === '3,9,0', 'the first triple is the Scape Doll 03 09 00');
check(DROP_CHECK_ITEMS[1].join(',') === '0,13,3', 'the second triple is 00 0D 03');
check(DROP_CHECK_ITEMS[2].join(',') === '1,2,82', 'the third triple is 01 02 52');
check(SCAPE_DOLL_CLASS === 0, 'the Scape Doll is class 0');
check(dropCheckClass(new Uint8Array([3, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) === 0, 'data1 of 03 09 00 is class 0');
check(dropCheckClass(new Uint8Array([0, 13, 3, 7, 0, 0, 0, 0, 0, 0, 0, 0])) === 1, 'data1 of 00 0D 03 is class 1 (the extra bytes do not matter)');
check(dropCheckClass(new Uint8Array([1, 2, 82, 0, 0, 0, 0, 0, 0, 0, 0, 0])) === 2, 'data1 of 01 02 52 is class 2');
check(dropCheckClass(new Uint8Array([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) === -1, 'a Monomate is not a drop-check item');
check(dropCheckClass(new Uint8Array([3, 9, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])) === -1, 'the group index must match too');

interface Log {
  deaths: number[];
  revivable: number;
  revived: number;
  consumed: number[];
  logs: string[];
  // Every send in order: 'consume', '31' (6x31), '4f' (6x4F), 'revivable' (6x4E).
  sent: string[];
  revivalItemUsed: number;
}

// A player with the events of the death flow; `item` is what the drop check finds
// (undefined: the event is absent, the flow without an inventory).
function makePlayer(item: { id: number; scapeDoll: boolean } | null | undefined, live: { item: { id: number; scapeDoll: boolean } | null } | null = null) {
  const log: Log = { deaths: [], revivable: 0, revived: 0, consumed: [], logs: [], sent: [], revivalItemUsed: 0 };
  const events: PlayerDamageEvents = {
    motion: () => {},
    push: () => {},
    face: () => {},
    sendHit: () => {},
    sendShieldAttack: () => {},
    sendDeath: (_killer, flags) => log.deaths.push(flags),
    sendRevivable: () => {
      log.revivable++;
      log.sent.push('revivable');
    },
    sendRevived: () => {
      log.revived++;
      log.sent.push('4f');
    },
    sendRevivalItemUsed: () => {
      log.revivalItemUsed++;
      log.sent.push('31');
    },
    log: (m) => log.logs.push(m),
    sendConsumeItem: (id) => {
      log.consumed.push(id);
      log.sent.push('consume');
    },
  };
  if (item !== undefined) {
    events.findDropCheckItem = () => (live ? live.item : item);
  }
  const pd = new PlayerDamage(events);
  pd.reset(100);
  return { pd, log };
}

// Kill the player with one heavy hit (damage > 25% of max HP) and run the death
// motion and the fade to their ends, with the fallback motion lengths.
function killAndFade(pd: PlayerDamage, maxTicks = 1000): void {
  pd.hit(150, 0, 0, 0x1000);
  for (let i = 0; i < maxTicks && pd.state !== 'revivable' && pd.state !== 'reviving' && pd.state !== 'alive'; i++) {
    pd.tick();
  }
}

{
  // No inventory event: the death flags keep the old behaviour (no drop, bit 2).
  const { pd, log } = makePlayer(undefined);
  killAndFade(pd);
  check(log.deaths.length === 1 && log.deaths[0] === DEATH_FLAG_NO_DROP, 'without the drop check the death sends flag 2');
  check(pd.state === 'revivable' && log.revivable === 1, 'without a Scape Doll the fade ends in the revivable state (6x4E once)');
  check(log.consumed.length === 0 && log.revived === 0, 'without a Scape Doll nothing is consumed or revived');
}

{
  // An empty drop check (none of the three items): bit 2 set, same as no event.
  const { pd, log } = makePlayer(null);
  killAndFade(pd);
  check(log.deaths[0] === DEATH_FLAG_NO_DROP, 'no drop-check item sends flag 2');
  check(pd.state === 'revivable' && log.revivable === 1, 'no drop-check item: revivable');
}

{
  // A Scape Doll held at death: the exe's drop check finds it, bit 2 stays clear.
  const { pd, log } = makePlayer({ id: 0x1234, scapeDoll: true });
  pd.hit(150, 0, 0, 0x1000);
  // The death is sent when the dead state starts.
  for (let i = 0; i < 1000 && log.deaths.length === 0; i++) pd.tick();
  check(log.deaths.length === 1 && log.deaths[0] === 0, 'a held Scape Doll clears the no-drop bit in 6x4D');
  // Run the fade to its end: the doll is used up, the player revives in place.
  for (let i = 0; i < 1000 && pd.state === 'dead'; i++) pd.tick();
  check(log.consumed.length === 1 && log.consumed[0] === 0x1234, 'the fade end sends 6x29 for the Scape Doll once');
  check(log.revivable === 0, 'the revivable marker (6x4E) is not sent');
  // Exe: dispatch_action_0x4f sends 6x31 (0x92c & 4) then 6x4F.
  check(log.revived === 1, 'the revive sends 6x4F once');
  check(log.revivalItemUsed === 1, 'the revive sends 6x31 once (the revival item was used)');
  check(log.sent.join(',') === 'consume,31,4f', 'the order is 6x29, 6x31, 6x4F');
  check(pd.state === 'reviving', 'the player is in the revive state (0x12)');
  check(pd.hp === pd.maxHp && pd.hp === 100 && pd.invuln === 300 && !pd.dead, 'revived at full HP (Player_DisableMovement -> PlayerRestoreHealthAndTP_0068fda4) with invulnerability 300');
  check(log.logs.some((m) => m.includes('revives you')), 'the revive is logged');
  // The revive motion ends: alive again, and no second consume.
  for (let i = 0; i < 1000 && pd.state !== 'alive'; i++) pd.tick();
  check(pd.state === 'alive' && log.consumed.length === 1, 'back to alive with one consume');
}

{
  // A Phoenix Claw / Ragol Ring of the drop check: the exe's HandleDropItemAction
  // consumes it (6x29) and returns 1 whatever the class, so the fade end revives
  // the player and sends no 6x4E.
  const { pd, log } = makePlayer({ id: 0x55, scapeDoll: false });
  killAndFade(pd);
  check(pd.state === 'reviving' && log.revivable === 0, 'a non-doll triple revives (exe: HandleDropItemAction returns 1)');
  check(log.consumed.length === 1 && log.consumed[0] === 0x55, 'a non-doll triple is used up with 6x29');
  check(log.revived === 1, 'a non-doll triple sends the 6x4F revive');
  check(log.revivalItemUsed === 1 && log.sent.join(',') === 'consume,31,4f', 'a non-doll triple sends 6x31 before 6x4F');
  check(log.deaths[0] === 0, 'a non-doll triple also clears bit 2 (the exe found an item)');
}

{
  // The doll is gone by the fade's end (e.g. used by a second item): revivable.
  const live: { item: { id: number; scapeDoll: boolean } | null } = { item: { id: 0x99, scapeDoll: true } };
  const { pd, log } = makePlayer({ id: 0x99, scapeDoll: true }, live);
  pd.hit(150, 0, 0, 0x1000);
  for (let i = 0; i < 1000 && log.deaths.length === 0; i++) pd.tick();
  live.item = null;
  for (let i = 0; i < 1000 && pd.state === 'dead'; i++) pd.tick();
  check(pd.state === 'revivable' && log.revivable === 1 && log.consumed.length === 0, 'a doll gone at the fade end is not used');
}

if (failures) {
  console.log(`${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`scapedoll: ${checks} checks ok`);

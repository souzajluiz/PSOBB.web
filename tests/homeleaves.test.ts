// The Home menu leaves the lobby and the field share (classic/homeleaves.ts): the Guild Card,
// Symbol Chat, Simple Mail and Team leaves of PsoBB.exe handle_player_menu_select (dump
// Psobb.exe-05112026.c line 700118). Run: node tests/homeleaves.test.ts
import { HomeLeaves, HOME_LEAF_IDS, type HomeLeafHost } from '../client/src/classic/homeleaves.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

const text = (g: number, i: number) => `t${g}.${i}`;
const lobby = { self: undefined, selfId: 0, players: new Map() } as unknown as HomeLeafHost['lobby'];
const host = (over: Partial<HomeLeafHost> = {}): HomeLeafHost => ({
  text,
  lobby,
  guildCards: () => null,
  guildCardClient: () => null,
  mailbox: () => null,
  fullCharacter: () => null,
  team: () => null,
  ...over,
});

check([0x0e, 0x12, 0x13, 0x25, 0x2b].every((id) => HOME_LEAF_IDS.has(id)), 'the five shared leaves are listed');
check(!HOME_LEAF_IDS.has(0x0b) && !HOME_LEAF_IDS.has(0x1a), 'the item list and trade stay with the owner');

// No session: nothing opens.
const none = new HomeLeaves(() => null);
check(none.openLeaf(0x0e) === false && none.open === false, 'no host, no Guild Card');

// Team leaves need a team (exe ValidateMenuItemCondition_00732620 greys them out of one).
const noTeam = new HomeLeaves(() => host());
check(noTeam.openLeaf(0x25) === false, 'Team Member List needs a team');
check(noTeam.openLeaf(0x2b) === false, 'Team Info needs a team');
check(noTeam.open === false, 'no window after a refused team leaf');

// Symbol Chat opens with no saved chats (12 empty rows), and its own Cancel closes it.
let closed = 0;
const leaves = new HomeLeaves(() => host());
leaves.onAllClosed = () => closed++;
check(leaves.openLeaf(0x12) === true && leaves.open === true, 'Symbol Chat opens');
leaves.key({ key: 'Escape', preventDefault() {} } as unknown as KeyboardEvent);
check(leaves.open === false, 'Cancel closes Symbol Chat');
check(closed === 1, 'onAllClosed fires once when the last window closes');

// Leaves close with close(): no callback (the owner's leave).
const quiet = new HomeLeaves(() => host());
quiet.onAllClosed = () => closed++;
quiet.openLeaf(0x12);
quiet.close();
check(quiet.open === false && closed === 1, 'close() drops the window without the callback');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('homeleaves: all checks pass');

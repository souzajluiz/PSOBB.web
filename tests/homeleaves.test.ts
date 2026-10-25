// The Home menu leaves the lobby and the field share (classic/homeleaves.ts): the Guild Card,
// Symbol Chat, Simple Mail and Team leaves of PsoBB.exe handle_player_menu_select (dump
// Psobb.exe-05112026.c line 700118). Run: node tests/homeleaves.test.ts
import { HomeLeaves, HOME_LEAF_IDS, type HomeLeafHost } from '../client/src/classic/homeleaves.ts';
import { TeamChat } from '../client/src/classic/teamchat.ts';
import { TeamInviteReceiver } from '../client/src/net/team.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

const text = (g: number, i: number) => `t${g}.${i}`;
const lobby = { self: undefined, selfId: 0, players: new Map(), teamInvites: new TeamInviteReceiver() } as unknown as HomeLeafHost['lobby'];
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

check([0x0e, 0x12, 0x13, 0x25, 0x27, 0x2b].every((id) => HOME_LEAF_IDS.has(id)), 'the shared leaves are listed (Team Log included)');
check(!HOME_LEAF_IDS.has(0x0b) && !HOME_LEAF_IDS.has(0x1a), 'the item list and trade stay with the owner');

// No session: nothing opens.
const none = new HomeLeaves(() => null);
check(none.openLeaf(0x0e) === false && none.open === false, 'no host, no Guild Card');

// Team leaves need a team (exe ValidateMenuItemCondition_00732620 greys them out of one).
const noTeam = new HomeLeaves(() => host());
check(noTeam.openLeaf(0x25) === false, 'Team Member List needs a team');
check(noTeam.openLeaf(0x2b) === false, 'Team Info needs a team');
check(noTeam.openLeaf(0x27) === false, 'Team Log needs a team');
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

// Team Log (0x27): needs a team and the team chat; its rows show / hide the chat window.
const chat = new TeamChat(() => {});
const noChat = new HomeLeaves(() => host({ team: () => ({}) as never }));
check(noChat.openLeaf(0x27) === false, 'Team Log needs the team chat window');
const logLeaves = new HomeLeaves(() => host({ team: () => ({}) as never, teamChat: () => chat }));
check(logLeaves.openLeaf(0x27) === true && logLeaves.open === true, 'Team Log opens in a team');
check(chat.open === false, 'Team Log opens with the window hidden (cursor on hide)');
logLeaves.key({ key: 'ArrowUp', preventDefault() {} } as unknown as KeyboardEvent);
check(chat.open === true, 'Team Log show row opens the team chat window');
logLeaves.key({ key: 'Enter', preventDefault() {} } as unknown as KeyboardEvent);
check(logLeaves.open === false && chat.open === true, 'Enter on show closes the Team Log and keeps the window');

// Team Invite (0x29) and Point Regist (0x2d): shared leaves that need a team and its hooks.
const key = (k: string) => ({ key: k, preventDefault() {} }) as unknown as KeyboardEvent;
const flush = () => new Promise((r) => setTimeout(r, 0));
check(HOME_LEAF_IDS.has(0x29) && HOME_LEAF_IDS.has(0x2d), 'Invite and Point Regist are listed as shared leaves');
check(noTeam.openLeaf(0x29) === false && noTeam.openLeaf(0x2d) === false, 'Invite and Point Regist need a team');
check(new HomeLeaves(() => host({ team: () => ({}) as never })).openLeaf(0x29) === false, 'Invite needs the team nearby / invite hooks');
check(new HomeLeaves(() => host({ team: () => ({}) as never })).openLeaf(0x2d) === false, 'Point Regist needs the team item rows');

const invites: number[] = [];
const invTeam = {
  nearby: async () => [{ name: 'Ann', guildCard: 7 }],
  invite: async (gc: number) => {
    invites.push(gc);
    return 'declined' as const;
  },
};
const invLeaves = new HomeLeaves(() => host({ team: () => invTeam as never }));
let invClosed = 0;
invLeaves.onAllClosed = () => invClosed++;
check(invLeaves.openLeaf(0x29) === true && invLeaves.open === true, 'Invite opens in a team');
await flush();
invLeaves.key(key('Enter'));
check(invites.length === 1 && invites[0] === 7 && invLeaves.open === true, 'Enter on the row invites that card; the menu waits');
await flush();
invLeaves.tick();
check(invLeaves.open === true && invClosed === 0, 'the declined answer shows its message; Invite stays open');
invLeaves.key(key('Enter'));
check(invLeaves.open === false && invClosed === 1, 'Enter on the message closes Invite, and the owner gets its keys back once');

const pointed: number[][] = [];
const ptTeam = {
  itemRows: () => [{ id: 0x100, name: 'Sword', count: 1, teamPoints: 4 }],
  exchangeItem: (id: number, amount: number) => pointed.push([id, amount]),
};
const ptLeaves = new HomeLeaves(() => host({ team: () => ptTeam as never }));
check(ptLeaves.openLeaf(0x2d) === true && ptLeaves.open === true, 'Point Regist opens in a team');
ptLeaves.key(key('Enter')); // the Sword: one item, Yes / No with No on the cursor
ptLeaves.key(key('ArrowUp'));
ptLeaves.key(key('Enter'));
check(JSON.stringify(pointed) === '[[256,1]]', 'Yes on Point Regist sends the exchange for one Sword');
ptLeaves.key(key('Enter')); // the result line closes
check(ptLeaves.open === false, 'a key closes the Point Regist result');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('homeleaves: all checks pass');

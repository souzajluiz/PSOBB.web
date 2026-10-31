// The counter's Team menus (classic/teammenu.ts) and Change SHIP / Change BLOCK
// rows (classic/counter.ts): the state machine against a fake host, the greyed
// rows, the window geometry and a drawing smoke test over every phase.
// Run: node tests/teammenu.test.ts
import { InfoCounter, type CounterText } from '../client/src/classic/counter.ts';
import {
  cleanTeamName,
  format,
  memberFilter,
  Question,
  memberColor,
  TEAM_LIST_POS,
  TEAM_POS,
  TEAM_INFO_POINTS_POS,
  TEAM_INFO_POS,
  TEAM_INFO_REWARDS_POS,
  TeamInfoWindow,
  TeamMemberListWindow,
  TeamMenus,
  teamRowsDisabled,
  T11_TEAM_INFO,
  T11_TEAM_LOG,
  T15_TEAM,
  TEAM_LOG_POS,
  TeamLogWindow,
  TeamInviteWindow,
  TeamPointWindow,
  type TeamHost,
} from '../client/src/classic/teammenu.ts';
import { TeamChat } from '../client/src/classic/teamchat.ts';
import { yesNoRect } from '../client/src/classic/titleflow.ts';
import { MailCompose } from '../client/src/classic/simplemail.ts';
import { BUY_POS, FLAG_POS, MasterTransferPromptWindow, rewardAffordable, type FlagPick } from '../client/src/classic/teammenu.ts';
import { drawNameWindow, TeamNameWindow, type TeamText } from '../client/src/classic/teammenu.ts';
import { MASTER_ANSWER } from '../client/src/net/team.ts';
const T15_TEAM_DONE_TEXT = `T15[7e] %s`;
import { BANNED_NAMES, isBannedName } from '../client/src/classic/bannednames.ts';
import { masterTransferSubcommand, NO_TEAM, parseMasterAnswer, parseMasterRequest, PRIVILEGE, type TeamMember, type TeamMembership } from '../client/src/net/team.ts';

// A stub canvas: every glyph is 7 px wide and drawing does nothing.
const noop = () => {};
const ctx = new Proxy(
  {},
  {
    get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 7 }) : prop === 'getImageData' ? () => ({ data: new Uint8ClampedArray(64) }) : noop),
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;
class FakeCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return ctx;
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeCanvas;

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
};
const eq = <T>(got: T, want: T, msg: string) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const k = (key: string) => ({ key });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const t15 = (i: number) => (i === T15_TEAM.otherBusiness ? 'Other business?' : `T15[${i.toString(16)}] %s`);
const t11 = (i: number) => `T11[${i.toString(16)}]`;
const t12 = (i: number) => `T12[${i.toString(16)}]`;
const text = { t11, t15, t12 };

const team = (privilege: number, name = 'Alpha'): TeamMembership => ({ masterGuildCard: 900, teamId: 4, unknownA5: 0, unknownA6: 0, privilege, memberCount: 3, name });

interface Calls {
  created: string[];
  removed: number[];
  privileges: Array<[number, number]>;
  disbanded: number;
  searched: number[];
  meets: number[];
}

function host(
  membership: TeamMembership,
  answers: Partial<{ create: number; remove: number; privilege: number; disband: number; found: boolean }> = {},
): { host: TeamHost; calls: Calls } {
  const calls: Calls = { created: [], removed: [], privileges: [], disbanded: 0, searched: [], meets: [] };
  const members: TeamMember[] = [
    { rank: 1, privilege: PRIVILEGE.master, guildCard: 900, name: 'Boss' },
    { rank: 2, privilege: PRIVILEGE.leader, guildCard: 901, name: 'Lead' },
    { rank: 3, privilege: PRIVILEGE.member, guildCard: 902, name: 'Rook' },
  ];
  return {
    calls,
    host: {
      membership: () => membership,
      selfGuildCard: () => 777,
      createTeam: async (n) => (calls.created.push(n), answers.create ?? 0),
      removeMember: async (g) => (calls.removed.push(g), answers.remove ?? 0),
      members: async () => members,
      searchMember: async (g) => (calls.searched.push(g), answers.found ?? false),
      meetMember: (g) => calls.meets.push(g),
      setPrivilege: async (g, p) => (calls.privileges.push([g, p]), answers.privilege ?? 0),
      disband: async () => (calls.disbanded++, answers.disband ?? 0),
      crossRanking: async () => [
        { name: 'Top', points: 900 },
        { name: 'Low', points: 5 },
      ],
    },
  };
}

function menus(h: TeamHost): { m: TeamMenus; closed: () => number; back: () => number } {
  const m = new TeamMenus(h, text);
  let closed = 0;
  let back = 0;
  m.onClose = () => closed++;
  m.onBack = () => back++;
  return { m, closed: () => closed, back: () => back };
}

// --- greyed rows (ShowTeamMainMenu) ---------------------------------------------------
eq(teamRowsDisabled(NO_TEAM), [false, true, true, true], 'no team: only Create Team');
eq(teamRowsDisabled(team(PRIVILEGE.master)), [true, false, false, true], 'master: no Create, no Leave');
eq(teamRowsDisabled(team(PRIVILEGE.leader)), [true, false, true, false], 'leader: no Create, no Master Menu');
eq(teamRowsDisabled(team(PRIVILEGE.member)), [true, false, true, false], 'member: no Create, no Master Menu');
eq(teamRowsDisabled(NO_TEAM, false), [true, true, true, true], 'g_ClientCapsFlag 0 greys Create Team');

// --- helpers ----------------------------------------------------------------------------
eq(cleanTeamName('A B　C'), 'ABC', 'spaces removed from the team name');
eq(format('Team [%s] and %s', 'X', 'Y'), 'Team [X] and Y', 'format');
check(memberFilter('promote', { rank: 1, privilege: 0, guildCard: 1, name: '' }) && !memberFilter('promote', { rank: 1, privilege: 0x30, guildCard: 1, name: '' }), 'promotion offers privilege < 0x30');
check(!memberFilter('demote', { rank: 1, privilege: 0, guildCard: 1, name: '' }) && memberFilter('demote', { rank: 1, privilege: 0x30, guildCard: 1, name: '' }) && !memberFilter('demote', { rank: 1, privilege: 0x40, guildCard: 1, name: '' }), 'demotion offers leaders');
check(memberFilter('dismiss', { rank: 1, privilege: 0x30, guildCard: 1, name: '' }) && !memberFilter('dismiss', { rank: 1, privilege: 0x40, guildCard: 1, name: '' }), 'dismissal offers everybody but the master');

// --- question geometry ------------------------------------------------------------------
{
  const q = new Question('One line', TEAM_POS.confirmQuestion);
  eq(q.rect, { x: 180, y: 240, w: 300, h: 34 }, 'one line question = listWindowHeight(1)');
  eq(yesNoRect(q.rect), { x: 180 + 300 - 111, y: 240 + 34 - 10, w: 104, h: 54 }, 'Yes/No list at the right bottom');
  const five = new Question('a\nb\nc\nd\ne', TEAM_POS.createQuestion);
  eq(five.rect.h, 14 + 20 * 4 + 20, 'five lines: 14 + 20 per further line + 20');
  eq(q.cursor, 1, 'the cursor starts on No');
  q.key(k('Escape'));
  eq(q.result, 'no', 'Cancel counts as No');
}

// --- Create Team ------------------------------------------------------------------------
{
  const { host: h, calls } = host(NO_TEAM);
  const { m, closed } = menus(h);
  m.begin(0);
  eq(m.phase.kind, 'createIntro', 'Create Team opens the intro question');
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq(m.phase.kind, 'name', 'Yes opens the name window');
  check(m.textInput() === null, 'no text input until the name row is chosen');
  m.key(k('Enter')); // row 1: the editor
  check(m.textInput() !== null, 'the name editor takes text');
  for (const c of 'My Team') m.key(k(c));
  m.key(k('Enter'));
  if (m.phase.kind === 'name') {
    eq(m.phase.w.name, 'MyTeam', 'the name has its spaces removed');
    eq(m.phase.w.row, 2, 'the cursor goes to Registration');
  }
  m.key(k('Enter'));
  eq(m.phase.kind, 'nameConfirm', 'Registration asks for confirmation');
  if (m.phase.kind === 'nameConfirm') eq(m.phase.q.text, 'T15[67] MyTeam', 'the confirmation names the team');
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq(m.phase.kind, 'creating', 'Yes sends 01EA');
  eq(calls.created, ['MyTeam'], 'createTeam called with the name');
  await tick();
  eq(m.phase.kind, 'notice', 'the answer is a notice');
  if (m.phase.kind === 'notice') eq(m.phase.info.text.replace(/\n/g, ' ').includes('T15[6a]'), true, 'result 0: [15:0x6a]');
  m.key(k('Enter'));
  eq([m.phase.kind, closed()], ['closed', 1], 'Enter closes every window');
}
{
  // Name already registered (02EA 2): Enter reopens the name window.
  const { host: h } = host(NO_TEAM, { create: 2 });
  const { m } = menus(h);
  m.begin(0);
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  m.key(k('Enter'));
  for (const c of 'Dup') m.key(k(c));
  m.key(k('Enter'));
  m.key(k('Enter'));
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  await tick();
  check(m.phase.kind === 'notice' && m.phase.info.text.includes('T15[6b]') && m.phase.next === 'name', 'result 2: [15:0x6b], Enter reopens the name window');
  m.key(k('Enter'));
  eq(m.phase.kind, 'name', 'back in the name window');
  if (m.phase.kind === 'name') eq(m.phase.w.name, '', 'with an empty name');
}
{
  // Any other code: "Team creation failed." and Enter closes.
  const { host: h } = host(NO_TEAM, { create: 1 });
  const { m, closed } = menus(h);
  m.begin(0);
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  m.key(k('Enter'));
  m.key(k('x'));
  m.key(k('Enter'));
  m.key(k('Enter'));
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  await tick();
  check(m.phase.kind === 'notice' && m.phase.info.text.includes('T15[6c]') && m.phase.next === 'close', 'result 1: [15:0x6c]');
  m.key(k('Enter'));
  eq(closed(), 1, 'closed after the failure notice');
}
{
  // Registration is greyed until a name is typed; Cancel closes.
  const { host: h } = host(NO_TEAM);
  const { m, closed } = menus(h);
  m.begin(0);
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  m.key(k('ArrowDown'));
  if (m.phase.kind === 'name') eq(m.phase.w.row, 1, 'no name: the cursor cannot reach Registration');
  m.key(k('Backspace'));
  eq([m.phase.kind, closed()], ['closed', 1], 'Cancel in the name window = close_lobby_menus');
}
{
  // No on the intro: "Do you have any other business?", Yes goes back to the list, No closes.
  const { host: h } = host(NO_TEAM);
  const { m, closed, back } = menus(h);
  m.begin(0);
  m.key(k('Enter')); // cursor starts on No
  eq(m.phase.kind, 'other', 'No on the intro asks about other business');
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq([m.phase.kind, back(), closed()], ['closed', 1, 0], 'Yes: back to the team list');
  m.begin(0);
  m.key(k('Enter'));
  m.key(k('Enter'));
  eq([m.phase.kind, back(), closed()], ['closed', 1, 1], 'No: close_lobby_menus');
}

// --- Leave Team ---------------------------------------------------------------------------
{
  const { host: h, calls } = host(team(PRIVILEGE.member, 'Beta'));
  const { m, closed } = menus(h);
  m.begin(3);
  eq(m.phase.kind, 'leaveConfirm', 'Leave Team asks first');
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq(calls.removed, [777], 'Yes sends 05EA with the own guild card');
  check(m.phase.kind === 'notice' && m.phase.info.text.includes('T15[85]'), 'the notice appears without waiting for the answer');
  m.key(k('Enter'));
  eq(closed(), 1, 'Enter closes');
}
{
  // The master cannot leave: the row is greyed, begin() ignores it.
  const { host: h, calls } = host(team(PRIVILEGE.master));
  const { m } = menus(h);
  m.begin(3);
  eq([m.phase.kind, calls.removed.length], ['closed', 0], 'Leave Team is refused for the master');
  m.begin(0);
  eq(m.phase.kind, 'closed', 'Create Team is refused inside a team');
}

// --- Master Menu --------------------------------------------------------------------------
async function openMaster(h: TeamHost) {
  const r = menus(h);
  r.m.begin(2);
  return r;
}
{
  const { host: h, calls } = host(team(PRIVILEGE.master));
  const { m, closed } = await openMaster(h);
  check(m.phase.kind === 'master', 'Master Menu opens the master list');
  if (m.phase.kind === 'master') {
    eq(m.phase.list.items.map((i) => i.enabled), [true, true, true, false, true, false, false], 'a host without the 6xCD pair, the 18EA / 1AEA requests and the flag picker greys Master Transfer, Buying Privileges and Flag Records');
    eq(m.phase.list.items.length, 7, 'seven rows');
  }
  // Greyed row: the buzzer, no phase change.
  m.key(k('ArrowDown'));
  m.key(k('ArrowDown'));
  m.key(k('ArrowDown'));
  m.key(k('Enter'));
  eq(m.phase.kind, 'master', 'Decide on a greyed row does nothing');
  m.key(k('Backspace'));
  eq(closed(), 1, 'Cancel closes everything');

  // Promotion: lists members below leader, asks, sends 11EA 0x30.
  const r = await openMaster(h);
  r.m.key(k('Enter'));
  eq(r.m.phase.kind, 'loading', 'Member Promotion asks for the member list (08EA)');
  await tick();
  check(r.m.phase.kind === 'pick', 'the list arrives');
  if (r.m.phase.kind === 'pick') {
    eq(r.m.phase.list.items.map((i) => i.value), [902], 'only plain members are offered');
    eq(r.m.phase.list.items[0].label, '<0003> Rook', 'rows are "<rank> name"');
  }
  r.m.key(k('Enter'));
  eq(r.m.phase.kind, 'pickConfirm', 'a member asks the confirmation');
  if (r.m.phase.kind === 'pickConfirm') eq(r.m.phase.q.text, 'T15[6e] <0003> Rook', 'with the row text');
  r.m.key(k('ArrowUp'));
  r.m.key(k('Enter'));
  await tick();
  eq(calls.privileges, [[902, 0x30]], 'Yes sends 11EA flag 0x30');
  check(r.m.phase.kind === 'notice' && r.m.phase.info.text.includes('T15[6f]'), 'success notice [15:0x6f]');
  r.m.key(k('Enter'));
  eq(r.closed(), 1, 'Enter closes');
}
{
  // Answer 5 = "already"; other = failed.
  const five = host(team(PRIVILEGE.master), { privilege: 5 });
  const a = await openMaster(five.host);
  a.m.key(k('Enter'));
  await tick();
  a.m.key(k('Enter'));
  a.m.key(k('ArrowUp'));
  a.m.key(k('Enter'));
  await tick();
  check(a.m.phase.kind === 'notice' && a.m.phase.info.text.includes('T15[70]'), 'promotion answer 5: [15:0x70]');
  const bad = host(team(PRIVILEGE.master), { privilege: 3 });
  const b = await openMaster(bad.host);
  b.m.key(k('Enter'));
  await tick();
  b.m.key(k('Enter'));
  b.m.key(k('ArrowUp'));
  b.m.key(k('Enter'));
  await tick();
  check(b.m.phase.kind === 'notice' && b.m.phase.info.text.includes('T15[71]'), 'promotion answer 3: [15:0x71]');
}
{
  // Demotion lists the leaders; dismissal sends 05EA and lists leaders and members.
  const { host: h, calls } = host(team(PRIVILEGE.master));
  const a = await openMaster(h);
  a.m.key(k('ArrowDown'));
  a.m.key(k('Enter'));
  await tick();
  if (a.m.phase.kind === 'pick') eq(a.m.phase.list.items.map((i) => i.value), [901], 'demotion offers the leader');
  a.m.key(k('Enter'));
  a.m.key(k('ArrowUp'));
  a.m.key(k('Enter'));
  await tick();
  eq(calls.privileges, [[901, 0]], 'demotion sends 11EA flag 0');

  const d = await openMaster(h);
  d.m.key(k('ArrowDown'));
  d.m.key(k('ArrowDown'));
  d.m.key(k('Enter'));
  await tick();
  if (d.m.phase.kind === 'pick') eq(d.m.phase.list.items.map((i) => i.value), [901, 902], 'dismissal offers everybody but the master');
  d.m.key(k('Enter'));
  d.m.key(k('ArrowUp'));
  d.m.key(k('Enter'));
  await tick();
  eq(calls.removed, [901], 'dismissal sends 05EA with the member');
  check(d.m.phase.kind === 'notice' && d.m.phase.info.text.includes('T15[79]'), 'dismissal notice [15:0x79]');
}
{
  // The "No Player" row (value 0) goes back to the master menu; Cancel too.
  const noOne = host(team(PRIVILEGE.master));
  noOne.host.members = async () => [{ rank: 1, privilege: PRIVILEGE.master, guildCard: 900, name: 'Boss' }];
  const a = await openMaster(noOne.host);
  a.m.key(k('Enter'));
  await tick();
  if (a.m.phase.kind === 'pick') eq(a.m.phase.list.items.map((i) => i.label), ['T11[f1]'], 'no candidate: [11:0xf1] "No Player"');
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'master', 'the No Player row returns to the master menu');
  a.m.key(k('Enter'));
  await tick();
  a.m.key(k('Backspace'));
  eq(a.m.phase.kind, 'master', 'Cancel in a member list returns to the master menu');
}
{
  // Dissolve: confirmation, 10EA, notice.
  const { host: h, calls } = host(team(PRIVILEGE.master, 'Gamma'));
  const a = await openMaster(h);
  for (let i = 0; i < 4; i++) a.m.key(k('ArrowDown'));
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'dissolveConfirm', 'Dissolve Team asks first');
  a.m.key(k('ArrowUp'));
  a.m.key(k('Enter'));
  await tick();
  eq(calls.disbanded, 1, 'Yes sends 10EA');
  check(a.m.phase.kind === 'notice' && a.m.phase.info.text.includes('T15[82]'), 'dissolved notice [15:0x82]');
  const bad = host(team(PRIVILEGE.master), { disband: 1 });
  const b = await openMaster(bad.host);
  for (let i = 0; i < 4; i++) b.m.key(k('ArrowDown'));
  b.m.key(k('Enter'));
  b.m.key(k('ArrowUp'));
  b.m.key(k('Enter'));
  await tick();
  check(b.m.phase.kind === 'notice' && b.m.phase.info.text.includes('T15[83]'), 'dissolution failed notice [15:0x83]');
}

// --- Ranking --------------------------------------------------------------------------------
{
  const { host: h } = host(team(PRIVILEGE.member));
  const { m, closed } = menus(h);
  m.begin(1);
  eq(m.phase.kind, 'ranking', 'Ranking sends 1CEA');
  await tick();
  if (m.phase.kind === 'ranking') {
    eq(m.phase.rows.rows, [['Top', '900'], ['Low', '5']], 'rows are name and points');
    eq(m.phase.rows.header, ['T15[68] %s', 'T11[175]'], 'header: [15:0x68] / [11:0x175]');
  }
  m.key(k('ArrowDown'));
  m.key(k('Backspace'));
  eq(closed(), 1, 'Cancel closes');
}

// --- a late answer after closing is dropped --------------------------------------------------
{
  const slow = host(NO_TEAM);
  let release: (n: number) => void = () => {};
  slow.host.createTeam = () => new Promise<number>((r) => (release = r));
  const { m } = menus(slow.host);
  m.begin(0);
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  m.key(k('Enter'));
  m.key(k('x'));
  m.key(k('Enter'));
  m.key(k('Enter'));
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq(m.phase.kind, 'creating', 'waiting for 02EA');
  m.key(k('Backspace'));
  eq(m.phase.kind, 'closed', 'Cancel while waiting closes');
  release(0);
  await tick();
  eq(m.phase.kind, 'closed', 'the late 02EA does not reopen anything');
}

// --- the counter: greyed rows, held leaves, resume --------------------------------------------
{
  const ct: CounterText = {
    info: 'info',
    first: ['Organize', 'Transport', 'Team'],
    transport: ['Change Ship', 'Change Block'],
    team: ['Create', 'Ranking', 'Master', 'Leave'],
    party: ['Join', 'Create'],
    teamDisabled: () => teamRowsDisabled(NO_TEAM),
  };
  const counter = new InfoCounter(ct);
  const chosen: Array<[string, number]> = [];
  let keep = false;
  counter.onChoose = (menu, index) => {
    chosen.push([menu, index]);
    return keep;
  };
  const press = (key: string) => counter.key({ key } as KeyboardEvent);
  counter.begin();
  press('ArrowDown');
  press('ArrowDown');
  press('Enter'); // Team
  press('ArrowDown'); // Ranking: greyed without a team
  press('Enter');
  eq(chosen, [], 'a greyed team row cannot be chosen');
  check(counter.open, 'the counter stays open after the buzzer');
  press('ArrowUp');
  press('Enter'); // Create Team
  eq(chosen, [['team', 0]], 'Create Team reaches onChoose');
  check(!counter.open, 'a leaf that does not keep the menus closes them');

  counter.begin();
  keep = true;
  press('ArrowDown');
  press('ArrowDown');
  press('Enter');
  press('Enter');
  check(counter.open && counter.held, 'a kept leaf holds the counter open');
  press('Backspace');
  check(counter.open, 'a held counter takes no keys');
  counter.resume();
  check(counter.open && !counter.held, 'resume() brings the list back');
  press('Backspace');
  check(!counter.open, 'Cancel closes everything again');

  // Transport rows: onChoose('transport', 0 | 1) and the counter closes.
  counter.begin();
  keep = false;
  chosen.length = 0;
  press('ArrowDown');
  press('Enter');
  press('Enter');
  press('Backspace');
  eq(chosen.at(-1), ['transport', 0], 'Change SHIP -> transport row 0');
  counter.begin();
  press('ArrowDown');
  press('Enter');
  press('ArrowDown');
  press('Enter');
  eq(chosen.at(-1), ['transport', 1], 'Change BLOCK -> transport row 1');
  check(!counter.open, 'Transport closes every menu');
}

// --- a drawing smoke test over every phase (stub canvas) ---------------------------------------
{
  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  const { host: h } = host(team(PRIVILEGE.master));
  const phases: string[] = [];
  const draw = (m: TeamMenus) => {
    phases.push(m.phase.kind);
    m.tick();
    m.draw(ctx, skin, 100);
  };
  const m = new TeamMenus(h, text);
  draw(m);
  const run = async (open: () => void, ...keys: string[]) => {
    m.close();
    open();
    draw(m);
    for (const key of keys) {
      m.key(k(key));
      await tick();
      draw(m);
    }
  };
  await run(() => m.begin(2), 'Enter', 'Enter', 'ArrowUp', 'Enter', 'Enter'); // master, loading, pick, confirm, working, notice
  await run(() => m.begin(1));
  await tick();
  draw(m);
  await run(() => host(NO_TEAM) && m.begin(3), 'Enter');
  const none = new TeamMenus(host(NO_TEAM).host, text);
  none.begin(0);
  none.draw(ctx, skin, 0);
  none.key(k('ArrowUp'));
  none.key(k('Enter'));
  none.key(k('Enter'));
  for (const c of 'Smoke') none.key(k(c));
  none.draw(ctx, skin, 0);
  none.key(k('Enter'));
  none.draw(ctx, skin, 0);
  none.key(k('Enter'));
  none.draw(ctx, skin, 0);
  none.key(k('ArrowUp'));
  none.key(k('Enter'));
  none.draw(ctx, skin, 0);
  await tick();
  none.draw(ctx, skin, 0);
  check(phases.length > 5, 'drew several phases without throwing');
}

// --- Home menu > Team Member List (0x25): the 09EA rows, colours, Cancel -----------------------
{
  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  eq(memberColor(0x10), '#8affa3', 'privilege 0x10 colour');
  eq(memberColor(0x20), '#8affa3', 'privilege 0x20 colour');
  eq(memberColor(0x30), '#5eb1ff', 'privilege 0x30 colour');
  eq(memberColor(0x40), '#ff6d46', 'privilege 0x40 colour');
  eq(memberColor(0), undefined, 'a member keeps the default colour');
  eq(TEAM_LIST_POS, { x: 13, y: 256 }, 'list position (ASSUMED, get_gui_position(0x15))');

  const { host: h } = host(team(PRIVILEGE.master));
  const w = new TeamMemberListWindow(h, text);
  eq(w.open, false, 'closed before the menu opens it');
  w.show();
  eq(w.open, true, 'open at once (08EA sent)');
  eq(w.rows.length, 0, 'no rows until the 09EA answer');
  await tick();
  eq(
    w.rows.map((r) => r.label),
    ['<0001> Boss', '<0002> Lead', '<0003> Rook'],
    'rows are "<rank> name" in the answer order',
  );
  eq(w.rows.map((r) => w.colorOf(r)), ['#ff6d46', '#5eb1ff', undefined], 'rows coloured by privilege');
  // Enter on the row (Boss, 900) starts the Guild Card search at once; no answer is "Not Found.".
  w.draw(ctx, skin, 0);
  check(w.key(k('Enter')) && w.open, 'Enter on a row keeps the window');
  eq(w.state, 'searching', 'Enter starts the search (state 0xf)');
  w.draw(ctx, skin, 0);
  await tick();
  eq([w.state, w.rows.length], ['notFound', 3], 'no answer: Not Found. (state 0x10), rows kept');
  w.draw(ctx, skin, 0);
  check(w.key(k('Enter')) && w.state === 'list', 'a key after Not Found. goes back to the list');
  check(!w.key(k('Escape')) && !w.open, 'Cancel closes');
  w.draw(ctx, skin, 0);

  // Send Mail's keyboard drawn over the list (the confirm too); Meet the User's wait drawn.
  const mailTo = host(team(PRIVILEGE.master), { found: true });
  const mw = new TeamMemberListWindow(mailTo.host, text);
  mw.show();
  await tick();
  mw.key(k('Enter'));
  await tick();
  mw.key(k('Enter'));
  const compose = new MailCompose(t11, () => {}, () => {});
  for (const c of 'Ok') compose.key(k(c));
  compose.draw(ctx, skin);
  compose.key(k('Enter'));
  compose.draw(ctx, skin);
  check(compose.open && mw.state === 'mail', 'the keyboard and its confirm draw over the member list');

  // Found: the action list (Send Mail always; Sent Item greyed without the trade state; Meet the User in the lobby).
  const found = host(team(PRIVILEGE.master), { found: true });
  const fw = new TeamMemberListWindow(found.host, text);
  fw.show();
  await tick();
  fw.key(k('ArrowDown'));
  fw.key(k('Enter'));
  eq(found.calls.searched, [901], 'the row\'s guild card is searched');
  await tick();
  eq(fw.state, 'actions', 'answer: the action list');
  eq(fw.actionRows?.map((r) => r.label), ['T11[15c]', 'T11[15d]', 'T11[15e]'], 'action rows Send Mail / Sent Item / Meet the User');
  eq(fw.actionRows?.map((r) => r.enabled), [true, false, true], 'Sent Item greyed (trade state not set), Meet the User in the lobby');
  fw.draw(ctx, skin, 0);
  fw.key(k('Enter'));
  eq(fw.lastLeaf, 0, 'Send Mail chosen');
  eq([fw.state, fw.mailTarget], ['mail', 901], 'Send Mail: the keyboard runs (action list hidden), to the searched card');
  fw.draw(ctx, skin, 0);
  fw.mailDone();
  eq(fw.state, 'actions', 'the keyboard is done: the action list comes back');
  fw.key(k('ArrowDown'));
  fw.key(k('Enter'));
  eq(fw.lastLeaf, 0, 'a greyed row records nothing');
  fw.key(k('ArrowDown'));
  fw.key(k('Enter'));
  eq([fw.lastLeaf, fw.state], [2, 'meet'], 'Meet the User chosen: the phase label starts');
  eq(found.calls.meets, [901], 'Meet the User asks the host to reconnect to the searched member once');
  fw.key(k('Enter'));
  eq(found.calls.meets, [901], 'a key during the phase label does not ask again');
  check(fw.key(k('Escape')) && fw.state === 'meet', 'keys are ignored during the phase label');
  for (let i = 0; i < 450; i++) fw.tick();
  check(fw.open && fw.meetFrames === 450, 'the phase label lasts 450 frames');
  fw.tick();
  check(!fw.open, 'the 451st frame calls the owner (the list closes)');
  fw.tick();
  check(!fw.open, 'a closed window ignores the tick');

  const cancelled = new TeamMemberListWindow(host(team(PRIVILEGE.master), { found: true }).host, text);
  cancelled.show();
  await tick();
  cancelled.key(k('ArrowDown'));
  cancelled.key(k('Enter'));
  await tick();
  check(cancelled.key(k('Escape')) && cancelled.state === 'list' && cancelled.open, 'Cancel in the action list goes back to the member list');

  // Trade state set and not on the own card: Sent Item enabled; on the own card it stays greyed.
  const tr = new TeamMemberListWindow(host(team(PRIVILEGE.master), { found: true }).host, text, { tradeState: true, lobby: false });
  tr.show();
  await tick();
  tr.key(k('ArrowDown'));
  tr.key(k('Enter'));
  await tick();
  eq(tr.actionRows?.map((r) => r.enabled), [true, true, false], 'trade state: Sent Item enabled, Meet the User off outside the lobby');
  const own = new TeamMemberListWindow({ ...host(team(PRIVILEGE.master), { found: true }).host, selfGuildCard: () => 901 }, text, { tradeState: true });
  own.show();
  await tick();
  own.key(k('ArrowDown'));
  own.key(k('Enter'));
  await tick();
  eq(own.actionRows?.map((r) => r.enabled), [true, false, true], 'own card: Sent Item stays greyed');

  // Sent Item (state 0x15): the item list over the local inventory (the meseta row out), a single
  // item to the keyboard with 1, a stack to the amount list first; the send goes to the host with
  // the item, the amount and the searched card; Cancel steps back; the send's end closes to the list.
  const sent = { sends: [] as [number, number, number][], answer: 1 };
  const withItems = (tradeState: boolean) => ({
    ...host(team(PRIVILEGE.master), { found: true }).host,
    tradeState: () => tradeState,
    itemRows: () => [
      { id: 0x00010203, name: 'Mag', count: 1 },
      { id: 0x00010300, name: 'Ration', count: 3 },
      { id: 0xffffffff, name: 'Meseta', count: 1 },
    ],
    sendItem: async (card: number, itemId: number, amount: number) => (sent.sends.push([card, itemId, amount]), sent.answer),
  });
  const si = new TeamMemberListWindow(withItems(true), text);
  si.show();
  await tick();
  si.key(k('ArrowDown'));
  si.key(k('Enter'));
  await tick();
  eq(si.actionRows?.map((r) => r.enabled), [true, true, true], 'Sent Item enabled with the host trade state (Meet the User in the lobby)');
  si.key(k('ArrowDown'));
  si.key(k('Enter'));
  eq([si.lastLeaf, si.state], [1, 'items'], 'Sent Item chosen: the item list');
  eq(si.itemListRows?.map((r) => r.label), ['Mag', 'Ration'], 'the item list leaves the meseta row out');
  si.key(k('Escape'));
  eq(si.state, 'actions', 'Cancel in the item list goes back to the action list');
  si.key(k('Enter'));
  eq(si.state, 'items', 'the item list again');
  si.key(k('Enter'));
  eq([si.state, si.giveItem], ['mail', { itemId: 0x00010203, name: 'Mag', amount: 1 }], 'a single item goes to the keyboard with 1');
  eq(si.mailTarget, 901, 'the keyboard is for the searched card');
  si.mailDone();
  eq(si.state, 'items', 'the keyboard cancelled: a fresh item list');
  si.key(k('ArrowDown'));
  si.key(k('Enter'));
  eq(si.state, 'quantity', 'a stack opens the amount list');
  si.key(k('Escape'));
  eq(si.state, 'items', 'Cancel in the amount list goes back to the item list (cursor on the stack)');
  si.key(k('Enter'));
  si.key(k('ArrowDown'));
  si.key(k('ArrowDown'));
  si.key(k('Enter'));
  eq([si.state, si.giveItem?.amount], ['mail', 3], 'the amount list gives 3');
  si.giveDone();
  eq([si.state, si.giveItem, si.mailTarget], ['list', null, null], 'the answer closes to the member list');
  eq(sent.sends.length, 0, 'the window itself sends nothing (the host sends at Yes)');

  const gate = new TeamMemberListWindow(withItems(false), text);
  gate.show();
  await tick();
  gate.key(k('ArrowDown'));
  gate.key(k('Enter'));
  await tick();
  eq(gate.actionRows?.map((r) => r.enabled), [true, false, true], 'host trade state off: Sent Item greyed');

  // Cancel during the search: the answer that comes later is dropped.
  let answer: (v: boolean) => void = () => {};
  const slow = new TeamMemberListWindow({ ...h, searchMember: () => new Promise<boolean>((r) => (answer = r)) }, text);
  slow.show();
  await tick();
  slow.key(k('Enter'));
  eq(slow.state, 'searching', 'searching before the answer');
  slow.key(k('Escape'));
  eq(slow.state, 'list', 'Cancel while searching goes back to the list');
  answer(true);
  await tick();
  eq(slow.state, 'list', 'the late answer is dropped');

  // A late answer after closing is dropped.
  const late = new TeamMemberListWindow(h, text);
  late.show();
  late.close();
  await tick();
  eq(late.rows.length, 0, 'answer after close is dropped');

  // A failed request leaves the title and no rows; the window stays open.
  const failing = new TeamMemberListWindow({ ...h, members: async () => Promise.reject(new Error('no 09EA')) }, text);
  failing.show();
  await tick();
  check(failing.open && failing.rows.length === 0, 'failed request: window open, no rows');
}

// --- Home menu > Team > Team Info (0x2b): 18EA points, 19EA rewards, Cancel -------------------
{
  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  eq(TEAM_INFO_POS, { x: 13, y: 256 }, 'the list at get_gui_position(3) (ASSUMED static)');
  eq(TEAM_INFO_POINTS_POS, { x: 299, y: 256 }, 'the points window at get_gui_position(0x1a)');
  eq(TEAM_INFO_REWARDS_POS, { x: 13, y: 296, w: 400, h: 140 }, 'the reward list at (3) + (0, 40), 400 x 140');
  eq([T11_TEAM_INFO.pointInfo, T11_TEAM_INFO.earnedPrivileges, T11_TEAM_INFO.none], [0x170, 0x171, 0xee], 'row and empty strings (group 11)');
  eq(T11_TEAM_LOG, { title: 0x157, rows: [0x158, 0x159] }, 'Team Log labels (group 11)');

  const calls = { intra: 0, rewards: [] as boolean[] };
  const ranking = {
    rankingPoints: 1200,
    pointsRemaining: 300,
    entries: [
      { rank: 1, privilege: PRIVILEGE.master, guildCard: 900, name: 'Boss', points: 700 },
      { rank: 2, privilege: PRIVILEGE.member, guildCard: 902, name: 'Rook', points: 500 },
    ],
  };
  const rewardList = [
    { name: 'Reward A', description: 'First', teamPoints: 10, rewardId: 1 },
    { name: 'Reward B', description: 'Second line', teamPoints: 20, rewardId: 2 },
  ];
  const mk = (o: { fail?: boolean; empty?: boolean } = {}): TeamHost =>
    ({
      membership: () => team(PRIVILEGE.master),
      selfGuildCard: () => 777,
      members: async () => [],
      intraRanking: async () => {
        calls.intra++;
        if (o.fail) throw new Error('no 18EA');
        return o.empty ? { ...ranking, entries: [] } : ranking;
      },
      rewards: async (owned: boolean) => {
        calls.rewards.push(owned);
        if (o.fail) throw new Error('no 19EA');
        return o.empty ? [] : rewardList;
      },
    }) as unknown as TeamHost;

  const w = new TeamInfoWindow(mk(), t11);
  eq(w.open, false, 'closed before the menu opens it');
  w.show();
  eq([w.open, w.state], [true, 'list'], 'open on the two rows');
  w.draw(ctx, skin, 0);
  // Row 0 (Point Information): 18EA at once, the points window after the answer.
  check(w.key(k('Enter')) && w.state === 'waiting', 'Enter on row 0 waits for 18EA');
  eq(calls.intra, 1, 'one 18EA sent');
  w.draw(ctx, skin, 0);
  await tick();
  eq(w.state, 'points', 'the 18EA answer opens the points window');
  eq(w.subRows?.map((r) => r.label), ['<0001> Boss 700', '<0002> Rook 500'], 'points rows: rank, name, points');
  w.draw(ctx, skin, 0);
  check(w.key(k('Escape')) && w.state === 'list' && w.open, 'Cancel in the points window goes back to the list');
  // Row 1 (Earned Privileges List): 19EA (owned) and the reward names; the cursor row's description.
  w.key(k('ArrowDown'));
  w.key(k('Enter'));
  eq(w.state, 'waiting', 'Enter on row 1 waits for 19EA');
  eq(calls.rewards, [true], 'one 19EA (owned rewards) sent');
  await tick();
  eq(w.state, 'rewards', 'the 19EA answer opens the reward list');
  eq(w.subRows?.map((r) => r.label), ['Reward A', 'Reward B'], 'reward names');
  eq(w.currentDescription, 'First', 'the cursor row\'s description');
  w.draw(ctx, skin, 0);
  w.key(k('ArrowDown'));
  eq(w.currentDescription, 'Second line', 'the description follows the cursor');
  check(w.key(k('Escape')) && w.state === 'list', 'Cancel in the reward list goes back to the list');
  check(!w.key(k('Escape')) && !w.open, 'Cancel on the list closes the window');

  // Empty answers: one greyed row with the group 11 string.
  const empty = new TeamInfoWindow(mk({ empty: true }), t11);
  empty.show();
  empty.key(k('Enter'));
  await tick();
  eq(empty.subRows?.map((r) => [r.label, r.enabled]), [['T11[ee]', false]], 'no points: one greyed row (11, 0xee)');
  empty.key(k('Escape'));
  empty.key(k('ArrowDown'));
  empty.key(k('Enter'));
  await tick();
  eq(empty.subRows?.map((r) => [r.label, r.enabled]), [['T11[ee]', false]], 'no rewards: one greyed row (11, 0xee)');

  // A failed request (no answer) goes back to the list.
  const failing = new TeamInfoWindow(mk({ fail: true }), t11);
  failing.show();
  failing.key(k('Enter'));
  await tick();
  eq([failing.state, failing.open], ['list', true], 'a failed 18EA keeps the window on the list');

  // A late answer after closing is dropped.
  const late = new TeamInfoWindow(mk(), t11);
  late.show();
  late.key(k('Enter'));
  late.close();
  await tick();
  eq([late.state, late.subRows], ['list', null], 'answer after close is dropped');
}

// --- Home menu > Team > Team Log (0x27): the team chat window's show / hide rows -------------
{
  eq(TEAM_LOG_POS, { x: 13, y: 256 }, 'the Team Log list at get_gui_position(0x16) (static)');
  const sent: string[] = [];
  const chat = new TeamChat((sender, text) => sent.push(`${sender}:${text}`));
  const log = new TeamLogWindow({ shown: () => chat.open, window: (on) => chat.setWindow(on) }, t11);
  eq([log.open, log.cursor], [false, 0], 'closed before show');
  eq(chat.open, false, 'the team chat window starts hidden');

  // Opened hidden: the cursor starts on row 1 (hide); no change to the window.
  log.show();
  eq([log.open, log.cursor, chat.open, chat.locked], [true, 1, false, false], 'hidden window: cursor on hide, nothing changed');

  // Up highlights row 0 (show): the window opens and is locked (0x180).
  log.key(k('ArrowUp'));
  eq([log.cursor, chat.open, chat.locked, chat.routes()], [0, true, true, true], 'row 0 previews show (open + lock)');

  // Enter on show: the list closes and the window stays shown.
  const kept = log.key(k('Enter'));
  eq([kept, log.open, chat.open, chat.locked], [false, false, true, true], 'decide on show closes the list, window stays shown');

  // Reopened shown: the cursor starts on row 0; Down previews hide and clears the lock.
  log.show();
  eq([log.cursor, chat.open], [0, true], 'shown window: cursor on show');
  log.key(k('ArrowDown'));
  eq([log.cursor, chat.open, chat.locked], [1, false, false], 'row 1 previews hide (0x180 cleared)');
  log.key(k('Enter'));
  eq([log.open, chat.open], [false, false], 'decide on hide closes the list, window hidden');

  // Cancel closes and keeps the window as the cursor row left it.
  log.show();
  log.key(k('ArrowUp'));
  eq(chat.open, true, 'preview shows the window');
  const cancelled = log.key(k('Escape'));
  eq([cancelled, log.open, chat.open], [false, false, true], 'Escape closes the list; window as last previewed');

  // The F9 toggle still works after the Team Log (the same two bits).
  chat.toggle();
  eq([chat.open, chat.locked], [false, false], 'F9 hides the shown window (both bits clear)');
  eq(sent, [], 'the Team Log sends nothing');

  // Draw smoke test: the list draws with the stub canvas.
  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  log.show();
  log.draw(ctx, skin, 0);
  log.close();
  log.draw(ctx, skin, 0);
  check(true, 'draw smoke');
}

// --- Home menu > Team > Invite (0x29): the nearby list, the invite and the answer ---------------
{
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const sent: number[] = [];
  let answer: 'declined' | 'joined' | 'full' | 'failed' | 'absent' = 'declined';
  const host = {
    nearby: async () => [
      { name: 'Ann', guildCard: 7 },
      { name: 'Bo', guildCard: 9 },
    ],
    invite: async (gc: number) => {
      sent.push(gc);
      return answer;
    },
  };
  const inv = new TeamInviteWindow(host, t11);
  eq([inv.open, inv.pending], [false, false], 'Invite closed before show');
  inv.show();
  eq([inv.open, inv.pending], [true, false], 'Invite opens at once (the list comes with the answer)');
  await flush();
  inv.key(k('ArrowDown'));
  inv.key(k('Enter'));
  eq([sent, inv.pending], [[9], true], 'Enter on row 2 invites its card and waits for the answer');
  inv.key(k('Escape'));
  eq(inv.open, true, 'Cancel is ignored while the answer is pending (ASSUMED)');
  await flush();
  eq([inv.open, inv.pending, inv.shown], [true, false, 'T11[14d]'], 'a declined answer shows its message (the window stays open)');
  eq([inv.key(k('Enter')), inv.open], [false, false], 'Enter on the message closes the window');

  // Cancel closes the list with no invite.
  const quiet = new TeamInviteWindow(host, t11);
  quiet.show();
  await flush();
  eq([quiet.key(k('Escape')), quiet.open, sent.length], [false, false, 1], 'Cancel closes the list, nothing sent');

  // A failed nearby request leaves no rows (Enter does nothing).
  const bad = new TeamInviteWindow({ nearby: () => Promise.reject(new Error('x')), invite: host.invite }, t11);
  bad.show();
  await flush();
  bad.key(k('Enter'));
  eq([bad.open, bad.pending, sent.length], [true, false, 1], 'no rows after a failed list: Enter invites nobody');

  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  inv.show();
  inv.draw(ctx, skin, 0);
  inv.close();
  inv.draw(ctx, skin, 0);
  check(true, 'Invite draw smoke');
}

// --- Home menu > Team > Invite: the inviter's message box (unitxt 11, the exe's states 3..9) ----
{
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const texts: Record<number, string> = {
    0x14c: 'Now inviting %s.',
    0x14d: '%s',
    0x150: 'has agreed to join',
    0x152: 'Team [%s] is already full.',
    0x153: 'Invitation failed.',
  };
  const tx = (i: number) => texts[i] ?? `?${i.toString(16)}`;
  let settle: ((o: 'joined' | 'full' | 'failed' | 'declined' | 'absent') => void) | null = null;
  let sent = 0;
  const host = {
    nearby: async () => [
      { name: 'Ann', guildCard: 7 },
      { name: 'Bo', guildCard: 9 },
    ],
    invite: (_gc: number) => {
      sent++;
      return new Promise<'joined' | 'full' | 'failed' | 'declined' | 'absent'>((r) => {
        settle = r;
      });
    },
    teamName: () => 'Blue',
  };
  const answer = async (o: 'joined' | 'full' | 'failed' | 'declined' | 'absent') => {
    settle?.(o);
    await flush();
  };
  const open = async () => {
    const w = new TeamInviteWindow(host, tx);
    w.show();
    await flush();
    return w;
  };

  // Sent: the row's name goes into the sent text while the answer is awaited (state 3..4).
  let w = await open();
  w.key(k('Enter'));
  eq([w.pending, w.shown, sent], [true, 'Now inviting Ann.', 1], 'Enter on Ann: the sent text (0x14c) shows while waiting');
  await answer('declined');
  eq([w.pending, w.open, w.shown], [false, true, 'Ann'], 'declined (3): the name text (0x14d) with the invitee name');
  w.key(k('Enter'));
  eq(w.open, false, 'decide closes the declined message');

  w = await open();
  w.key(k('Enter'));
  await answer('joined');
  eq(w.shown, 'has agreed to join', 'joined (04EA 0): the agreed text (0x150)');
  w.key(k('Enter'));
  eq(w.open, false, 'decide closes the joined message');

  w = await open();
  w.key(k('ArrowDown'));
  w.key(k('Enter'));
  await answer('full');
  eq(w.shown, 'Team [Blue] is already full.', 'full (04EA 5): the own team name in the full text (0x152)');

  w = await open();
  w.key(k('Enter'));
  await answer('failed');
  eq(w.shown, 'Invitation failed.', 'failed (other 04EA flag, or another 6xC2 answer): 0x153');

  w = await open();
  w.key(k('Enter'));
  await answer('absent');
  eq(w.shown, 'Invitation failed.', 'absent (no such player): 0x153 as the exe state 8');

  // Idle: the list counter (DAT_00973a48 = 300) past 300 frames shows the failed text.
  w = await open();
  for (let i = 0; i < 300; i++) w.tick();
  eq([w.open, w.shown], [true, ''], '300 idle frames: the list is still open');
  w.tick();
  eq(w.shown, 'Invitation failed.', 'the 301st idle frame: the failed text (state 8)');
  w.key(k('Enter'));
  eq(w.open, false, 'decide closes the idle message');

  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  w = await open();
  w.draw(ctx, skin, 0);
  w.key(k('Enter'));
  await answer('declined');
  w.draw(ctx, skin, 0);
  check(true, 'Invite message draw smoke');
}

// --- Home menu > Team > Point Regist (0x2d): the items, the amount, Yes / No and the 6xCC -------
{
  const exchanged: number[][] = [];
  const rows = [
    { id: 0x100, name: 'Sword', count: 1, teamPoints: 4 },
    { id: 0x200, name: 'Mate', count: 5, teamPoints: 2 },
    { id: 0x300, name: 'Trash', count: 3, teamPoints: 0 },
  ];
  const pt = new TeamPointWindow(
    { itemRows: () => rows, exchange: (id, amount) => exchanged.push([id, amount]) },
    t11,
  );
  pt.show();
  eq([pt.open, pt.state], [true, 'items'], 'Point Regist opens on the item list');
  eq(pt.key(k('ArrowDown')) && pt.key(k('Enter')) && pt.state, 'quantity', 'a stack asks the amount (Mate, 5)');
  pt.key(k('ArrowDown'));
  pt.key(k('ArrowDown'));
  pt.key(k('Enter'));
  eq([pt.state, pt.points], ['confirm', 0], 'amount 3 goes to Yes / No (no points yet)');
  pt.key(k('ArrowUp')); // the cursor starts on No
  pt.key(k('Enter'));
  eq([exchanged, pt.state, pt.points], [[[0x200, 3]], 'done', 6], 'Yes sends 6xCC for 3 Mates: 3 x 2 team points');
  eq(pt.key(k('Enter')), false, 'a key on the result line closes the window');
  eq(pt.open, false, 'closed');

  // Single item, No goes back to the list; Cancel on the list closes.
  const single = new TeamPointWindow({ itemRows: () => rows, exchange: (id, amount) => exchanged.push([id, amount]) }, t11);
  single.show();
  single.key(k('Enter'));
  eq(single.state, 'confirm', 'a single item asks Yes / No at once');
  single.key(k('Enter')); // cursor on No
  eq([single.state, exchanged.length], ['items', 1], 'No returns to the item list, nothing sent');
  eq([single.key(k('Escape')), single.open], [false, false], 'Cancel on the list closes');

  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  pt.show();
  pt.draw(ctx, skin, 0);
  pt.close();
  pt.draw(ctx, skin, 0);
  check(true, 'Point Regist draw smoke');
}

// --- Master Transfer (2026-10-30): the leader list, the 6xCD wait, 11EA flag 0x40 -----------------
{
  const lobby = new Map<number, string>([[901, 'LeadInLobby']]);
  const extra = (answer: number, transferred: number[]) => ({
    lobbyPlayerName: (card: number) => lobby.get(card) ?? null,
    transfer: async (card: number) => (transferred.push(card), answer),
    cancelTransfer: () => transferred.push(-1),
  });
  const run = async (answer: number, priv = 0) => {
    const { host: h, calls } = host(team(PRIVILEGE.master), { privilege: priv });
    const sent: number[] = [];
    Object.assign(h, extra(answer, sent));
    const { m } = await openMaster(h);
    if (m.phase.kind === 'master') eq(m.phase.list.items[3].enabled, true, 'Master Transfer is enabled with the host pair');
    for (let i = 0; i < 3; i++) m.key(k('ArrowDown'));
    m.key(k('Enter'));
    eq(m.phase.kind, 'loading', 'Master Transfer asks for the member list (08EA)');
    await tick();
    return { m, calls, sent };
  };

  const a = await run(2);
  check(a.m.phase.kind === 'pick', 'the leader list arrives');
  if (a.m.phase.kind === 'pick') {
    eq(a.m.phase.list.items.map((i) => i.value), [901], 'only leaders that are in the lobby are offered');
    eq(a.m.phase.title, 'T15[7b] %s', 'titled [15:0x7b]');
  }
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'pickConfirm', 'a leader asks the question [15:0x7c]');
  if (a.m.phase.kind === 'pickConfirm') {
    check(a.m.phase.q.text.startsWith('T15[7c]'), 'question text 0x7c');
    eq(a.m.phase.q.cursor, 1, 'the cursor starts on No');
  }
  a.m.key(k('ArrowUp'));
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'transferWait', 'Yes sends the 6xCD and waits (state 68)');
  if (a.m.phase.kind === 'transferWait') {
    check(a.m.phase.info.text.startsWith('T15[7d]') || a.m.phase.info.text.includes('LeadInLobby') || a.m.phase.info.text.includes('T15[7d]'), 'the wait text [15:0x7d]');
    eq([a.m.phase.info.x, a.m.phase.info.y, a.m.phase.info.w, a.m.phase.info.h], [294, 305, 342, 144], 'the wait window is the info window at 0xd5, 342 x 144');
  }
  eq(a.sent, [901], 'transfer() called for the chosen card');
  await tick();
  await tick();
  eq(a.calls.privileges, [[901, 0x40]], 'the accept sends 11EA with flag 0x40');
  check(a.m.phase.kind === 'notice' && a.m.phase.info.text.includes('T15[7e]'), 'the 11EA answer 0 shows [15:0x7e]');
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'closed', 'Enter closes the menus');

  const d = await run(3);
  d.m.key(k('Enter'));
  d.m.key(k('ArrowUp'));
  d.m.key(k('Enter'));
  await tick();
  await tick();
  eq(d.calls.privileges, [], 'a refusal sends no 11EA');
  check(d.m.phase.kind === 'notice' && d.m.phase.info.text.includes('T15[7f]'), 'action 3: [15:0x7f] "has declined"');

  const b = await run(1);
  b.m.key(k('Enter'));
  b.m.key(k('ArrowUp'));
  b.m.key(k('Enter'));
  await tick();
  await tick();
  eq(b.calls.privileges, [], 'a busy answer sends no 11EA');
  check(b.m.phase.kind === 'notice' && b.m.phase.info.text.includes('T15[80]'), 'action 1: [15:0x80] "Transfer failed."');

  const f = await run(2, 3);
  f.m.key(k('Enter'));
  f.m.key(k('ArrowUp'));
  f.m.key(k('Enter'));
  await tick();
  await tick();
  check(f.m.phase.kind === 'notice' && f.m.phase.info.text.includes('T15[80]'), 'a failed 11EA shows [15:0x80]');

  // The player left the lobby between the list and the Yes: the failure notice, no 6xCD.
  const g = await run(2);
  g.m.key(k('Enter'));
  lobby.delete(901);
  g.m.key(k('ArrowUp'));
  g.m.key(k('Enter'));
  check(g.m.phase.kind === 'notice' && g.m.phase.info.text.includes('T15[80]') && g.sent.length === 0, 'a card no longer in the lobby fails without a 6xCD');
  lobby.set(901, 'LeadInLobby');

  // No leader in the lobby: the "No Player" row goes back to the master menu.
  lobby.delete(901);
  const n = await run(2);
  if (n.m.phase.kind === 'pick') eq(n.m.phase.list.items.map((i) => [i.label, i.value]), [['T11[f1]', 0]], 'no leader in the lobby: one "No Player" row');
  n.m.key(k('Enter'));
  eq(n.m.phase.kind, 'master', 'the "No Player" row returns to the master menu');
  lobby.set(901, 'LeadInLobby');

  // Cancel while waiting drops the wait.
  const c = await run(2);
  c.m.key(k('Enter'));
  c.m.key(k('ArrowUp'));
  c.m.key(k('Enter'));
  const closedBefore = c.sent.length;
  c.m.key(k('Backspace'));
  eq([c.m.phase.kind, c.sent.slice(closedBefore)], ['closed', [-1]], 'Cancel while waiting closes and cancels the wait (port convenience)');
}

// --- Buying Privileges --------------------------------------------------------------------------
{
  const rewards = [
    { name: 'Dressing room', description: 'desc A', teamPoints: 500, rewardId: 7 },
    { name: 'Team flag', description: 'desc B', teamPoints: 2500, rewardId: 0 },
    { name: 'Ticket', description: 'desc C', teamPoints: 100, rewardId: 12 },
  ];
  const { host: h } = host(team(PRIVILEGE.master));
  const bought: number[] = [];
  let asked = 0;
  Object.assign(h, {
    intraRanking: async () => (asked++, { rankingPoints: 0, pointsRemaining: 1200, entries: [] }),
    rewards: async (owned: boolean) => (owned ? [] : rewards),
    buyReward: (id: number) => bought.push(id),
  });
  const { m } = await openMaster(h);
  if (m.phase.kind === 'master') eq(m.phase.list.items[5].enabled, true, 'Buying Privileges is enabled with the host pair');
  for (let i = 0; i < 5; i++) m.key(k('ArrowDown'));
  m.key(k('Enter'));
  eq(m.phase.kind, 'buyLoading', 'row 5 asks 18EA (state 77)');
  await tick();
  await tick();
  eq(m.phase.kind, 'buy', 'the 1AEA list opens the window (state 79)');
  if (m.phase.kind === 'buy') {
    eq(m.phase.buy.points, 1200, 'the points remaining come from 18EA');
    eq(m.phase.buy.rewards.map((r) => rewardAffordable(m.phase.kind === 'buy' ? m.phase.buy.points : 0, r)), [true, false, true], 'a reward dearer than the points is greyed');
  }
  m.key(k('ArrowDown')); // the 2500 row
  m.key(k('Enter'));
  eq(m.phase.kind, 'buy', 'Decide on a greyed reward does nothing');
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq(m.phase.kind, 'buyConfirm', 'Decide on an affordable reward asks Buy / Don\'t Buy');
  if (m.phase.kind === 'buyConfirm') eq(m.phase.cursor, 1, 'the cursor starts on Don\'t Buy');
  m.key(k('Enter')); // Don't Buy: 18EA again
  eq(m.phase.kind, 'buyLoading', 'Don\'t Buy refreshes the window');
  await tick();
  await tick();
  eq([m.phase.kind, asked], ['buy', 2], 'the refresh asked 18EA again and came back to the list');
  m.key(k('Enter'));
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq(bought, [7], 'Buy sends 1BEA with the reward id');
  check(m.phase.kind === 'notice' && m.phase.info.text.includes('T15[8b]'), 'the notice [15:0x8b] "Purchased %s."');
  m.key(k('Enter'));
  eq(m.phase.kind, 'closed', 'Enter closes the menus');

  // Cancel on the list asks "any other business?".
  const r2 = await openMaster(h);
  for (let i = 0; i < 5; i++) r2.m.key(k('ArrowDown'));
  r2.m.key(k('Enter'));
  await tick();
  await tick();
  r2.m.key(k('Backspace'));
  eq(r2.m.phase.kind, 'other', 'Cancel on the list asks the other-business question');

  // Draw smoke over the three phases.
  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  const r3 = await openMaster(h);
  for (let i = 0; i < 5; i++) r3.m.key(k('ArrowDown'));
  r3.m.key(k('Enter'));
  await tick();
  await tick();
  r3.m.draw(ctx, skin, 0);
  r3.m.key(k('Enter'));
  r3.m.draw(ctx, skin, 0);
  check(r3.m.phase.kind === 'buyConfirm', 'Buying Privileges draw smoke');
  eq([BUY_POS.list, BUY_POS.detail, BUY_POS.points], [{ x: 12, y: 50, w: 385, h: 184 }, { x: 400, y: 50, w: 228, h: 184 }, { x: 428, y: 234, w: 200, h: 40 }], 'window geometry from the exe');
}

// --- Team Flag Records --------------------------------------------------------------------------
{
  const flag = new Uint16Array(32 * 32).fill(0x8000 | (31 << 10));
  const stored: Uint16Array[] = [];
  const mk = (flags: number, pick: FlagPick) => {
    const { host: h } = host(team(PRIVILEGE.master));
    Object.assign(h, { rewardFlags: () => flags, pickFlag: async () => pick, setFlag: (f: Uint16Array) => stored.push(f) });
    return h;
  };
  // Without the team flag reward (1DEA bit 0) the row is greyed.
  const off = await openMaster(mk(2, { status: 1, flag }));
  if (off.m.phase.kind === 'master') eq(off.m.phase.list.items[6].enabled, false, 'rewards bit 0 clear: Team Flag Records is greyed');
  const on = await openMaster(mk(1, { status: 1, flag }));
  if (on.m.phase.kind === 'master') eq(on.m.phase.list.items[6].enabled, true, 'rewards bit 0 set: Team Flag Records is enabled');
  for (let i = 0; i < 6; i++) on.m.key(k('ArrowDown'));
  on.m.key(k('Enter'));
  eq(on.m.phase.kind, 'flagAsk', 'row 6 opens the question [15:0x8e]');
  if (on.m.phase.kind === 'flagAsk') eq(on.m.phase.cursor, 0, 'the Yes / No list starts on Yes (no SetSelection in the exe)');
  on.m.key(k('Enter'));
  eq(on.m.phase.kind, 'flagPicking', 'Yes asks the host for the picture');
  await tick();
  eq(on.m.phase.kind, 'flagStore', 'the picture opens the store question [15:0x8f]');
  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  on.m.draw(ctx, skin, 0);
  on.m.key(k('Enter'));
  eq(stored.length, 1, 'Yes sends 0FEA (setFlag)');
  eq(stored[0]?.length, 1024, 'with the 32 x 32 words');
  check(on.m.phase.kind === 'flagMessage' && on.m.phase.text === 'T15[90] %s', 'the message [15:0x90] "Recording complete."');
  on.m.key(k('Enter'));
  eq(on.m.phase.kind, 'other', 'the accept key ends the object (state 7: any other business?)');

  // No on the store question stores nothing.
  const no = await openMaster(mk(1, { status: 1, flag }));
  for (let i = 0; i < 6; i++) no.m.key(k('ArrowDown'));
  no.m.key(k('Enter'));
  no.m.key(k('Enter'));
  await tick();
  no.m.key(k('ArrowDown'));
  no.m.key(k('Enter'));
  eq([no.m.phase.kind, stored.length], ['other', 1], 'No on the store question stores nothing');

  // The load errors: 2 not found, 3 format, 4 read failed.
  for (const [status, id] of [[2, 0x91], [3, 0x92], [4, 0x93]] as const) {
    const e = await openMaster(mk(1, { status }));
    for (let i = 0; i < 6; i++) e.m.key(k('ArrowDown'));
    e.m.key(k('Enter'));
    e.m.key(k('Enter'));
    await tick();
    check(e.m.phase.kind === 'flagMessage' && e.m.phase.text === `T15[${id.toString(16)}] %s`, `load status ${status}: message [15:0x${id.toString(16)}]`);
  }
  // No on the first question ends it.
  const n1 = await openMaster(mk(1, { status: 1, flag }));
  for (let i = 0; i < 6; i++) n1.m.key(k('ArrowDown'));
  n1.m.key(k('Enter'));
  n1.m.key(k('ArrowDown'));
  n1.m.key(k('Enter'));
  eq(n1.m.phase.kind, 'other', 'No on the first question ends the object');
  eq([FLAG_POS.preview, FLAG_POS.message, FLAG_POS.list], [{ x: 100, y: 180, w: 100, h: 100 }, { x: 220, y: 180, w: 320, h: 100 }, { x: 460, y: 280 }], 'window geometry from the exe');
}

// --- banned team names ----------------------------------------------------------------------------
{
  eq(BANNED_NAMES.length, 90, 'the exe lists 90 banned strings (0x168 / 4)');
  check(isBannedName('SEGA') && isBannedName('MySegaTeam') && isBannedName('xGameMasterx') && isBannedName('ソニックチーム'), 'a name containing an entry is banned');
  check(!isBannedName('sega') && !isBannedName('Sonic') && !isBannedName('Reds'), 'wcsstr is case sensitive and needs the whole entry');
  const { host: h, calls } = host(NO_TEAM);
  const { m } = menus(h);
  m.begin(0);
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  m.key(k('Enter'));
  for (const c of 'MySegaTeam') m.key(k(c));
  m.key(k('Enter'));
  m.key(k('Enter'));
  eq(m.phase.kind, 'nameConfirm', 'a banned name still reaches the confirmation');
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  check(m.phase.kind === 'notice' && m.phase.info.text.includes('T15[6b]') && m.phase.next === 'name', 'Yes on a banned name shows [15:0x6b] and Enter reopens the name window');
  eq(calls.created, [], 'no 01EA is sent for a banned name');
}

// --- the Master Transfer prompt (the chosen leader's side) -------------------------------------------
{
  const request = parseMasterRequest(masterTransferSubcommand({ selfId: 3, name: 'Boss', teamName: 'Reds' }));
  const mkp = (withdrawn = false) => {
    const sent: Array<{ target: number; body: Uint8Array }> = [];
    const state = { withdrawn };
    const w = new MasterTransferPromptWindow(request, {
      text: (g, i) => `T${g}[${i.toString(16)}] %s %s`,
      ownCard: () => 0x1234,
      ownName: () => 'Leader',
      send: (target, body) => sent.push({ target, body }),
      withdrawn: () => state.withdrawn,
    });
    return { w, sent, state };
  };
  const yes = () => [k('ArrowUp'), k('Enter')];
  const { w, sent } = mkp();
  eq(w.state, 'intro', 'the intro text first');
  w.key(k('Enter'));
  eq(w.state, 'ask', 'a key moves to the first Yes / No');
  eq(w.cursorRow, 1, 'the cursor starts on No');
  yes().forEach((e) => w.key(e));
  eq(w.state, 'notice', 'Yes shows the notice [11:0x17b]');
  w.key(k('Enter'));
  eq([w.state, w.cursorRow], ['confirm', 1], 'the second Yes / No, cursor on No');
  yes().forEach((e) => w.key(e));
  eq([sent.length, sent[0]?.target, w.open], [1, 3, false], 'the second Yes answers the master and closes with no text');
  const a = parseMasterAnswer(sent[0].body);
  eq([a.guildCard, a.action, a.name], [0x1234, 2, 'Leader'], 'the 6xCE carries the own card, action 2 and the name');

  const dn = mkp();
  dn.w.key(k('Enter'));
  dn.w.key(k('Enter')); // No
  eq(dn.sent.length, 1, 'No on the first list answers');
  eq(parseMasterAnswer(dn.sent[0].body).action, 3, 'action 3 (declined)');
  check(dn.w.state === 'message' && dn.w.open, 'the refusal text is shown');
  dn.w.draw(ctx, { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource }, 0);
  dn.w.key(k('Enter'));
  eq(dn.w.open, false, 'a key closes it');

  const cn = mkp();
  cn.w.key(k('Enter'));
  cn.w.key(k('Escape'));
  eq(parseMasterAnswer(cn.sent[0].body).action, 3, 'Cancel on the first list declines');

  const to = mkp();
  to.w.key(k('Enter'));
  for (let i = 0; i < 449; i++) to.w.tick();
  eq(to.sent.length, 0, '449 frames: still waiting');
  to.w.tick();
  eq(parseMasterAnswer(to.sent[0].body).action, 1, 'the 450th frame answers 1 (busy / time-out)');
  check(to.w.state === 'message', 'with the cancelled text');

  const wd = mkp(true);
  wd.w.tick();
  check(wd.w.state === 'message' && wd.sent.length === 0, 'a withdrawn request shows the cancelled text and answers nothing');
}

// --- the 07EA operation notices (2026-10-31): leave, Master Transfer --------------------------------
{
  // team_leave_success_display: 05EA, then 07EA with unitxt 11 0x14d (the own name) and 15 0x85 (the team).
  const order: string[] = [];
  const notes: string[] = [];
  const { host: h } = host(team(PRIVILEGE.member, 'Beta'));
  Object.assign(h, {
    removeMember: async () => (order.push('05EA'), 0),
    ownName: () => 'Me',
    operationNotice: (t: string) => (order.push('07EA'), notes.push(t)),
  });
  const { m } = menus(h);
  m.begin(3);
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  eq(order, ['05EA', '07EA'], 'Leave: 05EA, then the 07EA without waiting');
  eq(notes, [format(t11(0x14d), 'Me') + format(t15(T15_TEAM.left), 'Beta')], 'the 07EA text is the two team log lines, no separator');
}
{
  // team_master_transfer_success_display: 07EA with [15:0x7e] and the row's label, sent on the 11EA 0 only.
  const sent: string[] = [];
  const { host: h } = host(team(PRIVILEGE.master));
  Object.assign(h, {
    lobbyPlayerName: (card: number) => (card === 901 ? 'LeadInLobby' : null),
    transfer: async () => MASTER_ANSWER.accept,
    operationNotice: (t: string) => sent.push(t),
  });
  const { m } = await openMaster(h);
  for (let i = 0; i < 3; i++) m.key(k('ArrowDown'));
  m.key(k('Enter'));
  await tick();
  m.key(k('Enter')); // the leader (901)
  m.key(k('ArrowUp'));
  m.key(k('Enter')); // Yes: 6xCD
  await tick();
  await tick();
  eq(sent, [format(T15_TEAM_DONE_TEXT, '<0002> Lead')], 'the transfer 07EA: [15:0x7e] with the row label');
  check(m.phase.kind === 'notice' && m.phase.info.text.includes('T15[7e]'), 'and the notice shows the same text');
}
{
  // A refused transfer (11EA 1) sends no 07EA.
  const sent: string[] = [];
  const { host: h } = host(team(PRIVILEGE.master), { privilege: 1 });
  Object.assign(h, {
    lobbyPlayerName: (card: number) => (card === 901 ? 'LeadInLobby' : null),
    transfer: async () => MASTER_ANSWER.accept,
    operationNotice: (t: string) => sent.push(t),
  });
  const { m } = await openMaster(h);
  for (let i = 0; i < 3; i++) m.key(k('ArrowDown'));
  m.key(k('Enter'));
  await tick();
  m.key(k('Enter'));
  m.key(k('ArrowUp'));
  m.key(k('Enter'));
  await tick();
  await tick();
  eq(sent, [], 'a failed 11EA sends no 07EA');
}

// --- Team name change (Buying Privileges row 0x1a, 2026-10-31) -------------------------------------
{
  const rewards = [
    { name: 'Ticket', description: 'desc', teamPoints: 100, rewardId: 12 },
    { name: 'Team name change', description: 'desc', teamPoints: 300, rewardId: 26 },
  ];
  const run = async (answer: number, points = 1200) => {
    const renamed: Array<[string, number]> = [];
    const notes: string[] = [];
    const { host: h } = host(team(PRIVILEGE.master));
    Object.assign(h, {
      intraRanking: async () => ({ rankingPoints: 0, pointsRemaining: points, entries: [] }),
      rewards: async () => rewards,
      buyReward: () => {},
      renameTeam: async (name: string, id: number) => (renamed.push([name, id]), answer),
      operationNotice: (t: string) => notes.push(t),
    });
    const r = await openMaster(h);
    for (let i = 0; i < 5; i++) r.m.key(k('ArrowDown'));
    r.m.key(k('Enter'));
    await tick();
    await tick();
    r.m.key(k('ArrowDown')); // the 0x1a row
    return { ...r, renamed, notes };
  };

  // The rename row opens the name window at once (no Buy / Don't Buy), the 1EEA carries the name and 0x1a.
  const a = await run(0);
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'name', 'the rename row opens the team name window');
  if (a.m.phase.kind === 'name') eq([a.m.phase.w.kind, a.m.phase.w.rewardId, a.m.phase.w.row], ['rename', 26, 1], 'a rename window, the cursor on the name row');
  a.m.key(k('Enter'));
  check(a.m.textInput() !== null, 'the name editor takes text');
  for (const c of 'New Team') a.m.key(k(c));
  a.m.key(k('Enter'));
  if (a.m.phase.kind === 'name') eq([a.m.phase.w.name, a.m.phase.w.row], ['NewTeam', 2], 'spaces are removed; Registration is reachable');
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'nameConfirm', 'Registration asks the same question');
  if (a.m.phase.kind === 'nameConfirm') eq(a.m.phase.q.text, 'T15[67] NewTeam', 'the question names the new team name');
  a.m.key(k('ArrowUp'));
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'creating', 'Yes sends 1EEA and waits for 1FEA');
  eq(a.renamed, [['NewTeam', 26]], 'renameTeam called with the name and the reward id');
  await tick();
  eq(a.m.phase.kind, 'notice', 'the 1FEA answer is a notice');
  if (a.m.phase.kind === 'notice') check(a.m.phase.info.text.includes('T15[94]') && a.m.phase.next === 'close', 'result 0: [15:0x94] and Enter closes');
  eq(a.notes, ['T15[9a] NewTeam'], 'result 0 sends the 07EA with [15:0x9a] and the new name');
  a.m.key(k('Enter'));
  eq(a.m.phase.kind, 'closed', 'Enter closes everything');

  // Greyed: a 300 row with 100 points left buzzes and opens nothing.
  const g = await run(0, 100);
  g.m.key(k('Enter'));
  eq([g.m.phase.kind, g.renamed.length], ['buy', 0], 'a greyed rename row opens nothing');

  // Result 2: [15:0x6b] and Enter goes to the creation name window (the exe's HandleLobbyMenuTeamCreationFailed).
  const d = await run(2);
  d.m.key(k('Enter'));
  d.m.key(k('Enter'));
  for (const c of 'Dup') d.m.key(k(c));
  d.m.key(k('Enter'));
  d.m.key(k('Enter'));
  d.m.key(k('ArrowUp'));
  d.m.key(k('Enter'));
  await tick();
  check(d.m.phase.kind === 'notice' && d.m.phase.info.text.includes('T15[6b]') && d.m.phase.next === 'name', 'result 2: [15:0x6b], the next window is the name window');
  d.m.key(k('Enter'));
  eq(d.m.phase.kind === 'name' ? d.m.phase.w.kind : null, 'create', 'Enter opens the creation name window');
  eq(d.notes, [], 'no 07EA for a name in use');

  // Result 1 (or any failure): [15:0x95], no 07EA.
  const f = await run(1);
  f.m.key(k('Enter'));
  f.m.key(k('Enter'));
  for (const c of 'Fail') f.m.key(k(c));
  f.m.key(k('Enter'));
  f.m.key(k('Enter'));
  f.m.key(k('ArrowUp'));
  f.m.key(k('Enter'));
  await tick();
  check(f.m.phase.kind === 'notice' && f.m.phase.info.text.includes('T15[95]') && f.m.phase.next === 'close', 'a failed 1FEA shows [15:0x95]');
  eq(f.notes, [], 'a failed rename sends no 07EA');

  // A banned name (the company list) is refused before the packet, as for the creation.
  const b = await run(0);
  b.m.key(k('Enter'));
  b.m.key(k('Enter'));
  for (const c of 'Sega') b.m.key(k(c));
  b.m.key(k('Enter'));
  b.m.key(k('Enter'));
  b.m.key(k('ArrowUp'));
  b.m.key(k('Enter'));
  eq([b.renamed.length, b.m.phase.kind === 'notice' && b.m.phase.info.text.includes('T15[6b]')], [0, true], 'a banned name: [15:0x6b], no 1EEA');

  // Cancel in the name window closes.
  const c = await run(0);
  c.m.key(k('Enter'));
  c.m.key(k('Backspace'));
  eq(c.m.phase.kind, 'closed', 'Cancel in the rename window closes');

  // The window's third row is group 15 0x2f (the creation window has unitxt 11 0x64).
  const seen: Array<[string, number]> = [];
  const spy: TeamText = {
    t11: (i: number) => (seen.push(['11', i]), 'x'),
    t15: (i: number) => (seen.push(['15', i]), 'x'),
  };
  const skin = { frame: {} as CanvasImageSource, bars: {} as CanvasImageSource };
  drawNameWindow(ctx, skin, new TeamNameWindow('rename', 26), spy, 0, true);
  check(seen.some(([g2, i]) => g2 === '15' && i === 0x2f) && !seen.some(([g2, i]) => g2 === '11' && i === 0x64), 'the rename window draws 15:0x2f, not 11:0x64');
}

console.log(failures ? `${failures} of ${checks} FAILED` : `ALL PASS (${checks} checks)`);
process.exit(failures ? 1 : 0);

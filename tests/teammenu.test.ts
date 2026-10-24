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
  type TeamHost,
} from '../client/src/classic/teammenu.ts';
import { yesNoRect } from '../client/src/classic/titleflow.ts';
import { MailCompose } from '../client/src/classic/simplemail.ts';
import { NO_TEAM, PRIVILEGE, type TeamMember, type TeamMembership } from '../client/src/net/team.ts';

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
    eq(m.phase.list.items.map((i) => i.enabled), [true, true, true, false, true, false, false], 'Master Transfer, Buying Privileges and Flag Records are greyed (see the header)');
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
  eq(T11_TEAM_LOG, { title: 0x157, rows: [0x158, 0x159] }, 'Team Log labels (group 11, not ported)');

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

console.log(failures ? `${failures} of ${checks} FAILED` : `ALL PASS (${checks} checks)`);
process.exit(failures ? 1 : 0);

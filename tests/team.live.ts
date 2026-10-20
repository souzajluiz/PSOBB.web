// The team commands (EA family) against a live newserv: create / duplicate
// name / member list / add (invite) / promote / demote / team chat / rankings /
// lobby team info / rename / dismiss / leave / disband, with the 12EA
// membership updates the clients keep as g_pKeyTeamConfig.
// Requires newserv + bridge running. Run: node tests/team.live.ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BBSession } from '../client/src/net/bbsession.ts';
import type { Lobby } from '../client/src/net/lobby.ts';
import { inTeam, membershipFromSave, PRIVILEGE, TEAM_RESULT, TeamClient } from '../client/src/net/team.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (what: string, ok: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!ok()) {
    if (Date.now() - t > ms) throw new Error(`timeout: ${what}`);
    await sleep(20);
  }
};

interface Player {
  session: BBSession;
  lobby: Lobby;
  team: TeamClient;
  gc: number;
}

async function enter(user: string, charName: string, charClass: number): Promise<Player> {
  const session = new BBSession({ nsk, connect: nodeBridge });
  const init = await session.login(user, user);
  const slots = await session.characterPreviews();
  if (!slots[0]) await session.createCharacter(0, { name: charName, charClass });
  const lobby = await session.enterLobby(user, user, 0);
  const team = new TeamClient(lobby.conn, membershipFromSave(session.fullCharacter), init.guildCardNumber);
  return { session, lobby, team, gc: init.guildCardNumber };
}

// A previous run may have died half way: leave the team first.
async function clean(p: Player): Promise<void> {
  if (!inTeam(p.team.membership)) return;
  if (p.team.membership.privilege === PRIVILEGE.master) await p.team.disband();
  else await p.team.removeMember(p.gc);
}

const NAME = `WebTeam${Date.now() % 100000}`;
const RENAMED = `${NAME}b`.slice(0, 15);

try {
  const a = await enter('webteama', 'TeamMaster', 0);
  const b = await enter('webteamb', 'TeamMember', 6);
  await clean(b);
  await clean(a);
  await sleep(200);
  check('both start without a team', !inTeam(a.team.membership) && !inTeam(b.team.membership));

  // Create.
  check('A cannot be renamed without a team (1FEA generic error)', (await a.team.renameTeam('x')) === 1);
  const created = await a.team.createTeam(NAME);
  check(`create team "${NAME}" -> 02EA 0`, created === TEAM_RESULT.ok);
  await until('A membership (12EA)', () => inTeam(a.team.membership));
  check('A is the master (0x40) of the new team', a.team.membership.privilege === PRIVILEGE.master && a.team.membership.name === NAME && a.team.membership.masterGuildCard === a.gc);
  check('A cannot create a second team (02EA 1)', (await a.team.createTeam(`${NAME}2`)) === 1);
  check('B cannot reuse the name (02EA 2)', (await b.team.createTeam(NAME)) === TEAM_RESULT.nameInUse);

  // Members.
  let list = await a.team.members();
  check('member list has the master only', list.length === 1 && list[0].guildCard === a.gc && list[0].privilege === PRIVILEGE.master && list[0].rank === 1);
  check('team name request (0DEA -> 0EEA)', (await a.team.name()) === NAME);
  check('add member B (03EA -> 04EA 0)', (await a.team.addMember(b.gc)) === TEAM_RESULT.ok);
  await until('B membership (12EA)', () => inTeam(b.team.membership));
  check('B is in the team as a plain member', b.team.membership.name === NAME && b.team.membership.privilege === PRIVILEGE.member && b.team.membership.memberCount === 2);
  list = await a.team.members();
  check('member list has both', list.length === 2 && list.some((m) => m.guildCard === b.gc));

  // Privileges.
  check('promote B (11EA 0x30 -> 0)', (await a.team.setPrivilege(b.gc, PRIVILEGE.leader)) === 0);
  await until('B privilege 0x30', () => b.team.membership.privilege === PRIVILEGE.leader);
  check('B is a leader now', b.team.membership.privilege === PRIVILEGE.leader);
  check('promoting a leader again answers 5 ("already")', (await a.team.setPrivilege(b.gc, PRIVILEGE.leader)) === 5);
  check('demote B (11EA 0 -> 0)', (await a.team.setPrivilege(b.gc, PRIVILEGE.member)) === 0);
  await until('B privilege 0', () => b.team.membership.privilege === PRIVILEGE.member);
  check('B is a plain member again', b.team.membership.privilege === PRIVILEGE.member);
  check('demoting a member answers 5', (await a.team.setPrivilege(b.gc, PRIVILEGE.member)) === 5);

  // Team chat reaches the other member.
  const heard = new Promise<string>((r) => (a.team.onChat = (_s, text) => r(text)));
  b.team.chat('TeamMember', 'hello team');
  const said = await Promise.race([heard, sleep(3000).then(() => '')]);
  check(`team chat B -> A ("${said}")`, said === 'hello team');

  // Lobby team info and rankings.
  // 15EA is also pushed unprompted (one entry per membership change): the
  // client drops the ones that arrived before asking.
  await sleep(400);
  const near = await a.team.nearby();
  check('lobby team info (14EA -> 15EA) carries both players with the team name', near.length === 2 && near.every((n) => n.membership.name === NAME));
  const ranking = await a.team.crossRanking();
  check(`cross-team ranking (1CEA) lists "${NAME}"`, ranking.some((r) => r.name === NAME));
  const intra = await a.team.intraRanking();
  check('intra-team ranking (18EA) lists both members', intra.entries.length === 2);

  // Rename.
  check(`rename (1EEA -> 1FEA 0) to "${RENAMED}"`, (await a.team.renameTeam(RENAMED)) === 0);
  await until('A new name', () => a.team.membership.name === RENAMED);
  await until('B new name', () => b.team.membership.name === RENAMED);
  check('both clients got the new name by 12EA', a.team.membership.name === RENAMED && b.team.membership.name === RENAMED);

  // Leave and dismiss.
  check('B leaves (05EA own card -> 06EA 0)', (await b.team.removeMember(b.gc)) === 0);
  check('B has no team after leaving', !inTeam(b.team.membership));
  check('re-add B', (await a.team.addMember(b.gc)) === TEAM_RESULT.ok);
  await until('B back', () => inTeam(b.team.membership));
  check('dismiss B (05EA B -> 06EA 0)', (await a.team.removeMember(b.gc)) === 0);
  check('member list is the master again', (await a.team.members()).length === 1);

  // Disband.
  check('disband (10EA -> 10EA 0)', (await a.team.disband()) === 0);
  await until('A membership cleared', () => !inTeam(a.team.membership));
  check('A has no team after disbanding', !inTeam(a.team.membership));
  check('the name is free again', (await b.team.createTeam(NAME)) === TEAM_RESULT.ok);
  await clean(b);
} catch (err) {
  console.error(err);
  failures++;
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

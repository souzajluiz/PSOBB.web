// The EA team packets: builders match the exe's send_packet0xea_subcommand*
// layouts and the parsers read the newserv layouts. Run: node tests/team.test.ts
import {
  addMemberPacket,
  buyRewardPacket,
  createTeamPacket,
  crossRankingPacket,
  disbandPacket,
  exchangeTeamPointsPayload,
  INVITE_ANSWER_FRAMES,
  inviteAnswerSubcommand,
  InviteAnswerPrompt,
  inviteSubcommand,
  inviteTarget,
  parseInviteAnswer,
  TEAM_INVITE_ACCEPT,
  TEAM_INVITE_DECLINE,
  TEAM_INVITE_TIMEOUT,
  inTeam,
  memberListPacket,
  memberRowLabel,
  membershipFromSave,
  NO_TEAM,
  nearbyTeamsPacket,
  parseCrossRanking,
  parseIntraRanking,
  parseLobbyTeamInfo,
  parseMemberList,
  parseMembership,
  parseMembershipUpdate,
  parseRewardList,
  parseTeamChat,
  parseTeamName,
  privilegePacket,
  removeMemberPacket,
  renameTeamPacket,
  setFlagPacket,
  TEAM_CMD,
  teamChatPacket,
} from '../client/src/net/team.ts';

let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};

function putUtf16(dst: Uint8Array, off: number, text: string): void {
  const dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
  [...text].forEach((c, i) => dv.setUint16(off + i * 2, c.charCodeAt(0), true));
}

// Command numbers: (subcommand << 8) | 0xEA, as the exe writes bytes 0xEA, sub.
check('command numbers', TEAM_CMD.create === 0x01ea && TEAM_CMD.privilege === 0x11ea && TEAM_CMD.crossRanking === 0x1cea && TEAM_CMD.renameResult === 0x1fea);

// send_packet0xea_subcommand1: size 0x28 = header 8 + name[0x10] UTF-16.
{
  const p = createTeamPacket('Hunters');
  check('01EA payload is 0x20 bytes (size 0x28 with the header)', p.command === 0x01ea && p.flag === 0 && p.payload.length === 0x20);
  const dv = new DataView(p.payload.buffer);
  check('01EA name is UTF-16 LE, zero padded', dv.getUint16(0, true) === 0x48 && dv.getUint16(12, true) === 0x73 && dv.getUint16(14, true) === 0);
  check('01EA keeps at most 15 characters + terminator', createTeamPacket('x'.repeat(40)).payload.length === 0x20 && new DataView(createTeamPacket('x'.repeat(40)).payload.buffer).getUint16(0x1e, true) === 0);
}

// sub 3 / 5: size 0xC, guild card; sub 0x11: size 0xC, flag = privilege.
{
  const a = addMemberPacket(0x01020304);
  const r = removeMemberPacket(0x01020304);
  check('03EA / 05EA carry the guild card', a.command === 0x03ea && r.command === 0x05ea && a.payload.length === 4 && new DataView(a.payload.buffer).getUint32(0, true) === 0x01020304);
  const pr = privilegePacket(77, 0x30);
  check('11EA flag is the new privilege', pr.command === 0x11ea && pr.flag === 0x30 && new DataView(pr.payload.buffer).getUint32(0, true) === 77);
}

// Header-only requests.
check('08EA / 10EA / 1CEA are empty', memberListPacket().payload.length === 0 && disbandPacket().command === 0x10ea && crossRankingPacket().command === 0x1cea);
check('14EA asks with flag 1 (send_packet0xea_subcommand0x14)', nearbyTeamsPacket().flag === 1);
check('1BEA carries the reward id in the flag', buyRewardPacket(9).flag === 9);
check('1EEA name payload', renameTeamPacket('New', 3).flag === 3 && renameTeamPacket('New').payload.length === 0x20);

// 0FEA: 0x800 data bytes (size 0x808).
{
  const flag = new Uint16Array(0x400).fill(0x1234);
  const p = setFlagPacket(flag);
  check('0FEA payload is 0x800 bytes', p.payload.length === 0x800 && new DataView(p.payload.buffer).getUint16(0x7fe, true) === 0x1234);
  let threw = false;
  try {
    setFlagPacket(new Uint16Array(3));
  } catch {
    threw = true;
  }
  check('0FEA rejects a wrong sized flag', threw);
}

// 07EA: size ((len * 2 + 5) & ~3) + 0x28 and the text ends with two zero bytes
// (newserv relays it only then).
{
  const p = teamChatPacket('Name', 'hi there');
  check('07EA size matches SendTeamOperationSuccessPacket', 8 + p.payload.length === (('hi there'.length * 2 + 5) & ~3) + 0x28);
  check('07EA ends with two zero bytes', p.payload[p.payload.length - 1] === 0 && p.payload[p.payload.length - 2] === 0);
  const back = parseTeamChat(p.payload);
  check('07EA round trip', back.sender === 'Name' && back.text === 'hi there');
  check('07EA text is cut at 0x8F units', parseTeamChat(teamChatPacket('N', 'y'.repeat(300)).payload).text.length === 0x8f);
}

// PSOBBBaseTeamMembership.
function membershipBytes(): Uint8Array {
  const b = new Uint8Array(0x34);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 1234, true);
  dv.setUint32(4, 7, true);
  b[0x10] = 0x40;
  b[0x11] = 3;
  putUtf16(b, 0x14, '\tEAlpha');
  return b;
}
{
  const m = parseMembership(membershipBytes());
  check('membership fields', m.masterGuildCard === 1234 && m.teamId === 7 && m.privilege === 0x40 && m.memberCount === 3 && m.name === 'Alpha');
  check('inTeam looks at the first four fields', inTeam(m) && !inTeam(NO_TEAM) && inTeam({ ...NO_TEAM, unknownA6: 1 }));
  const save = new Uint8Array(0x3994);
  save.set(membershipBytes(), 0x315c);
  check('membership inside the E7 save data (0x315C)', membershipFromSave(save).name === 'Alpha' && membershipFromSave(null) === NO_TEAM);
  const upd = new Uint8Array(0x38);
  upd.set(membershipBytes(), 4);
  check('12EA applies when skip_update_system_file is 0', parseMembershipUpdate(upd)?.teamId === 7);
  upd[0] = 1;
  check('12EA is ignored when skip_update_system_file is not 0', parseMembershipUpdate(upd) === null);
  check('12EA too short is ignored', parseMembershipUpdate(new Uint8Array(8)) === null);
}

// 09EA member list.
{
  const b = new Uint8Array(4 + 2 * 0x2c);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 2, true);
  [
    [1, 0x40, 111, '\tEBoss'],
    [2, 0x00, 222, '\tERookie'],
  ].forEach(([rank, priv, gc, name], i) => {
    const o = 4 + i * 0x2c;
    dv.setUint32(o, rank as number, true);
    dv.setUint32(o + 4, priv as number, true);
    dv.setUint32(o + 8, gc as number, true);
    putUtf16(b, o + 12, name as string);
  });
  const list = parseMemberList(b);
  check('member list entries', list.length === 2 && list[1].guildCard === 222 && list[0].privilege === 0x40 && list[1].name === 'Rookie');
  check('member row label "<0001> name"', memberRowLabel(list[0]) === '<0001> Boss');
  check('truncated member list stops at the data', parseMemberList(b.slice(0, 4 + 0x2c + 10)).length === 1);
}

// 0EEA, 1CEA, 18EA, 19EA.
{
  const n = new Uint8Array(0x30);
  putUtf16(n, 0x10, '\tETeamX');
  check('0EEA team name', parseTeamName(n) === 'TeamX');

  const r = new Uint8Array(4 + 2 * 0x28);
  const dv = new DataView(r.buffer);
  dv.setUint32(0, 2, true);
  putUtf16(r, 4, '\tEOne');
  dv.setUint32(4 + 0x20, 900, true);
  putUtf16(r, 4 + 0x28, '\tETwo');
  dv.setUint32(4 + 0x28 + 0x20, 50, true);
  const ranks = parseCrossRanking(r);
  check('1CEA ranking rows', ranks.length === 2 && ranks[0].name === 'One' && ranks[0].points === 900 && ranks[1].points === 50);

  const i = new Uint8Array(0x10 + 0x30);
  const idv = new DataView(i.buffer);
  idv.setUint32(0, 640, true);
  idv.setUint32(8, 100, true);
  idv.setUint32(12, 1, true);
  idv.setUint32(0x10, 1, true);
  idv.setUint32(0x10 + 4, 0x40, true);
  idv.setUint32(0x10 + 8, 5, true);
  putUtf16(i, 0x10 + 12, '\tEMe');
  idv.setUint32(0x10 + 0x2c, 640, true);
  const intra = parseIntraRanking(i);
  check('18EA ranking', intra.rankingPoints === 640 && intra.pointsRemaining === 100 && intra.entries[0].name === 'Me' && intra.entries[0].points === 640);

  const w = new Uint8Array(4 + 0x188);
  const wdv = new DataView(w.buffer);
  wdv.setUint32(0, 1, true);
  putUtf16(w, 4, 'Reward');
  putUtf16(w, 4 + 0x80, 'Describes');
  wdv.setUint32(4 + 0x180, 500, true);
  wdv.setUint32(4 + 0x184, 3, true);
  const rewards = parseRewardList(w);
  check('19EA reward rows', rewards.length === 1 && rewards[0].name === 'Reward' && rewards[0].description === 'Describes' && rewards[0].teamPoints === 500 && rewards[0].rewardId === 3);
}

// 15EA lobby team info: flag = count, entries of 0x85C.
{
  const d = new Uint8Array(0x85c);
  d.set(membershipBytes(), 0);
  new DataView(d.buffer).setUint32(0x34, 4242, true);
  new DataView(d.buffer).setUint32(0x38, 2, true);
  putUtf16(d, 0x3c, '\tEPlayer');
  const info = parseLobbyTeamInfo({ command: 0x15ea, flag: 1, data: d });
  check('15EA entry', info.length === 1 && info[0].guildCard === 4242 && info[0].clientId === 2 && info[0].name === 'Player' && info[0].membership.name === 'Alpha');
  check('15EA with a short body yields nothing', parseLobbyTeamInfo({ command: 0x15ea, flag: 1, data: d.slice(0, 100) }).length === 0);
}

// 07EA team chat (send_packet0xea / SendTeamOperationSuccessPacket 0x007f32ac and the
// handler 0x007c1a4c): the name is 0x10 units at payload 0, the text at payload 0x20.
{
  const p = teamChatPacket('Ann', 'hi there');
  check('07EA command and flag 0', p.command === 0x07ea && p.flag === 0);
  const back = parseTeamChat(p.payload);
  check('07EA round trip: sender and text', back.sender === 'Ann' && back.text === 'hi there');
  check('07EA text is zero terminated (length (len*2+5)&~3 with a 4-byte floor)', p.payload.length === 0x20 + Math.max(4, ((8 * 2 + 5) & ~3)));
}

// Team Invite (6xC1 body, the 6xC2 answer) and Point Regist (6xCC payload): the layouts the
// dump's writers and the newserv structs give (net/team.ts).
{
  const body = inviteSubcommand({ selfId: 2, guildCard: 0x1234, name: 'Ann', teamName: 'Reds' });
  const dv = new DataView(body.buffer);
  check('6xC1 body is 0x5C bytes with the size word 0x17 and the 0xC1 sub', body.length === 0x5c && body[0] === 0xc1 && body[1] === 0x17);
  check('6xC1 sender id at +2, card at +4, action 0 at +8', dv.getUint16(2, true) === 2 && dv.getUint32(4, true) === 0x1234 && dv.getUint32(8, true) === 0);
  check('6xC1 name at +0xC (24 units), team name at +0x3C (16 units)', dv.getUint16(0x0c, true) === 0x41 && dv.getUint16(0x3c, true) === 0x52 && dv.getUint16(0x3c + 2 * 3, true) === 0x73);
  check('6xC2 answer: card at +4, action at +8', JSON.stringify(parseInviteAnswer(body)) === JSON.stringify({ guildCard: 0x1234, action: 0 }));
  const pts = exchangeTeamPointsPayload(0x100, 3);
  const pv = new DataView(pts.buffer);
  check('6xCC payload: item id then amount (u32 each, 8 bytes)', pts.length === 8 && pv.getUint32(0, true) === 0x100 && pv.getUint32(4, true) === 3);
}

// Team Invite answer (the invitee's 6xC2): the exe's values are Yes 2, No / cancel 3, the 900-frame
// timeout 4 (and the refuse paths 4); only 2 is an accept at the receiver 0x0078be84.
{
  check('answer values: accept 2, decline 3, timeout 4', TEAM_INVITE_ACCEPT === 2 && TEAM_INVITE_DECLINE === 3 && TEAM_INVITE_TIMEOUT === 4);
  const invite = inviteSubcommand({ selfId: 2, guildCard: 0x1234, name: 'Ann', teamName: 'Reds' });
  const yes = inviteAnswerSubcommand({ invite, ownCard: 0x9999, ownName: 'Bo', action: TEAM_INVITE_ACCEPT });
  const dv = new DataView(yes.buffer);
  check('6xC2 answer: 0x5C bytes, 0xC2 sub, size word 0x17', yes.length === 0x5c && yes[0] === 0xc2 && yes[1] === 0x17);
  check('6xC2 answer: own card at +4, action 2 at +8', dv.getUint32(4, true) === 0x9999 && dv.getUint32(8, true) === 2);
  check('6xC2 answer: own name at +0xC (16 units), team name kept at +0x3C', dv.getUint16(0x0c, true) === 0x42 && dv.getUint16(0x3c, true) === 0x52);
  check('6xC2 answer: the relay target is the invite +4 word', inviteTarget(invite) === 0x1234);
  check('6xC2 answer round trip: parseInviteAnswer reads the own card and 2', JSON.stringify(parseInviteAnswer(yes)) === JSON.stringify({ guildCard: 0x9999, action: 2 }));
  const no = inviteAnswerSubcommand({ invite, ownCard: 0x9999, ownName: 'Bo', action: TEAM_INVITE_DECLINE });
  check('6xC2 decline: action 3, not an accept', parseInviteAnswer(no).action === 3);

  const run = (steps: (p: InviteAnswerPrompt) => void) => {
    const p = new InviteAnswerPrompt();
    steps(p);
    return p.action;
  };
  check('prompt: No on the first list declines (3)', run((p) => p.choose(false)) === 3);
  check('prompt: Yes, dismiss the notice, Yes on the second list accepts (2)', run((p) => { p.choose(true); p.dismissNotice(); p.choose(true); }) === 2);
  check('prompt: Yes, notice, No on the second list declines (3)', run((p) => { p.choose(true); p.dismissNotice(); p.choose(false); }) === 3);
  check('prompt: cancel on the second list declines (3)', run((p) => { p.choose(true); p.dismissNotice(); p.cancel(); }) === 3);
  check('prompt: a notice key before the notice is shown does nothing (no answer yet)', run((p) => { p.dismissNotice(); }) === null);
  check('prompt: the second list only answers after the notice', run((p) => { p.choose(true); p.choose(true); }) === null);
  {
    const p = new InviteAnswerPrompt();
    for (let i = 0; i < INVITE_ANSWER_FRAMES - 1; i++) p.tick();
    check('prompt: no time-out before 900 frames', p.action === null);
    p.tick();
    check('prompt: the 900th frame of the first list times out (4)', p.action === TEAM_INVITE_TIMEOUT);
    p.choose(true);
    check('prompt: a finished prompt keeps its answer', p.action === TEAM_INVITE_TIMEOUT && p.phase === 'done');
  }
  {
    const p = new InviteAnswerPrompt();
    p.choose(true);
    p.dismissNotice();
    for (let i = 0; i < INVITE_ANSWER_FRAMES; i++) p.tick();
    check('prompt: the second list times out too (4)', p.action === TEAM_INVITE_TIMEOUT);
  }
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

// Master Transfer, Buying Privileges and Team Flag Records against a local newserv, with two
// fresh accounts in one lobby:
//   A creates a team, invites B (Home > Team > Invite, B accepts), promotes B to leader, then
//   transfers the master to B: the 6xCD request, B's prompt (Yes twice), the 6xCE answer, 11EA flag
//   0x40, and the server's 12EA membership updates (A leader 0x30, B master 0x40).
//   The transfer's 07EA notice reaches B's team log (newserv relays it to the team's members).
//   B (now the master) opens Buying Privileges (a fresh team has no points, every reward is greyed)
//   and Team Flag Records (greyed without the reward bit; with the bit forced on the page the
//   question, the picture and the store question run and the 0FEA goes out).
//
// Needs newserv and the bridge running; PW_BASE_URL points at a Vite on its own port.
import { expect, test, type Page } from '@playwright/test';
import { cursorTo, key, peek, reachLobby, type Win } from './classic.ts';
import { ensureCharacter, freshUser } from './fresh-field.ts';

const USER_A = process.env.PSO_USER_A ?? freshUser('tmx');
const USER_B = process.env.PSO_USER_B ?? freshUser('tmy');

const membership = (page: Page) => peek(page, (w: Win) => w.classicLobby.hud.team.membership() as { privilege: number; masterGuildCard: number; teamId: number; name: string });
const teamPhase = (page: Page) => peek(page, (w: Win) => (w.classicLobby.team?.phase?.kind ?? null) as string | null);
const inTeam = async (page: Page) => {
  const m = await membership(page);
  return (m.masterGuildCard | m.teamId) !== 0;
};

async function openCounter(page: Page): Promise<void> {
  await peek(page, (w: Win) => {
    const c = w.classicLobby.hud.infoCols[0];
    w.classicLobby.lobby.self.position.x = c.x;
    w.classicLobby.lobby.self.position.z = c.z;
  });
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w: Win) => w.classicLobby.counter.open)).toBe(true);
}

async function chooseRow(page: Page, row: number): Promise<void> {
  await cursorTo(page, (w: Win) => w.classicLobby.counter.stack.at(-1).cursor, row);
  await key(page, 'Enter');
}

async function openMasterRow(page: Page, row: number): Promise<void> {
  await openCounter(page);
  await chooseRow(page, 2); // Team
  await chooseRow(page, 2); // Master Menu
  await expect.poll(() => teamPhase(page)).toBe('master');
  await cursorTo(page, (w: Win) => w.classicLobby.team.phase.list.cursor, row);
}

async function yes(page: Page): Promise<void> {
  await key(page, 'ArrowUp');
  await key(page, 'Enter');
}

async function pickMember(page: Page, label: string): Promise<void> {
  await expect.poll(() => teamPhase(page), { timeout: 20_000 }).toBe('pick');
  const items = await peek(page, (w: Win) => w.classicLobby.team.phase.list.items.map((i: { label: string }) => i.label) as string[]);
  const at = items.findIndex((l) => l.includes(label));
  expect(at).toBeGreaterThanOrEqual(0);
  await cursorTo(page, (w: Win) => w.classicLobby.team.phase.list.cursor, at);
  await key(page, 'Enter');
  await expect.poll(() => teamPhase(page)).toBe('pickConfirm');
  await yes(page);
}

async function continueNotice(page: Page): Promise<void> {
  await expect.poll(() => teamPhase(page), { timeout: 30_000 }).toBe('notice');
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w: Win) => !!w.classicLobby.team?.open)).toBe(false);
}

test('two accounts: invite, promote, Master Transfer, Buying Privileges, Team Flag Records', async ({ browser }) => {
  test.setTimeout(420_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(String(e)));

  await ensureCharacter(a, USER_A, USER_A);
  await reachLobby(a);
  await ensureCharacter(b, USER_B, USER_B);
  await reachLobby(b);
  const nameB = await peek(b, (w: Win) => w.classicLobby.lobby.self.name as string);
  await expect.poll(() => peek(a, (w: Win) => w.classicLobby.lobby.players.size as number), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  await test.step('A creates a team', async () => {
    await openCounter(a);
    await chooseRow(a, 2);
    await chooseRow(a, 0);
    await expect.poll(() => teamPhase(a)).toBe('createIntro');
    await yes(a);
    await key(a, 'Enter');
    await a.keyboard.type(`T${Date.now().toString(36).slice(-6)}`, { delay: 30 });
    await key(a, 'Enter');
    await key(a, 'Enter');
    await expect.poll(() => teamPhase(a)).toBe('nameConfirm');
    await yes(a);
    await continueNotice(a);
    await expect.poll(() => inTeam(a), { timeout: 15_000 }).toBe(true);
  });

  await test.step('A invites B, B accepts', async () => {
    // Both characters carry the default name, so rows are matched by guild card.
    const cardB = await peek(b, (w: Win) => w.classicLobby.lobby.self.guildCardNumber as number);
    await peek(a, (w: Win) => w.classicLobby.home.openLeaf(0x29));
    await expect
      .poll(() => peek(a, (w: Win) => (w.classicLobby.home.teamInvite?.list?.items ?? []).map((i: { value: number }) => i.value) as number[]), { timeout: 20_000 })
      .toContain(cardB);
    const items = await peek(a, (w: Win) => w.classicLobby.home.teamInvite.list.items.map((i: { value: number }) => i.value) as number[]);
    await cursorTo(a, (w: Win) => w.classicLobby.home.teamInvite.list.cursor, items.indexOf(cardB));
    await key(a, 'Enter');
    await expect.poll(() => peek(b, (w: Win) => !!w.classicLobby.home.inviteAnswer), { timeout: 20_000 }).toBe(true);
    await key(b, 'Enter'); // intro
    await yes(b);
    await key(b, 'Enter'); // notice
    await yes(b);
    await expect.poll(() => inTeam(b), { timeout: 20_000 }).toBe(true);
    // close both windows
    await expect.poll(async () => {
      for (const p of [a, b]) if (await peek(p, (w: Win) => w.classicLobby.home.open)) await key(p, 'Enter');
      return (await peek(a, (w: Win) => w.classicLobby.home.open)) || (await peek(b, (w: Win) => w.classicLobby.home.open));
    }).toBe(false);
  });

  await test.step('A promotes B to leader', async () => {
    await openMasterRow(a, 0);
    await key(a, 'Enter');
    await pickMember(a, nameB);
    await continueNotice(a);
    await expect.poll(async () => (await membership(b)).privilege, { timeout: 15_000 }).toBe(0x30);
  });

  await test.step('Master Transfer: A asks, B says Yes twice, the server swaps the roles', async () => {
    const logBefore = await peek(b, (w: Win) => w.classicLobby.hud.teamChat.log.lines.length as number);
    await openMasterRow(a, 3);
    await key(a, 'Enter');
    await pickMember(a, nameB);
    await expect.poll(() => teamPhase(a)).toBe('transferWait');
    await expect.poll(() => peek(b, (w: Win) => w.classicLobby.home.masterPrompt?.state ?? null), { timeout: 20_000 }).toBe('intro');
    await key(b, 'Enter');
    await yes(b);
    await expect.poll(() => peek(b, (w: Win) => w.classicLobby.home.masterPrompt.state)).toBe('notice');
    await key(b, 'Enter');
    await yes(b);
    await expect.poll(() => peek(b, (w: Win) => !!w.classicLobby.home.masterPrompt), { timeout: 10_000 }).toBe(false);
    await continueNotice(a);
    await expect.poll(async () => (await membership(b)).privilege, { timeout: 15_000 }).toBe(0x40);
    await expect.poll(async () => (await membership(a)).privilege, { timeout: 15_000 }).toBe(0x30);
    // The old master's 07EA operation notice (SendTeamOperationSuccessPacket) is relayed to the team: B's log gets the line.
    await expect.poll(() => peek(b, (w: Win) => w.classicLobby.hud.teamChat.log.lines.length as number), { timeout: 15_000 }).toBeGreaterThan(logBefore);
    const mb = await membership(b);
    expect(mb.masterGuildCard).toBe((await membership(a)).masterGuildCard);
    expect(mb.masterGuildCard).toBe(await peek(b, (w: Win) => w.classicLobby.lobby.self.guildCardNumber as number));
  });

  await test.step('Buying Privileges (B, the master): a fresh team cannot afford anything', async () => {
    await openMasterRow(b, 5);
    await key(b, 'Enter');
    await expect.poll(() => teamPhase(b), { timeout: 20_000 }).toBe('buy');
    const buy = await peek(b, (w: Win) => ({
      points: w.classicLobby.team.phase.buy.points as number,
      rows: w.classicLobby.team.phase.buy.rewards.map((r: { teamPoints: number }) => r.teamPoints) as number[],
    }));
    expect(buy.points).toBe(0);
    expect(buy.rows.length).toBeGreaterThan(0);
    expect(buy.rows.every((p) => p > buy.points)).toBe(true);
    await key(b, 'Enter'); // a greyed row: the buzzer
    expect(await teamPhase(b)).toBe('buy');
    await key(b, 'Escape');
    await expect.poll(() => teamPhase(b)).toBe('other');
    await key(b, 'Enter'); // "any other business?" Yes would reopen the counter; No closes
    await peek(b, (w: Win) => w.classicLobby.team.close());
    await peek(b, (w: Win) => w.classicLobby.counter.close());
  });

  await test.step('Team Flag Records (B): greyed without the reward, then the flow with the bit forced', async () => {
    await openMasterRow(b, 0);
    expect(await peek(b, (w: Win) => w.classicLobby.team.phase.list.items[6].enabled as boolean)).toBe(false);
    await peek(b, (w: Win) => w.classicLobby.team.close());
    await peek(b, (w: Win) => w.classicLobby.counter.close());
    // The page's host: reward bit 0 on and a picture of 1024 opaque red words (no file chooser in the test).
    await peek(b, (w: Win) => {
      const h = w.classicLobby.hud.team;
      h.rewardFlags = () => 1;
      h.pickFlag = async () => ({ status: 1, flag: new Uint16Array(1024).fill(0xfc00) });
    });
    await openMasterRow(b, 6);
    expect(await peek(b, (w: Win) => w.classicLobby.team.phase.list.items[6].enabled as boolean)).toBe(true);
    await key(b, 'Enter');
    await expect.poll(() => teamPhase(b)).toBe('flagAsk');
    await key(b, 'Enter');
    await expect.poll(() => teamPhase(b)).toBe('flagStore');
    expect(await peek(b, (w: Win) => w.classicLobby.team.phase.flag.length as number)).toBe(1024);
    await key(b, 'Enter');
    await expect.poll(() => teamPhase(b)).toBe('flagMessage');
  });

  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

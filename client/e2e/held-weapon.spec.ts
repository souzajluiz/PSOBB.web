// The held weapon in the field (render/heldweapon.ts) between two classic
// clients against a local newserv: A creates a party and B joins it (as
// party-join.spec.ts), both warp to Forest 1, and each one's view draws the
// other's equipped weapon (the mesh of its marker, shown). Then B unequips the
// weapon (6x26) and equips it again (6x25): A's view drops and rebuilds the
// model's weapon, and so does B's own view (the local equip path).
//
// The walks are not under test: the warp is GameView.warpTo (6x21), the item
// changes are GameItems.equip / unequip (the item pack's calls).
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER_A = process.env.PSO_USER_A ?? 'webgameb';
const PASSWORD_A = process.env.PSO_PASSWORD_A ?? 'webgameb';
const USER_B = process.env.PSO_USER ?? 'webtest';
const PASSWORD_B = process.env.PSO_PASSWORD ?? 'webtest';

type Held = { clientId: number; key: string; weaponKey: string; vertices: number; shown: boolean };

let contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.map((c) => c.close()));
  contexts = [];
});

// The held weapon of `clientId` as `page` draws it (null: no marker).
const heldOf = (page: Page, clientId: number) =>
  page.evaluate((id) => (window as any).classicGame?.view.heldWeapons().find((h: Held) => h.clientId === id) ?? null, clientId) as Promise<Held | null>;

// The equipped weapon's item id and whether it is equipped, from the local character.
const weaponOf = (page: Page) =>
  peek(page, (w) => {
    const inv = w.classicGame.view.items.character.inventory as Array<{ flags: number; data: { id: number; data1: number[] } }>;
    const eq = inv.find((i) => (i.flags & 8) !== 0 && i.data.data1[0] === 0);
    const other = inv.find((i) => (i.flags & 8) === 0 && i.data.data1[0] === 0);
    return { equipped: eq?.data.id ?? null, spare: other?.data.id ?? null };
  });

test('held weapon: a party member\'s weapon is drawn in the field and follows equip changes', async ({ browser }) => {
  test.setTimeout(420_000);
  contexts = [await browser.newContext(), await browser.newContext()];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const logsA = consoleLog(a);
  const logsB = consoleLog(b);
  const name = `hw${Date.now() % 100000}`;
  let idB = -1;

  await test.step('A and B reach the lobby', async () => {
    await Promise.all([logIn(a, USER_A, PASSWORD_A).then(() => reachLobby(a)), logIn(b, USER_B, PASSWORD_B).then(() => reachLobby(b))]);
  });

  await test.step('A creates the party and enters it', async () => {
    await openPartyMenu(a);
    await key(a, 'ArrowDown'); // Create a PARTY
    await key(a, 'Enter');
    await key(a, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(a, (w) => w.classicLobby.party?.phase)).toBe('create');
    await key(a, 'Enter'); // Party Name
    await a.keyboard.type(name, { delay: 30 });
    await key(a, 'Enter');
    await cursorTo(a, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
    await key(a, 'Enter');
    await expectInGame(a, logsA, name);
  });

  await test.step('B joins it from the list', async () => {
    await openPartyMenu(b);
    await key(b, 'Enter'); // Join a PARTY
    await expect.poll(() => peek(b, (w) => w.classicLobby.party?.phase)).toBe('list');
    const names = await peek(b, (w) => w.classicLobby.party.list.entries.map((e: { name: string }) => e.name));
    const index = names.indexOf(name);
    expect(index).toBeGreaterThanOrEqual(0);
    await cursorTo(b, (w) => w.classicLobby.party.list.cursor, index, 0x40);
    await key(b, 'Enter');
    await expectInGame(b, logsB, name);
  });

  await test.step('both see two players on Pioneer 2', async () => {
    await expect.poll(() => peek(a, (w) => w.classicGame.game.players.size)).toBe(2);
    await expect.poll(() => peek(b, (w) => w.classicGame.game.players.size)).toBe(2);
    idB = await peek(b, (w) => w.classicGame.game.selfId);
  });

  await test.step('both warp to Forest 1', async () => {
    for (const page of [a, b]) {
      await peek(page, (w) => void w.classicGame.view.warpTo(1));
      await expect
        .poll(() => peek(page, (w) => (w.classicGame ? `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}` : '')), { timeout: 60_000 })
        .toBe('1:false');
    }
  });

  await test.step('each view draws the other player\'s weapon, with the same key as the owner', async () => {
    const idA = await peek(a, (w) => w.classicGame.game.selfId);
    // B's own key is what the owner draws from its character file; A's view
    // of B must match it (the join data / 6x70 copy of the weapon).
    const selfKeyB = (await heldOf(b, idB))!.key;
    expect(selfKeyB).not.toBe('');
    await expect.poll(async () => (await heldOf(a, idB))?.key ?? null, { timeout: 30_000 }).toBe(selfKeyB);
    await expect.poll(async () => (await heldOf(a, idB))?.shown ?? false, { timeout: 30_000 }).toBe(true);
    expect((await heldOf(a, idB))!.vertices).toBeGreaterThan(0);
    // And B draws A's weapon the same way (A's weapon from its join data).
    const selfKeyA = (await heldOf(a, idA))!.key;
    expect(selfKeyA).not.toBe('');
    await expect.poll(async () => (await heldOf(b, idA))?.key ?? null, { timeout: 30_000 }).toBe(selfKeyA);
    await expect.poll(async () => (await heldOf(b, idA))?.shown ?? false, { timeout: 30_000 }).toBe(true);
  });

  await test.step('B unequips its weapon: A and B drop it', async () => {
    const { equipped } = await weaponOf(b);
    expect(equipped).not.toBeNull();
    await b.evaluate((weaponId) => (window as any).classicGame.view.items.unequip(weaponId), equipped!);
    await expect.poll(async () => (await heldOf(b, idB))?.key ?? 'x', { timeout: 30_000 }).toBe('');
    await expect.poll(async () => (await heldOf(a, idB))?.key ?? 'x', { timeout: 30_000 }).toBe('');
    await expect.poll(async () => (await heldOf(a, idB))?.shown ?? true, { timeout: 30_000 }).toBe(false);
  });

  await test.step('B equips it again: A and B draw it again', async () => {
    const { equipped, spare } = await weaponOf(b);
    // Re-equip the weapon B had; it is a spare now (the unequipped weapon).
    const id = spare ?? equipped;
    await b.evaluate((weaponId) => (window as any).classicGame.view.items.equip(weaponId), id);
    const selfKeyB = (await heldOf(b, idB))?.key ?? '';
    expect(selfKeyB).not.toBe('');
    await expect.poll(async () => (await heldOf(a, idB))?.key ?? '', { timeout: 30_000 }).toBe(selfKeyB);
    await expect.poll(async () => (await heldOf(a, idB))?.shown ?? false, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await heldOf(b, idB))?.shown ?? false, { timeout: 30_000 }).toBe(true);
    expect((await heldOf(a, idB))!.vertices).toBeGreaterThan(0);
  });

  await test.step('back to the lobby', async () => {
    await leaveToLobby(b);
    await leaveToLobby(a);
  });

  for (const [who, logs] of [['A', logsA], ['B', logsB]] as const) {
    const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror') || l.startsWith('warning: held weapon'));
    if (errors.length) console.log(`${who}:\n${errors.join('\n')}`);
    expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
  }
});

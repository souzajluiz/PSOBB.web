// Shared steps of the e2e tests that need a character in a party field on a fresh account:
// log in, make the character (slot 0) when the account has none, optionally fund it while the
// account is offline (bridge/admin-chars.mjs), then reach the lobby, create a party and enter it.
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { applyCharacterPatch, charPath, loadCharBuffer, parseCharacter, writeCharacter } from '../../bridge/admin-chars.mjs';
import { cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';
import { makeCharacter, slotFilled } from './phone-helpers.ts';

// newserv's players folder: the worktree's vendor/newserv/system (NEWSERV_SYSTEM overrides it, as
// bridge/admin.mjs does).
export const playersDir = (): string =>
  process.env.NEWSERV_SYSTEM
    ? `${process.env.NEWSERV_SYSTEM.replace(/\/+$/, '')}/players`
    : fileURLToPath(new URL('../../vendor/newserv/system/players', import.meta.url));

// A new account name (newserv registers an unknown user on its first login). Letters and
// digits only, within admin-chars.mjs's username rule.
export const freshUser = (prefix: string): string => `${prefix}${Date.now().toString(36).slice(-7)}`;

// An unidentified weapon (class 0, the Saber's code 000100, the special byte 0x80: the tekker's
// "unknown" state, classic/itempack.ts isTekked), put in the character's last inventory slot.
export const UNIDENTIFIED_WEAPON = { data1: '000100008000000000000000', data2: '00000000' } as const;

// Sets the meseta of slot 0's character while the account is offline (and, with `weapon`, puts
// UNIDENTIFIED_WEAPON in its last inventory slot). The page leaves the server
// first (newserv saves a character when its client goes away, so the save must come before the
// write); the file is read back after a pause, so a late save cannot undo the write.
export async function fundOffline(page: Page, user: string, meseta: number, weapon = false): Promise<void> {
  const patch: Record<string, unknown> = { meseta };
  if (weapon) {
    const n = parseCharacter(loadCharBuffer(charPath(playersDir(), user, 0))).inventory.length;
    patch.inventory = { set: [{ slot: n - 1, ...UNIDENTIFIED_WEAPON }] };
  }
  await patchOffline(page, user, patch);
  const file = charPath(playersDir(), user, 0);
  expect(parseCharacter(loadCharBuffer(file)).meseta).toBe(meseta);
}

// Applies an admin character patch (bridge/admin-chars.mjs) to slot 0 while the account is offline.
export async function patchOffline(page: Page, user: string, patch: Record<string, unknown>): Promise<void> {
  await page.goto('about:blank');
  await page.waitForTimeout(2000);
  const dir = playersDir();
  const file = charPath(dir, user, 0);
  const { buf } = applyCharacterPatch(loadCharBuffer(file), patch);
  writeCharacter(dir, file, buf); // a backup of the file is kept under system/players/_admin-backups
  await page.waitForTimeout(2000);
}

// A MAG (item class 2) in the inventory's raw form: type 0 (its parts are on records 28 and 0), no
// stats, colour 0 (data2[3]). Equip it in the field (GameItems.equip).
export const MAG_ITEM = { data1: '020000000000000000000000', data2: '00000000' };

// From the login to a party field (Pioneer 2, floor 0). `meseta`: fund the character first.
// PSO_USER / PSO_PASSWORD override the account (then it is not fresh: `meseta` still applies).
// `patch`: an admin character patch (bridge/admin-chars.mjs) applied to slot 0 while offline, before the
// login that enters the field (e.g. { charClass: 6, techniques: { Foie: 30 } }).
export async function enterFreshField(page: Page, logs: string[], opts: { prefix: string; meseta?: number; weapon?: boolean; mag?: boolean; patch?: Record<string, unknown> }): Promise<{ user: string; name: string }> {
  const user = process.env.PSO_USER ?? freshUser(opts.prefix);
  const password = process.env.PSO_PASSWORD ?? user;
  const name = `ps${Date.now() % 100000}`;

  await logIn(page, user, password);
  await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
  if (!(await slotFilled(page, 0))) {
    await key(page, 'Enter'); // the empty slot 0: the creation
    await makeCharacter(page);
    await expect.poll(() => slotFilled(page, 0), { timeout: 30_000 }).toBe(true);
  }
  if (opts.meseta !== undefined || opts.mag || opts.patch) {
    if (opts.patch) await patchOffline(page, user, opts.patch);
    if (opts.mag) await patchOffline(page, user, { inventory: { add: [MAG_ITEM] } });
    if (opts.meseta !== undefined) await fundOffline(page, user, opts.meseta, opts.weapon);
    await logIn(page, user, password);
    await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
  }
  await reachLobby(page);

  // Create a PARTY (1) -> EPISODE 1 (0), the name, Difficulty Normal, Registration.
  await openPartyMenu(page);
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
  await key(page, 'Enter');
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 3);
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party.create.step)).toBe('difficulty');
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4);
  await key(page, 'Enter');
  await expectInGame(page, logs, name);
  return { user, name };
}

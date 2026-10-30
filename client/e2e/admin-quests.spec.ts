// Admin panel, Quests tab, live: "Open in editor" on a real quest (newserv's extermination
// quest 101), the editor's "Publish to server" into the hidden category under a new number,
// "Test in game" answered by the panel (it publishes the same quest as the test file), the
// server's refusal of a quest number held in another category, and "Open in editor" again from
// the Quests tab for the published quest.
//
// Self-contained like admin-characters.spec.ts: a temporary copy of vendor/newserv/system (never
// the real one), its newserv on a random loopback port and bridge/server.mjs (the panel) on
// another. No Vite: the editor is served by the bridge's dist folder, so the spec needs the
// built editor, or it skips (see the beforeAll).
//
// Run: cd client && npx playwright test -c playwright.admin.config.ts admin-quests --trace off
import { expect, test, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

test.use({ locale: 'en-US' });

const ROOT = resolve(import.meta.dirname, '../..');
const VENDORS = [process.env.NEWSERV, join(ROOT, 'vendor/newserv'), '/Users/junior/Downloads/psobb-master/web/vendor/newserv'].filter(Boolean) as string[];
const vendor = VENDORS.find((v) => existsSync(join(v, 'build/newserv')));
const PASSWORD = 'e2e-admin-password-123';
const TEST_NUMBER = 9101;

async function freePort(avoid: number[] = []): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((res) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => res(p));
      });
    });
    const banned = port === 5173 || port === 8080 || (port >= 12000 && port <= 12008);
    if (!banned && !avoid.includes(port)) return port;
  }
}

async function waitFor(url: string, what: string, log: () => string): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* not yet */ }
    if (Date.now() - started > 30_000) throw new Error(`${what} did not start:\n${log().slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

let tmp = '';
let sys = '';
let ns: ChildProcess | null = null;
let bridge: ChildProcess | null = null;
let panel = '';

test.beforeAll(async () => {
  test.skip(!vendor, 'vendor/newserv/build/newserv is not built');
  test.setTimeout(420_000); // the editor build alone can take minutes
  tmp = mkdtempSync(join(tmpdir(), 'admin-quests-e2e-'));
  // The panel serves the built editor (its own temp dist, so client/dist is not touched).
  // EDITOR_DIST: a dist built beforehand (vite build --outDir <dir>), which saves the ~40 s build.
  const dist = process.env.EDITOR_DIST ?? join(tmp, 'dist');
  if (!process.env.EDITOR_DIST) {
    const viteBin = resolve(ROOT, 'client/node_modules/vite/bin/vite.js');
    await promisify(execFile)(process.execPath, [viteBin, 'build', '--outDir', dist, '--emptyOutDir'], { cwd: resolve(ROOT, 'client') });
  }
  test.skip(!existsSync(join(dist, 'questeditor.html')), 'the editor did not build');
  sys = join(tmp, 'system');
  mkdirSync(sys);
  for (const d of readdirSync(join(vendor!, 'system'))) {
    if (['players', 'licenses', 'teams', 'config.json'].includes(d)) continue;
    cpSync(join(vendor!, 'system', d), join(sys, d), { recursive: true });
  }
  for (const d of ['players', 'licenses', 'teams']) mkdirSync(join(sys, d));
  const portA = await freePort();
  const portB2 = await freePort([portA]);
  const httpPort = await freePort([portA, portB2]);
  const webPort = await freePort([portA, portB2, httpPort]);
  let config = readFileSync(join(vendor!, 'system/config.example.json'), 'utf8');
  config = config.replace(/"PortConfiguration": \{.*?\n  \},/s, `"PortConfiguration": {"bb-data1": [["127.0.0.1", ${portA}], "bb", "game_server"], "bb-data2": [["127.0.0.1", ${portB2}], "bb", "game_server"]},`);
  for (const [a, b] of [
    ['"LocalAddress": "en0"', '"LocalAddress": "127.0.0.1"'], ['"ExternalAddress": "10.0.1.5"', '"ExternalAddress": "127.0.0.1"'], ['"DNSServerPort": 53', '"DNSServerPort": 0'],
    ['"IPStackListen": [5059]', '"IPStackListen": []'], ['"PPPStackListen": [5058]', '"PPPStackListen": []'], ['"PPPRawListen": [5057]', '"PPPRawListen": []'],
    ['"HTTPListen": []', `"HTTPListen": ["127.0.0.1:${httpPort}"]`], ['"AllowUnregisteredUsers": true', '"AllowUnregisteredUsers": false'],
  ]) {
    config = config.replace(a, b);
  }
  writeFileSync(join(sys, 'config.json'), config);

  let nsLog = '';
  ns = spawn(join(vendor!, 'build/newserv'), [], { cwd: tmp, stdio: ['pipe', 'pipe', 'pipe'] });
  ns.stdout?.on('data', (d) => (nsLog += d));
  ns.stderr?.on('data', (d) => (nsLog += d));
  await waitFor(`http://127.0.0.1:${httpPort}/`, 'newserv', () => nsLog);

  let brLog = '';
  bridge = spawn(process.execPath, [join(ROOT, 'bridge/server.mjs')], {
    cwd: join(ROOT, 'bridge'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: String(webPort), DIST: dist, NEWSERV_SYSTEM: sys, NEWSERV_HTTP: `127.0.0.1:${httpPort}`,
      ADMIN_PASSWORD: PASSWORD, ADMIN_REQUIRE_HTTPS: '0', ADMIN_AUDIT_LOG: join(tmp, 'audit.log'), ALLOWED_PORTS: String(portA),
    },
  });
  bridge.stdout?.on('data', (d) => (brLog += d));
  bridge.stderr?.on('data', (d) => (brLog += d));
  panel = `http://127.0.0.1:${webPort}`;
  await waitFor(`${panel}/admin/api/session`, 'bridge/server.mjs', () => brLog);
});

test.afterAll(() => {
  bridge?.kill('SIGTERM');
  ns?.kill('SIGTERM');
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// The "Open in editor" button of a quest in the Quests tab: its category card (by folder name,
// opened) and its row (by number).
async function openInEditorButton(page: Page, dir: string, number: number) {
  const card = page.locator('details.card', { has: page.locator('summary span.mono', { hasText: new RegExp(`^${dir}$`) }) });
  // The row text starts with the number and the name follows with no space: no digit may follow.
  const row = card.locator('tr', { hasText: new RegExp(`^\\s*${number}(?!\\d)`) });
  // The tab re-renders after a reload: open the card again on each try, until the row is there.
  await expect(async () => {
    await card.evaluate((d: HTMLDetailsElement) => (d.open = true));
    await expect(row).toHaveCount(1);
  }).toPass({ timeout: 30_000 });
  return row.getByRole('button', { name: 'Open in editor', exact: true });
}

test('Quests tab: open a quest in the editor, publish it under a new number, test it in game, open it again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${panel}/admin`);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('nav [data-tab="quests"]')).toBeVisible();
  await page.locator('nav [data-tab="quests"]').click();
  const questTotal = Number((await page.getByText(/^Quests \(\d+\)$/).textContent())?.match(/\d+/)?.[0]);
  expect(questTotal).toBeGreaterThan(0);

  // Open in editor on the extermination quest 101: a new tab with the editor and the quest.
  const [editor] = await Promise.all([
    page.waitForEvent('popup'),
    (await openInEditorButton(page, 'extermination', 101)).click(),
  ]);
  await editor.waitForLoadState('domcontentloaded');
  await expect(editor.locator('.qe-entity-list')).toBeVisible({ timeout: 30_000 });
  await expect(editor.getByRole('button', { name: 'Publish to server', exact: true })).toBeVisible(); // the admin session
  const number = await editor.evaluate(() => (window as any).questEditor.document.header.questNumber);
  expect(number).toBe(101);

  // A new number for the copy (the quest keeps its name), set in the quest properties.
  await editor.getByLabel('Quest number', { exact: true }).fill(String(TEST_NUMBER));
  await editor.getByLabel('Quest number', { exact: true }).dispatchEvent('change');

  // Publish to server: the hidden category, q9101-bb-e.bin, typed target to confirm.
  await editor.getByRole('button', { name: 'Publish to server', exact: true }).click();
  const dialog = editor.locator('dialog[open]');
  await dialog.getByLabel('Category folder').selectOption('hidden');
  await dialog.getByLabel('File name').fill(`q${TEST_NUMBER}-bb-e.bin`);
  await dialog.getByLabel('Confirmation').fill(`hidden/q${TEST_NUMBER}-bb-e.bin`);
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(editor.locator('.qe-message')).toContainText(`Published q${TEST_NUMBER}-bb-e.bin`, { timeout: 30_000 });
  expect(existsSync(join(sys, 'quests/hidden', `q${TEST_NUMBER}-bb-e.bin`))).toBe(true);
  expect(existsSync(join(sys, 'quests/hidden', `q${TEST_NUMBER}-bb.dat`))).toBe(true);

  // The server refuses the same quest number in another category (newserv would reject the quest).
  const csrf = (await (await page.request.get(`${panel}/admin/api/session`)).json()).csrf;
  const clash = await page.request.post(`${panel}/admin/api/quests/publish`, {
    headers: { 'X-CSRF-Token': csrf, Origin: panel },
    data: { category: 'extermination', name: `q${TEST_NUMBER}-bb-e.bin`, confirm: `extermination/q${TEST_NUMBER}-bb-e.bin`, bin: readFileB64(join(sys, 'quests/hidden', `q${TEST_NUMBER}-bb-e.bin`)), dat: readFileB64(join(sys, 'quests/hidden', `q${TEST_NUMBER}-bb.dat`)) },
  });
  expect(clash.status()).toBe(409);
  expect(await clash.text()).toContain('already exists in category hidden');

  // Test in game: the panel answers the editor's opener and publishes the package as the test quest.
  await editor.getByRole('button', { name: 'Test in game', exact: true }).click();
  // One toast carries all three facts (it stays 3.5 s, so it is checked at once).
  await expect(page.locator('.toast').filter({ hasText: `Test quest ${TEST_NUMBER}` }).filter({ hasText: `hidden/q${TEST_NUMBER}-bb-e.bin` }).filter({ hasText: '$quest' })).toBeVisible({ timeout: 30_000 });

  // The Quests tab lists the new quest under Hidden; Open in editor opens it again.
  await page.getByRole('button', { name: 'Reload quests', exact: true }).click();
  // The tab renders again with the new total: wait for it, or the cards are replaced under the click.
  await expect(page.getByText(`Quests (${questTotal + 1})`, { exact: true })).toBeVisible({ timeout: 30_000 });
  const [again] = await Promise.all([
    page.waitForEvent('popup'),
    (await openInEditorButton(page, 'hidden', TEST_NUMBER)).click(),
  ]);
  await again.waitForLoadState('domcontentloaded');
  await expect(again.locator('.qe-entity-list')).toBeVisible({ timeout: 30_000 });
  expect(await again.evaluate(() => (window as any).questEditor.document.header.questNumber)).toBe(TEST_NUMBER);

  // Edit the quest's .json from the editor: the dialog starts from a template (no file yet),
  // invalid JSON disables Save, a valid object is written (backup on replace), quests reload.
  const jsonName = `q${TEST_NUMBER}-bb.json`;
  await again.getByRole('button', { name: 'Quest .json', exact: true }).click();
  const jd = again.locator('dialog[open]');
  await jd.getByLabel('JSON category folder').selectOption('hidden');
  await expect(jd.getByLabel('JSON file name')).toHaveValue(jsonName);
  await expect(jd.getByLabel('Quest JSON')).toHaveValue(/AllowStartFromChatCommand/);
  await jd.getByLabel('Quest JSON').fill('{ "AllowStartFromChatCommand": ');
  await expect(jd.getByRole('button', { name: 'Save .json', exact: true })).toBeDisabled();
  await jd.getByLabel('Quest JSON').fill('{\n  "AllowStartFromChatCommand": true,\n  "DescriptionFlag": 65\n}\n');
  await jd.getByRole('button', { name: 'Save .json', exact: true }).click();
  await expect(again.locator('.qe-message')).toContainText(`Created hidden/${jsonName}`, { timeout: 30_000 });
  const jsonPath = join(sys, 'quests/hidden', jsonName);
  expect(JSON.parse(readFileSync(jsonPath, 'utf8'))).toEqual({ AllowStartFromChatCommand: true, DescriptionFlag: 65 });
  // A second save replaces it and keeps a backup of the first.
  await again.getByRole('button', { name: 'Quest .json', exact: true }).click();
  await expect(jd.getByLabel('Quest JSON')).toHaveValue(/DescriptionFlag/);
  await jd.getByLabel('Quest JSON').fill('{ "AllowStartFromChatCommand": false }');
  await jd.getByRole('button', { name: 'Save .json', exact: true }).click();
  await expect(again.locator('.qe-message')).toContainText(`Replaced hidden/${jsonName}`, { timeout: 30_000 });
  expect(JSON.parse(readFileSync(jsonPath, 'utf8'))).toEqual({ AllowStartFromChatCommand: false });
  expect(readdirSync(join(tmp, 'quest-backups/hidden')).filter((n) => n.startsWith(`${jsonName}.`))).toHaveLength(1);

  await editor.close();
  await again.close();

  // Delete the published quest from the Quests tab: typed confirmation, every file of it
  // (.bin, .dat, .json) goes after a backup, the others stay, the total is back.
  await page.getByRole('button', { name: 'Reload quests', exact: true }).click();
  const hiddenCard = page.locator('details.card', { has: page.locator('summary span.mono', { hasText: /^hidden$/ }) });
  const hiddenRow = hiddenCard.locator('tr', { hasText: new RegExp(`^\\s*${TEST_NUMBER}(?!\\d)`) });
  await expect(async () => {
    await hiddenCard.evaluate((d: HTMLDetailsElement) => (d.open = true));
    await expect(hiddenRow).toHaveCount(1);
  }).toPass({ timeout: 30_000 });
  await hiddenRow.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.locator('.modal');
  await expect(confirm).toContainText(`hidden/q${TEST_NUMBER}-bb-e.bin`);
  await expect(confirm.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await confirm.getByLabel('confirmation text').fill(`hidden/q${TEST_NUMBER}-bb-e.bin`);
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Deleted' })).toBeVisible({ timeout: 30_000 });
  const left = readdirSync(join(sys, 'quests/hidden'));
  expect(left.filter((n) => n.startsWith(`q${TEST_NUMBER}-bb`))).toEqual([]);
  const saved = readdirSync(join(tmp, 'quest-backups/hidden'));
  for (const n of [`q${TEST_NUMBER}-bb-e.bin`, `q${TEST_NUMBER}-bb.dat`, jsonName]) expect(saved.some((f) => f.startsWith(`${n}.`))).toBe(true);
  await expect(page.getByText(`Quests (${questTotal})`, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

function readFileB64(path: string): string {
  return readFileSync(path).toString('base64');
}

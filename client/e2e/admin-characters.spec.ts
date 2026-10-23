// Admin panel, character editor in Chrome: level (EXP threshold + stats from
// newserv's level table), techniques limited by class, the item picker, the
// mag editor, backup + confirmation, then the file read back.
//
// Self-contained: starts vendor/newserv/build/newserv in a temporary copy of its
// system folder (never the real system/players) with its HTTP API on a random
// loopback port, and bridge/server.mjs (the admin panel) on another random port.
// A fresh account is created through the panel; its character file is a copy of
// a local character (player_webtest_0 or the first one found), or the spec skips.
//
// Run: cd client && npx playwright test -c playwright.admin.config.ts
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.use({ locale: 'en-US' }); // the panel follows the browser language; this spec reads English

const ROOT = resolve(import.meta.dirname, '../..');
const VENDORS = [process.env.NEWSERV, join(ROOT, 'vendor/newserv'), '/Users/junior/Downloads/psobb-master/web/vendor/newserv'].filter(Boolean) as string[];
const vendor = VENDORS.find((v) => existsSync(join(v, 'build/newserv')));
const PASSWORD = 'e2e-admin-password-123';
const USER = `e2ech${Date.now().toString(36).slice(-6)}`;

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
let charSource = '';

test.beforeAll(async () => {
  test.skip(!vendor, 'vendor/newserv/build/newserv is not built');
  const players = join(vendor!, 'system/players');
  const pick = ['player_webtest_0.psochar', ...(existsSync(players) ? readdirSync(players).filter((f) => /^player_.+_\d+\.psochar$/.test(f)) : [])].find((f) => existsSync(join(players, f)));
  test.skip(!pick, 'no local character file to copy');
  charSource = join(players, pick!);

  tmp = mkdtempSync(join(tmpdir(), 'admin-chars-e2e-'));
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
  const dist = join(tmp, 'dist');
  mkdirSync(dist);
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

test('character editor: level, techniques, item picker, mag', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Log in through the page.
  await page.goto(`${panel}/admin`);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('nav [data-tab="characters"]')).toBeVisible();

  // A fresh account through the panel's API (same session), then its character file.
  const csrf = (await (await page.request.get(`${panel}/admin/api/session`)).json()).csrf;
  const created = await page.request.post(`${panel}/admin/api/accounts`, { headers: { 'X-CSRF-Token': csrf, Origin: panel }, data: { username: USER, password: 'E2ePass1', flags: [] } });
  expect(created.status()).toBe(200);
  const id: string = (await created.json()).id;
  copyFileSync(charSource, join(sys, 'players', `player_${USER}_0.psochar`));
  const getChar = async () => (await page.request.get(`${panel}/admin/api/accounts/${id}/characters/0?username=${USER}`)).json();
  const before = await getChar();

  await page.locator('nav [data-tab="characters"]').click();
  await page.locator('main select').first().selectOption(id);
  await page.getByRole('button', { name: 'Open' }).click();
  const ed = page.locator('#character-editor');
  await expect(ed).toBeVisible();

  // Level 50: EXP and stats come from the level-preview route (newserv's table).
  const preview = await (await page.request.get(`${panel}/admin/api/accounts/${id}/characters/0/level-preview?username=${USER}&level=50`)).json();
  await ed.getByLabel('Level', { exact: true }).fill('50');
  await ed.getByLabel('Level', { exact: true }).dispatchEvent('change');
  await expect(ed.getByLabel('EXP', { exact: true })).toHaveValue(String(preview.exp));
  await expect(ed.getByLabel('ATP', { exact: true })).toHaveValue(String(preview.stats.atp));

  // Techniques: only the class's, with the cap in the label.
  const limits = before.techLimits as Record<string, number | null>;
  const learnable = Object.entries(limits).filter(([, v]) => v !== null);
  const [tech, cap] = learnable.find(([t]) => t === 'Foie') ?? learnable[0] ?? [null, null];
  if (tech) {
    await expect(ed.getByText(`${tech} (max ${cap})`, { exact: true })).toBeVisible();
    await ed.getByLabel(tech, { exact: true }).fill(String(cap));
  }
  for (const [t, v] of Object.entries(limits)) if (v === null && !before.techniques[t]) await expect(ed.getByLabel(t, { exact: true })).toHaveCount(0);

  // Item picker: a weapon with grind / special / attribute, then a tool stack.
  await ed.getByLabel('Item kind').selectOption('weapon');
  await ed.getByPlaceholder('Search by name').fill('Saber');
  await ed.getByLabel('Item', { exact: true }).selectOption('000100');
  await ed.getByLabel('Grind', { exact: true }).fill('10');
  await ed.getByLabel('Special').selectOption({ label: 'Charge' });
  await ed.getByLabel('Attribute').first().selectOption({ label: 'Machine' });
  await ed.getByLabel('Percent').first().fill('30');
  await ed.getByRole('button', { name: 'Add to list' }).first().click();
  await expect(ed.locator('ul.pending')).toContainText('Charge Saber +10 Machine 30%');
  await ed.getByLabel('Item kind').selectOption('tool');
  await ed.getByPlaceholder('Search by name').fill('Dimate');
  await ed.getByLabel('Count').fill('4');
  await ed.getByRole('button', { name: 'Add to list' }).first().click();
  await expect(ed.locator('ul.pending')).toContainText('Dimate x4');

  // Mag editor on the first mag.
  const magSlot = before.inventory.find((i: { mag?: unknown }) => i.mag)?.slot;
  if (magSlot !== undefined) {
    await ed.getByRole('button', { name: 'Edit mag' }).first().click();
    await ed.getByLabel('pow level').fill('20');
    await ed.getByLabel('pow progress').fill('40');
    await ed.getByLabel('Synchro', { exact: true }).fill('100');
    await ed.getByLabel('IQ', { exact: true }).fill('150');
    await ed.getByLabel('Center photon blast').selectOption({ label: 'Golla' });
    await ed.getByLabel('Right photon blast').selectOption({ label: 'Farlla' });
    await ed.getByRole('button', { name: 'Keep mag changes' }).click();
  }
  await page.screenshot({ path: test.info().outputPath('editor-before-save.png'), fullPage: true });

  // Save: confirmation with the account id, backup, write.
  await ed.getByRole('button', { name: 'Save changes...' }).click();
  const dlg = page.locator('.modal');
  await expect(dlg).toContainText('backup copy');
  await dlg.getByLabel('confirmation text').fill(id);
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.toast.ok', { hasText: 'Saved:' })).toBeVisible();

  const after = await getChar();
  expect([after.level, after.exp, after.stats]).toEqual([50, preview.exp, preview.stats]);
  if (tech) expect(after.techniques[tech]).toBe(cap);
  const saber = after.inventory.find((i: { data1: string }) => i.data1 === '0001000a0c00031e00000000');
  expect(saber?.name).toBe('Saber');
  const dimate = after.inventory.find((i: { data1: string }) => i.data1.startsWith('030001'));
  expect(dimate).toBeTruthy();
  if (magSlot !== undefined) {
    const mag = after.inventory[magSlot].mag;
    expect([mag.pow, mag.synchro, mag.iq, mag.photonBlasts]).toEqual([{ level: 20, progress: 40 }, 100, 150, [2, 0, null]]);
  }
  expect(readdirSync(join(sys, 'players', '_admin-backups')).some((f) => f.startsWith(`player_${USER}_0.psochar.`))).toBe(true);

  // Server-side checks: a technique above the class cap and a bad mag are refused.
  const post = (patch: unknown) => page.request.post(`${panel}/admin/api/accounts/${id}/characters/0`, { headers: { 'X-CSRF-Token': csrf, Origin: panel }, data: { username: USER, patch, confirm: id } });
  if (tech && cap !== null && cap < 30) {
    const r = await post({ techniques: { [tech]: cap + 1 } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toContain(`limited to level ${cap}`);
  }
  const unlearnable = Object.entries(limits).find(([, v]) => v === null);
  if (unlearnable) expect((await post({ techniques: { [unlearnable[0]]: 1 } })).status()).toBe(400);
  if (magSlot !== undefined) {
    const bad = { ...after.inventory[magSlot].mag, slot: magSlot, def: { level: 150, progress: 0 }, pow: { level: 60, progress: 0 } };
    delete (bad as { level?: number }).level;
    const r = await post({ mags: [bad] });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toContain('200 or less');
  }

  // The reloaded editor shows the new values.
  await page.reload();
  await page.locator('nav [data-tab="characters"]').click();
  await page.locator('main select').first().selectOption(id);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('#character-editor').getByLabel('Level', { exact: true })).toHaveValue('50');
  await expect(page.locator('#character-editor')).toContainText('Saber');
  await page.screenshot({ path: test.info().outputPath('editor-after-save.png'), fullPage: true });
  expect(errors).toEqual([]);
});

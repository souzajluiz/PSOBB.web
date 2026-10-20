// The admin panel against a REAL newserv: starts vendor/newserv/build/newserv in
// a temporary copy of its system folder (never the real system/players), with
// HTTPListen on a random loopback port and its game ports on random free ports,
// mounts bridge/admin.mjs on another random port and drives every area through
// the panel's API: accounts, licenses, flags, ban, password, announce, reload,
// quests, config, data tables, online players, and (with a real BB client
// session) a character edit that the next login reads back.
//
// Run: node tests/admin.live.ts      (skips itself if newserv is not built)
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAdmin } from '../bridge/admin.mjs';
import { buildPackage } from '../client/src/questeditor/io.ts';
import { QuestDocument } from '../client/src/questeditor/model.ts';
import { BBSession } from '../client/src/net/bbsession.ts';
import type { Transport } from '../client/src/net/bbconnection.ts';

const ROOT = resolve(import.meta.dirname, '..');
// In a worktree vendor/ is empty: fall back to the main checkout (read-only use).
const VENDORS = [join(ROOT, 'vendor/newserv'), '/Users/junior/Downloads/psobb-master/web/vendor/newserv'];
const vendor = VENDORS.find((v) => existsSync(join(v, 'build/newserv')));
if (!vendor) {
  console.log('SKIP: vendor/newserv/build/newserv is not built');
  process.exit(0);
}

let checks = 0;
let failures = 0;
function check(ok: boolean, name: string): void {
  checks++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
}

async function freePort(avoid: number[] = []): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((res) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => res(p));
      });
    });
    // Never the ports the main development setup uses.
    const banned = port === 5173 || port === 8080 || (port >= 12000 && port <= 12008);
    if (!banned && !avoid.includes(port)) return port;
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'newserv-admin-'));
const sys = join(tmp, 'system');
mkdirSync(sys);
for (const d of readdirSync(join(vendor, 'system'))) {
  if (['players', 'licenses', 'teams', 'config.json'].includes(d)) continue;
  cpSync(join(vendor, 'system', d), join(sys, d), { recursive: true });
}
for (const d of ['players', 'licenses', 'teams']) mkdirSync(join(sys, d));

const portA = await freePort();
const portB = await freePort([portA]);
const httpPort = await freePort([portA, portB]);
let config = readFileSync(join(vendor, 'system/config.example.json'), 'utf8');
config = config.replace(/"PortConfiguration": \{.*?\n  \},/s, `"PortConfiguration": {"bb-data1": [["127.0.0.1", ${portA}], "bb", "game_server"], "bb-data2": [["127.0.0.1", ${portB}], "bb", "game_server"]},`);
for (const [a, b] of [
  ['"LocalAddress": "en0"', '"LocalAddress": "127.0.0.1"'], ['"ExternalAddress": "10.0.1.5"', '"ExternalAddress": "127.0.0.1"'], ['"DNSServerPort": 53', '"DNSServerPort": 0'],
  ['"IPStackListen": [5059]', '"IPStackListen": []'], ['"PPPStackListen": [5058]', '"PPPStackListen": []'], ['"PPPRawListen": [5057]', '"PPPRawListen": []'],
  ['"HTTPListen": []', `"HTTPListen": ["127.0.0.1:${httpPort}"]`], ['"AllowUnregisteredUsers": true', '"AllowUnregisteredUsers": false'],
]) {
  if (!config.includes(a)) throw new Error(`config.example.json no longer has ${a}`);
  config = config.replace(a, b);
}
writeFileSync(join(sys, 'config.json'), config);

let ns: ChildProcess | null = null;
let nsLog = '';
function cleanup(): void {
  ns?.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
}
process.on('exit', cleanup);

ns = spawn(join(vendor, 'build/newserv'), [], { cwd: tmp, stdio: ['pipe', 'pipe', 'pipe'] });
ns.stdout?.on('data', (d) => (nsLog += d));
ns.stderr?.on('data', (d) => (nsLog += d));
const started = Date.now();
for (;;) {
  try {
    const r = await fetch(`http://127.0.0.1:${httpPort}/`);
    if (r.ok) break;
  } catch { /* not yet */ }
  if (Date.now() - started > 30_000) {
    console.log(nsLog.slice(-2000));
    throw new Error('newserv did not start');
  }
  await new Promise((r) => setTimeout(r, 300));
}
// Give the game ports a moment to open.
await new Promise((r) => setTimeout(r, 500));

// ---- the panel ----
const PASSWORD = 'live-test-password-123';
const admin = createAdmin({ env: { ADMIN_PASSWORD: PASSWORD }, newservHttp: `127.0.0.1:${httpPort}`, systemDir: sys, auditFile: join(tmp, 'audit.log'), log: () => {} });
const panel = http.createServer((req, res) => (admin.owns(req.url) ? void admin.handle(req, res) : res.end()));
await new Promise<void>((r) => panel.listen(0, '127.0.0.1', r));
const panelPort = (panel.address() as AddressInfo).port;

let cookie = '';
let csrf = '';
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { Cookie: cookie };
  if (method !== 'GET') Object.assign(headers, { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${panelPort}`, 'X-CSRF-Token': csrf });
  const r = await fetch(`http://127.0.0.1:${panelPort}/admin/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch { /* none */ }
  if (path === '/login' && r.ok) cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  return { status: r.status, json };
}

try {
  const login = await call('POST', '/login', { username: 'admin', password: PASSWORD });
  csrf = login.json.csrf;
  check(login.status === 200, 'panel login');

  const dash = await call('GET', '/dashboard');
  check(dash.status === 200 && dash.json.server?.ServerName === 'newserv' && dash.json.server.LobbyCount > 0, 'dashboard: /y/summary of the real server');
  check((await call('GET', '/lobbies')).json.lobbies.length > 0, 'lobbies: /y/lobbies');
  check((await call('GET', '/teams')).status === 200, 'teams: /y/teams');

  // Accounts
  const created = await call('POST', '/accounts', { username: 'paneluser', password: 'Pa55word!', flags: ['KICK_USER'] });
  check(created.status === 200 && /^[0-9A-F]{8}$/.test(created.json.id), `account created through add-account + add-license (${created.json?.id})`);
  const id: string = created.json.id;
  let list = await call('GET', '/accounts');
  let acct = list.json.accounts.find((a: any) => a.id === id);
  check(acct?.bbUsernames[0] === 'paneluser' && acct.flagNames.includes('KICK_USER') && !acct.banned, 'account listed with its BB username and flags');
  check(!JSON.stringify(list.json).includes('Pa55word!'), 'the password never appears in the list');
  check((await call('POST', '/accounts', { username: 'paneluser', password: 'x' })).status === 409, 'duplicate username refused');
  check((await call('POST', `/accounts/${id}/flags`, { flags: ['MODERATOR', 'ANNOUNCE'], confirm: id })).status === 200, 'flags changed (update-account flags=)');
  acct = (await call('GET', '/accounts')).json.accounts.find((a: any) => a.id === id);
  check(acct.flags === 0x27 && acct.flagNames.includes('ANNOUNCE'), 'new flags read back from newserv (0x27)');
  check((await call('POST', `/accounts/${id}/ban`, { duration: '2d', confirm: id })).status === 200, 'ban (update-account ban-duration=2d)');
  acct = (await call('GET', '/accounts')).json.accounts.find((a: any) => a.id === id);
  check(acct.banned === true && new Date(acct.banEnd).getTime() > Date.now() + 86_400_000, 'ban read back, about two days');
  check((await call('POST', `/accounts/${id}/unban`, {})).status === 200, 'unban');
  acct = (await call('GET', '/accounts')).json.accounts.find((a: any) => a.id === id);
  check(acct.banned === false, 'ban cleared');

  // The BB login uses the new password; the old one fails.
  const tcp = (port: number): Promise<Transport> => new Promise((resolveT, rejectT) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const early: Uint8Array[] = [];
    let handler: ((d: Uint8Array) => void) | null = null;
    const t: Transport = {
      send: (d) => void sock.write(d),
      close: () => void sock.destroy(),
      get onData() { return handler ?? ((d: Uint8Array) => void early.push(d)); },
      set onData(fn) { handler = fn; for (const d of early.splice(0)) fn(d); },
      onClose: () => {},
    };
    sock.on('data', (d) => t.onData(new Uint8Array(d)));
    sock.on('close', () => t.onClose());
    sock.on('connect', () => resolveT(t));
    sock.on('error', rejectT);
  });
  const nsk = new Uint8Array(readFileSync(join(vendor, 'system/blueburst/keys/default.nsk')));
  const withTimeout = <T>(p: Promise<T>, ms = 15_000): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  check((await call('POST', `/accounts/${id}/password`, { password: 'NewPass9' })).status === 200, 'password change (delete-license + add-license)');
  let bad = false;
  try {
    const s = new BBSession({ nsk, connect: tcp });
    await withTimeout(s.login('paneluser', 'Pa55word!', portA));
    s.close();
  } catch {
    bad = true;
  }
  check(bad, 'the old password no longer logs in');

  // A character: create it with a real client session, then edit it offline.
  const s1 = new BBSession({ nsk, connect: tcp });
  await withTimeout(s1.login('paneluser', 'NewPass9', portA));
  check(true, 'the new password logs in');
  await withTimeout(s1.characterPreviews());
  await withTimeout(s1.createCharacter(0, { name: 'PanelHero', charClass: 4 }));
  const lobby = await withTimeout(s1.enterLobby('paneluser', 'NewPass9', 0, portA));
  check(!!lobby, 'the player entered a lobby');

  const online = await call('GET', '/online');
  const me = online.json.clients.find((c: any) => c.accountId === id);
  check(!!me && me.Name === 'PanelHero', 'online: the player shows up with name and account');
  check((await call('GET', `/online/${me.ID}`)).json.client.Level >= 1, 'online: client detail');
  check((await call('GET', '/dashboard')).json.server.ClientCount >= 1, 'dashboard counts the player');
  check((await call('POST', `/accounts/${id}/characters/0`, { patch: { level: 50 }, confirm: id })).status === 409, 'editing a character of an online account is refused');
  check((await call('POST', '/online/announce', { message: 'Panel test announcement' })).status === 200, 'announce command accepted');
  check((await call('POST', '/online/kick', { accountId: id, confirm: `account ${id}` })).status === 200, 'kick command accepted');
  await new Promise((r) => setTimeout(r, 1500));
  s1.close();
  await new Promise((r) => setTimeout(r, 1500));

  const files = readdirSync(join(sys, 'players'));
  check(files.includes('player_paneluser_0.psochar'), `newserv wrote the character file (${files.join(', ')})`);
  const chars = await call('GET', `/accounts/${id}/characters`);
  const c0 = chars.json.characters?.[0];
  check(c0?.name === 'PanelHero' && c0.level === 1, 'character listed from the real .psochar (name PanelHero, level 1)');
  const detail = await call('GET', `/accounts/${id}/characters/0`);
  check(detail.json.inventory.length >= 0 && detail.json.className === 'RAcast', 'character detail parses class from the real file');

  const patch = { level: 42, exp: 123456, meseta: 98765, stats: { atp: 777 }, techniques: { Foie: 18 } };
  const edit = await call('POST', `/accounts/${id}/characters/0`, { patch, confirm: id });
  check(edit.status === 200, `character edit through the panel (${edit.json?.error ?? 'ok'})`);
  check(readdirSync(join(sys, 'players', '_admin-backups')).length === 1, 'a backup copy of the character was made');

  // newserv reads the edited file at the next login.
  const s2 = new BBSession({ nsk, connect: tcp });
  await withTimeout(s2.login('paneluser', 'NewPass9', portA));
  await withTimeout(s2.enterLobby('paneluser', 'NewPass9', 0, portA));
  const ch = s2.character;
  check(!!ch && ch.level === 42 && ch.exp === 123456 && ch.meseta === 98765 && ch.stats.atp === 777, `the game reads the edited character (level ${ch?.level}, exp ${ch?.exp}, meseta ${ch?.meseta}, atp ${ch?.stats.atp})`);
  check(ch?.techLevels[0] === 18, `and the technique level (Foie ${ch?.techLevels[0]})`);
  s2.close();
  await new Promise((r) => setTimeout(r, 1000));

  // Bank
  const bank = await call('POST', `/accounts/${id}/bank/0`, { patch: { meseta: 4242 }, confirm: id });
  check(bank.status === 200 && existsSync(join(sys, 'players', 'player_paneluser_0.psobank')), 'bank edit writes a .psobank');
  const s3 = new BBSession({ nsk, connect: tcp });
  await withTimeout(s3.login('paneluser', 'NewPass9', portA));
  await withTimeout(s3.enterLobby('paneluser', 'NewPass9', 0, portA));
  check(s3.character?.level === 42, 'the edited character is still intact after another login');
  s3.close();
  await new Promise((r) => setTimeout(r, 800));

  // Quests, reload, data, config
  const quests = await call('GET', '/quests');
  check(quests.json.total > 100 && quests.json.categories.some((c: any) => c.quests.length > 0), `quests: ${quests.json.total} quests in ${quests.json.categories.length} categories from /y/data/quests`);
  check((await call('POST', '/reload', { items: ['quests', 'accounts', 'teams'] })).status === 200, 'reload quests accounts teams (shell reload)');

  // Publish a quest made by the editor's writer: the real newserv must load it after the panel's reload.
  const qpkg = buildPackage(QuestDocument.blank({ episode: 0, name: 'Panel Published' }));
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  const pubDir = quests.json.categories.find((c: any) => c.directory === 'retrieval')?.directory ?? 'retrieval';
  const pub = await call('POST', '/quests/publish', { category: pubDir, name: 'q9001-bb-e.bin', bin: b64(qpkg.bin), dat: b64(qpkg.dat), confirm: `${pubDir}/q9001-bb-e.bin` });
  check(pub.status === 200, `publish a quest through the panel (${pub.status} ${JSON.stringify(pub.json)})`);
  const questsAfter = await call('GET', '/quests');
  check(questsAfter.json.total === quests.json.total + 1, `the real newserv loaded the published quest (${quests.json.total} -> ${questsAfter.json.total})`);
  check(questsAfter.json.categories.some((c: any) => c.quests.some((x: any) => x.number === 9001 && x.name === 'Panel Published')), 'it is listed by number and name');
  const qfiles = await call('GET', '/quests/files');
  check(qfiles.json.directories.find((d: any) => d.dir === pubDir)?.files.some((f: any) => f.name === 'q9001-bb.dat'), 'the file list shows the published .dat');
  check((await call('GET', '/data/rare-tables')).json.data.length > 0, 'data: rare tables listed');
  check((await call('GET', '/data/common-tables')).status === 200, 'data: common tables listed');
  check((await call('GET', '/data/tekker-table')).status === 200, 'data: tekker table');
  check((await call('GET', '/data/level-table/BB_V4')).status === 200, 'data: level table');

  const cfg = await call('GET', '/config');
  check(cfg.json.editable.find((e: any) => e.key === 'CheatModeBehavior').current === 'OnByDefault', 'config: current value read from config.json');
  const eConfig = await call('POST', '/config', { key: 'BBGlobalEXPMultiplier', value: 2.5, confirm: 'BBGlobalEXPMultiplier' });
  check(eConfig.status === 200, `config edit + reload config (${eConfig.json?.error ?? 'ok'})`);
  const eff = await fetch(`http://127.0.0.1:${httpPort}/y/config`).then((r) => r.json());
  check(eff.BBGlobalEXPMultiplier === 2.5, 'newserv now reports BBGlobalEXPMultiplier 2.5');
  check((await call('POST', '/config', { key: 'ServerName', value: 'Panel Test', confirm: 'ServerName' })).status === 200, 'config: ServerName');
  const after = await fetch(`http://127.0.0.1:${httpPort}/y/server`).then((r) => r.json());
  check(after.ServerName === 'Panel Test', 'newserv reports the new ServerName after reload config');

  // Delete
  check((await call('POST', `/accounts/${id}/delete`, { confirm: id })).status === 200, 'account deleted (delete-account)');
  list = await call('GET', '/accounts');
  check(!list.json.accounts.some((a: any) => a.id === id), 'it is gone from newserv');
  check(existsSync(join(sys, 'players', 'player_paneluser_0.psochar')), 'its character file is kept');

  const audit = await call('GET', '/audit?limit=200');
  check(audit.json.entries.length >= 12 && !JSON.stringify(audit.json).includes('NewPass9') && !JSON.stringify(audit.json).includes('Pa55word!'), `audit log has ${audit.json.entries.length} entries and no password`);
} catch (e) {
  failures++;
  console.log(`FAIL exception: ${(e as Error).stack}`);
  console.log(nsLog.slice(-2500));
}

panel.close();
admin.close();
ns.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 500));
cleanup();
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

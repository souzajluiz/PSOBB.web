// The admin panel backend (bridge/admin.mjs, bridge/admin-chars.mjs) against a
// fake newserv HTTP server: authentication, lockout, session expiry, CSRF,
// no CORS, input validation, the mapping of every action to newserv's HTTP
// routes / shell commands, the audit log, character / bank / config editing.
//
// Run: node tests/admin.test.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdmin, hashPassword, stripSecrets } from '../bridge/admin.mjs';
import { CHAR_FILE_SIZE, applyBankPatch, applyCharacterPatch, parseCharacter } from '../bridge/admin-chars.mjs';

let checks = 0;
let failures = 0;
function check(ok: boolean, name: string): void {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}`);
  }
}
const eq = (a: unknown, b: unknown, name: string): void => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  check(ok, ok ? name : `${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// ---- fake newserv ---------------------------------------------------------------------

type Acct = { AccountID: number; Flags: number; UserFlags: number; BanEndTime: number; LastPlayerName: string; BBTeamID: number; BBLicenses: Array<{ UserName: string; Password: string }>; DCLicenses: unknown[]; PCLicenses: unknown[]; GCLicenses: unknown[]; XBLicenses: unknown[]; DCNTELicenses: unknown[] };
const fake = {
  accounts: [] as Acct[],
  clients: [] as Array<Record<string, unknown>>,
  shell: [] as string[],
  failNext: new Set<string>(),
  nextId: 0x10,
  hits: [] as string[],
};
function hex8(n: number): string {
  return n.toString(16).toUpperCase().padStart(8, '0');
}
function shellExec(cmd: string): string {
  fake.shell.push(cmd);
  const t = cmd.split(' ');
  for (const prefix of fake.failNext) {
    if (cmd.startsWith(prefix)) {
      fake.failNext.delete(prefix);
      throw new Error('simulated failure');
    }
  }
  const find = (id: string) => {
    const a = fake.accounts.find((x) => x.AccountID === parseInt(id, 16));
    if (!a) throw new Error('missing account');
    return a;
  };
  switch (t[0]) {
    case 'add-account': {
      const flags = parseInt(t[1].slice(6), 16);
      const a: Acct = { AccountID: fake.nextId++, Flags: flags, UserFlags: 0, BanEndTime: 0, LastPlayerName: '', BBTeamID: 0, BBLicenses: [], DCLicenses: [], PCLicenses: [], GCLicenses: [], XBLicenses: [], DCNTELicenses: [] };
      fake.accounts.push(a);
      return `Account ${hex8(a.AccountID)} added`;
    }
    case 'add-license': {
      const a = find(t[1]);
      if (t[2] !== 'BB') throw new Error('type');
      if (a.BBLicenses.some((l) => l.UserName === t[3])) throw new Error('duplicate');
      a.BBLicenses.push({ UserName: t[3], Password: t[4] });
      return 'ok';
    }
    case 'delete-license': {
      const a = find(t[1]);
      a.BBLicenses = a.BBLicenses.filter((l) => l.UserName !== t[3]);
      return 'ok';
    }
    case 'delete-account':
      find(t[1]);
      fake.accounts = fake.accounts.filter((x) => x.AccountID !== parseInt(t[1], 16));
      return 'Account deleted';
    case 'update-account': {
      const a = find(t[1]);
      for (const tok of t.slice(2)) {
        if (tok.startsWith('flags=')) a.Flags = parseInt(tok.slice(6), 16);
        else if (tok === 'unban') a.BanEndTime = Date.now() * 1000;
        else if (tok.startsWith('ban-duration=')) a.BanEndTime = (Date.now() + 86_400_000) * 1000;
        else throw new Error('bad field');
      }
      return 'ok';
    }
    case 'kick':
    case 'announce':
    case 'reload':
      return '';
    default:
      throw new Error('no such command');
  }
}

const fakeServer = http.createServer((req, res) => {
  fake.hits.push(`${req.method} ${req.url}`);
  const send = (status: number, obj: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'POST' && req.url === '/y/shell-exec') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        send(200, { result: shellExec(JSON.parse(body).command) });
      } catch (e) {
        send(400, { Message: (e as Error).message, Error: true });
      }
    });
    return;
  }
  const url = req.url ?? '';
  if (url === '/y/accounts') return send(200, fake.accounts);
  if (url === '/y/clients') return send(200, fake.clients);
  if (url === '/y/summary') return send(200, { Server: { ServerName: 'fake', ClientCount: fake.clients.length, GameCount: 0, LobbyCount: 20, UptimeUsecs: 5_000_000 }, Games: [], Clients: fake.clients.map((c) => ({ ID: c.ID, AccountID: (c.Account as { AccountID: number }).AccountID, Name: 'Hero', Level: 5 })) });
  if (url === '/y/lobbies') return send(200, [{ ID: 1 }]);
  if (url === '/y/teams') return send(200, {});
  if (url === '/y/config') return send(200, { ServerName: 'newserv', BBGlobalEXPMultiplier: 1 });
  if (url === '/y/data/quests') {
    return send(200, {
      Directory: 'system/quests',
      Categories: { Retrieval: { CategoryID: 4, DirectoryName: 'retrieval', Description: 'x', Flags: 129, Name: 'Retrieval' }, Hidden: { CategoryID: 1, DirectoryName: 'hidden', Description: '', Flags: 0, Name: 'Hidden' } },
      Quests: [{ Metadata: { QuestNumber: 5, CategoryID: 4, Episode: 'Episode 1', MaxPlayers: 4, Joinable: false, EnabledExpression: 'F_0001', AvailableExpression: null, DefaultDropMode: 'CLIENT' }, Versions: [{ Name: 'Hello', Language: 'English', Version: 'BB_V4' }] }],
    });
  }
  if (url === '/y/data/rare-tables') return send(200, ['rare-table-v4']);
  send(404, { Message: 'no', Error: true });
});
await new Promise<void>((r) => fakeServer.listen(0, '127.0.0.1', r));
const fakePort = (fakeServer.address() as AddressInfo).port;

// ---- environment ----------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), 'admintest-'));
const systemDir = join(tmp, 'system');
const players = join(systemDir, 'players');
mkdirSync(players, { recursive: true });
const configFile = join(systemDir, 'config.json');
const configText = `{
  // test config
  "ServerName": "newserv", // name
  "AllowUnregisteredUsers": true,
  "CheatModeBehavior": "OnByDefault",
  "BBGlobalEXPMultiplier": 1,
  "WelcomeMessage": "Hello, world",
  "HTTPListen": ["127.0.0.1:5080"],
}
`;
writeFileSync(configFile, configText);
const mirror = join(tmp, 'mirror', 'config.json');
const auditFile = join(tmp, 'audit.log');

let clock = 1_800_000_000_000;
const PASSWORD = 'correct horse battery staple';
function makeAdmin(extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  return createAdmin({
    env: { ADMIN_PASSWORD: PASSWORD, ...env },
    newservHttp: `127.0.0.1:${fakePort}`,
    systemDir,
    configMirror: mirror,
    auditFile,
    now: () => clock,
    log: () => {},
    ...extra,
  });
}

async function mount(admin: ReturnType<typeof createAdmin>) {
  const server = http.createServer((req, res) => {
    if (admin.owns(req.url)) return void admin.handle(req, res);
    res.setHeader('Access-Control-Allow-Origin', '*'); // like bridge/server.mjs for the public files
    res.writeHead(200);
    res.end('public');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { server, port, base: `http://127.0.0.1:${port}` };
}

class Client {
  cookie = '';
  csrf = '';
  base: string;
  port: number;
  constructor(base: string, port: number) {
    this.base = base;
    this.port = port;
  }
  async req(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string>; raw?: string; noOrigin?: boolean; csrf?: boolean } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.cookie && !headers.Cookie) headers.Cookie = this.cookie;
    if (method !== 'GET') {
      headers['Content-Type'] ??= 'application/json';
      if (!opts.noOrigin) headers.Origin ??= `http://127.0.0.1:${this.port}`;
      if (opts.csrf !== false && this.csrf) headers['X-CSRF-Token'] ??= this.csrf;
    }
    const res = await fetch(this.base + path, { method, headers, body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual' });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  async login(password = PASSWORD, headers: Record<string, string> = {}) {
    const r = await this.req('POST', '/admin/api/login', { username: 'admin', password }, { headers });
    if (r.status === 200) {
      this.cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
      this.csrf = r.json.csrf;
    }
    return r;
  }
  get(path: string) {
    return this.req('GET', '/admin/api' + path);
  }
  post(path: string, body: unknown, opts = {}) {
    return this.req('POST', '/admin/api' + path, body, opts);
  }
}

// fetch() does not let a test choose the Host header.
function rawLoginStatus(port: number, host: string): Promise<number> {
  return new Promise((res) => {
    const body = JSON.stringify({ username: 'admin', password: PASSWORD });
    const r = http.request({ host: '127.0.0.1', port, path: '/admin/api/login', method: 'POST', headers: { Host: host, Origin: 'http://' + host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (resp) => {
      resp.resume();
      res(resp.statusCode ?? 0);
    });
    r.end(body);
  });
}

const admin = makeAdmin();
const m = await mount(admin);
const c = new Client(m.base, m.port);

// ---- disabled / refused configuration ----------------------------------------------------------

{
  const off = createAdmin({ env: {}, log: () => {} });
  check(off.enabled === false && off.owns('/admin/api/session'), 'without a password the module is disabled but owns /admin');
  const mm = await mount(off);
  const r = await fetch(mm.base + '/admin/', { redirect: 'manual' });
  eq(r.status, 404, 'disabled admin answers 404 for the page');
  eq((await fetch(mm.base + '/admin/api/session')).status, 404, 'and for the api');
  eq((await fetch(mm.base + '/admin/api/login', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status, 404, 'and a login attempt');
  mm.server.close();
  let threw = false;
  try {
    createAdmin({ env: { ADMIN_PASSWORD: PASSWORD }, newservHttp: '10.0.0.5:5080', log: () => {} });
  } catch {
    threw = true;
  }
  check(threw, 'a non-loopback newserv HTTP address is refused');
  threw = false;
  try {
    createAdmin({ env: { ADMIN_PASSWORD: PASSWORD, ALLOWED_PORTS: '12000,5080' }, newservHttp: '127.0.0.1:5080', log: () => {} });
  } catch {
    threw = true;
  }
  check(threw, 'newserv HTTP port inside the relay allow-list is refused');
  threw = false;
  try {
    createAdmin({ env: { ADMIN_PASSWORD_HASH: 'plaintext' }, newservHttp: '127.0.0.1:5080', log: () => {} });
  } catch {
    threw = true;
  }
  check(threw, 'a malformed ADMIN_PASSWORD_HASH is refused');
}

// ---- static page, headers, CORS -----------------------------------------------------------------------

{
  const r = await c.req('GET', '/admin/');
  eq(r.status, 200, 'the admin page is served');
  check((r.headers.get('content-security-policy') ?? '').includes("script-src 'self'"), 'with a strict CSP');
  eq(r.headers.get('x-frame-options'), 'DENY', 'and no framing');
  eq(r.headers.get('access-control-allow-origin'), null, 'no CORS header on the page');
  const js = await c.req('GET', '/admin/static/admin.js');
  eq(js.status, 200, 'the script is served');
  eq((await c.req('GET', '/admin/static/%2e%2e/admin-chars.mjs')).status, 404, 'no path traversal through the static route');
  eq((await c.req('GET', '/admin/static/admin-chars.mjs')).status, 404, 'only the three ui files are served');
  const pub = await c.req('GET', '/somefile');
  eq(pub.headers.get('access-control-allow-origin'), '*', 'the public handler still sends its own header (control)');
  const api = await c.req('GET', '/admin/api/dashboard', undefined, { headers: { Origin: 'https://evil.example' } });
  eq(api.status, 401, 'api needs a session');
  eq(api.headers.get('access-control-allow-origin'), null, 'no CORS header on api answers, even for a foreign Origin');
  const pre = await c.req('OPTIONS', '/admin/api/login', undefined, { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  eq(pre.status, 405, 'a CORS preflight is refused');
  eq(pre.headers.get('access-control-allow-origin'), null, 'without allow headers');
  eq((await c.req('GET', '/admin/api/nope')).status, 404, 'unknown api route');
  const noSess = await c.get('/session');
  eq(noSess.json.authenticated, false, 'session endpoint says logged out');
}

// ---- login ---------------------------------------------------------------------------------------------------

{
  eq((await c.login('wrong')).status, 401, 'wrong password is refused');
  eq((await c.req('POST', '/admin/api/login', { username: 'root', password: PASSWORD })).status, 401, 'wrong username is refused');
  eq((await c.req('POST', '/admin/api/login', { username: 'admin', password: PASSWORD }, { noOrigin: true })).status, 403, 'login without Origin is refused');
  eq((await c.req('POST', '/admin/api/login', { username: 'admin', password: PASSWORD }, { headers: { Origin: 'https://evil.example' } })).status, 403, 'login from a foreign Origin is refused');
  eq((await c.req('POST', '/admin/api/login', { username: 'admin', password: PASSWORD }, { headers: { 'Content-Type': 'text/plain' } })).status, 415, 'login needs application/json');
  eq((await c.req('POST', '/admin/api/login', null, { raw: 'x'.repeat(70000) })).status, 413, 'oversized body refused');
  eq((await c.req('POST', '/admin/api/login', null, { raw: '{bad' })).status, 400, 'invalid JSON refused');
  eq(await rawLoginStatus(m.port, 'admin.example.com'), 403,'plain http to a non-loopback host is refused (HTTPS required)');

  const ok = await c.login();
  eq(ok.status, 200, 'right password logs in');
  const sc = ok.headers.get('set-cookie') ?? '';
  check(/HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\/admin/.test(sc), 'cookie is HttpOnly, SameSite=Strict, scoped to /admin');
  check(!/Secure/.test(sc), 'not Secure over plain loopback http');
  check(/^psobb_admin=[0-9a-f]{64}/.test(sc), 'the session id is 32 random bytes');
  check(typeof ok.json.csrf === 'string' && ok.json.csrf.length >= 32, 'a CSRF token comes back');
  eq((await c.get('/session')).json.authenticated, true, 'the cookie authenticates');
  eq((await c.req('GET', '/admin/api/dashboard', undefined, { headers: { Cookie: 'psobb_admin=' + 'a'.repeat(64) } })).status, 401, 'a forged session id is refused');
}

// ---- CSRF ----------------------------------------------------------------------------------------------------------

{
  const body = { items: ['quests'] };
  eq((await c.post('/reload', body, { csrf: false })).status, 403, 'POST without CSRF token is refused');
  eq((await c.post('/reload', body, { headers: { 'X-CSRF-Token': 'x'.repeat(48) } })).status, 403, 'wrong CSRF token is refused');
  eq((await c.post('/reload', body, { noOrigin: true })).status, 403, 'POST without Origin is refused');
  eq((await c.post('/reload', body, { headers: { Origin: 'https://evil.example' } })).status, 403, 'POST from a foreign Origin is refused');
  eq((await c.post('/reload', body, { headers: { Origin: 'null' } })).status, 403, 'Origin "null" is refused');
  eq((await c.post('/reload', body, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403, 'cross-site fetch metadata is refused');
  eq(fake.shell.length, 0, 'none of those reached newserv');
  eq((await c.post('/reload', body)).status, 200, 'with token and Origin it works');
  eq(fake.shell.at(-1), 'reload quests', 'and maps to the shell command');
}

// ---- lockout / expiry / logout --------------------------------------------------------------------------------------

{
  const a2 = makeAdmin({ maxFailures: 3, windowMs: 60_000, lockMs: 120_000, globalMaxFailures: 1000, idleMs: 600_000, absoluteMs: 3_600_000 });
  const mm = await mount(a2);
  const x = new Client(mm.base, mm.port);
  for (let i = 0; i < 2; i++) eq((await x.login('bad')).status, 401, `failure ${i + 1} is a 401`);
  const third = await x.login('bad');
  eq(third.status, 429, 'the third failure locks out');
  check(Number(third.headers.get('retry-after')) > 0, 'with Retry-After');
  const locked = await x.login(PASSWORD);
  eq(locked.status, 429, 'the right password is refused while locked');
  clock += 121_000;
  eq((await x.login(PASSWORD)).status, 200, 'after the lock time the login works again');
  // Idle expiry
  eq((await x.get('/session')).json.authenticated, true, 'session is alive');
  clock += 601_000;
  eq((await x.get('/session')).json.authenticated, false, 'idle expiry ends the session');
  eq((await x.get('/dashboard')).status, 401, 'and the api refuses it');
  // Absolute expiry even if active
  await x.login(PASSWORD);
  for (let i = 0; i < 8; i++) {
    clock += 500_000;
    await x.get('/session');
  }
  clock += 500_000;
  eq((await x.get('/session')).json.authenticated, false, 'absolute expiry ends an active session');
  // Logout
  await x.login(PASSWORD);
  const old = x.cookie;
  eq((await x.post('/logout', {})).status, 200, 'logout works');
  eq((await x.req('GET', '/admin/api/session', undefined, { headers: { Cookie: old } })).json.authenticated, false, 'the old cookie is dead after logout');
  mm.server.close();
  a2.close();

  const a3 = makeAdmin({ maxFailures: 1000, globalMaxFailures: 4, globalLockMs: 60_000 });
  const m3 = await mount(a3);
  const y = new Client(m3.base, m3.port);
  for (let i = 0; i < 4; i++) await y.login('bad');
  eq((await y.login(PASSWORD)).status, 429, 'many failures overall lock every client for a while');
  m3.server.close();
  a3.close();

  // Behind a TLS proxy
  const a4 = makeAdmin({ trustProxy: true });
  const m4 = await mount(a4);
  const z = new Client(m4.base, m4.port);
  const r = await z.login(PASSWORD, { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '9.9.9.9' });
  eq(r.status, 200, 'login works behind the proxy with X-Forwarded-Proto https');
  check(/; Secure/.test(r.headers.get('set-cookie') ?? ''), 'and the cookie is Secure');
  m4.server.close();
  a4.close();
}

// scrypt hash login
{
  const hash = await hashPassword('another very long password');
  const a5 = createAdmin({ env: { ADMIN_PASSWORD_HASH: hash }, newservHttp: `127.0.0.1:${fakePort}`, systemDir, auditFile, now: () => clock, log: () => {} });
  const m5 = await mount(a5);
  const w = new Client(m5.base, m5.port);
  eq((await w.login('wrong')).status, 401, 'hash: wrong password');
  eq((await w.login('another very long password')).status, 200, 'hash: right password');
  m5.server.close();
  a5.close();
}

// ---- validation: nothing odd reaches the shell -----------------------------------------------------------------------------

await c.login();
fake.shell.length = 0;
{
  const bad = async (path: string, body: unknown, status: number, name: string) => {
    const r = await c.post(path, body);
    eq(r.status, status, name);
  };
  await bad('/accounts', { username: 'a b', password: 'pw1234' }, 400, 'username with a space');
  await bad('/accounts', { username: 'ok', password: 'pw 1234' }, 400, 'password with a space');
  await bad('/accounts', { username: 'ok', password: 'pw"1234' }, 400, 'password with a quote');
  await bad('/accounts', { username: 'ok', password: "pw'1" }, 400, 'password with an apostrophe');
  await bad('/accounts', { username: 'ok', password: 'pw;reload all' }, 400, 'password with a separator');
  await bad('/accounts', { username: 'ok', password: 'pw\nexit' }, 400, 'password with a newline');
  await bad('/accounts', { username: 'x'.repeat(17), password: 'pw' }, 400, 'username too long');
  await bad('/accounts', { username: 'ok', password: 'x'.repeat(17) }, 400, 'password too long');
  await bad('/accounts', { username: 'ok', password: 'pw', flags: ['EVIL'] }, 400, 'unknown flag name');
  await bad('/accounts', { username: 'ok', password: 'pw', flags: ['IS_SHARED_ACCOUNT'] }, 400, 'shared-account flag cannot be granted');
  await bad('/accounts', { username: { a: 1 }, password: 'pw' }, 400, 'username of the wrong type');
  await bad('/accounts', [], 400, 'array body');
  await bad('/reload', { items: ['all'] }, 400, 'reload all is not allowed');
  await bad('/reload', { items: ['quests; exit'] }, 400, 'reload item with a separator');
  await bad('/reload', { items: [] }, 400, 'reload with no items');
  await bad('/reload', { items: ['functions'] }, 400, 'reload of functions is not offered');
  await bad('/online/announce', { message: 'hi "there"' }, 400, 'announcement with quotes');
  await bad('/online/announce', { message: "it's" }, 400, 'announcement with an apostrophe');
  await bad('/online/announce', { message: 'a;b' }, 400, 'announcement with a semicolon');
  await bad('/online/announce', { message: 'line\nexit' }, 400, 'announcement with a newline');
  await bad('/online/announce', { message: 'tab\there' }, 400, 'announcement with a control character');
  await bad('/online/announce', { message: 'x'.repeat(201) }, 400, 'announcement too long');
  await bad('/online/announce', { message: '   ' }, 400, 'blank announcement');
  await bad('/online/kick', { clientId: '1; exit', confirm: 'x' }, 400, 'kick with a non-numeric client');
  await bad('/online/kick', { accountId: '../1', confirm: 'x' }, 400, 'kick with a bad account id');
  await bad('/config', { key: 'HTTPListen', value: ['0.0.0.0:80'], confirm: 'HTTPListen' }, 400, 'config key outside the allow-list');
  await bad('/config', { key: '__proto__', value: 1, confirm: '__proto__' }, 400, 'prototype key');
  fake.accounts.push({ AccountID: 0x99, Flags: 0, UserFlags: 0, BanEndTime: 0, LastPlayerName: '', BBTeamID: 0, BBLicenses: [{ UserName: 'victim', Password: 'secretpw1' }], DCLicenses: [], PCLicenses: [], GCLicenses: [], XBLicenses: [], DCNTELicenses: [] });
  await bad('/accounts/99/ban', { duration: '3d; exit', confirm: '00000099' }, 400, 'ban duration with a separator');
  await bad('/accounts/99/ban', { duration: '0d', confirm: '00000099' }, 400, 'ban duration of zero');
  await bad('/accounts/99/ban', { duration: '99999d', confirm: '00000099' }, 400, 'ban duration too long');
  await bad('/accounts/99/ban', { duration: '3x', confirm: '00000099' }, 400, 'ban duration with a bad unit');
  await bad('/accounts/99/password', { password: 'bad pw' }, 400, 'password change with a space');
  eq((await c.get('/accounts/zz')).status, 404, 'non-hex account id never matches a route');
  eq((await c.get('/accounts/123456789')).status, 404, 'overlong account id never matches a route');
  eq((await c.get('/accounts/FF')).status, 404, 'unknown account is a 404');
  eq((await c.get('/data/..%2f..%2fetc')).status, 404, 'data path traversal');
  eq((await c.get('/data/rare-table/../x')).status, 404, 'data path with dots');
  eq(fake.shell.length, 0, 'no rejected request reached newserv');
}

// ---- confirmation step is enforced by the server ---------------------------------------------------------------------------

{
  const r1 = await c.post('/accounts/99/delete', {});
  eq(r1.status, 409, 'delete without confirmation is refused');
  eq(r1.json.confirmRequired, '00000099', 'and says what to confirm');
  eq((await c.post('/accounts/99/delete', { confirm: '99' })).status, 409, 'a wrong confirmation is refused');
  eq((await c.post('/accounts/99/ban', { duration: '1d' })).status, 409, 'ban without confirmation');
  eq((await c.post('/accounts/99/flags', { flags: ['ROOT'] })).status, 409, 'flags without confirmation');
  eq((await c.post('/online/kick', { clientId: 3 })).status, 409, 'kick without confirmation');
  eq((await c.post('/config', { key: 'ServerName', value: 'x' })).status, 409, 'config without confirmation');
  eq((await c.post('/accounts/99/characters/0', { patch: { level: 5 } })).status, 409, 'character edit without confirmation');
  eq((await c.post('/accounts/99/bank/0', { patch: { meseta: 5 } })).status, 409, 'bank edit without confirmation');
  eq(fake.shell.length, 0, 'none reached newserv');
}

// ---- proxy mapping ---------------------------------------------------------------------------------------------------------------

{
  const list = await c.get('/accounts');
  eq(list.status, 200, 'account list');
  check(!list.text.includes('secretpw1') && !/Password|AccessKey/i.test(list.text), 'the list carries no password');
  eq(list.json.accounts.find((a: any) => a.id === '00000099').bbUsernames, ['victim'], 'it shows the BB username');
  check(JSON.stringify(stripSecrets({ BBLicenses: [{ UserName: 'a', Password: 'p' }], X: { AccessKey: 'k' } })) === '{"BBLicenses":[{"UserName":"a"}],"X":{}}', 'stripSecrets removes Password and AccessKey at any depth');

  const created = await c.post('/accounts', { username: 'newguy', password: 'S3cret!pw', flags: ['MODERATOR'] });
  eq(created.status, 200, 'account creation');
  eq(fake.shell.slice(-2), ['add-account flags=00000007', `add-license ${created.json.id} BB newguy S3cret!pw`], 'creation maps to add-account + add-license');
  eq((await c.post('/accounts', { username: 'NEWGUY', password: 'pw' })).status, 409, 'a duplicate username (any case) is refused');
  fake.failNext.add('add-license');
  const before = fake.accounts.length;
  const failed = await c.post('/accounts', { username: 'broken', password: 'pw' });
  check(failed.status >= 400, 'a failing license add is reported');
  eq(fake.accounts.length, before, 'and the half-made account is deleted again');
  eq(fake.shell.at(-1)?.startsWith('delete-account'), true, 'by delete-account');

  fake.shell.length = 0;
  eq((await c.post('/accounts/99/flags', { flags: ['KICK_USER', 'ANNOUNCE'], confirm: '00000099' })).status, 200, 'flag change');
  eq(fake.shell, ['update-account 00000099 flags=00000021'], 'flags map to update-account flags=HEX');
  fake.shell.length = 0;
  eq((await c.post('/accounts/99/ban', { duration: '3d', confirm: '00000099' })).status, 200, 'ban');
  eq((await c.post('/accounts/99/ban', { duration: 'permanent', confirm: '00000099' })).status, 200, 'permanent ban');
  eq((await c.post('/accounts/99/unban', {})).status, 200, 'unban');
  eq(fake.shell, ['update-account 00000099 ban-duration=3d', 'update-account 00000099 ban-duration=100y', 'update-account 00000099 unban'], 'ban / unban commands');

  fake.shell.length = 0;
  eq((await c.post('/accounts/99/password', { password: 'N3wpass' })).status, 200, 'password change');
  eq(fake.shell, ['delete-license 00000099 BB victim', 'add-license 00000099 BB victim N3wpass'], 'password change = delete-license + add-license');
  fake.shell.length = 0;
  fake.failNext.add('add-license 00000099 BB victim BadNew');
  const pf = await c.post('/accounts/99/password', { password: 'BadNew' });
  check(pf.status >= 400, 'a failing password change is reported');
  eq(fake.accounts.find((a) => a.AccountID === 0x99)?.BBLicenses[0].Password, 'N3wpass', 'and the old license is put back');
  check(!pf.text.includes('N3wpass'), 'without leaking the old password');

  fake.shell.length = 0;
  eq((await c.post('/online/announce', { message: 'Server restart in 5 minutes $C6' })).status, 200, 'announce');
  eq((await c.post('/online/kick', { accountId: '99', confirm: 'account 00000099' })).status, 200, 'kick by account');
  eq((await c.post('/online/kick', { clientId: 26, confirm: 'C-1a' })).status, 200, 'kick by client');
  eq(fake.shell, ['announce Server restart in 5 minutes $C6', 'kick 0x99', 'kick C-1a'], 'announce / kick commands');
  fake.shell.length = 0;
  eq((await c.post('/accounts/99/delete', { confirm: '00000099' })).status, 200, 'delete');
  eq(fake.shell, ['delete-account 00000099'], 'delete-account');

  const q = await c.get('/quests');
  eq(q.status, 200, 'quests');
  eq(q.json.categories.map((x: any) => [x.name, x.listed, x.quests.length]), [['Hidden', false, 0], ['Retrieval', true, 1]], 'quests are grouped by category with the listed state');
  eq(q.json.categories[1].quests[0].name, 'Hello', 'with the English name');
  const dash = await c.get('/dashboard');
  eq(dash.json.server.ServerName, 'fake', 'dashboard shows the server');
  eq((await c.get('/lobbies')).json.lobbies.length, 1, 'lobbies');
  eq((await c.get('/teams')).status, 200, 'teams');
  eq((await c.get('/data/rare-tables')).json.data, ['rare-table-v4'], 'data tables');
  eq(fake.hits.includes('GET /y/data/rare-tables'), true, 'map to /y/data/...');
  eq((await c.get('/data/common-table/..')).status, 404, 'data name must match the pattern');
}

// ---- characters -----------------------------------------------------------------------------------------------------------------------

function makeCharFile(): Buffer {
  const b = Buffer.alloc(CHAR_FILE_SIZE);
  b.writeUInt16LE(CHAR_FILE_SIZE, 0);
  b.writeUInt16LE(0x00e7, 2);
  const inv = 8;
  b[inv] = 2; // two items
  const item = (slot: number, d1: string, equipped: boolean) => {
    const o = inv + 4 + slot * 0x1c;
    b[o] = equipped ? 2 : 1;
    b[o + 2] = slot < 19 ? 3 : 0; // technique extension byte of the slot (must survive)
    b.writeUInt32LE(equipped ? 8 : 0, o + 4);
    Buffer.from(d1, 'hex').copy(b, o + 8);
    b.writeUInt32LE(0x10000 + slot, o + 20);
  };
  for (let i = 0; i < 19; i++) b[inv + 4 + i * 0x1c + 2] = 3; // technique extension bytes live in every slot
  item(0, '000100000000000000000000', true);
  item(1, '030000000000000000000000', false);
  const disp = 8 + 0x34c;
  [100, 50, 60, 400, 70, 80, 10].forEach((v, i) => b.writeUInt16LE(v, disp + i * 2));
  b.writeUInt32LE(9, disp + 0x18); // level 10
  b.writeUInt32LE(5000, disp + 0x1c);
  b.writeUInt32LE(1234, disp + 0x20);
  b[disp + 0x54] = 3;
  b[disp + 0x55] = 4;
  Buffer.from('\tEHero', 'utf16le').copy(b, disp + 0x74);
  b.fill(0xff, disp + 0x17c, disp + 0x17c + 0x14);
  b[disp + 0x17c] = 4; // Foie level 5
  return b;
}

{
  fake.accounts.push({ AccountID: 0x42, Flags: 0, UserFlags: 0, BanEndTime: 0, LastPlayerName: 'Hero', BBTeamID: 0, BBLicenses: [{ UserName: 'hero', Password: 'pw' }], DCLicenses: [], PCLicenses: [], GCLicenses: [], XBLicenses: [], DCNTELicenses: [] });
  const file = join(players, 'player_hero_0.psochar');
  writeFileSync(file, makeCharFile());

  const parsed = parseCharacter(makeCharFile());
  eq([parsed.name, parsed.level, parsed.exp, parsed.meseta, parsed.stats.hp, parsed.sectionName, parsed.techniques.Foie, parsed.inventory.length], ['Hero', 10, 5000, 1234, 400, 'Bluefull', 8, 2], 'the character codec reads the file');
  eq(parsed.inventory[0].equipped, true, 'equipped flag is read');

  const list = await c.get('/accounts/42/characters');
  eq(list.json.characters.map((x: any) => [x.slot, x.name, x.level]), [[0, 'Hero', 10]], 'character list');
  const one = await c.get('/accounts/42/characters/0');
  eq([one.json.level, one.json.inventory.length, one.json.bank.source], [10, 2, 'psochar'], 'character detail');
  eq((await c.get('/accounts/42/characters/9')).status, 404, 'missing slot');
  eq((await c.get('/accounts/42/characters/99')).status, 400, 'slot out of range');

  const patch = { level: 30, exp: 99999, meseta: 500000, stats: { hp: 900, atp: 250 }, sectionId: 5, charClass: 3, techniques: { Foie: 20, Barta: 7, Gifoie: null }, inventory: { remove: [0], add: [{ data1: '000200000000000000000000' }] } };
  fake.clients = [{ ID: 1, Account: { AccountID: 0x42 } }];
  const refused = await c.post('/accounts/42/characters/0', { patch, confirm: '00000042' });
  eq(refused.status, 409, 'editing an online account is refused');
  fake.clients = [];
  eq((await c.post('/accounts/42/characters/0', { patch: { level: 0 }, confirm: '00000042' })).status, 400, 'level 0 is refused');
  eq((await c.post('/accounts/42/characters/0', { patch: { meseta: 1_000_000 }, confirm: '00000042' })).status, 400, 'meseta over the cap is refused');
  eq((await c.post('/accounts/42/characters/0', { patch: { evil: 1 }, confirm: '00000042' })).status, 400, 'unknown field is refused');
  eq((await c.post('/accounts/42/characters/0', { patch: { inventory: { add: [{ data1: 'zz' }] } }, confirm: '00000042' })).status, 400, 'bad item hex is refused');
  eq((await c.post('/accounts/42/characters/0', { patch: { techniques: { Nope: 3 } }, confirm: '00000042' })).status, 400, 'unknown technique is refused');
  eq(readFileSync(file).equals(makeCharFile()), true, 'refused edits leave the file unchanged');
  eq(readdirSync(players).includes('_admin-backups'), false, 'and make no backup');

  const done = await c.post('/accounts/42/characters/0', { patch, confirm: '00000042' });
  eq(done.status, 200, 'the edit is applied');
  const after = parseCharacter(readFileSync(file));
  eq([after.level, after.exp, after.meseta, after.stats.hp, after.stats.atp, after.stats.mst, after.sectionId, after.charClass], [30, 99999, 500000, 900, 250, 50, 5, 3], 'level, exp, meseta, stats, section and class are written');
  eq([after.techniques.Foie, after.techniques.Barta, after.techniques.Gifoie], [20, 7, null], 'technique levels above 15 use the extension byte');
  eq([after.inventory.length, after.inventory[0].data1, after.inventory[1].data1], [2, '030000000000000000000000', '000200000000000000000000'], 'inventory: remove then add');
  const raw = readFileSync(file);
  eq(raw[8 + 4 + 5 * 0x1c + 2], 3,'the slot extension bytes stay with the slot index');
  eq(raw.length, CHAR_FILE_SIZE, 'the file keeps its size');
  const backups = readdirSync(join(players, '_admin-backups'));
  eq(backups.length, 1, 'one backup was made');
  eq(readFileSync(join(players, '_admin-backups', backups[0])).equals(makeCharFile()), true, 'and it is the original file');
  check(!existsSync(file + '.admin-tmp'), 'no temp file is left');

  // Pure functions: limits
  let err = '';
  try {
    applyCharacterPatch(makeCharFile(), { inventory: { add: Array.from({ length: 29 }, () => ({ data1: '030000000000000000000000' })) } });
  } catch (e) {
    err = (e as Error).message;
  }
  check(err.includes('full'), 'a 31st inventory item is refused');

  // Bank
  const bank0 = await c.get('/accounts/42/bank/0');
  eq([bank0.json.bank.source, bank0.json.bank.items.length], ['psochar', 0], 'bank read from the character file');
  const add = await c.post('/accounts/42/bank/0', { patch: { meseta: 777, add: [{ data1: '030000000000000000000000', amount: 5 }] }, confirm: '00000042' });
  eq(add.status, 200, 'bank edit');
  const bankFile = readFileSync(join(players, 'player_hero_0.psobank'));
  eq([bankFile.readUInt32LE(0), bankFile.readUInt32LE(4), bankFile.length, bankFile.readUInt16LE(8 + 20)], [1, 777, 8 + 0x18, 5], 'a .psobank is written in newserv format');
  const again = await c.get('/accounts/42/bank/0');
  eq([again.json.bank.source, again.json.bank.items[0].amount], ['psobank', 5], 'and wins over the character file');
  eq((await c.post('/accounts/42/bank/shared', { patch: { meseta: 5 }, confirm: '00000042' })).status, 200, 'shared bank');
  check(existsSync(join(players, 'shared_bank_hero.psobank')), 'shared bank file path');
  const rm = applyBankPatch({ meseta: 1, items: [{ data1: '03', id: 1, data2: '00000000', amount: 1, present: 1 }] }, { remove: [0] });
  eq(rm.bank.items.length, 0, 'bank item removal');

  // File-name safety
  fake.accounts.push({ AccountID: 0x43, Flags: 0, UserFlags: 0, BanEndTime: 0, LastPlayerName: '', BBTeamID: 0, BBLicenses: [{ UserName: '../../evil', Password: 'pw' }], DCLicenses: [], PCLicenses: [], GCLicenses: [], XBLicenses: [], DCNTELicenses: [] });
  eq((await c.get('/accounts/43/characters')).status, 400, 'a username that is not file-safe never becomes a path');
  eq((await c.get('/accounts/43/characters/0')).status, 400, 'also for one character');
  eq((await c.post('/accounts/43/bank/shared', { patch: { meseta: 1 }, confirm: '00000043' })).status, 400, 'and for a bank write');
}

// ---- config ----------------------------------------------------------------------------------------------------------------------

{
  fake.shell.length = 0;
  const cfg = await c.get('/config');
  eq(cfg.status, 200, 'config view');
  eq(cfg.json.editable.find((e: any) => e.key === 'CheatModeBehavior').current, 'OnByDefault', 'current values come from config.json');
  eq(cfg.json.editable.find((e: any) => e.key === 'WelcomeMessage').current, 'Hello, world', 'a string with a comma is read');
  eq((await c.post('/config', { key: 'BBGlobalEXPMultiplier', value: 3, confirm: 'BBGlobalEXPMultiplier' })).status, 200, 'number edit');
  eq((await c.post('/config', { key: 'AllowUnregisteredUsers', value: false, confirm: 'AllowUnregisteredUsers' })).status, 200, 'bool edit');
  eq((await c.post('/config', { key: 'CheatModeBehavior', value: 'Off', confirm: 'CheatModeBehavior' })).status, 200, 'enum edit');
  eq((await c.post('/config', { key: 'ServerName', value: 'My Server', confirm: 'ServerName' })).status, 200, 'string edit');
  eq((await c.post('/config', { key: 'WelcomeMessage', value: 'Hi, all', confirm: 'WelcomeMessage' })).status, 200, 'string with a comma');
  const text = readFileSync(configFile, 'utf8');
  check(text.includes('"BBGlobalEXPMultiplier": 3,') && text.includes('"AllowUnregisteredUsers": false,') && text.includes('"CheatModeBehavior": "Off",') && text.includes('"ServerName": "My Server", // name') && text.includes('"WelcomeMessage": "Hi, all",'), 'values replaced in place, comments kept');
  check(text.includes('// test config') && text.includes('"HTTPListen": ["127.0.0.1:5080"],'), 'other lines are untouched');
  eq(fake.shell.filter((s) => s === 'reload config').length, 5, 'each edit reloads the config');
  eq(readFileSync(mirror, 'utf8'), text, 'the mirror copy is updated');
  eq((await c.post('/config', { key: 'BBGlobalEXPMultiplier', value: 1000, confirm: 'BBGlobalEXPMultiplier' })).status, 400, 'number out of range');
  eq((await c.post('/config', { key: 'AllowUnregisteredUsers', value: 'yes', confirm: 'AllowUnregisteredUsers' })).status, 400, 'bool type check');
  eq((await c.post('/config', { key: 'CheatModeBehavior', value: 'Maybe', confirm: 'CheatModeBehavior' })).status, 400, 'enum check');
  eq((await c.post('/config', { key: 'ServerName', value: 'a"b', confirm: 'ServerName' })).status, 400, 'string with a quote');
  fake.failNext.add('reload config');
  const rf = await c.post('/config', { key: 'BBGlobalEXPMultiplier', value: 7, confirm: 'BBGlobalEXPMultiplier' });
  check(rf.status >= 400, 'a failing reload is reported');
  check(readFileSync(configFile, 'utf8').includes('"BBGlobalEXPMultiplier": 3,'), 'and the file is restored');
}

// ---- audit log ----------------------------------------------------------------------------------------------------------------------------

{
  const a = await c.get('/audit?limit=500');
  eq(a.status, 200, 'audit read');
  const actions = new Set(a.json.entries.map((e: any) => e.action));
  for (const act of ['login', 'logout', 'account.create', 'account.delete', 'account.ban', 'account.unban', 'account.flags', 'account.password', 'online.kick', 'online.announce', 'reload', 'character.edit', 'bank.edit', 'config.edit']) check(actions.has(act), `audit has ${act}`);
  const file = readFileSync(auditFile, 'utf8');
  check(!file.includes('S3cret!pw') && !file.includes('N3wpass') && !file.includes('BadNew') && !file.includes('secretpw1') && !file.includes(PASSWORD), 'no password reaches the audit log');
  check(a.json.entries.every((e: any) => e.ts && e.who && e.action && e.result), 'every entry has time, who, action and result');
  check(a.json.entries.some((e: any) => e.action === 'login' && e.result === 'denied'), 'failed logins are recorded');
  check(a.json.entries.some((e: any) => e.action === 'account.password' && e.result === 'error'), 'failed actions are recorded as errors');
  check(file.split('\n').filter(Boolean).every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'the log is JSON lines');
  eq((await new Client(m.base, m.port).get('/audit')).status, 401, 'the audit log needs a session');
}

m.server.close();
admin.close();
fakeServer.close();
rmSync(tmp, { recursive: true, force: true });
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
process.exit(0);

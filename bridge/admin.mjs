// Admin panel backend, mounted by bridge/server.mjs under /admin (docs/ADMIN.md).
//
// It is a thin, authenticated layer over newserv's own admin surface:
//   - newserv's HTTP API (GET /y/...) for everything it reports, and
//   - POST /y/shell-exec for every change newserv has a command for
//     (add-account, update-account, add-license, kick, announce, reload ...).
// Only character and bank files, which newserv has no command for, are edited
// directly, offline and with a backup (admin-chars.mjs); config.json keys are
// edited from a short allow-list followed by `reload config`. Quest files
// (.bin/.dat/.qst) are listed, read and published under system/quests only
// (admin-quests.mjs: validated names, parsed before writing, backed up).
//
// Security (the panel is meant for a public host): disabled unless
// ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is set; constant-time login with
// per-IP and global lockout; random HttpOnly + SameSite=Strict (+Secure) session
// cookie with idle and absolute expiry; CSRF token header + Origin check on
// every state-changing request; no CORS; strict input validation (nothing
// reaches newserv's shell unless it matches an allow-list); every action is
// written to an audit log; passwords are never logged, returned or displayed;
// newserv's HTTP port must be loopback (this module refuses anything else).

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { appendFileSync, closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import {
  CHAR_CLASSES, SECTION_IDS, TECHNIQUES, CharError, USER_RE, applyBankPatch, applyCharacterPatch, charPath, listCharacterSlots,
  loadBank, loadCharBuffer, parseCharacter, summarizeCharacter, writeBank, writeCharacter,
} from './admin-chars.mjs';
import { MAX_BODY_BYTES, QuestError, checkCategoryName, checkPublishName, createQuestStore } from './admin-quests.mjs';

const here = import.meta.dirname;

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---- passwords ------------------------------------------------------------------

const scryptAsync = (pw, salt, len, opts) => new Promise((res, rej) => scrypt(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));

// "scrypt$N$r$p$saltBase64$hashBase64"
export async function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyHash(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const want = Buffer.from(parts[5], 'base64');
  const key = await scryptAsync(password, salt, want.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return key.length === want.length && timingSafeEqual(key, want);
}

// Constant-time comparison of two strings of any length.
export function safeEqual(a, b) {
  const key = randomBytes(32);
  const ha = createHmac('sha256', key).update(String(a)).digest();
  const hb = createHmac('sha256', key).update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// ---- input validation -------------------------------------------------------------

const ACCOUNT_FLAGS = {
  KICK_USER: 0x1, BAN_USER: 0x2, SILENCE_USER: 0x4, CHANGE_EVENT: 0x10, ANNOUNCE: 0x20, FREE_JOIN_GAMES: 0x40,
  DEBUG: 0x01000000, CHEAT_ANYWHERE: 0x02000000, DISABLE_QUEST_REQUIREMENTS: 0x04000000, ALWAYS_ENABLE_CHAT_COMMANDS: 0x08000000,
};
const FLAG_PRESETS = { MODERATOR: 0x7, ADMINISTRATOR: 0xff, ROOT: 0x7fffffff };
const IS_SHARED = 0x80000000;
const BB_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,15}$/;
// No spaces (newserv splits the line on spaces) and none of the characters a
// shell would act on.
const BB_PASS_RE = /^[A-Za-z0-9!@#%^*()_+=.,:?~/[\]{}-]{1,16}$/;
const DURATION_RE = /^([1-9][0-9]{0,3})(s|m|h|d|w|mo|y)$/;
const MSG_BAD = /["'`;|&<>\\]/;
// Everything sent to newserv's shell must be printable ASCII on one line.
const LINE_RE = /^[\x20-\x7e]{1,400}$/;
const RELOAD_ITEMS = new Set(['accounts', 'battle-params', 'config', 'drop-tables', 'ep3-cards', 'ep3-maps', 'item-definitions', 'item-name-index', 'level-tables', 'quests', 'set-tables', 'teams', 'text-index', 'word-select']);

// config.json keys the panel may change (single-line, top-level values).
const CONFIG_KEYS = {
  ServerName: { type: 'string', re: /^[A-Za-z0-9 _.-]{1,16}$/, note: 'maximum 16 characters' },
  WelcomeMessage: { type: 'string', re: /^[\x20-\x7e]{0,200}$/, note: 'shown to GameCube players only' },
  AllowUnregisteredUsers: { type: 'bool', note: 'true lets anyone create an account by logging in' },
  AllowSameAccountConcurrentLogins: { type: 'bool' },
  EnableChatCommands: { type: 'bool' },
  CheatModeBehavior: { type: 'enum', values: ['Off', 'OffByDefault', 'OnByDefault', 'On'] },
  EnableSwitchAssistByDefault: { type: 'bool' },
  UseGameCreatorSectionID: { type: 'bool' },
  NotifyServerForMaxLevelAchieved: { type: 'bool' },
  BBGlobalEXPMultiplier: { type: 'number', min: 0, max: 100 },
  BBEXPShareMultiplier: { type: 'number', min: 0, max: 10 },
  ServerGlobalDropRateMultiplier: { type: 'number', min: 0, max: 100 },
};

const DATA_ROUTES = [
  [/^common-tables$/, () => '/y/data/common-tables'],
  [/^common-table\/([A-Za-z0-9_.-]{1,64})$/, (m) => `/y/data/common-table/${m[1]}`],
  [/^rare-tables$/, () => '/y/data/rare-tables'],
  [/^rare-table\/([A-Za-z0-9_.-]{1,64})$/, (m) => `/y/data/rare-table/${m[1]}`],
  [/^level-table\/([A-Za-z0-9_]{1,16})$/, (m) => `/y/data/level-table/${m[1]}`],
  [/^mag-table\/([A-Za-z0-9_]{1,16})$/, (m) => `/y/data/mag-table/${m[1]}`],
  [/^item-stack-limits\/([A-Za-z0-9_]{1,16})$/, (m) => `/y/data/item-stack-limits/${m[1]}`],
  [/^shop-table\/(armor|tool)$/, (m) => `/y/data/shop-table/${m[1]}`],
  [/^shop-table\/weapon\/([0-3])$/, (m) => `/y/data/shop-table/weapon/${m[1]}`],
  [/^tekker-table$/, () => '/y/data/tekker-table'],
];

function isAcctId(s) {
  return typeof s === 'string' && /^[0-9A-Fa-f]{1,8}$/.test(s);
}
const id8 = (n) => Number(n).toString(16).toUpperCase().padStart(8, '0');

function need(cond, msg, status = 400) {
  if (!cond) throw new HttpError(status, msg);
}

function plainObject(v, what) {
  need(v !== null && typeof v === 'object' && !Array.isArray(v), `${what} must be a JSON object`);
  return v;
}

function strField(body, key, re, what) {
  const v = body[key];
  need(typeof v === 'string' && re.test(v), `invalid ${what ?? key}`);
  return v;
}

// A line for newserv's shell: tokens joined by single spaces, each already validated.
function shellLine(...tokens) {
  const line = tokens.join(' ');
  need(LINE_RE.test(line) && !MSG_BAD.test(line), 'command rejected by the input filter');
  return line;
}

function parseFlagsInput(list) {
  need(Array.isArray(list) && list.length <= 20, 'flags must be a list of names');
  let mask = 0;
  for (const name of list) {
    need(typeof name === 'string', 'flag names must be strings');
    if (name in ACCOUNT_FLAGS) mask |= ACCOUNT_FLAGS[name];
    else if (name in FLAG_PRESETS) mask |= FLAG_PRESETS[name];
    else throw new HttpError(400, `unknown flag: ${name.slice(0, 40)}`);
  }
  return mask >>> 0;
}

export function flagNames(flags) {
  const names = [];
  for (const [n, v] of Object.entries(ACCOUNT_FLAGS)) if ((flags & v) === v) names.push(n);
  if ((flags & IS_SHARED) !== 0) names.push('IS_SHARED_ACCOUNT');
  return names;
}

// Drops any credential from data coming back from newserv.
export function stripSecrets(v) {
  if (Array.isArray(v)) return v.map(stripSecrets);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'Password' && k !== 'AccessKey') o[k] = stripSecrets(x);
    return o;
  }
  return v;
}

// ---- factory ---------------------------------------------------------------------------

export function createAdmin(options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? ((m) => console.log(`[admin] ${m}`));
  const systemDir = resolve(options.systemDir ?? env.NEWSERV_SYSTEM ?? resolve(here, '../vendor/newserv/system'));
  const playersDir = resolve(options.playersDir ?? resolve(systemDir, 'players'));
  const configFile = resolve(options.configFile ?? resolve(systemDir, 'config.json'));
  const configMirror = options.configMirror ?? env.ADMIN_CONFIG_MIRROR ?? null;
  const auditFile = resolve(options.auditFile ?? env.ADMIN_AUDIT_LOG ?? resolve(systemDir, '../admin-audit.log'));
  const questStore = createQuestStore({
    questsDir: options.questsDir ?? resolve(systemDir, 'quests'),
    backupDir: options.questBackupDir ?? env.ADMIN_QUEST_BACKUP ?? resolve(systemDir, '../quest-backups'),
    mirrorDir: options.questsMirror ?? env.ADMIN_QUESTS_MIRROR ?? null,
    formatsDir: options.formatsDir ?? env.ADMIN_FORMATS_DIR ?? resolve(here, '../client/src/formats'),
    log,
    now: options.now,
  });
  const uiDir = resolve(options.uiDir ?? resolve(here, 'admin-ui'));
  const adminUser = env.ADMIN_USER || 'admin';
  const password = env.ADMIN_PASSWORD || '';
  const passwordHash = env.ADMIN_PASSWORD_HASH || '';
  const trustProxy = (options.trustProxy ?? env.ADMIN_TRUST_PROXY) === true || (options.trustProxy ?? env.ADMIN_TRUST_PROXY) === '1';
  const requireHttps = (options.requireHttps ?? env.ADMIN_REQUIRE_HTTPS) !== '0' && options.requireHttps !== false;
  const forceSecureCookie = env.ADMIN_COOKIE_SECURE === '1';
  const allowedOrigins = (env.ADMIN_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowedHosts = (env.ADMIN_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const now = options.now ?? (() => Date.now());
  const limits = {
    maxFailures: options.maxFailures ?? 5,
    windowMs: options.windowMs ?? 15 * 60_000,
    lockMs: options.lockMs ?? 15 * 60_000,
    globalMaxFailures: options.globalMaxFailures ?? 50,
    globalLockMs: options.globalLockMs ?? 5 * 60_000,
    idleMs: options.idleMs ?? 30 * 60_000,
    absoluteMs: options.absoluteMs ?? 8 * 3_600_000,
    maxSessions: 20,
  };

  const enabled = Boolean(password || passwordHash);
  const [nsHost, nsPortText] = String(options.newservHttp ?? env.NEWSERV_HTTP ?? '127.0.0.1:5080').split(':');
  const nsPort = Number(nsPortText);

  if (enabled) {
    // newserv's HTTP API has no authentication and a shell: loopback only.
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(nsHost) && !/^127\.\d+\.\d+\.\d+$/.test(nsHost)) {
      throw new Error(`admin: NEWSERV_HTTP must be a loopback address (got ${nsHost}); newserv's HTTP port must never be exposed`);
    }
    if (!Number.isInteger(nsPort) || nsPort < 1 || nsPort > 65535) throw new Error('admin: NEWSERV_HTTP needs a port');
    const relay = (env.ALLOWED_PORTS ?? '').split(',').map((p) => Number(p.trim()));
    if (relay.includes(nsPort)) throw new Error('admin: newserv HTTP port is in ALLOWED_PORTS (the public relay)');
    if (passwordHash && !/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(passwordHash)) throw new Error('admin: ADMIN_PASSWORD_HASH is not in scrypt$N$r$p$salt$hash form (node bridge/admin-hash.mjs)');
    if (!passwordHash && password.length < 12) log('warning: ADMIN_PASSWORD is shorter than 12 characters; use a long random one or ADMIN_PASSWORD_HASH');
  }

  // ---- state ----
  const sessions = new Map(); // id -> { id, csrf, created, last, ip }
  const ipFailures = new Map(); // ip -> { count, first, lockedUntil }
  const globalFail = { count: 0, first: 0, lockedUntil: 0 };

  // ---- audit log ----
  function audit(actor, action, detail, result = 'ok') {
    const entry = {
      ts: new Date(now()).toISOString(),
      who: actor ? `${actor.sid ?? '-'}@${actor.ip ?? '-'}` : '-',
      action,
      detail: typeof detail === 'string' ? detail.slice(0, 500) : detail,
      result: String(result).slice(0, 300),
    };
    try {
      mkdirSync(dirname(auditFile), { recursive: true });
      if (existsSync(auditFile) && statSync(auditFile).size > 5_000_000) renameSync(auditFile, auditFile + '.1');
      appendFileSync(auditFile, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch (e) {
      log(`audit write failed: ${e.message}`);
    }
    return entry;
  }

  function readAudit(limit) {
    if (!existsSync(auditFile)) return [];
    const fd = openSync(auditFile, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, 1_000_000);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      const out = [];
      for (const line of lines.slice(-limit)) {
        try {
          out.push(JSON.parse(line));
        } catch { /* partial first line */ }
      }
      return out.reverse();
    } finally {
      closeSync(fd);
    }
  }

  // ---- newserv client (loopback only) ----
  function nsRequest(method, path, body) {
    return new Promise((res, rej) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({
        host: nsHost === 'localhost' ? '127.0.0.1' : nsHost, port: nsPort, method, path, timeout: 10_000,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      }, (r) => {
        const chunks = [];
        let size = 0;
        r.on('data', (c) => {
          size += c.length;
          if (size > 16_000_000) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(c);
        });
        r.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch { /* not JSON */ }
          res({ status: r.statusCode ?? 0, json });
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', rej);
      if (data) req.write(data);
      req.end();
    });
  }

  async function nsGet(path) {
    let r;
    try {
      r = await nsRequest('GET', path);
    } catch {
      throw new HttpError(502, 'newserv is not reachable (is HTTPListen set in its config.json?)');
    }
    if (r.status === 404) throw new HttpError(404, r.json?.Message ?? 'not found');
    if (r.status !== 200 || r.json === null) throw new HttpError(502, `newserv answered ${r.status}`);
    return stripSecrets(r.json);
  }

  // Raw GET that keeps credentials, for the one place that needs the old
  // password (restoring a license after a failed change). Never returned.
  async function nsGetRaw(path) {
    const r = await nsRequest('GET', path).catch(() => {
      throw new HttpError(502, 'newserv is not reachable');
    });
    if (r.status !== 200 || r.json === null) throw new HttpError(502, `newserv answered ${r.status}`);
    return r.json;
  }

  async function nsShell(command) {
    need(LINE_RE.test(command), 'command rejected by the input filter');
    let r;
    try {
      r = await nsRequest('POST', '/y/shell-exec', { command });
    } catch {
      throw new HttpError(502, 'newserv is not reachable');
    }
    if (r.status === 400) throw new HttpError(422, `newserv: ${String(r.json?.Message ?? 'command failed').slice(0, 200)}`);
    if (r.status !== 200 || r.json === null) throw new HttpError(502, `newserv answered ${r.status}`);
    return String(r.json.result ?? '');
  }

  // ---- request plumbing ----
  function clientIp(req) {
    if (trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  const isLoopbackHost = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/.test(h ?? '');

  function isSecure(req) {
    return Boolean(req.socket.encrypted) || (trustProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',').pop()?.trim() === 'https');
  }

  const SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };

  // A route may answer with raw bytes (quest files) instead of JSON.
  class Raw {
    constructor(bytes, type = 'application/octet-stream', name = 'file') {
      this.bytes = bytes;
      this.type = type;
      this.name = name;
    }
  }

  function reply(res, status, payload, headers = {}) {
    if (payload instanceof Raw) {
      res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': payload.type, 'Content-Length': payload.bytes.length, 'Content-Disposition': `attachment; filename="${payload.name}"`, ...headers });
      return res.end(payload.bytes);
    }
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ...headers });
    res.end(body);
  }

  function readBody(req, maxBytes = 65536) {
    return new Promise((res, rej) => {
      const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return rej(new HttpError(415, 'Content-Type must be application/json'));
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > maxBytes) return rej(new HttpError(413, 'body too large'));
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          rej(new HttpError(413, 'body too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          res(text ? JSON.parse(text) : {});
        } catch {
          rej(new HttpError(400, 'invalid JSON'));
        }
      });
      req.on('error', () => rej(new HttpError(400, 'request aborted')));
    });
  }

  function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  function purgeSessions() {
    const t = now();
    for (const [id, s] of sessions) if (t - s.last > limits.idleMs || t - s.created > limits.absoluteMs) sessions.delete(id);
  }
  const purgeTimer = setInterval(purgeSessions, 60_000);
  purgeTimer.unref?.();

  function getSession(req) {
    const id = parseCookies(req).psobb_admin;
    if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
    const s = sessions.get(id);
    if (!s) return null;
    const t = now();
    if (t - s.last > limits.idleMs || t - s.created > limits.absoluteMs) {
      sessions.delete(id);
      return null;
    }
    s.last = t;
    return s;
  }

  function cookieHeader(req, value, maxAgeSec) {
    const parts = [`psobb_admin=${value}`, 'Path=/admin', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (isSecure(req) || forceSecureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  function checkOrigin(req) {
    const origin = req.headers.origin;
    need(typeof origin === 'string' && origin !== 'null', 'Origin header required', 403);
    const site = req.headers['sec-fetch-site'];
    need(site === undefined || site === 'same-origin', 'cross-site request refused', 403);
    if (allowedOrigins.length) need(allowedOrigins.includes(origin), 'origin not allowed', 403);
    else {
      let host;
      try {
        host = new URL(origin).host.toLowerCase();
      } catch {
        throw new HttpError(403, 'bad Origin');
      }
      need(host === String(req.headers.host ?? '').toLowerCase(), 'origin does not match host', 403);
    }
  }

  // ---- login throttling ----
  function lockState(ip) {
    const t = now();
    if (globalFail.lockedUntil > t) return globalFail.lockedUntil - t;
    const e = ipFailures.get(ip);
    if (e && e.lockedUntil > t) return e.lockedUntil - t;
    return 0;
  }
  function noteFailure(ip) {
    const t = now();
    let e = ipFailures.get(ip);
    if (!e || t - e.first > limits.windowMs) e = { count: 0, first: t, lockedUntil: 0 };
    e.count++;
    if (e.count >= limits.maxFailures) e.lockedUntil = t + limits.lockMs;
    ipFailures.set(ip, e);
    if (t - globalFail.first > limits.windowMs) {
      globalFail.count = 0;
      globalFail.first = t;
    }
    globalFail.count++;
    if (globalFail.count >= limits.globalMaxFailures) {
      globalFail.lockedUntil = t + limits.globalLockMs;
      globalFail.count = 0;
    }
    if (ipFailures.size > 5000) for (const [k, v] of ipFailures) if (v.lockedUntil < t && t - v.first > limits.windowMs) ipFailures.delete(k);
  }

  async function checkCredentials(user, pass) {
    const userOk = safeEqual(user, adminUser);
    let passOk;
    if (passwordHash) passOk = await verifyHash(pass, passwordHash).catch(() => false);
    else passOk = safeEqual(pass, password);
    return userOk && passOk;
  }

  // ---- data helpers ----
  function publicAccount(a, onlineIds) {
    const bb = (a.BBLicenses ?? []).map((l) => l.UserName);
    const banEnd = Number(a.BanEndTime ?? 0);
    const banned = banEnd > now() * 1000;
    return {
      id: id8(a.AccountID),
      flags: a.Flags,
      flagNames: flagNames(a.Flags),
      userFlags: a.UserFlags,
      banned,
      banEnd: banned ? new Date(banEnd / 1000).toISOString() : null,
      lastPlayerName: a.LastPlayerName ?? '',
      bbUsernames: bb,
      licenseCounts: { dcnte: a.DCNTELicenses?.length ?? 0, dc: a.DCLicenses?.length ?? 0, pc: a.PCLicenses?.length ?? 0, gc: a.GCLicenses?.length ?? 0, xb: a.XBLicenses?.length ?? 0, bb: bb.length },
      teamId: a.BBTeamID ?? 0,
      online: onlineIds ? onlineIds.has(a.AccountID) : null,
    };
  }

  async function onlineAccountIds() {
    const clients = await nsGet('/y/clients');
    return new Set(clients.map((c) => c.Account?.AccountID).filter((x) => x !== undefined && x !== null));
  }

  async function findAccount(idText) {
    need(isAcctId(idText), 'invalid account id');
    const want = parseInt(idText, 16);
    const list = await nsGet('/y/accounts');
    const a = list.find((x) => x.AccountID === want);
    need(a, 'account not found', 404);
    return a;
  }

  // A raw copy (with passwords) of one account, for the password change only.
  async function findAccountRaw(idText) {
    const want = parseInt(idText, 16);
    const list = await nsGetRaw('/y/accounts');
    return list.find((x) => x.AccountID === want);
  }

  function pickBbUser(acct, requested) {
    const users = (acct.BBLicenses ?? []).map((l) => l.UserName);
    need(users.length > 0, 'the account has no BB license');
    if (requested !== undefined && requested !== null) {
      need(typeof requested === 'string' && users.includes(requested), 'username is not a BB license of this account');
      return requested;
    }
    need(users.length === 1, 'the account has several BB licenses; pass username');
    return users[0];
  }

  function requireConfirm(body, expected) {
    if (body.confirm !== expected) throw new HttpError(409, `confirmation required: send confirm="${expected}"`, { confirmRequired: expected });
  }

  async function requireOffline(acct) {
    const ids = await onlineAccountIds();
    need(!ids.has(acct.AccountID), 'the account is online: kick the player first (characters are edited offline only)', 409);
  }

  // ---- config.json editing ----
  function readConfigText() {
    return readFileSync(configFile, 'utf8');
  }
  function configLineRe(key) {
    return new RegExp(`^(  "${key}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,/\\n]*?)(\\s*,?)(\\s*//.*)?$`, 'm');
  }
  function formatConfigValue(key, value) {
    const spec = CONFIG_KEYS[key];
    switch (spec.type) {
      case 'bool':
        need(typeof value === 'boolean', `${key} must be true or false`);
        return String(value);
      case 'number':
        need(typeof value === 'number' && Number.isFinite(value) && value >= spec.min && value <= spec.max, `${key} must be a number from ${spec.min} to ${spec.max}`);
        return String(value);
      case 'enum':
        need(spec.values.includes(value), `${key} must be one of ${spec.values.join(', ')}`);
        return JSON.stringify(value);
      default:
        need(typeof value === 'string' && spec.re.test(value), `invalid value for ${key}`);
        need(!/["\\]/.test(value), `invalid value for ${key}`);
        return JSON.stringify(value);
    }
  }
  function readConfigValue(text, key) {
    const m = configLineRe(key).exec(text);
    if (!m) return undefined;
    try {
      return JSON.parse(m[2].trim());
    } catch {
      return undefined;
    }
  }

  // ---- routes ----------------------------------------------------------------------------
  // [method, pattern, options, handler]. options.public: no session; options.read: GET only.
  const routes = [];
  const route = (method, pattern, opts, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), opts, handler });

  route('GET', '/session', { public: true }, async ({ session }) => ({ authenticated: Boolean(session), csrf: session?.csrf ?? null, user: session ? adminUser : null }));

  route('POST', '/login', { public: true }, async ({ req, res, body, ip }) => {
    need(requireHttps === false || isSecure(req) || isLoopbackHost(req.headers.host), 'HTTPS is required for the admin login (set ADMIN_TRUST_PROXY=1 behind a TLS proxy)', 403);
    const wait = lockState(ip);
    if (wait > 0) {
      audit({ ip }, 'login', 'refused: locked out', 'locked');
      throw new HttpError(429, 'too many failed logins; try again later', { retryAfter: Math.ceil(wait / 1000) });
    }
    plainObject(body, 'body');
    const user = typeof body.username === 'string' ? body.username.slice(0, 100) : '';
    const pass = typeof body.password === 'string' ? body.password.slice(0, 1000) : '';
    const ok = await checkCredentials(user, pass);
    if (!ok) {
      noteFailure(ip);
      audit({ ip }, 'login', 'wrong credentials', 'denied');
      const after = lockState(ip);
      throw new HttpError(after > 0 ? 429 : 401, after > 0 ? 'too many failed logins; try again later' : 'wrong username or password', after > 0 ? { retryAfter: Math.ceil(after / 1000) } : undefined);
    }
    ipFailures.delete(ip);
    purgeSessions();
    if (sessions.size >= limits.maxSessions) {
      const oldest = [...sessions.values()].sort((a, b) => a.last - b.last)[0];
      sessions.delete(oldest.id);
    }
    const s = { id: randomBytes(32).toString('hex'), csrf: randomBytes(24).toString('hex'), created: now(), last: now(), ip };
    sessions.set(s.id, s);
    audit({ ip, sid: s.id.slice(0, 8) }, 'login', 'ok');
    res.setHeader('Set-Cookie', cookieHeader(req, s.id, Math.floor(limits.absoluteMs / 1000)));
    return { authenticated: true, csrf: s.csrf, user: adminUser };
  });

  route('POST', '/logout', {}, async ({ req, res, session, actor }) => {
    sessions.delete(session.id);
    audit(actor, 'logout', 'ok');
    res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
    return { authenticated: false };
  });

  route('GET', '/dashboard', {}, async () => {
    const [summary, accounts] = await Promise.all([nsGet('/y/summary'), nsGet('/y/accounts')]);
    const t = now() * 1000;
    return {
      server: summary.Server,
      clients: summary.Clients,
      games: summary.Games,
      accounts: { total: accounts.length, banned: accounts.filter((a) => Number(a.BanEndTime) > t).length, withBbLicense: accounts.filter((a) => a.BBLicenses?.length).length },
      adminSessions: sessions.size,
    };
  });

  route('GET', '/accounts', {}, async () => {
    const [list, ids] = await Promise.all([nsGet('/y/accounts'), onlineAccountIds().catch(() => null)]);
    return { accounts: list.map((a) => publicAccount(a, ids)).sort((a, b) => a.id.localeCompare(b.id)), flagChoices: { single: Object.keys(ACCOUNT_FLAGS), presets: Object.keys(FLAG_PRESETS) } };
  });

  route('GET', '/accounts/([0-9A-Fa-f]{1,8})', {}, async ({ params }) => {
    const a = await findAccount(params[0]);
    return { account: publicAccount(a, await onlineAccountIds().catch(() => null)) };
  });

  route('POST', '/accounts', {}, async ({ body, actor }) => {
    plainObject(body, 'body');
    const username = strField(body, 'username', BB_USER_RE, 'username (1-16 letters, digits, _ . -)');
    const pass = strField(body, 'password', BB_PASS_RE, 'password (1-16 characters, no spaces or quotes)');
    const mask = body.flags === undefined ? 0 : parseFlagsInput(body.flags);
    const existing = await nsGet('/y/accounts');
    need(!existing.some((a) => (a.BBLicenses ?? []).some((l) => l.UserName.toLowerCase() === username.toLowerCase())), 'that BB username already exists', 409);
    const created = await nsShell(shellLine('add-account', `flags=${mask.toString(16).padStart(8, '0')}`));
    const m = /Account ([0-9A-F]{8}) added/.exec(created);
    need(m, 'newserv did not report the new account id', 502);
    try {
      await nsShell(shellLine('add-license', m[1], 'BB', username, pass));
    } catch (e) {
      await nsShell(shellLine('delete-account', m[1])).catch(() => {});
      audit(actor, 'account.create', `${username} -> license failed, rolled back`, 'error');
      throw e;
    }
    audit(actor, 'account.create', `id=${m[1]} user=${username} flags=${mask.toString(16)}`);
    return { id: m[1] };
  });

  route('POST', '/accounts/([0-9A-Fa-f]{1,8})/flags', {}, async ({ params, body, actor }) => {
    plainObject(body, 'body');
    const a = await findAccount(params[0]);
    const id = id8(a.AccountID);
    requireConfirm(body, id);
    const mask = parseFlagsInput(body.flags);
    const value = ((mask & 0x7fffffff) | (a.Flags & IS_SHARED)) >>> 0;
    await nsShell(shellLine('update-account', id, `flags=${value.toString(16).padStart(8, '0')}`));
    audit(actor, 'account.flags', `id=${id} ${a.Flags.toString(16)} -> ${value.toString(16)}`);
    return { ok: true, flags: value };
  });

  route('POST', '/accounts/([0-9A-Fa-f]{1,8})/password', {}, async ({ params, body, actor }) => {
    plainObject(body, 'body');
    const pass = strField(body, 'password', BB_PASS_RE, 'password (1-16 characters, no spaces or quotes)');
    const a = await findAccount(params[0]);
    const id = id8(a.AccountID);
    const user = pickBbUser(a, body.username);
    // newserv has no "change password" command: delete the BB license and add it
    // again. The old password is read server-side so a failure can restore it.
    const raw = await findAccountRaw(params[0]);
    const old = raw?.BBLicenses?.find((l) => l.UserName === user)?.Password;
    need(typeof old === 'string' && old.length > 0, 'could not read the current license', 502);
    await nsShell(shellLine('delete-license', id, 'BB', user));
    try {
      await nsShell(shellLine('add-license', id, 'BB', user, pass));
    } catch (e) {
      const restored = BB_PASS_RE.test(old) ? await nsShell(shellLine('add-license', id, 'BB', user, old)).then(() => true, () => false) : false;
      audit(actor, 'account.password', `id=${id} user=${user} FAILED (${restored ? 'old password restored' : 'COULD NOT RESTORE THE LICENSE'})`, 'error');
      throw e;
    }
    audit(actor, 'account.password', `id=${id} user=${user} password changed`);
    return { ok: true };
  });

  route('POST', '/accounts/([0-9A-Fa-f]{1,8})/ban', {}, async ({ params, body, actor }) => {
    plainObject(body, 'body');
    const a = await findAccount(params[0]);
    const id = id8(a.AccountID);
    requireConfirm(body, id);
    const duration = body.duration === 'permanent' ? '100y' : body.duration;
    need(typeof duration === 'string' && DURATION_RE.test(duration), 'duration must look like 30m, 12h, 3d, 2w, 1mo, 1y or permanent');
    await nsShell(shellLine('update-account', id, `ban-duration=${duration}`));
    audit(actor, 'account.ban', `id=${id} duration=${body.duration}`);
    return { ok: true };
  });

  route('POST', '/accounts/([0-9A-Fa-f]{1,8})/unban', {}, async ({ params, actor }) => {
    const a = await findAccount(params[0]);
    const id = id8(a.AccountID);
    await nsShell(shellLine('update-account', id, 'unban'));
    audit(actor, 'account.unban', `id=${id}`);
    return { ok: true };
  });

  route('POST', '/accounts/([0-9A-Fa-f]{1,8})/delete', {}, async ({ params, body, actor }) => {
    plainObject(body, 'body');
    const a = await findAccount(params[0]);
    const id = id8(a.AccountID);
    requireConfirm(body, id);
    await nsShell(shellLine('delete-account', id));
    audit(actor, 'account.delete', `id=${id} users=${(a.BBLicenses ?? []).map((l) => l.UserName).join(',')} (character files are kept)`);
    return { ok: true };
  });

  // ---- characters ----
  route('GET', '/accounts/([0-9A-Fa-f]{1,8})/characters', {}, async ({ params, query }) => {
    const a = await findAccount(params[0]);
    const user = pickBbUser(a, query.get('username') ?? undefined);
    const slots = listCharacterSlots(playersDir, user).map((slot) => {
      try {
        return { slot, ...summarizeCharacter(loadCharBuffer(charPath(playersDir, user, slot))) };
      } catch (e) {
        return { slot, error: e.message };
      }
    });
    return { username: user, characters: slots, techniques: TECHNIQUES, sectionIds: SECTION_IDS, classes: CHAR_CLASSES, online: (await onlineAccountIds().catch(() => new Set())).has(a.AccountID) };
  });

  route('GET', '/accounts/([0-9A-Fa-f]{1,8})/characters/([0-9]{1,2})', {}, async ({ params, query }) => {
    const a = await findAccount(params[0]);
    const user = pickBbUser(a, query.get('username') ?? undefined);
    const slot = Number(params[1]);
    const ch = parseCharacter(loadCharBuffer(charPath(playersDir, user, slot)));
    const bank = loadBank(playersDir, user, slot);
    const { bankInCharacterFile: _ignored, ...rest } = ch;
    return { username: user, slot, ...rest, bank, online: (await onlineAccountIds().catch(() => new Set())).has(a.AccountID) };
  });

  route('POST', '/accounts/([0-9A-Fa-f]{1,8})/characters/([0-9]{1,2})', {}, async ({ params, body, actor }) => {
    plainObject(body, 'body');
    const a = await findAccount(params[0]);
    const id = id8(a.AccountID);
    requireConfirm(body, id);
    const user = pickBbUser(a, body.username);
    await requireOffline(a);
    const file = charPath(playersDir, user, Number(params[1]));
    const orig = loadCharBuffer(file);
    const { buf, changes } = applyCharacterPatch(orig, body.patch);
    need(changes.length > 0, 'nothing to change');
    const backup = writeCharacter(playersDir, file, buf);
    audit(actor, 'character.edit', `id=${id} user=${user} slot=${params[1]}: ${changes.join('; ')} (backup ${backup ? 'yes' : 'no'})`);
    return { ok: true, changes };
  });

  route('GET', '/accounts/([0-9A-Fa-f]{1,8})/bank/(shared|[0-9]{1,2})', {}, async ({ params, query }) => {
    const a = await findAccount(params[0]);
    const user = pickBbUser(a, query.get('username') ?? undefined);
    return { username: user, target: params[1], bank: loadBank(playersDir, user, params[1] === 'shared' ? 'shared' : Number(params[1])) };
  });

  route('POST', '/accounts/([0-9A-Fa-f]{1,8})/bank/(shared|[0-9]{1,2})', {}, async ({ params, body, actor }) => {
    plainObject(body, 'body');
    const a = await findAccount(params[0]);
    const id = id8(a.AccountID);
    requireConfirm(body, id);
    const user = pickBbUser(a, body.username);
    await requireOffline(a);
    const target = params[1] === 'shared' ? 'shared' : Number(params[1]);
    const { bank, changes } = applyBankPatch(loadBank(playersDir, user, target), body.patch);
    need(changes.length > 0, 'nothing to change');
    const backup = writeBank(playersDir, user, target, bank);
    audit(actor, 'bank.edit', `id=${id} user=${user} bank=${params[1]}: ${changes.join('; ')} (backup ${backup ? 'yes' : 'no (new file)'})`);
    return { ok: true, changes };
  });

  // ---- online ----
  route('GET', '/online', {}, async () => {
    const [summary, clients] = await Promise.all([nsGet('/y/summary'), nsGet('/y/clients')]);
    const byId = new Map(clients.map((c) => [c.ID, c]));
    return {
      server: summary.Server,
      games: summary.Games,
      clients: summary.Clients.map((c) => {
        const d = byId.get(c.ID) ?? {};
        return { ...c, accountId: c.AccountID === null || c.AccountID === undefined ? null : id8(c.AccountID), address: d.RemoteAddress ?? null, floor: d.LocationFloor ?? null, bbUsernames: (d.Account?.BBLicenses ?? []).map((l) => l.UserName) };
      }),
    };
  });

  route('GET', '/online/([0-9]{1,10})', {}, async ({ params }) => {
    const c = await nsGet(`/y/client/${Number(params[0])}`);
    return { client: c };
  });

  route('POST', '/online/kick', {}, async ({ body, actor }) => {
    plainObject(body, 'body');
    let target;
    let label;
    if (body.accountId !== undefined) {
      need(isAcctId(body.accountId), 'invalid account id');
      target = `0x${parseInt(body.accountId, 16).toString(16)}`;
      label = `account ${id8(parseInt(body.accountId, 16))}`;
    } else {
      need(Number.isInteger(body.clientId) && body.clientId >= 0 && body.clientId < 1 << 30, 'invalid clientId');
      target = `C-${body.clientId.toString(16)}`;
      label = target;
    }
    requireConfirm(body, label);
    await nsShell(shellLine('kick', target));
    audit(actor, 'online.kick', label);
    return { ok: true };
  });

  route('POST', '/online/announce', {}, async ({ body, actor }) => {
    plainObject(body, 'body');
    const msg = body.message;
    need(typeof msg === 'string' && msg.trim().length > 0 && msg.length <= 200, 'message must be 1-200 characters');
    need(/^[\x20-\x7e]+$/.test(msg) && !MSG_BAD.test(msg), 'message may use printable ASCII only, without quotes, backslash, ; | & < >');
    await nsShell(`announce ${msg.trim()}`);
    audit(actor, 'online.announce', msg.trim());
    return { ok: true };
  });

  route('GET', '/lobbies', {}, async () => ({ lobbies: await nsGet('/y/lobbies') }));

  // ---- quests / teams / data / config ----
  route('GET', '/quests', {}, async () => {
    const q = await nsGet('/y/data/quests');
    const cats = Object.values(q.Categories).map((c) => ({ id: c.CategoryID, name: c.Name, directory: c.DirectoryName, description: c.Description, flags: c.Flags, listed: c.Flags !== 0 }));
    const byCat = new Map(cats.map((c) => [c.id, { ...c, quests: [] }]));
    for (const quest of q.Quests) {
      const m = quest.Metadata;
      const v = quest.Versions?.find((x) => x.Language === 'English') ?? quest.Versions?.[0];
      const entry = {
        number: m.QuestNumber, name: v?.Name ?? `Quest ${m.QuestNumber}`, episode: m.Episode, maxPlayers: m.MaxPlayers, joinable: m.Joinable,
        enabledExpression: m.EnabledExpression, availableExpression: m.AvailableExpression, dropMode: m.DefaultDropMode,
        versions: (quest.Versions ?? []).map((x) => `${x.Version}/${x.Language}`),
      };
      (byCat.get(m.CategoryID) ?? byCat.set(m.CategoryID, { id: m.CategoryID, name: `Category ${m.CategoryID}`, quests: [] }).get(m.CategoryID)).quests.push(entry);
    }
    return { directory: q.Directory, categories: [...byCat.values()].sort((a, b) => a.name.localeCompare(b.name)), total: q.Quests.length };
  });

  // ---- quest files (admin-quests.mjs) ----
  route('GET', '/quests/files', {}, async () => ({ directories: questStore.listFiles() }));

  route('GET', '/quests/file/([A-Za-z0-9_-]{1,48})/([A-Za-z0-9_.-]{1,64})', {}, async ({ params }) => {
    const bytes = questStore.readFile(params[0], params[1]);
    return new Raw(bytes, 'application/octet-stream', params[1]);
  });

  route('POST', '/quests/publish', { maxBody: MAX_BODY_BYTES }, async ({ body, actor }) => {
    plainObject(body, 'body');
    const category = checkCategoryName(body.category);
    const name = checkPublishName(body.name);
    const target = `${category}/${name}`;
    requireConfirm(body, target);
    let plan;
    try {
      plan = await questStore.plan(body);
    } catch (e) {
      if (e instanceof QuestError) audit(actor, 'quest.publish', `${target} rejected: ${e.message}`, 'denied');
      throw e;
    }
    let result;
    try {
      result = questStore.commit(plan);
    } catch (e) {
      audit(actor, 'quest.publish', `${target} write failed`, 'error');
      log(`quest write failed: ${e.message}`);
      throw new HttpError(500, 'could not write the quest files');
    }
    try {
      await nsShell('reload quests');
    } catch (e) {
      questStore.rollback(plan, result);
      audit(actor, 'quest.publish', `${target}: reload failed, files restored`, 'error');
      throw e;
    }
    const label = String(plan.info.name).replace(/[^\x20-\x7e]/g, '?').slice(0, 40);
    audit(actor, 'quest.publish', `${target} files=${result.files.map((f) => `${f.name}(${f.size}${f.replaced ? ',replaced' : ',new'})`).join(' ')} quest=${plan.info.questNumber} "${label}"`);
    return { ok: true, files: result.files, quest: plan.info };
  });

  route('POST', '/reload', {}, async ({ body, actor }) => {
    plainObject(body, 'body');
    need(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 14, 'items must be a list');
    const items = [...new Set(body.items)];
    for (const i of items) need(typeof i === 'string' && RELOAD_ITEMS.has(i), `cannot reload: ${String(i).slice(0, 30)}`);
    await nsShell(shellLine('reload', ...items));
    audit(actor, 'reload', items.join(' '));
    return { ok: true, items };
  });

  route('GET', '/teams', {}, async () => {
    const t = await nsGet('/y/teams');
    return { teams: Object.entries(t).map(([id, team]) => ({ id, ...team })) };
  });

  route('GET', '/data/(.+)', {}, async ({ params }) => {
    for (const [re, build] of DATA_ROUTES) {
      const m = re.exec(params[0]);
      if (m) return { data: await nsGet(build(m)) };
    }
    throw new HttpError(404, 'unknown data table');
  });

  route('GET', '/config', {}, async () => {
    const [effective, text] = await Promise.all([nsGet('/y/config'), Promise.resolve(existsSync(configFile) ? readConfigText() : '')]);
    const editable = Object.entries(CONFIG_KEYS).map(([key, spec]) => ({ key, type: spec.type, values: spec.values, min: spec.min, max: spec.max, note: spec.note, current: readConfigValue(text, key) ?? effective[key] ?? null }));
    // Listen addresses and other sensitive-looking keys are shown as is: the panel is admin-only.
    return { editable, config: effective, configFile: configFile.replace(systemDir, '<system>') };
  });

  route('POST', '/config', {}, async ({ body, actor }) => {
    plainObject(body, 'body');
    need(typeof body.key === 'string' && Object.hasOwn(CONFIG_KEYS, body.key), 'this key cannot be changed from the panel');
    requireConfirm(body, body.key);
    const text = formatConfigValue(body.key, body.value);
    need(existsSync(configFile), 'config.json not found', 500);
    const src = readConfigText();
    const re = configLineRe(body.key);
    const matches = src.match(new RegExp(re.source, 'gm')) ?? [];
    need(matches.length === 1, `config.json has ${matches.length} matching lines for ${body.key}; edit it by hand`, 409);
    const before = readConfigValue(src, body.key);
    const next = src.replace(re, (_m, a, _v, c, d) => `${a}${text}${c}${d ?? ''}`);
    copyFileSync(configFile, `${configFile}.admin-backup`);
    writeFileSync(configFile + '.admin-tmp', next);
    renameSync(configFile + '.admin-tmp', configFile);
    if (configMirror) {
      try {
        mkdirSync(dirname(configMirror), { recursive: true });
        copyFileSync(configFile, configMirror);
      } catch (e) {
        log(`config mirror failed: ${e.message}`);
      }
    }
    try {
      await nsShell('reload config');
    } catch (e) {
      copyFileSync(`${configFile}.admin-backup`, configFile);
      audit(actor, 'config.edit', `${body.key}: reload failed, restored`, 'error');
      throw e;
    }
    audit(actor, 'config.edit', `${body.key}: ${JSON.stringify(before)} -> ${text}`);
    return { ok: true };
  });

  route('GET', '/audit', {}, async ({ query }) => {
    const limit = Math.min(Math.max(Number(query.get('limit') ?? 200) || 200, 1), 1000);
    return { entries: readAudit(limit) };
  });

  // ---- static page ----
  const STATIC = { '': 'index.html', '/': 'index.html', '/static/admin.js': 'admin.js', '/static/admin.css': 'admin.css' };
  const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

  function serveStatic(res, rel) {
    const file = resolve(uiDir, rel);
    if (!existsSync(file)) return reply(res, 404, { error: 'not found' });
    const body = readFileSync(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': STATIC_TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length });
    res.end(body);
  }

  // ---- entry point ----
  function owns(urlText) {
    const p = String(urlText ?? '').split('?')[0];
    return p === '/admin' || p.startsWith('/admin/');
  }

  async function handle(req, res) {
    if (!enabled) {
      res.writeHead(404);
      return res.end();
    }
    const ip = clientIp(req);
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://admin');
    } catch {
      return reply(res, 400, { error: 'bad url' });
    }
    // No CORS headers anywhere on this module: browsers keep other origins out.
    try {
      if (allowedHosts.length && !allowedHosts.includes(String(req.headers.host ?? '').toLowerCase())) throw new HttpError(404, 'not found');
      if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, POST');
        throw new HttpError(405, 'method not allowed');
      }
      const sub = url.pathname.slice('/admin'.length);
      if (!sub.startsWith('/api/')) {
        if (req.method === 'POST') throw new HttpError(405, 'method not allowed');
        const rel = STATIC[sub];
        if (!rel) throw new HttpError(404, 'not found');
        return serveStatic(res, rel);
      }
      const apiPath = sub.slice('/api'.length);
      let matched = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(apiPath);
        if (!m) continue;
        pathMatched = true;
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        if (r.method === method) {
          matched = { r, params: m.slice(1) };
          break;
        }
      }
      if (!matched) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method not allowed' : 'not found');
      const { r, params } = matched;
      const session = getSession(req);
      const actor = { ip, sid: session?.id.slice(0, 8) };
      if (r.method === 'POST') {
        checkOrigin(req);
        if (!r.opts.public) {
          need(session, 'login required', 401);
          const token = String(req.headers['x-csrf-token'] ?? '');
          need(token.length > 0 && safeEqual(token, session.csrf), 'bad CSRF token', 403);
        }
      } else if (!r.opts.public) {
        need(session, 'login required', 401);
      }
      const body = r.method === 'POST' ? await readBody(req, r.opts.maxBody) : undefined;
      const result = await r.handler({ req, res, params, query: url.searchParams, body, session, actor, ip });
      return reply(res, 200, result);
    } catch (e) {
      if (e instanceof HttpError) {
        const extra = e.extra ?? {};
        const headers = extra.retryAfter ? { 'Retry-After': String(extra.retryAfter) } : {};
        return reply(res, e.status, { error: e.message, ...extra }, headers);
      }
      if (e instanceof CharError || e instanceof QuestError) return reply(res, e.status, { error: e.message });
      log(`internal error: ${e?.stack ?? e}`);
      return reply(res, 500, { error: 'internal error' });
    }
  }

  if (enabled) log(`enabled (newserv HTTP ${nsHost}:${nsPort}, audit log ${auditFile})`);
  else log('disabled: set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH to enable /admin');

  return { enabled, owns, handle, audit, readAudit, close: () => clearInterval(purgeTimer), _sessions: sessions };
}

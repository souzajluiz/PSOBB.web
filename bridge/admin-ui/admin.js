// PSOBB.web admin panel (docs/ADMIN.md). Plain DOM code, no framework and no
// external resources. Everything that comes from the server (player names,
// account data) is put in the page with textContent, never as HTML.

import { langSelect, tr } from './i18n.js';

const app = document.getElementById('app');
let csrf = null;
let user = null;
let currentTab = 'dashboard';
let timer = null;

// ---- helpers --------------------------------------------------------------------

// Text nodes and the placeholder / title / aria-label / alt attributes go through
// tr() (i18n.js); the content of a `mono` element (ids, keys, codes) never does.
const TR_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt']);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  const literal = /\bmono\b/.test(String(attrs?.class ?? ''));
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (TR_ATTRS.has(k) && typeof v === 'string') {
      el.setAttribute(k, tr(v));
      continue;
    }
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(literal ? String(kid) : tr(String(kid))));
  }
  return el;
}

function toast(message, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}

async function api(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.headers['X-CSRF-Token'] = csrf ?? '';
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/admin/api${path}`, init);
  let data = {};
  try {
    data = await res.json();
  } catch { /* empty body */ }
  if (res.status === 401 && path !== '/login') {
    csrf = null;
    showLogin();
    throw new Error('Session expired: log in again');
  }
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { data });
  return data;
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'bad');
    return undefined;
  }
}

// A confirmation step: the person must type the exact token shown.
function confirmDialog({ title, lines = [], token, danger = true, action = 'Confirm' }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'confirmation text' });
    const ok = h('button', { class: danger ? 'danger' : 'primary', disabled: true }, action);
    const close = (v) => {
      overlay.remove();
      resolve(v);
    };
    input.addEventListener('input', () => {
      ok.disabled = input.value !== token;
    });
    ok.addEventListener('click', () => close(true));
    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal' },
        h('h2', null, title),
        ...lines.map((l) => h('p', null, l)),
        h('p', { class: 'muted' }, 'Type ', h('b', { class: 'mono' }, token), ' to confirm.'),
        input,
        h('div', { class: 'actions' }, h('button', { onclick: () => close(false) }, 'Cancel'), ok)));
    document.body.append(overlay);
    input.focus();
  });
}

const fmtDuration = (s) => {
  s = Math.floor(Number(s) || 0);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}d ` : ''}${hh}h ${m}m`;
};

function table(headers, rows, empty = 'Nothing to show.') {
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  return h('table', null, h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))));
}

// ---- login ----------------------------------------------------------------------------

// A password input with an eye button that shows or hides the text.
// Original emblem (not Sega art): a cyan magic circle with a "PSO" mark, inlined as a data URI (CSP allows img-src data:).
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ff6ff"/><stop offset="1" stop-color="#1aa7c9"/></linearGradient></defs><circle cx="32" cy="32" r="29" fill="#06222c" stroke="url(#g)" stroke-width="3"/><circle cx="32" cy="32" r="22" fill="none" stroke="#35d0ee" stroke-width="1" stroke-dasharray="3 3"/><path d="M32 6v10M32 48v10M6 32h10M48 32h10" stroke="#ff9a1f" stroke-width="3" stroke-linecap="round"/><text x="32" y="38" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="18" fill="url(#g)">PSO</text></svg>';
const logoImg = () => h('img', { class: 'logo', src: 'data:image/svg+xml,' + encodeURIComponent(LOGO_SVG), alt: '', width: 28, height: 28 });

function eyeField(input) {
  const btn = h('button', { type: 'button', class: 'eye', title: 'Show password', 'aria-label': 'Show password' }, '\u{1F441}');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '\u{1F648}' : '\u{1F441}';
    btn.title = btn.ariaLabel = tr(show ? 'Hide password' : 'Show password');
  });
  return h('span', { class: 'eyefield' }, input, btn);
}

// A language change re-renders the current view without touching the session.
function rerender() {
  document.title = tr('PSOBB.web Admin');
  if (csrf) showApp();
  else showLogin();
}

function showLogin(message) {
  clearInterval(timer);
  const u = h('input', { type: 'text', autocomplete: 'username', placeholder: 'Username', value: 'admin' });
  const p = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const msg = h('p', { class: 'notice bad', hidden: !message }, message ?? '');
  const go = async () => {
    msg.hidden = true;
    try {
      const r = await api('POST', '/login', { username: u.value, password: p.value });
      csrf = r.csrf;
      user = r.user;
      p.value = '';
      showApp();
    } catch (e) {
      msg.textContent = tr(e.message);
      msg.hidden = false;
    }
  };
  p.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  app.replaceChildren(h('div', { class: 'card login' }, h('h1', null, logoImg(), 'PSOBB.web admin'), msg, u, eyeField(p), h('button', { class: 'primary', onclick: go }, 'Log in'), langSelect(rerender)));
  p.focus();
}

// ---- shell ----------------------------------------------------------------------------

const TABS = [
  ['dashboard', 'Dashboard'], ['accounts', 'Accounts'], ['characters', 'Characters'], ['online', 'Online'], ['quests', 'Quests'],
  ['teams', 'Teams'], ['data', 'Data'], ['config', 'Config'], ['audit', 'Audit log'],
];
const views = {};

function showApp() {
  const content = h('main');
  const nav = h('nav', null, TABS.map(([id, label]) => h('button', { class: id === currentTab ? 'active' : '', onclick: () => select(id), 'data-tab': id }, label)));
  const bar = h('div', { class: 'bar' }, h('span', { class: 'brand' }, logoImg(), 'PSOBB.web admin'), h('span', { class: 'muted' }, user),
    langSelect(rerender),
    h('button', { class: 'small', onclick: async () => { await run(() => api('POST', '/logout', {})); csrf = null; showLogin(); } }, 'Log out'));
  app.replaceChildren(bar, nav, content);
  async function select(id, arg) {
    currentTab = id;
    clearInterval(timer);
    for (const b of nav.children) b.classList.toggle('active', b.dataset.tab === id);
    content.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
    const view = await run(() => views[id](content, arg, select));
    if (view === undefined) content.replaceChildren(h('p', { class: 'muted' }, 'Could not load this tab.'));
  }
  app.select = select;
  select(currentTab);
}

// ---- tabs ------------------------------------------------------------------------------

views.dashboard = async (root) => {
  const render = async () => {
    const d = await api('GET', '/dashboard');
    const s = d.server ?? {};
    root.replaceChildren(
      h('div', { class: 'grid' },
        stat('Server', s.ServerName), stat('Uptime', fmtDuration(Number(s.UptimeUsecs) / 1e6)), stat('Players online', s.ClientCount),
        stat('Games', s.GameCount), stat('Lobbies', s.LobbyCount), stat('Accounts', d.accounts.total), stat('Banned', d.accounts.banned), stat('Admin sessions', d.adminSessions)),
      h('div', { class: 'card' }, h('h2', null, 'Connected players'),
        table(['ID', 'Account', 'Name', 'Level', 'Class', 'Section', 'Version', 'Lobby'], d.clients.map((c) => [c.ID, c.AccountID === null ? '-' : c.AccountID.toString(16).toUpperCase().padStart(8, '0'), c.Name ?? '-', c.Level ?? '-', c.Class ?? '-', c.SectionID ?? '-', c.Version, c.LobbyID ?? '-']), 'Nobody is online.')),
      h('div', { class: 'card' }, h('h2', null, 'Games'),
        table(['ID', 'Name', 'Players', 'Episode', 'Mode', 'Difficulty', 'Quest'], d.games.map((g) => [g.ID, g.Name, g.Players, g.Episode, g.Mode ?? '-', g.Difficulty ?? '-', g.Quest?.Metadata?.QuestNumber ?? (g.QuestInProgress ? 'yes' : '-')]), 'No games.')),
      h('p', { class: 'muted' }, 'Refreshes every 10 seconds.'));
  };
  await render();
  timer = setInterval(() => render().catch(() => {}), 10_000);
  return true;
};
const stat = (label, value) => h('div', { class: 'stat' }, h('b', null, value ?? '-'), h('span', null, label));

// Accounts
views.accounts = async (root, _arg, select) => {
  const data = await api('GET', '/accounts');
  const reload = () => select('accounts');
  const createUser = h('input', { type: 'text', maxlength: 16, placeholder: 'BB username', autocomplete: 'off' });
  const createPass = h('input', { type: 'password', maxlength: 16, placeholder: 'Password (1-16)', autocomplete: 'new-password' });
  const createFlags = flagPicker(data.flagChoices, 0, []);
  const create = h('div', { class: 'card' }, h('h2', null, 'Create account'),
    h('div', { class: 'row' }, createUser, eyeField(createPass),
      h('button', { class: 'primary', onclick: () => run(async () => {
        const r = await api('POST', '/accounts', { username: createUser.value, password: createPass.value, flags: createFlags.value() });
        toast(`Account ${r.id} created`);
        reload();
      }) }, 'Create')),
    h('details', null, h('summary', null, 'Permission flags (optional)'), createFlags.el),
    h('p', { class: 'muted' }, 'Username: letters, digits, _ . - (16 max). Password: 16 characters max, no spaces or quotes.'));

  const rows = data.accounts.map((a) => [
    h('span', { class: 'mono' }, a.id),
    a.bbUsernames.join(', ') || h('span', { class: 'muted' }, 'no BB license'),
    a.lastPlayerName || '-',
    [a.online ? h('span', { class: 'pill ok' }, 'online') : null, a.banned ? h('span', { class: 'pill bad' }, `banned until ${a.banEnd.slice(0, 16).replace('T', ' ')}`) : null, ...a.flagNames.map((f) => h('span', { class: 'pill warn' }, f))],
    h('div', { class: 'row' },
      h('button', { class: 'small', onclick: () => app.select('characters', a.id) }, 'Characters'),
      h('button', { class: 'small', onclick: () => flagsDialog(a, data.flagChoices, reload) }, 'Flags'),
      h('button', { class: 'small', onclick: () => passwordDialog(a, reload) }, 'Password'),
      a.banned ? h('button', { class: 'small', onclick: () => run(async () => { await api('POST', `/accounts/${a.id}/unban`, {}); toast('Unbanned'); reload(); }) }, 'Unban')
        : h('button', { class: 'small danger', onclick: () => banDialog(a, reload) }, 'Ban'),
      a.online ? h('button', { class: 'small', onclick: () => kick({ accountId: a.id }, `account ${a.id}`, reload) }, 'Kick') : null,
      h('button', { class: 'small danger', onclick: () => deleteDialog(a, reload) }, 'Delete')),
  ]);
  root.replaceChildren(create, h('div', { class: 'card' }, h('h2', null, `Accounts (${data.accounts.length})`), table(['ID', 'BB username', 'Last character', 'Status', 'Actions'], rows, 'No accounts yet.')),
    h('p', { class: 'muted' }, 'Passwords are never shown. Other license types (DC, PC, GC, XB) are not managed here.'));
  return true;
};

function flagPicker(choices, current, names) {
  const boxes = new Map();
  const el = h('div');
  for (const n of [...choices.single, ...choices.presets]) {
    const cb = h('input', { type: 'checkbox', checked: names.includes(n) });
    boxes.set(n, cb);
    el.append(h('label', null, cb, n));
  }
  return { el, value: () => [...boxes].filter(([, cb]) => cb.checked).map(([n]) => n) };
}

function flagsDialog(a, choices, done) {
  const picker = flagPicker(choices, a.flags, a.flagNames);
  const overlay = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, h('h2', null, `Flags of ${a.id}`), h('p', { class: 'muted' }, 'MODERATOR, ADMINISTRATOR and ROOT are presets that include the flags above them (ROOT = everything).'), picker.el,
    h('div', { class: 'actions' }, h('button', { onclick: () => overlay.remove() }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        overlay.remove();
        const ok = await confirmDialog({ title: 'Change permission flags', lines: [`Account ${a.id} will get: ${picker.value().join(', ') || 'no flags'}.`], token: a.id });
        if (ok) run(async () => { await api('POST', `/accounts/${a.id}/flags`, { flags: picker.value(), confirm: a.id }); toast('Flags updated'); done(); });
      } }, 'Save'))));
  document.body.append(overlay);
}

function passwordDialog(a, done) {
  const p = h('input', { type: 'password', maxlength: 16, autocomplete: 'new-password' });
  const sel = h('select', null, a.bbUsernames.map((u) => h('option', { value: u }, u)));
  const overlay = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, h('h2', null, `New password for ${a.id}`), a.bbUsernames.length > 1 ? sel : null, h('p', null, eyeField(p)),
    h('p', { class: 'muted' }, 'The BB license is removed and added again with the new password.'),
    h('div', { class: 'actions' }, h('button', { onclick: () => overlay.remove() }, 'Cancel'),
      h('button', { class: 'primary', onclick: () => run(async () => {
        await api('POST', `/accounts/${a.id}/password`, { password: p.value, username: a.bbUsernames.length > 1 ? sel.value : undefined });
        overlay.remove();
        toast('Password changed');
        done();
      }) }, 'Change'))));
  document.body.append(overlay);
  p.focus();
}

function banDialog(a, done) {
  const sel = h('select', null, ['30m', '12h', '1d', '3d', '1w', '1mo', '1y', 'permanent'].map((d) => h('option', { value: d }, d)));
  const overlay = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, h('h2', null, `Ban ${a.id}`), h('p', null, 'Duration: ', sel), h('p', { class: 'muted' }, 'A connected player is disconnected at once.'),
    h('div', { class: 'actions' }, h('button', { onclick: () => overlay.remove() }, 'Cancel'),
      h('button', { class: 'danger', onclick: async () => {
        overlay.remove();
        const ok = await confirmDialog({ title: 'Ban account', lines: [`Account ${a.id} (${a.bbUsernames.join(', ') || 'no BB license'}) will be banned for ${sel.value}.`], token: a.id, action: 'Ban' });
        if (ok) run(async () => { await api('POST', `/accounts/${a.id}/ban`, { duration: sel.value, confirm: a.id }); toast('Banned'); done(); });
      } }, 'Ban'))));
  document.body.append(overlay);
}

async function deleteDialog(a, done) {
  const ok = await confirmDialog({ title: 'Delete account', lines: [`Account ${a.id} (${a.bbUsernames.join(', ') || 'no BB license'}) will be removed. Character files are kept on disk. This cannot be undone.`], token: a.id, action: 'Delete' });
  if (ok) run(async () => { await api('POST', `/accounts/${a.id}/delete`, { confirm: a.id }); toast('Account deleted'); done(); });
}

async function kick(target, label, done) {
  const token = target.accountId ? `account ${target.accountId}` : `C-${target.clientId.toString(16)}`;
  const ok = await confirmDialog({ title: 'Kick player', lines: [`Disconnect ${label}. They can reconnect (this is not a ban).`], token, action: 'Kick', danger: false });
  if (ok) run(async () => { await api('POST', '/online/kick', { ...target, confirm: token }); toast('Kicked'); done?.(); });
}

// Characters
views.characters = async (root, accountId, select) => {
  const { accounts } = await api('GET', '/accounts');
  const withBb = accounts.filter((a) => a.bbUsernames.length);
  const pick = h('select', null, h('option', { value: '' }, 'Select an account...'), withBb.map((a) => h('option', { value: a.id, selected: a.id === accountId }, `${a.id}  ${a.bbUsernames.join(', ')}`)));
  const body = h('div');
  root.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'row' }, 'Account: ', pick)), body);
  const load = async () => {
    body.replaceChildren();
    if (pick.value) await run(() => accountCharacters(body, accounts.find((a) => a.id === pick.value)));
  };
  pick.addEventListener('change', load);
  if (accountId) await load();
  return true;
};

async function accountCharacters(body, acct) {
  const list = await api('GET', `/accounts/${acct.id}/characters${acct.bbUsernames.length > 1 ? `?username=${encodeURIComponent(acct.bbUsernames[0])}` : ''}`);
  const user = list.username;
  const warn = list.online ? h('div', { class: 'notice warn' }, 'This account is online. Characters can only be edited while it is offline: kick the player first.') : null;
  const shared = h('button', { class: 'small', onclick: () => run(() => bankEditor(detail, acct, user, 'shared', list.online)) }, 'Shared bank');
  const detail = h('div');
  body.replaceChildren(...(warn ? [warn] : []), h('div', { class: 'card' }, h('h2', null, `Characters of ${user}`),
    table(['Slot', 'Name', 'Level', 'EXP', 'Meseta', 'Class', 'Section', 'Items', ''], list.characters.map((c) => c.error ? [c.slot, h('span', { class: 'pill bad' }, c.error), '', '', '', '', '', '', ''] : [c.slot, c.name, c.level, c.exp, c.meseta, c.className, c.sectionName, c.items,
      h('button', { class: 'small', onclick: () => run(() => characterEditor(detail, acct, user, c.slot, list)) }, 'Open')]), 'No character files found for this username.'), h('div', { class: 'row' }, shared)), detail);
}

// The item list for the picker (newserv's names-v4.json + ItemPMT ranges), fetched once.
let catalogPromise = null;
const loadCatalog = () => (catalogPromise ??= api('GET', '/items/catalog').catch((e) => {
  catalogPromise = null;
  throw e;
}));

const KIND_LABELS = [['weapon', 'Weapon'], ['armor', 'Armor'], ['shield', 'Shield'], ['unit', 'Unit'], ['mag', 'Mag'], ['tool', 'Tool'], ['techdisk', 'Technique disk'], ['meseta', 'Meseta']];
const pbName = (cat, n) => (n === null || n === undefined ? '-' : cat.photonBlasts[n]);

// A short description of a picker spec, for the "to add" list.
function describeSpec(cat, s) {
  const name = cat.items.find((i) => i.code === s.code)?.name ?? s.code;
  switch (s.kind) {
    case 'weapon': return `${s.special ? `${cat.specials[s.special]} ` : ''}${name}${s.grind ? ` +${s.grind}` : ''}${(s.attributes ?? []).filter((a) => a?.type).map((a) => ` ${cat.attributes[a.type]} ${a.amount}%`).join('')}`;
    case 'armor': return `${name} [${s.slots ?? 0}] +${s.dfp ?? 0} DFP +${s.evp ?? 0} EVP`;
    case 'shield': return `${name} +${s.dfp ?? 0} DFP +${s.evp ?? 0} EVP`;
    case 'unit': return `${name}${s.modifier > 0 ? '+'.repeat(s.modifier) : '-'.repeat(-(s.modifier ?? 0))}`;
    case 'tool': return `${name} x${s.count ?? 1}`;
    case 'techdisk': return `Disk:${s.tech} Lv.${s.level}`;
    case 'meseta': return `${s.amount} Meseta`;
    default: return name;
  }
}

// The item picker: kind, search by name, the fields of that kind; calls onAdd(spec).
function itemPicker(cat, onAdd) {
  const box = h('div', { class: 'picker' });
  const kind = h('select', { 'aria-label': 'Item kind' }, KIND_LABELS.map(([v, l]) => h('option', { value: v }, l)));
  const fields = h('div', { class: 'form-grid' });
  const numIn = (label, min, max, value = 0, step = 1) => h('input', { type: 'number', min, max, step, value, 'aria-label': label });
  const field = (label, input) => h('label', null, label, input);
  let read = () => null;
  const render = () => {
    const k = kind.value;
    const list = cat.items.filter((i) => i.kind === k);
    const search = h('input', { type: 'search', placeholder: 'Search by name', 'aria-label': 'Search by name', class: 'grow' });
    const pick = h('select', { 'aria-label': 'Item', size: 6, class: 'item-list' });
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      const shown = list.filter((i) => !q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().startsWith(q)).slice(0, 300);
      pick.replaceChildren(...shown.map((i, n) => h('option', { value: i.code, selected: n === 0, class: 'mono' }, `${i.name}  (${i.code})`)));
      pick.dispatchEvent(new Event('change'));
    };
    search.addEventListener('input', fill);
    const item = () => list.find((i) => i.code === pick.value);
    const extra = h('div', { class: 'form-grid' });
    const needsItem = !['techdisk', 'meseta'].includes(k);
    if (k === 'weapon') {
      const grind = numIn('Grind', 0, 0);
      const special = h('select', { 'aria-label': 'Special' }, cat.specials.map((s, i) => h('option', { value: i }, s ?? '(none)')));
      const attrs = [0, 1, 2].map(() => [h('select', { 'aria-label': 'Attribute' }, cat.attributes.map((a, i) => h('option', { value: i }, a ?? '(none)'))), numIn('Percent', -100, 100)]);
      pick.addEventListener('change', () => {
        const it = item();
        grind.max = it?.maxGrind ?? 0;
        if (Number(grind.value) > Number(grind.max)) grind.value = grind.max;
        const s = Boolean(it?.sRank);
        special.disabled = s;
        for (const [t, p] of attrs) { t.disabled = s; p.disabled = s; }
      });
      extra.append(field('Grind (max from the item table)', grind), field('Special', special), ...attrs.flatMap(([t, p], i) => [field(`Attribute ${i + 1}`, t), field('%', p)]));
      read = () => ({ kind: k, code: pick.value, grind: Number(grind.value), special: Number(special.value), attributes: attrs.map(([t, p]) => (Number(t.value) ? { type: Number(t.value), amount: Number(p.value) } : null)).filter(Boolean) });
    } else if (k === 'armor' || k === 'shield') {
      const slots = numIn('Slots', 0, 4);
      const dfp = numIn('DFP bonus', 0, 0);
      const evp = numIn('EVP bonus', 0, 0);
      pick.addEventListener('change', () => {
        const it = item();
        dfp.max = it?.dfpRange ?? 0;
        evp.max = it?.evpRange ?? 0;
      });
      if (k === 'armor') extra.append(field('Slots', slots));
      extra.append(field('DFP bonus', dfp), field('EVP bonus', evp));
      read = () => ({ kind: k, code: pick.value, ...(k === 'armor' ? { slots: Number(slots.value) } : {}), dfp: Number(dfp.value), evp: Number(evp.value) });
    } else if (k === 'unit') {
      const mod = h('select', { 'aria-label': 'Modifier' }, [-2, -1, 0, 1, 2].map((v) => h('option', { value: v, selected: v === 0 }, v === 0 ? '(normal)' : v > 0 ? '+'.repeat(v) : '-'.repeat(-v))));
      extra.append(field('Modifier', mod));
      read = () => ({ kind: k, code: pick.value, modifier: Number(mod.value) });
    } else if (k === 'tool') {
      const count = numIn('Count', 1, 1, 1);
      pick.addEventListener('change', () => {
        count.max = item()?.maxStack ?? 1;
        if (Number(count.value) > Number(count.max)) count.value = count.max;
      });
      extra.append(field('Count', count));
      read = () => ({ kind: k, code: pick.value, count: Number(count.value) });
    } else if (k === 'mag') {
      extra.append(h('p', { class: 'muted' }, 'A new mag starts as newserv makes one (DEF 5, synchro 40); edit it with "Edit mag" after saving.'));
      read = () => ({ kind: k, code: pick.value });
    } else if (k === 'techdisk') {
      const tech = h('select', { 'aria-label': 'Technique' }, cat.techniques.map((t) => h('option', { value: t }, t)));
      const level = numIn('Level', 1, 30, 1);
      extra.append(field('Technique', tech), field('Level', level));
      read = () => ({ kind: k, tech: tech.value, level: Number(level.value) });
    } else {
      const amount = numIn('Amount', 1, 999999, 1000);
      extra.append(field('Amount', amount));
      read = () => ({ kind: k, amount: Number(amount.value) });
    }
    fields.replaceChildren(...(needsItem ? [h('div', { class: 'picker-search' }, search, pick)] : []), extra);
    if (needsItem) fill();
  };
  kind.addEventListener('change', render);
  const add = h('button', { onclick: () => {
    const spec = read();
    if (!spec || ('code' in spec && !spec.code)) return toast('Pick an item first', 'bad');
    onAdd(spec);
  } }, 'Add to list');
  box.append(h('div', { class: 'row' }, h('label', null, 'Kind', kind), add), fields);
  render();
  return box;
}

// The mag editor: returns { el, read } for one mag (fields of decodeMag).
function magEditor(cat, mag) {
  const numIn = (label, min, max, value, step = 1) => h('input', { type: 'number', min, max, step, value, 'aria-label': label });
  const field = (label, input) => h('label', null, label, input);
  const mags = cat.items.filter((i) => i.kind === 'mag');
  const type = h('select', { 'aria-label': 'Mag type' }, mags.map((m) => h('option', { value: parseInt(m.code.slice(2, 4), 16), selected: parseInt(m.code.slice(2, 4), 16) === mag.type }, m.name)));
  const stats = ['def', 'pow', 'dex', 'mind'].map((k) => [k, numIn(`${k} level`, 0, 200, mag[k].level), numIn(`${k} progress`, 0, 98, mag[k].progress - (mag[k].progress % 2), 2)]);
  const synchro = numIn('Synchro', 0, 120, mag.synchro);
  const iq = numIn('IQ', 0, 200, mag.iq);
  const color = h('select', { 'aria-label': 'Colour' }, cat.magColors.map((c, i) => h('option', { value: i, selected: i === mag.color }, c)));
  const pbs = ['Center', 'Right', 'Left'].map((slot, s) => [slot, h('select', { 'aria-label': `${slot} photon blast` }, h('option', { value: '' }, '(none)'), cat.photonBlasts.map((p, i) => h('option', { value: i, selected: mag.photonBlasts[s] === i }, p)))]);
  const sum = h('b');
  const upd = () => {
    const total = stats.reduce((a, [, l]) => a + Number(l.value), 0);
    sum.textContent = String(total);
    sum.className = total > 200 ? 'bad' : '';
  };
  for (const [, l] of stats) l.addEventListener('input', upd);
  upd();
  const el = h('div', null,
    h('div', { class: 'form-grid' }, field('Mag type', type), field('Synchro (0-120)', synchro), field('IQ (0-200)', iq), field('Colour', color)),
    h('div', { class: 'form-grid' }, stats.flatMap(([k, l, p]) => [field(`${k.toUpperCase()} level`, l), field(`${k.toUpperCase()} progress`, p)])),
    h('p', { class: 'muted' }, 'Level (DEF + POW + DEX + MIND, max 200): ', sum, '. Progress is kept in steps of 2 (newserv stores it that way).'),
    h('div', { class: 'form-grid' }, pbs.map(([slot, sel]) => field(`${slot} photon blast`, sel))),
    h('p', { class: 'muted' }, 'Photon blast slots fill in order: center, then right, then left; each blast once.'));
  const read = () => ({
    type: Number(type.value),
    ...Object.fromEntries(stats.map(([k, l, p]) => [k, { level: Number(l.value), progress: Number(p.value) }])),
    synchro: Number(synchro.value), iq: Number(iq.value), color: Number(color.value),
    photonBlasts: pbs.map(([, sel]) => (sel.value === '' ? null : Number(sel.value))),
  });
  return { el, read };
}

async function characterEditor(root, acct, user, slot, meta) {
  const [c, cat] = await Promise.all([api('GET', `/accounts/${acct.id}/characters/${slot}?username=${encodeURIComponent(user)}`), loadCatalog().catch(() => null)]);
  const tables = c.gameData ?? {};
  const f = {};
  const num = (key, label, val, min, max) => (f[key] = h('input', { type: 'number', min, max, value: val, 'aria-label': label }));
  const field = (label, input) => h('label', null, label, input);
  num('level', 'Level', c.level, 1, 200);
  num('exp', 'EXP', c.exp, 0, 999999999);
  num('meseta', 'Meseta', c.meseta, 0, 999999);
  const stats = ['atp', 'mst', 'evp', 'hp', 'dfp', 'ata', 'lck'].map((k) => [k, h('input', { type: 'number', min: 0, max: 9999, value: c.stats[k], 'aria-label': k.toUpperCase() })]);
  f.section = h('select', null, meta.sectionIds.map((n, i) => h('option', { value: i, selected: i === c.sectionId }, n)));
  f.cls = h('select', null, meta.classes.map((n, i) => h('option', { value: i, selected: i === c.charClass }, n)));

  // Level / class -> EXP and stats from newserv's level table (the save does the same).
  const levelNote = h('p', { class: 'muted' }, tables.levelTable
    ? 'Changing the level or class recomputes EXP (the threshold of that level) and the base stats of the class from newserv\'s level table; used materials stay on top. You can still adjust a value by hand after that.'
    : 'Level table not found on the server: the level is written alone (EXP and stats are not recomputed).');
  const preview = async () => {
    if (!tables.levelTable) return;
    const lv = Number(f.level.value);
    if (!Number.isInteger(lv) || lv < 1 || lv > 200) return;
    const p = await run(() => api('GET', `/accounts/${acct.id}/characters/${slot}/level-preview?username=${encodeURIComponent(user)}&level=${lv}&charClass=${f.cls.value}`));
    if (!p) return;
    f.exp.value = p.exp;
    for (const [k, input] of stats) input.value = p.stats[k];
  };
  f.level.addEventListener('change', preview);

  // Techniques: only what the class can learn, with its level cap.
  const techBox = h('div', { class: 'form-grid' });
  let techs = [];
  const renderTechs = () => {
    const limits = cat?.techLimits?.[meta.classes[Number(f.cls.value)]] ?? (Number(f.cls.value) === c.charClass ? c.techLimits : null);
    techs = [];
    const els = [];
    for (const t of meta.techniques) {
      const max = limits ? limits[t] : 30;
      const cur = c.techniques[t] ?? 0;
      if (max === null && !cur) continue;
      const input = h('input', { type: 'number', min: 0, max: max ?? 0, value: cur, title: '0 = not learned', 'aria-label': t });
      techs.push([t, input]);
      els.push(field(max === null ? `${t} (this class cannot learn it: set 0)` : `${t} (max ${max})`, input));
    }
    techBox.replaceChildren(...(els.length ? els : [h('p', { class: 'muted' }, 'This class cannot learn techniques.')]));
  };
  renderTechs();
  f.cls.addEventListener('change', () => { renderTechs(); preview(); });

  // Inventory: remove, pending additions (picker or raw), mag edits.
  const invRemove = new Set();
  const pendingAdd = [];
  const pendingMags = new Map();
  const addList = h('ul', { class: 'pending' });
  const renderAdds = () => addList.replaceChildren(...pendingAdd.map((a, i) => h('li', null, a.spec ? describeSpec(cat, a.spec) : h('span', { class: 'mono' }, `${a.data1} ${a.data2}`), ' ',
    h('button', { class: 'small', onclick: () => { pendingAdd.splice(i, 1); renderAdds(); } }, 'Remove'))));
  const invAdd1 = h('input', { type: 'text', maxlength: 24, placeholder: 'data1 (24 hex)', class: 'mono' });
  const invAdd2 = h('input', { type: 'text', maxlength: 8, placeholder: 'data2 (8 hex)', class: 'mono', value: '00000000' });
  const rawAdd = h('button', { class: 'small', onclick: () => {
    if (!/^[0-9a-fA-F]{24}$/.test(invAdd1.value) || !/^[0-9a-fA-F]{8}$/.test(invAdd2.value || '00000000')) return toast('data1 must be 24 hex digits and data2 8', 'bad');
    pendingAdd.push({ data1: invAdd1.value, data2: invAdd2.value || '00000000' });
    invAdd1.value = '';
    renderAdds();
  } }, 'Add to list');
  const magBox = h('div');
  const openMag = (it) => {
    const ed = magEditor(cat, it.mag);
    magBox.replaceChildren(h('div', { class: 'card inner' }, h('h3', null, `Mag in slot ${it.slot}: ${it.name ?? ''}`), ed.el,
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { pendingMags.set(it.slot, ed.read); toast(`Mag in slot ${it.slot}: changes kept, press Save changes`); } }, 'Keep mag changes'),
        h('button', { onclick: () => { pendingMags.delete(it.slot); magBox.replaceChildren(); } }, 'Close'))));
  };
  const invRows = c.inventory.map((it) => [it.slot, it.name ?? it.kind, h('span', { class: 'mono' }, it.data1), h('span', { class: 'mono' }, it.data2), it.equipped ? h('span', { class: 'pill ok' }, 'equipped') : '',
    h('span', null, it.mag && cat ? h('button', { class: 'small', onclick: () => openMag(it) }, 'Edit mag') : null,
      h('label', null, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? invRemove.add(it.slot) : invRemove.delete(it.slot)) }), 'remove'))]);

  const save = async () => {
    const patch = {};
    const diff = (key, val, orig) => { if (Number(val) !== orig) patch[key] = Number(val); };
    diff('level', f.level.value, c.level);
    diff('exp', f.exp.value, c.exp);
    diff('meseta', f.meseta.value, c.meseta);
    diff('sectionId', f.section.value, c.sectionId);
    diff('charClass', f.cls.value, c.charClass);
    const st = {};
    for (const [k, input] of stats) if (Number(input.value) !== c.stats[k]) st[k] = Number(input.value);
    if (Object.keys(st).length) patch.stats = st;
    const tc = {};
    for (const [t, input] of techs) {
      const v = Number(input.value) === 0 ? null : Number(input.value);
      if (v !== (c.techniques[t] ?? null)) tc[t] = v;
    }
    if (Object.keys(tc).length) patch.techniques = tc;
    const inv = {};
    if (invRemove.size) inv.remove = [...invRemove];
    if (pendingAdd.length) inv.add = pendingAdd.map((a) => (a.spec ? { spec: a.spec } : { data1: a.data1, data2: a.data2 }));
    if (Object.keys(inv).length) patch.inventory = inv;
    if (pendingMags.size) {
      for (const s of pendingMags.keys()) if (invRemove.has(s)) return toast('A mag being edited is also marked for removal', 'bad');
      patch.mags = [...pendingMags].map(([s, read]) => ({ slot: s, ...read() }));
    }
    if (!Object.keys(patch).length) return toast('Nothing changed', 'bad');
    const ok = await confirmDialog({ title: `Edit character ${c.name} (slot ${slot})`, lines: ['The character file is changed on disk after a backup copy. The account must stay offline until it is saved.', `Changes: ${Object.keys(patch).join(', ')}`], token: acct.id, action: 'Save changes' });
    if (!ok) return;
    await run(async () => {
      const r = await api('POST', `/accounts/${acct.id}/characters/${slot}`, { username: user, patch, confirm: acct.id });
      toast(`Saved: ${r.changes.length} change(s)`);
      characterEditor(root, acct, user, slot, meta);
    });
  };

  const pickerBox = cat?.available
    ? itemPicker(cat, (spec) => { pendingAdd.push({ spec }); renderAdds(); })
    : h('p', { class: 'muted' }, 'Item names not found on the server (newserv system/tables/names-v4.json): only raw items can be added.');
  const bankBox = h('div');
  root.replaceChildren(h('div', { class: 'card', id: 'character-editor' }, h('h2', null, `${c.name || '(unnamed)'} - slot ${slot}`),
    h('p', { class: 'muted' }, `${c.className}, ${c.sectionName}, played ${fmtDuration(c.playTimeSeconds)}. Backups go to players/_admin-backups.`),
    h('div', { class: 'form-grid' }, field('Level', f.level), field('EXP', f.exp), field('Meseta', f.meseta), field('Section ID', f.section), field('Class', f.cls)),
    levelNote,
    h('h3', null, 'Stats'), h('div', { class: 'form-grid' }, stats.map(([k, i]) => field(k.toUpperCase(), i))),
    c.materials ? h('p', { class: 'muted' }, `Materials used: power ${c.materials.power}, mind ${c.materials.mind}, evade ${c.materials.evade}, def ${c.materials.def}, luck ${c.materials.luck}, HP ${c.materials.hp}, TP ${c.materials.tp}.`) : null,
    h('h3', null, 'Technique levels (0 = none)'), techBox,
    h('h3', null, `Inventory (${c.inventory.length}/30)`),
    table(['Slot', 'Item', 'data1', 'data2', '', ''], invRows, 'Empty.'),
    magBox,
    h('h3', null, 'Give items'), pickerBox,
    h('details', { class: 'advanced' }, h('summary', null, 'Advanced: raw item bytes'),
      h('div', { class: 'row' }, invAdd1, invAdd2, rawAdd),
      h('p', { class: 'muted' }, 'Raw items: data1 is the 12 item bytes, data2 the 4 trailing bytes. They are not checked against the item tables; wrong data can make the client reject the character.')),
    h('p', { class: 'muted' }, 'To add when saving:'), addList,
    h('div', { class: 'row' }, h('button', { class: 'danger', onclick: save, disabled: meta.online }, 'Save changes...'), meta.online ? h('span', { class: 'muted' }, 'Account is online.') : null)),
  h('div', { class: 'card' }, h('h2', null, 'Bank'), h('p', { class: 'muted' }, `Source: ${c.bank.source}. Meseta ${c.bank.meseta}, ${c.bank.items.length} item(s).`), h('button', { onclick: () => run(() => bankEditor(bankBox, acct, user, slot, meta.online)) }, 'Edit bank...')), bankBox);
}

async function bankEditor(root, acct, user, target, online) {
  const [r, cat] = await Promise.all([api('GET', `/accounts/${acct.id}/bank/${target}?username=${encodeURIComponent(user)}`), loadCatalog().catch(() => null)]);
  const remove = new Set();
  const pendingAdd = [];
  const addList = h('ul', { class: 'pending' });
  const renderAdds = () => addList.replaceChildren(...pendingAdd.map((a, i) => h('li', null, a.spec ? describeSpec(cat, a.spec) : h('span', { class: 'mono' }, `${a.data1} ${a.data2} x${a.amount}`), ' ',
    h('button', { class: 'small', onclick: () => { pendingAdd.splice(i, 1); renderAdds(); } }, 'Remove'))));
  const meseta = h('input', { type: 'number', min: 0, max: 999999, value: r.bank.meseta });
  const a1 = h('input', { type: 'text', maxlength: 24, placeholder: 'data1 (24 hex)', class: 'mono' });
  const a2 = h('input', { type: 'text', maxlength: 8, placeholder: 'data2 (8 hex)', class: 'mono', value: '00000000' });
  const amount = h('input', { type: 'number', min: 1, max: 999, value: 1 });
  const rawAdd = h('button', { class: 'small', onclick: () => {
    if (!/^[0-9a-fA-F]{24}$/.test(a1.value)) return toast('data1 must be 24 hex digits and data2 8', 'bad');
    pendingAdd.push({ data1: a1.value, data2: a2.value || '00000000', amount: Number(amount.value) });
    a1.value = '';
    renderAdds();
  } }, 'Add to list');
  const rows = r.bank.items.map((it, i) => [i, it.name ?? it.kind, h('span', { class: 'mono' }, it.data1), h('span', { class: 'mono' }, it.data2), it.amount, h('label', null, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? remove.add(i) : remove.delete(i)) }), 'remove')]);
  const save = async () => {
    const patch = {};
    if (Number(meseta.value) !== r.bank.meseta) patch.meseta = Number(meseta.value);
    if (remove.size) patch.remove = [...remove];
    if (pendingAdd.length) patch.add = pendingAdd.map((a) => (a.spec ? { spec: a.spec } : { data1: a.data1, data2: a.data2, amount: a.amount }));
    if (!Object.keys(patch).length) return toast('Nothing changed', 'bad');
    const ok = await confirmDialog({ title: `Edit ${target === 'shared' ? 'shared' : `slot ${target}`} bank`, lines: ['The bank file is rewritten after a backup copy.'], token: acct.id, action: 'Save bank' });
    if (!ok) return;
    await run(async () => {
      const res = await api('POST', `/accounts/${acct.id}/bank/${target}`, { username: user, patch, confirm: acct.id });
      toast(`Saved: ${res.changes.length} change(s)`);
      bankEditor(root, acct, user, target, online);
    });
  };
  const card = h('div', { class: 'card' }, h('h2', null, `Bank (${target === 'shared' ? 'shared' : `slot ${target}`})`), h('p', { class: 'muted' }, `Source: ${r.bank.source}. Saving writes a .psobank file, which newserv prefers over the bank in the character file.`),
    h('div', { class: 'row' }, h('label', null, 'Meseta', meseta)), table(['#', 'Item', 'data1', 'data2', 'Amount', ''], rows, 'Empty.'),
    h('h3', null, 'Give items'),
    cat?.available ? itemPicker(cat, (spec) => { pendingAdd.push({ spec }); renderAdds(); }) : null,
    h('details', { class: 'advanced' }, h('summary', null, 'Advanced: raw item bytes'), h('div', { class: 'row' }, a1, a2, amount, rawAdd)),
    h('p', { class: 'muted' }, 'To add when saving:'), addList,
    h('button', { class: 'danger', onclick: save, disabled: online }, 'Save bank...'));
  root.replaceChildren(card);
}

// Online
views.online = async (root, _arg, select) => {
  const render = async () => {
    const d = await api('GET', '/online');
    const msg = h('input', { type: 'text', maxlength: 200, placeholder: 'Announcement to all players', class: 'grow' });
    root.replaceChildren(
      h('div', { class: 'card' }, h('h2', null, 'Announcement'), h('div', { class: 'row' }, msg,
        h('button', { class: 'primary', onclick: () => run(async () => { await api('POST', '/online/announce', { message: msg.value }); toast('Announcement sent'); msg.value = ''; }) }, 'Send')),
        h('p', { class: 'muted' }, 'Printable ASCII only, no quotes, backslash or ; | & < >. newserv can only announce to everyone; there is no per-player message command.')),
      h('div', { class: 'card' }, h('h2', null, `Players (${d.clients.length})`),
        table(['Client', 'Account', 'Name', 'Level', 'Class', 'Lobby', 'Address', ''], d.clients.map((c) => [c.ID, c.accountId ?? '-', c.Name ?? '-', c.Level ?? '-', c.Class ?? '-', c.LobbyID ?? '-', c.address ?? '-',
          h('button', { class: 'small danger', onclick: () => kick({ clientId: c.ID }, `${c.Name ?? 'client'} (C-${c.ID.toString(16)})`, () => select('online')) }, 'Kick')]), 'Nobody is online.')),
      h('div', { class: 'card' }, h('h2', null, 'Games'), table(['ID', 'Name', 'Players', 'Episode', 'Mode', 'Difficulty', 'Cheats'], d.games.map((g) => [g.ID, g.Name, g.Players, g.Episode, g.Mode ?? '-', g.Difficulty ?? '-', g.CheatsEnabled ? 'yes' : 'no']), 'No games.')));
  };
  await render();
  return true;
};

// Quests

// The BB files of a quest: newserv names them q058-bb-e.bin + q058-bb.dat (or a
// .qst); the number in the name is the quest number.
function questFiles(files, number) {
  const num = (name) => {
    const m = /^[A-Za-z]?0*(\d+)-bb(?:-([a-z]))?\.(bin|dat|qst)$/.exec(name);
    return m && Number(m[1]) === number ? { lang: m[2] ?? '', ext: m[3] } : null;
  };
  const found = files.map((f) => ({ f, m: num(f.name) })).filter((x) => x.m);
  const qst = found.find((x) => x.m.ext === 'qst');
  const bins = found.filter((x) => x.m.ext === 'bin').sort((a, b) => (a.m.lang === 'e' ? -1 : 0) - (b.m.lang === 'e' ? -1 : 0));
  const dat = found.find((x) => x.m.ext === 'dat');
  if (bins.length && dat) return { bin: bins[0].f.name, dat: dat.f.name };
  if (qst) return { qst: qst.f.name };
  return null;
}

// The editor opens in a new tab on the same origin, so it shares the session
// cookie (Path=/admin) and fetches the files from the authenticated route. No
// 'noopener': the editor's "Test in game" answers its opener (questeditor:test).
function openInEditor(dir, found) {
  const url = (name) => `/admin/api/quests/file/${encodeURIComponent(dir)}/${encodeURIComponent(name)}`;
  const params = found.qst ? `qst=${encodeURIComponent(url(found.qst))}` : `qst=${encodeURIComponent(url(found.bin))}&dat=${encodeURIComponent(url(found.dat))}`;
  window.open(`/questeditor.html?${params}&admin=1`, '_blank');
}

// "Test in game" from the editor: the package (see client/src/questeditor/io.ts) is
// published to the server's hidden category as q<number>-bb-e.bin + q<number>-bb.dat,
// so newserv loads it (the hidden category is in no menu). A quest number that another
// category already holds is refused by the server (docs/ADMIN.md, Quests).
function base64Bytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function testInGame(pkg) {
  const n = pkg.questNumber;
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error('the quest has no valid number: set the Quest number in the editor first');
  const name = `q${n}-bb-e.bin`;
  const res = await api('POST', '/quests/publish', { category: 'hidden', name, confirm: `hidden/${name}`, bin: base64Bytes(pkg.bin), dat: base64Bytes(pkg.dat) });
  const replaced = res.files.some((f) => f.replaced);
  toast(`Test quest ${res.quest.questNumber} "${res.quest.name}" is on the server as hidden/${name}${replaced ? ' (the previous files are in the backups)' : ''}. Quests reloaded. In a game, the chat command $quest ${res.quest.questNumber} starts it when the quest allows chat starts (AllowStartFromChatCommand) or the account has debug on; see docs/ADMIN.md.`);
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'questeditor:test' || !e.data.package) return;
  if (!csrf) {
    toast('Log in to the admin panel to test a quest in game', 'bad');
    return;
  }
  run(() => testInGame(e.data.package));
});

// Delete a published quest: every Blue Burst file of it in its category (bin, dat or qst, json). The
// server copies each file to the backup folder first and removes the mirror copies (docs/ADMIN.md).
async function deleteQuest(dir, quest, found, select) {
  const name = found.qst ?? found.bin;
  const token = `${dir}/${name}`;
  const ok = await confirmDialog({ title: `Delete quest ${quest.number}`, lines: [`"${quest.name}" (${token}) will be removed from the server with its .dat / .json of the same name. Each file is copied to the server's quest backups first. Players see the change after the quest reload.`], token, action: 'Delete' });
  if (!ok) return;
  run(async () => {
    const r = await api('POST', '/quests/delete', { category: dir, name, confirm: token });
    toast(`Deleted ${r.files.map((f) => f.name).join(', ')} (backups kept). Quests reloaded.`);
    select('quests');
  });
}

views.quests = async (root, _arg, select) => {
  const [q, f] = await Promise.all([api('GET', '/quests'), api('GET', '/quests/files').catch(() => ({ directories: [] }))]);
  const filesByDir = new Map(f.directories.map((d) => [d.dir, d.files]));
  root.append(
    h('div', { class: 'card' }, h('h2', null, `Quests (${q.total})`), h('p', { class: 'muted' }, `Loaded from ${q.directory}. Edit a quest in the quest editor and use its Publish to server action, or add or remove the files on the server and reload. ENABLED expressions are quest-flag conditions: a quest shows in the menu only when its category is listed and its expression is true for the player.`),
      h('button', { class: 'primary', onclick: () => run(async () => { await api('POST', '/reload', { items: ['quests'] }); toast('Quests reloaded'); select('quests'); }) }, 'Reload quests'),
      ' ', h('a', { class: 'btn', href: '/questeditor.html?admin=1', target: '_blank' }, 'New quest (editor)')),
    ...q.categories.map((c) => h('details', { class: 'card' }, h('summary', null, `${c.name} `, h('span', { class: 'pill' }, `${c.quests.length} quests`), h('span', { class: `pill ${c.listed ? 'ok' : 'bad'}` }, c.listed ? 'listed in menus' : 'hidden'), c.directory ? h('span', { class: 'muted mono' }, c.directory) : null),
      table(['#', 'Name', 'Episode', 'Players', 'Enabled when', 'Drops', 'Versions', ''], c.quests.map((x) => {
        const found = c.directory ? questFiles(filesByDir.get(c.directory) ?? [], x.number) : null;
        return [x.number, x.name, x.episode, x.maxPlayers, h('span', { class: 'mono' }, x.enabledExpression ?? 'always'), x.dropMode ?? '-', x.versions.length,
          found ? h('span', null, h('button', { onclick: () => openInEditor(c.directory, found) }, 'Open in editor'), ' ', h('button', { class: 'danger', onclick: () => deleteQuest(c.directory, x, found, select) }, 'Delete')) : h('span', { class: 'muted' }, 'no BB file')];
      }), 'No quests.'))));
  return true;
};

// Teams
views.teams = async (root, _arg, select) => {
  const t = await api('GET', '/teams');
  root.replaceChildren(h('div', { class: 'card' }, h('h2', null, `Teams (${t.teams.length})`),
    table(['ID', 'Name', 'Members', 'Points', 'Spent points'], t.teams.map((x) => [x.id, x.Name ?? '-', x.Members?.length ?? '-', x.Points ?? '-', x.SpentPoints ?? '-']), 'No teams.'),
    h('p', { class: 'muted' }, 'newserv has no team commands: teams are read-only here. After editing team files by hand, reload them.'),
    h('button', { onclick: () => run(async () => { await api('POST', '/reload', { items: ['teams'] }); toast('Teams reloaded'); select('teams'); }) }, 'Reload teams')),
  h('details', { class: 'card' }, h('summary', null, 'Raw team data'), h('pre', null, JSON.stringify(t.teams, null, 2))));
  return true;
};

// Data tables (read-only)
views.data = async (root) => {
  const items = [['common-tables', 'Common item tables (list)'], ['rare-tables', 'Rare drop tables (list)'], ['tekker-table', 'Tekker table'], ['shop-table/armor', 'Armor shop'], ['shop-table/tool', 'Tool shop'], ['shop-table/weapon/0', 'Weapon shop (Normal)'], ['shop-table/weapon/1', 'Weapon shop (Hard)'], ['shop-table/weapon/2', 'Weapon shop (Very Hard)'], ['shop-table/weapon/3', 'Weapon shop (Ultimate)'], ['level-table/BB_V4', 'Level table (BB)'], ['mag-table/BB_V4', 'Mag table (BB)'], ['item-stack-limits/BB_V4', 'Stack limits (BB)']];
  const sel = h('select', null, items.map(([v, l]) => h('option', { value: v }, l)));
  const custom = h('input', { type: 'text', placeholder: 'or a path such as rare-table/rare-table-v4', class: 'wide' });
  const out = h('pre', null, 'Choose a table.');
  const load = (path) => run(async () => {
    out.textContent = tr('Loading...');
    const d = await api('GET', `/data/${path}`);
    const text = JSON.stringify(d.data, null, 1);
    out.textContent = text.length > 400000 ? `${text.slice(0, 400000)}\n${tr(`... (truncated; ${text.length} bytes)`)}` : text;
  });
  root.replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Server data tables'), h('p', { class: 'muted' }, 'Read-only views of newserv tables. Drop rates and EXP are changed in Config; the tables themselves are files on the server (reload them from here).'),
    h('div', { class: 'row' }, sel, h('button', { onclick: () => load(sel.value) }, 'Show'), custom, h('button', { onclick: () => custom.value && load(custom.value) }, 'Show path'),
      h('button', { onclick: () => run(async () => { await api('POST', '/reload', { items: ['drop-tables', 'level-tables', 'item-definitions'] }); toast('Reloaded drop tables, level tables and item definitions'); }) }, 'Reload tables')), out));
  return true;
};

// Config
views.config = async (root, _arg, select) => {
  const c = await api('GET', '/config');
  const rows = c.editable.map((e) => {
    let input;
    if (e.type === 'bool') input = h('select', null, ['true', 'false'].map((v) => h('option', { value: v, selected: String(e.current) === v }, v)));
    else if (e.type === 'enum') input = h('select', null, e.values.map((v) => h('option', { value: v, selected: e.current === v }, v)));
    else if (e.type === 'number') input = h('input', { type: 'number', step: 'any', min: e.min, max: e.max, value: e.current ?? '' });
    else input = h('input', { type: 'text', value: e.current ?? '', maxlength: 200 });
    const save = async () => {
      let value = input.value;
      if (e.type === 'bool') value = value === 'true';
      if (e.type === 'number') value = Number(value);
      const ok = await confirmDialog({ title: `Change ${e.key}`, lines: [`${e.key} = ${JSON.stringify(value)}. config.json is edited (backup kept) and reloaded.`], token: e.key, action: 'Apply' });
      if (ok) run(async () => { await api('POST', '/config', { key: e.key, value, confirm: e.key }); toast(`${e.key} updated`); select('config'); });
    };
    return [h('span', { class: 'mono' }, e.key), input, e.note ?? '', h('button', { class: 'small danger', onclick: save }, 'Apply...')];
  });
  root.replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Editable settings'), table(['Key', 'Value', 'Note', ''], rows),
    h('p', { class: 'muted' }, 'Only these keys can be changed from the panel. Everything else (ports, addresses, drop tables, item lists) is edited in config.json on the server.')),
    h('details', { class: 'card' }, h('summary', null, 'Effective configuration (read-only)'), h('pre', null, JSON.stringify(c.config, null, 1))));
  return true;
};

// Audit
views.audit = async (root, _arg, select) => {
  const a = await api('GET', '/audit?limit=300');
  root.replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Audit log'), h('div', { class: 'row' }, h('button', { onclick: () => select('audit') }, 'Refresh')),
    table(['Time (UTC)', 'Who', 'Action', 'Detail', 'Result'], a.entries.map((e) => [h('span', { class: 'mono' }, e.ts.replace('T', ' ').slice(0, 19)), h('span', { class: 'mono' }, e.who), e.action, e.detail, h('span', { class: `pill ${e.result === 'ok' ? 'ok' : 'bad'}` }, e.result)]), 'No entries.')));
  return true;
};

// ---- start ------------------------------------------------------------------------------

document.title = tr('PSOBB.web Admin');
(async () => {
  try {
    const s = await api('GET', '/session');
    if (s.authenticated) {
      csrf = s.csrf;
      user = s.user;
      showApp();
    } else showLogin();
  } catch (e) {
    showLogin(e.message);
  }
})();

// Admin panel translations (bridge/admin-ui/i18n.js): dictionary integrity,
// placeholders, pattern samples, English fallback, language detection, and a
// coverage REPORT (not a failure) of English literals in admin.js and admin.mjs
// that have no dictionary entry.
//
// Run: node tests/admin.i18n.test.ts
import { readFileSync } from 'node:fs';
import { DICT, LANGS, PATTERNS, getLang, pickLang, setLang, tr, trIn } from '../bridge/admin-ui/i18n.js';

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

const nonEn = ['pt-BR', 'es'];

// ---- dictionary integrity --------------------------------------------------------------

const seen = new Set<string>();
for (const entry of DICT as string[][]) {
  const [en, pt, es] = entry;
  check(entry.length === 3, `entry has 3 columns: ${en}`);
  check(typeof en === 'string' && en !== '', 'English text is not empty');
  check(typeof pt === 'string' && pt.trim() !== '', `pt-BR not empty: ${en}`);
  check(typeof es === 'string' && es.trim() !== '', `es not empty: ${en}`);
  check(!seen.has(en), `no duplicate English entry: ${en}`);
  seen.add(en);
  // The same placeholders (digits, ids written as ALL_CAPS or config.json style) must survive.
  const nums = (t: string) => (t.match(/\d+/g) ?? []).join(',');
  for (const [lang, t] of [['pt-BR', pt], ['es', es]]) {
    // leading / trailing space must be kept: the code concatenates text nodes
    check(/^\s/.test(en) === /^\s/.test(t) && /\s$/.test(en) === /\s$/.test(t), `${lang} keeps edge spaces: ${JSON.stringify(en)}`);
    if (!/^(\d+)(m|h|d|w|mo|y)$/.test(en)) check(nums(en) === nums(t), `${lang} keeps numbers: ${en}`);
    for (const word of en.match(/\b[A-Z_]{4,}\b|\b[\w.-]+\.(json|psobank)\b/g) ?? []) {
      check(t.includes(word), `${lang} keeps token ${word}: ${en}`);
    }
  }
}
eq(LANGS.map((l: { code: string }) => l.code), ['en', 'pt-BR', 'es'], 'languages');

// ---- patterns ---------------------------------------------------------------------------

for (const [src, pt, es] of PATTERNS as string[][]) {
  const groups = new RegExp(`${src}|`).exec('')!.length - 1;
  for (const [lang, t] of [['pt-BR', pt], ['es', es]]) {
    check(t.trim() !== '', `pattern ${lang} not empty: ${src}`);
    const refs = [...t.matchAll(/\$t?(\d)/g)].map((m) => Number(m[1]));
    check(refs.every((r) => r >= 1 && r <= groups), `pattern ${lang} refs exist: ${src}`);
    for (let g = 1; g <= groups; g++) check(refs.includes(g), `pattern ${lang} uses group ${g}: ${src}`);
  }
}

const samples: Array<[string, string, string, string]> = [
  ['Quests (12)', 'Quests (12)', 'Missões (12)', 'Misiones (12)'],
  ['Accounts (3)', '', 'Contas (3)', 'Cuentas (3)'],
  ['Characters of alice', '', 'Personagens de alice', 'Personajes de alice'],
  ['New password for 0000ABCD', '', 'Nova senha para 0000ABCD', 'Nueva contraseña para 0000ABCD'],
  ['Ban 0000ABCD', '', 'Banir 0000ABCD', 'Banear 0000ABCD'],
  ['Account 0000ABCD (bob, eve) will be banned for 1d.', '', 'A conta 0000ABCD (bob, eve) será banida por 1 dia.', 'La cuenta 0000ABCD (bob, eve) será baneada por 1 día.'],
  ['Account 0000ABCD (no BB license) will be banned for permanent.', '', 'A conta 0000ABCD (sem licença BB) será banida por permanente.', 'La cuenta 0000ABCD (sin licencia BB) será baneada por permanente.'],
  ['Account 0000ABCD will get: no flags.', '', 'A conta 0000ABCD receberá: nenhuma flag.', 'La cuenta 0000ABCD recibirá: ninguna flag.'],
  ['Account 0000ABCD will get: MODERATOR, ROOT.', '', 'A conta 0000ABCD receberá: MODERATOR, ROOT.', 'La cuenta 0000ABCD recibirá: MODERATOR, ROOT.'],
  ['Disconnect account 0000ABCD. They can reconnect (this is not a ban).', '', 'Desconectar conta 0000ABCD. O jogador pode se reconectar (isto não é um banimento).', 'Desconectar a cuenta 0000ABCD. Puede volver a conectarse (esto no es un baneo).'],
  ['banned until 2026-10-20 12:00', '', 'banido até 2026-10-20 12:00', 'baneado hasta 2026-10-20 12:00'],
  ['Saved: 2 change(s)', '', 'Salvo: 2 alteração(ões)', 'Guardado: 2 cambio(s)'],
  ['Inventory (4/30)', '', 'Inventário (4/30)', 'Inventario (4/30)'],
  ['Edit slot 2 bank', '', 'Editar banco do slot 2', 'Editar banco de la ranura 2'],
  ['Bank (shared)', '', 'Banco (compartilhado)', 'Banco (compartido)'],
  ['Hunter - slot 1', '', 'Hunter - slot 1', 'Hunter - ranura 1'],
  ['(unnamed) - slot 1', '', '(sem nome) - slot 1', '(sin nombre) - ranura 1'],
  ['wrong username or password', '', 'usuário ou senha incorretos', 'usuario o contraseña incorrectos'],
  ['too many failed logins; try again later', '', 'muitas tentativas de login falhas; tente novamente mais tarde', 'demasiados intentos de inicio de sesión fallidos; vuelve a intentarlo más tarde'],
  ['newserv answered 502', '', 'newserv respondeu 502', 'newserv respondió 502'],
  ['level must be an integer from 1 to 200', '', 'level deve ser um inteiro de 1 a 200', 'level debe ser un entero de 1 a 200'],
  ['drop_rate must be a number from 0 to 4', '', 'drop_rate deve ser um número de 0 a 4', 'drop_rate debe ser un número de 0 a 4'],
  ['Online', '', 'Conectados', 'En línea'],
  ['Audit log', '', 'Registro de auditoria', 'Registro de auditoría'],
  ['Ban', '', 'Banir', 'Banear'],
  ['Unban', '', 'Desbanir', 'Desbanear'],
  ['Kick', '', 'Expulsar', 'Expulsar'],
];
for (const [en, , pt, es] of samples) {
  eq(trIn('pt-BR', en), pt, `pt-BR sample: ${en}`);
  eq(trIn('es', en), es, `es sample: ${en}`);
  eq(trIn('en', en), en, `en passthrough: ${en}`);
}

// ---- fallback ---------------------------------------------------------------------------

for (const lang of nonEn) {
  eq(trIn(lang, 'A brand new sentence nobody translated'), 'A brand new sentence nobody translated', `${lang} falls back to English`);
  eq(trIn(lang, ''), '', `${lang} empty string`);
  eq(trIn(lang, '0000ABCD'), '0000ABCD', `${lang} account ids are untouched`);
  eq(trIn(lang, 'rare_drop_multiplier'), 'rare_drop_multiplier', `${lang} config keys are untouched`);
  eq(trIn(lang, 'account 0000ABCD').startsWith('account'), false, `${lang} account label is translated (token is protected by the mono class in h())`);
}
eq(trIn('pt-BR', 12 as unknown as string), 12, 'non-string passes through');
eq(trIn('xx', 'Accounts'), 'Accounts', 'unknown language passes through');

// ---- language selection -------------------------------------------------------------------

eq(pickLang(null, 'pt-BR'), 'pt-BR', 'navigator pt-BR');
eq(pickLang(null, 'pt-PT'), 'pt-BR', 'navigator pt-PT -> pt-BR');
eq(pickLang(null, 'pt'), 'pt-BR', 'navigator pt');
eq(pickLang(null, 'es-MX'), 'es', 'navigator es-MX');
eq(pickLang(null, 'ES'), 'es', 'navigator ES');
eq(pickLang(null, 'en-US'), 'en', 'navigator en-US');
eq(pickLang(null, 'fr-FR'), 'en', 'navigator fr -> en');
eq(pickLang(null, undefined), 'en', 'no navigator -> en');
eq(pickLang('es', 'pt-BR'), 'es', 'saved choice beats navigator');
eq(pickLang('klingon', 'pt-BR'), 'pt-BR', 'invalid saved value ignored');

eq(getLang(), 'en', 'default in Node (no navigator language) is en');
check(setLang('pt-BR') === true && getLang() === 'pt-BR', 'setLang pt-BR');
eq(tr('Accounts'), 'Contas', 'tr uses the current language');
check(setLang('es') === true, 'setLang es');
eq(tr('Accounts'), 'Cuentas', 'tr es');
check(setLang('de') === false && getLang() === 'es', 'setLang rejects unknown codes');
setLang('en');
eq(tr('Accounts'), 'Accounts', 'tr en');

// ---- coverage report (not a failure) --------------------------------------------------------

function literals(file: string, onlyMessages: boolean): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  // admin.mjs also has regex literals and shell code: only the messages thrown to the client count.
  const re = onlyMessages
    ? /(?:HttpError\([^,]+,|need\([^,]+,|CharError\(|note: )\s*(?:'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g
    : /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const m of src.matchAll(re)) {
    const t = (m[1] ?? m[2]).replace(/\\(['`\\])/g, '$1').replace(/\\n/g, '\n');
    out.push(m[2] !== undefined ? t.replace(/\$\{[^}]*\}/g, '1') : t);
  }
  return out;
}
function looksLikeText(t: string): boolean {
  if (!/[A-Za-z]{3}/.test(t)) return false;
  if (/^[a-z0-9_./:#\-[\]=,&?%]+$/i.test(t) && !/\s/.test(t) && !/^[A-Z][a-z]/.test(t)) return false; // identifiers, paths, classes
  if (/^(application|text)\//.test(t) || /^[a-z]+(-[a-z]+)*$/.test(t)) return false;
  if (/[{}<>]/.test(t) && !/\s/.test(t)) return false;
  return /^[A-Z(]/.test(t) || /\s/.test(t);
}
const known = new Set((DICT as string[][]).map((e) => e[0]));
const covered = (t: string): boolean => known.has(t) || trIn('pt-BR', t) !== t;

for (const [label, file, msgs] of [['admin.js', 'bridge/admin-ui/admin.js', false], ['admin.mjs messages', 'bridge/admin.mjs', true]] as const) {
  const all = [...new Set(literals(file, msgs).filter(looksLikeText))];
  const missing = all.filter((t) => !covered(t));
  console.log(`i18n coverage ${label}: ${all.length - missing.length}/${all.length} candidate literals have an entry`);
  if (missing.length) console.log(`  without entry (report only):\n${missing.map((t) => `    ${JSON.stringify(t)}`).join('\n')}`);
}
console.log(`dictionary: ${DICT.length} exact entries, ${PATTERNS.length} patterns`);

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
process.exit(0);

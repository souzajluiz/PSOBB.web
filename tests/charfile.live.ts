// Logs in, downloads the stream file (ItemPMT.prs), enters the lobby and prints
// the character file from E7 with item names.
// Requires newserv + bridge running. Run: node web/tests/charfile.live.ts [user] [password] [slot]
// Item names need a unitxt that matches the server's ItemPMT: the client's
// (PSOBB_DATA) is tried first, then newserv's bb-v4 text set.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseItemPMT } from '../client/src/formats/itempmt.ts';
import { ItemNames, magStats } from '../client/src/formats/itemnames.ts';
import { parseUnitxt } from '../client/src/classic/charcreate_text.ts';
import { BBSession, CLASS_NAMES, SECTION_IDS } from '../client/src/net/bbsession.ts';
import { E7_SIZE } from '../client/src/net/charfile.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
const [user = 'webtest', password = 'webtest', slotArg = '0'] = process.argv.slice(2);
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};
const timeout = <T>(p: Promise<T>, ms = 8000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

const session = new BBSession({ nsk, connect: nodeBridge });
await timeout(session.login(user, password));
const slots = await timeout(session.characterPreviews());
const slot = Number(slotArg);
check(`slot ${slot + 1} has a character`, !!slots[slot]);

const stream = await timeout(session.streamFiles());
const pmtFile = stream.get('ItemPMT.prs');
check(`stream file has ItemPMT.prs (${[...stream.keys()].join(', ')})`, !!pmtFile);
const pmt = parseItemPMT(pmtFile!);
check(`ItemPMT: ${pmt.weapons.length} weapon classes, ${pmt.tools.length} tool classes`, pmt.weapons.length > 0);

// Text table candidates, client first.
const candidates: Array<[string, () => Uint8Array]> = [];
const gslPath = join(DATA, 'data.gsl');
const gsl = existsSync(gslPath) ? new GSLArchive(new Uint8Array(readFileSync(gslPath))) : null;
for (const name of ['unitxt_e.prs', 'unitxt_j.prs']) {
  if (existsSync(join(DATA, name))) candidates.push([`client ${name}`, () => new Uint8Array(readFileSync(join(DATA, name)))]);
  else if (gsl?.has(name)) candidates.push([`client data.gsl:${name}`, () => gsl.get(name)]);
}
const nsText = join(ROOT, 'vendor/newserv/system/text-sets/bb-v4/unitxt_e.prs');
if (existsSync(nsText)) candidates.push(['newserv bb-v4 unitxt_e.prs', () => new Uint8Array(readFileSync(nsText))]);
let names = new ItemNames(pmt, null);
for (const [label, load] of candidates) {
  const text = parseUnitxt(load());
  const ok = ItemNames.textMatches(pmt, text);
  console.log(`text table ${label}: ${ok ? 'matches' : 'does not match'} the server ItemPMT`);
  if (ok) {
    names = new ItemNames(pmt, text);
    break;
  }
}

await timeout(session.enterLobby(user, password, slot));
const c = session.character;
check('E7 character file received', !!c);
if (c) {
  console.log(`\n${c.name} · Lv ${c.level} ${CLASS_NAMES[c.charClass]} · ${SECTION_IDS[c.sectionId]} · GC ${c.guildCardNumber}`);
  console.log(`EXP ${c.exp} · Meseta ${c.meseta} · bank ${c.bank.meseta} meseta, ${c.bank.items.length} items · played ${Math.round(c.playTimeSeconds / 60)} min`);
  const s = c.stats;
  console.log(`ATP ${s.atp} MST ${s.mst} EVP ${s.evp} HP ${s.hp} DFP ${s.dfp} ATA ${s.ata} LCK ${s.lck}`);
  const techs = c.techLevels.map((l, t) => (l ? `${names.techName(t)} ${l}` : '')).filter(Boolean);
  console.log(`Techniques: ${techs.join(', ') || '-'}`);
  console.log(`Inventory (${c.inventory.length}):`);
  for (const it of c.inventory) {
    const hex = [...it.data.data1].map((b) => b.toString(16).padStart(2, '0')).join('');
    console.log(`  ${it.equipped ? 'E' : ' '} ${names.describe(it.data).padEnd(44)} ${hex} id=${it.data.id.toString(16)}`);
    if (it.data.data1[0] === 2 && it.equipped) console.log(`      mag: ${JSON.stringify(magStats(it.data))}`);
  }
  for (const b of c.bank.items) console.log(`  bank: ${names.describe(b.data)}`);
  check(`E7 size constant ${E7_SIZE.toString(16)}`, true);
  check('inventory items all have names', c.inventory.every((it) => !names.describe(it.data).includes('!ID')));
}
session.close();
process.exit(failures ? 1 : 0);

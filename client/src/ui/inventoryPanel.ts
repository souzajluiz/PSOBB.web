// "Inventory" panel of the Online tab: the character file from E7 (stats,
// meseta, inventory with equipped markers, bank) with item names built from
// ItemPMT + unitxt.
//
// ItemPMT comes from the server's stream file (01EB/02EB), which is how the BB
// client gets it, unless the data folder has a loose ItemPMT.prs. The names
// need a unitxt from the same build as that ItemPMT (the client indexes the
// text table with the PMT ids): the client's unitxt_e/unitxt_j are tried first,
// then, on the dev server, newserv's bb-v4 text set (/newserv-text/).

import { parseUnitxt } from '../classic/charcreate_text.ts';
import { ClientFiles } from '../data/clientfiles.ts';
import type { DataSource } from '../data/source.ts';
import { parseItemPMT } from '../formats/itempmt.ts';
import { ItemNames } from '../formats/itemnames.ts';
import { CLASS_NAMES, SECTION_IDS, type BBSession } from '../net/bbsession.ts';
import type { CharacterFile } from '../net/charfile.ts';

export interface InventoryPanel {
  // Call on the data-server connection (after login, before enterLobby).
  prepare(session: BBSession, source: DataSource): Promise<void>;
  show(character: CharacterFile | null): void;
  hide(): void;
}

async function loadText(files: ClientFiles, matches: (t: string[][]) => boolean, log: (m: string) => void) {
  for (const name of ['unitxt_e.prs', 'unitxt_j.prs']) {
    if (!(await files.has(name))) continue;
    const text = parseUnitxt(await files.read(name));
    if (matches(text)) return { text, label: `client ${name}` };
    log(`items: client ${name} does not match the server's ItemPMT`);
  }
  try {
    const res = await fetch('/newserv-text/unitxt_e.prs');
    if (res.ok) {
      const text = parseUnitxt(new Uint8Array(await res.arrayBuffer()));
      if (matches(text)) return { text, label: "newserv's bb-v4 unitxt_e.prs" };
    }
  } catch {
    // not on the dev server
  }
  return null;
}

export function initInventoryPanel(after: HTMLElement, log: (msg: string) => void): InventoryPanel {
  const panel = document.createElement('section');
  panel.className = 'panel inventory-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <h2>Inventory <small class="inv-char"></small></h2>
    <div class="inv-layout">
      <div>
        <dl class="inv-stats"></dl>
        <p class="inv-note hint"></p>
      </div>
      <div>
        <h3>Items <small class="inv-count"></small></h3>
        <ol class="inv-items"></ol>
        <h3>Bank <small class="inv-bank-count"></small></h3>
        <ol class="inv-items inv-bank"></ol>
      </div>
    </div>`;
  after.after(panel);
  const q = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
  let names: ItemNames | null = null;
  let note = '';

  return {
    async prepare(session, source) {
      names = null;
      note = '';
      try {
        const files = new ClientFiles(source);
        let pmtFile: Uint8Array | undefined;
        if (await files.has('ItemPMT.prs')) {
          pmtFile = await files.read('ItemPMT.prs');
          note = 'ItemPMT: client data folder';
        } else {
          pmtFile = (await session.streamFiles()).get('ItemPMT.prs');
          note = "ItemPMT: server stream file";
        }
        if (!pmtFile) throw new Error('no ItemPMT.prs');
        const pmt = parseItemPMT(pmtFile);
        const text = await loadText(files, (t) => ItemNames.textMatches(pmt, t), log);
        names = new ItemNames(pmt, text?.text ?? null);
        note += text ? ` · names: ${text.label}` : ' · no matching text table, names are item codes';
        log(`items: ${note}`);
      } catch (err) {
        note = `item tables unavailable: ${err instanceof Error ? err.message : String(err)}`;
        log(`items: ${note}`);
      }
    },

    show(c) {
      panel.hidden = !c;
      if (!c) return;
      q('.inv-char').textContent = `· ${c.name}, Lv ${c.level} ${CLASS_NAMES[c.charClass] ?? ''} · ${SECTION_IDS[c.sectionId] ?? ''}`;
      const s = c.stats;
      const rows: Array<[string, string | number]> = [
        ['Level', c.level],
        ['EXP', c.exp],
        ['Meseta', c.meseta],
        ['HP', s.hp],
        ['ATP', s.atp],
        ['DFP', s.dfp],
        ['MST', s.mst],
        ['ATA', s.ata],
        ['EVP', s.evp],
        ['LCK', s.lck],
        ['Play time', `${Math.floor(c.playTimeSeconds / 3600)}h ${String(Math.floor(c.playTimeSeconds / 60) % 60).padStart(2, '0')}m`],
      ];
      const techs = c.techLevels.map((l, t) => (l ? `${names?.techName(t) ?? t} ${l}` : '')).filter(Boolean);
      if (techs.length) rows.push(['Techniques', techs.join(', ')]);
      q('.inv-stats').replaceChildren(
        ...rows.flatMap(([k, v]) => {
          const dt = document.createElement('dt');
          dt.textContent = k;
          const dd = document.createElement('dd');
          dd.textContent = String(v);
          return [dt, dd];
        }),
      );
      const describe = (d: CharacterFile['inventory'][number]['data']) =>
        names ? names.describe(d) : [...d.data1].map((b) => b.toString(16).padStart(2, '0')).join('');
      q('.inv-count').textContent = `${c.inventory.length}/30`;
      q('.inv-items').replaceChildren(
        ...c.inventory.map((it) => {
          const li = document.createElement('li');
          if (it.equipped) li.className = 'equipped';
          if (names?.isRare(it.data)) li.classList.add('rare');
          const mark = document.createElement('span');
          mark.className = 'mark';
          mark.textContent = it.equipped ? 'E' : '';
          mark.title = it.equipped ? 'Equipped' : '';
          li.append(mark, describe(it.data));
          return li;
        }),
      );
      q('.inv-bank-count').textContent = `${c.bank.items.length}/200 · ${c.bank.meseta} meseta`;
      q('.inv-bank').replaceChildren(
        ...c.bank.items.map((b) => {
          const li = document.createElement('li');
          li.textContent = describe(b.data);
          return li;
        }),
      );
      q('.inv-note').textContent = note;
    },

    hide() {
      panel.hidden = true;
    },
  };
}

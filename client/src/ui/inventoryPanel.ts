// "Inventory" panel of the Online tab: the character file from E7 (stats,
// meseta, inventory with equipped markers, bank) with item names built from
// ItemPMT + unitxt.
//
// ItemPMT comes from the server's stream file (01EB/02EB), which is how the BB
// client gets it, unless the data folder has a loose ItemPMT.prs. The names
// need a unitxt from the same build as that ItemPMT (the client indexes the
// text table with the PMT ids): the client's unitxt_e/unitxt_j are tried first,
// then, on the dev server, newserv's bb-v4 text set (/newserv-text/).
//
// In a game the panel gets item actions (net/items.ts GameItems through
// setActions): Equip / Unequip (6x25 / 6x26), Use (6x27), Drop (6x2A, or
// 6xC3 for one item of a stack and for meseta). The rows follow the local
// inventory, which GameItems updates as the server answers.

import { parseUnitxt } from '../classic/charcreate_text.ts';
import { ClientFiles } from '../data/clientfiles.ts';
import type { DataSource } from '../data/source.ts';
import { parseItemPMT } from '../formats/itempmt.ts';
import { ItemNames } from '../formats/itemnames.ts';
import { CLASS_NAMES, SECTION_IDS, type BBSession } from '../net/bbsession.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { stackSize } from '../net/items.ts';
import { displayedStats, wornEquipment } from '../combat/playerstats.ts';
import { liveBeatTime } from '../combat/beattime.ts';

export interface InventoryActions {
  equip(itemId: number): void;
  unequip(itemId: number): void;
  use(itemId: number): void;
  canUse(item: InventoryItem): boolean;
  canEquip(item: InventoryItem): boolean;
  drop(itemId: number, amount?: number): void;
  dropMeseta(amount: number): void;
}

export interface InventoryPanel {
  // Call on the data-server connection (after login, before enterLobby).
  prepare(session: BBSession, source: DataSource): Promise<void>;
  show(character: CharacterFile | null): void;
  hide(): void;
  // Item names (ItemPMT + text) once prepare() has run.
  readonly names: ItemNames | null;
  // Buttons for each item while in a game; null removes them.
  setActions(actions: InventoryActions | null): void;
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
  let actions: InventoryActions | null = null;
  let last: CharacterFile | null = null;
  const button = (label: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'inv-act';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };

  return {
    get names() {
      return names;
    },

    setActions(a) {
      actions = a;
      if (last) this.show(last);
    },

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
      last = c;
      panel.hidden = !c;
      if (!c) return;
      q('.inv-char').textContent = `· ${c.name}, Lv ${c.level} ${CLASS_NAMES[c.charClass] ?? ''} · ${SECTION_IDS[c.sectionId] ?? ''}`;
      // The file's stats are the stat block (the save, combat/playerstats.ts); the panel shows the
      // displayed totals (UpdatePlayerDisplayStats): ATP = saved + class / weapon range max, EVP / DFP
      // with the worn resist, ATA blended. HP and LCK are the file's (LCK has no range part).
      const file = c.stats;
      const pmt = names?.pmt;
      const s = pmt
        ? displayedStats(
            { atp: file.atp, dfp: file.dfp, mst: file.mst, ata: file.ata, evp: file.evp, lck: file.lck },
            wornEquipment(c.inventory.filter((it) => it.equipped).map((it) => it.data)),
            c.charClass,
            pmt,
            liveBeatTime(),
          )
        : file;
      const rows: Array<[string, string | number]> = [
        ['Level', c.level],
        ['EXP', c.exp],
        ['Meseta', c.meseta],
        ['HP', file.hp],
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
          if (actions) {
            const a = actions;
            const id = it.data.id;
            if (a.canEquip(it)) li.append(it.equipped ? button('Unequip', 'Unequip (6x26)', () => a.unequip(id)) : button('Equip', 'Equip (6x25)', () => a.equip(id)));
            if (a.canUse(it)) li.append(button('Use', 'Use (6x27)', () => a.use(id)));
            if (stackSize(it.data) > 1) li.append(button('Drop 1', 'Drop one of the stack (6xC3)', () => a.drop(id, 1)));
            li.append(button('Drop', 'Drop on the floor (6x2A)', () => a.drop(id)));
          }
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
      if (actions && c.meseta > 0) {
        const a = actions;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = String(c.meseta);
        input.value = String(Math.min(10, c.meseta));
        input.className = 'inv-meseta';
        input.setAttribute('aria-label', 'Meseta to drop');
        const row = document.createElement('p');
        row.className = 'inv-meseta-row';
        row.append(input, button('Drop meseta', 'Drop meseta on the floor (6xC3)', () => a.dropMeseta(Math.floor(Number(input.value)))));
        q('.inv-note').append(row);
      }
    },

    hide() {
      panel.hidden = true;
    },
  };
}

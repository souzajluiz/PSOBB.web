// The Pioneer 2 Medical Center (classic/shop.ts MedicalCounter, bb_p2_menu 1)
// and its commands (net/items.ts useMedicalCenter): the fee, what needs
// treatment (combat/status.ts medicalNeeds), the key-driven flows of the
// state machine at 0x006ce9a4 (healthy, refuse, treat, not enough meseta,
// Backspace), the 6x31 / 6x32 / 6xC5 bytes and the party HP on a remote 6x31.
// Run: node tests/medical.test.ts
import { COUNTER_MENUS, createCounter, MEDICAL, MedicalCounter, MSG, type CounterEnv, type CounterItems } from '../client/src/classic/shop.ts';
import type { RowContext } from '../client/src/classic/itempack.ts';
import { PartyHp } from '../client/src/combat/partyhp.ts';
import { MEDICAL_NEED, medicalNeeds, type MedicalPlayer } from '../client/src/combat/status.ts';
import type { CharacterFile } from '../client/src/net/charfile.ts';
import type { Game } from '../client/src/net/game.ts';
import { GameItems, MEDICAL_COST } from '../client/src/net/items.ts';
import { Lobby } from '../client/src/net/lobby.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// --- table, fee, lines ---
eq(COUNTER_MENUS[1], 'medical', 'bb_p2_menu 1 is the Medical Center');
eq(MEDICAL_COST, 10, 'fee: the immediates at 0x006ceacb / 0x006ceb1a, no level dependency');
eq([MEDICAL.welcome, MEDICAL.cost, MEDICAL.fine, MEDICAL.goodLuck, MEDICAL.careful, MEDICAL.notEnoughMeseta], [0x1f, 0x20, 0x21, 0x22, 0x24, 0x0f], 'unitxt_shop group 0 lines');

// --- SinowberillChallengePlayer_GetStatusFlags_0068bfe0 ---
const healthy: MedicalPlayer = { hp: 300, maxHp: 300, tp: 50, maxTp: 50, statusFlags: 0, attackBuff: 0, defenseBuff: 0 };
eq(medicalNeeds(healthy), 0, 'full HP / TP, no status: nothing');
eq(medicalNeeds({ ...healthy, hp: 299 }), MEDICAL_NEED.hp, 'HP below max');
eq(medicalNeeds({ ...healthy, tp: 0 }), MEDICAL_NEED.tp, 'TP below max');
eq(medicalNeeds({ ...healthy, statusFlags: 0x20 }), MEDICAL_NEED.status, 'frozen (flags & 0x3f)');
eq(medicalNeeds({ ...healthy, statusFlags: 0x40 }), 0, 'flag 0x40 is not a status');
eq(medicalNeeds({ ...healthy, attackBuff: 0x0b }), MEDICAL_NEED.status, 'Jellen (+0x274 == 0xb)');
eq(medicalNeeds({ ...healthy, defenseBuff: 0x0c }), MEDICAL_NEED.status, 'Zalure (+0x280 == 0xc)');
eq(medicalNeeds({ ...healthy, attackBuff: 0x09, defenseBuff: 0x0a }), 0, 'Shifta / Deband need nothing');
eq(medicalNeeds({ ...healthy, hp: 1, tp: 1, statusFlags: 1 }), 7, 'all three bits');

// --- counter flows ---
const tick = async (c: { tick(): void }, n = 200) => {
  for (let i = 0; i < n; i++) c.tick();
  await new Promise((r) => setTimeout(r, 0));
};
const press = async (c: { key(e: KeyboardEvent): void; tick(): void }, ...keys: string[]) => {
  for (const key of keys) {
    await tick(c);
    c.key({ key } as KeyboardEvent);
    await tick(c, 1);
  }
};

function run(meseta: number, needs: number) {
  const calls: string[] = [];
  const character = { meseta, inventory: [] } as unknown as CharacterFile;
  const items = {
    shops: [],
    bank: null,
    medicalNeeds: () => needs,
    useMedicalCenter: () => {
      calls.push('treat');
      character.meseta -= MEDICAL_COST;
    },
  } as unknown as CounterItems;
  const ctx = { names: null, charClass: 0, level: 1, stats: { atp: 0, mst: 0, ata: 0 }, lobby: false } as RowContext;
  const env: CounterEnv = {
    shopText: (i, g = 0) => `${g}#${i.toString(16)}`,
    text: () => '',
    character: () => character,
    rowContext: () => ctx,
    pmt: () => null,
    items,
  };
  const c = createCounter(env, 'medical');
  const out = { c, calls, character, closed: false };
  c.onClose = () => (out.closed = true);
  c.start();
  return out;
}

{
  // Nothing to treat: [0x21], Enter, [0x22], Enter closes.
  const r = run(500, 0);
  eq(r.c instanceof MedicalCounter, true, 'createCounter("medical")');
  await tick(r.c);
  eq([r.c.state().message, r.c.state().choice], ['0#1f', null], 'state 1: welcome, no choice yet');
  await press(r.c, 'Enter');
  eq([r.c.state().message, r.c.state().choice], ['0#21', null], 'state 6: completely fine');
  await press(r.c, 'Enter');
  eq(r.c.state().message, '0#22', 'state 8: good luck');
  eq(r.closed, false, 'still open on [0x22]');
  await press(r.c, 'Enter');
  await tick(r.c);
  eq([r.closed, r.calls], [true, []], 'state 10: Enter closes, nothing done');
}

{
  // Treatment: [0x20] with Yes / No, Yes pays and treats, [0x22], close.
  const r = run(500, MEDICAL_NEED.hp);
  await press(r.c, 'Enter');
  eq([r.c.state().message, r.c.state().choice], ['0#20', [`0#${MSG.yes}`, `0#${MSG.no}`]], 'state 7: the cost and Yes / No');
  await press(r.c, 'Enter');
  eq([r.calls, r.character.meseta, r.c.state().message, r.c.state().choice], [['treat'], 490, '0#22', null], 'state 4: treated, 10 meseta, good luck');
  await press(r.c, 'Backspace');
  await tick(r.c);
  eq(r.closed, true, 'state 10 closes on Backspace too (0x006dc8fc)');
}

{
  // Refused: No -> [0x24], Enter -> [0x22], Enter closes.
  const r = run(500, MEDICAL_NEED.status);
  await press(r.c, 'Enter', 'ArrowDown', 'Enter');
  eq([r.c.state().message, r.calls], ['0#24', []], 'state 5: be careful');
  await press(r.c, 'Backspace');
  eq(r.c.state().message, '0#24', 'state 8 waits for Enter only (0x006dc988)');
  await press(r.c, 'Enter');
  eq(r.c.state().message, '0#22', 'then good luck');
  await press(r.c, 'Enter');
  await tick(r.c);
  eq(r.closed, true, 'closed');
}

{
  // Backspace on Yes / No is No.
  const r = run(500, MEDICAL_NEED.tp);
  await press(r.c, 'Enter', 'Backspace');
  eq([r.c.state().message, r.calls], ['0#24', []], 'Backspace -> state 5');
}

{
  // Not enough meseta: [0x0f], then the close (no [0x22]).
  const r = run(9, MEDICAL_NEED.hp);
  await press(r.c, 'Enter', 'Enter');
  eq([r.c.state().message, r.calls, r.character.meseta], ['0#f', [], 9], 'state 4 with 9 meseta: not enough');
  await press(r.c, 'Enter');
  await tick(r.c);
  eq(r.closed, true, 'closed after [0x0f]');
}

// --- GameItems: 6x31, the local treatment, 6x32, the fee, 6xC5 ---
{
  const sent: string[] = [];
  const order: string[] = [];
  const game = {
    on: () => {},
    conn: {
      onCommand: () => {},
      send: (cmd: number, flag: number, body: Uint8Array) => {
        sent.push(`${cmd.toString(16)} ${flag} ${hex(body)}`);
        order.push(`6x${body[0].toString(16)}`);
      },
    },
    info: null,
    players: new Map(),
    selfId: 2,
    active: true,
    sendSubcommand: Lobby.prototype.sendSubcommand,
  } as unknown as Game;
  const ch = { meseta: 25, inventory: [], techLevels: [], stats: {}, charClass: 0, sectionId: 0 } as unknown as CharacterFile;
  const items = new GameItems(game, { character: () => ch, fullCharacter: () => null } as never);
  let needs = MEDICAL_NEED.hp | MEDICAL_NEED.status;
  items.medicalNeedsOf = () => needs;
  items.onMedical = () => {
    order.push(`heal ${ch.meseta}`);
    needs = 0;
  };
  eq(items.medicalNeeds(), 5, 'medicalNeeds from the hook');
  items.useMedicalCenter();
  eq(sent, ['60 0 31010200', '60 0 32010200', '60 0 c5010200'], '6x31 / 6x32 / 6xC5 = {sub, 1, client id} through 60');
  eq(order, ['6x31', 'heal 25', '6x32', '6xc5'], '6x31 runs locally before 6x32; meseta paid before 6xC5');
  eq([ch.meseta, items.medicalNeeds()], [15, 0], '10 meseta taken, nothing left to treat');
  sent.length = 0;
  ch.meseta = 9;
  items.useMedicalCenter();
  eq([sent, ch.meseta], [[], 9], 'nothing sent under 10 meseta');
}

// --- a remote 6x31: the sender's HP back to max ---
{
  const party = new PartyHp();
  party.stats(1, { charClass: 0, level: 10, hpStat: 0, hpMaterials: 0 }, 5);
  const max = party.get(1)!.maxHp;
  eq(party.receive(0x31, new Uint8Array([0x31, 0x01, 0x01, 0x00])), true, '6x31 handled');
  eq(party.get(1)!.hp, max, 'party member at max HP');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('medical: all checks passed');

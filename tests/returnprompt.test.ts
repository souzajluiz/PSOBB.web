// The dead prompt (classic/returnprompt.ts): the question's layout at the exe's
// position, the cursor on No, Yes / No / Backspace, one answer per prompt, and
// the death path that opens it (combat/playerdamage.ts: the death fade ends in
// the revivable state, which sends 6x4E once and is what the prompt waits on).
// Run: node tests/returnprompt.test.ts
import { ReturnPrompt, RETURN_POS, RETURN_TEXT, RETURN_YES, RETURN_NO } from '../client/src/classic/returnprompt.ts';
import { PlayerDamage, DEATH_FADE_TICKS } from '../client/src/combat/playerdamage.ts';
import { wrapGameText } from '../client/src/classic/chat.ts';
import { pioneer2ReturnArrival } from '../client/src/net/telepipe.ts';
import { nearbyAtomizerList, NO_CLIENT, reviveRestore, reverserHp } from '../client/src/combat/buffs.ts';
import { parseRevivePlayer, parseStarAtomizer } from '../client/src/net/game.ts';
import { buildRevivePlayer, buildStarAtomizer, buildUseItem, GameItems } from '../client/src/net/items.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';

// A stub canvas for the text measure (gametext.ts): every glyph is 7 px wide.
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return new Proxy({}, { get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 7 }) : () => {}), set: () => true });
  }
};

let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL: ${what}`);
  }
};

// unitxt(11, 0x56) of the English set (newserv's usbb-resources/unitxt_e.prs).
const QUESTION = 'Do you wish to \nreturn to \nPioneer 2?';

// The index constants are the unitxt group 11 rows.
check(RETURN_TEXT === 0x56 && RETURN_YES === 0x6e && RETURN_NO === 0x6f, 'unitxt rows 11/0x56, 0x6e, 0x6f');
check(RETURN_POS.x === 17 && RETURN_POS.y === 306 && RETURN_POS.w === 206, 'position (17, 306) and width 206');

// The question wraps on its own newlines into three lines (the English text).
check(wrapGameText(QUESTION, RETURN_POS.w - 20).length === 3, 'the question is three lines');

{
  const answers: boolean[] = [];
  const p = new ReturnPrompt(QUESTION, 'YES', 'NO', (yes) => answers.push(yes));
  check(p.cursor === 1 && p.question.cursor === 1, 'the cursor starts on No');
  check(p.question.rect.x === 17 && p.question.rect.y === 306 && p.question.rect.w === 206, 'the window sits at the exe position');
  check(p.result === null, 'no answer yet');
  p.key({ key: 'Enter' });
  check(answers.length === 1 && answers[0] === false, 'Enter on No answers false');
  check(p.result === 'no', 'the result is no');
  p.key({ key: 'ArrowUp' });
  p.key({ key: 'Enter' });
  check(answers.length === 1, 'one answer per prompt');
}

{
  const answers: boolean[] = [];
  const p = new ReturnPrompt(QUESTION, 'YES', 'NO', (yes) => answers.push(yes));
  p.key({ key: 'ArrowUp' });
  check(p.cursor === 0, 'Up moves to Yes');
  p.key({ key: 'ArrowDown' });
  check(p.cursor === 1, 'Down moves back to No');
  p.key({ key: 'ArrowUp' });
  p.key({ key: 'Enter' });
  check(answers.length === 1 && answers[0] === true, 'Enter on Yes answers true');
  check(p.result === 'yes', 'the result is yes');
}

{
  const answers: boolean[] = [];
  const p = new ReturnPrompt(QUESTION, 'YES', 'NO', (yes) => answers.push(yes));
  p.key({ key: 'Backspace' });
  check(answers.length === 1 && answers[0] === false, 'Backspace is No');
  check(p.result === 'no', 'Backspace leaves the result as no');
}

{
  // The death path: a lethal hit goes through the flinch and the death motion,
  // then the 64-tick fade, and sends 6x4E once when the fade ends.
  const sent: string[] = [];
  const d = new PlayerDamage({
    motion: () => {},
    push: () => {},
    face: () => {},
    sendHit: () => sent.push('hit'),
    sendShieldAttack: () => sent.push('shield'),
    sendDeath: () => sent.push('death'),
    sendRevivable: () => sent.push('revivable'),
    sendRevived: () => sent.push('revived'),
    log: () => {},
  });
  d.reset(100, 100);
  d.hit(500, 0, 0);
  check(!d.dead && d.state === 'heavy', 'a lethal hit (over 25% of max HP) starts the heavy fall first');
  let ticks = 0;
  while (d.state !== 'revivable' && ticks < 1000) {
    d.tick();
    ticks++;
  }
  check(d.state === 'revivable', 'the fade ends in the revivable state');
  check(d.dead, 'revivable counts as dead');
  check(ticks >= DEATH_FADE_TICKS, 'the fade lasts DEATH_FADE_TICKS after the death motion');
  check(sent.filter((s) => s === 'revivable').length === 1 && sent.filter((s) => s === 'death').length === 1, 'one 6x89 / 6x4D and one 6x4E');
  d.tick();
  d.tick();
  check(sent.filter((s) => s === 'revivable').length === 1, 'no second 6x4E');
  // Returning to Pioneer 2 refills HP (combat/playerdamage reset, as enterFloor does).
  d.reset(100);
  check(!d.dead && d.hp === 100 && d.fade === 0, 'a reset after the return is alive at full HP');
}

{
  // The Yes spot: the Medical Center position of the player's client id and episode
  // (SetPlayerRespawnState_006986ec), not DAT_0097df90 (214, 0, -236), which is for
  // the state-3 players. Episode 4 uses the Episode 1 values; angle is the P2 facing.
  const a = pioneer2ReturnArrival(0, 1);
  check(a.x === 213 && a.y === 3 && a.z === -280, 'Episode 1, client 0: the Medical Center spot (213, 3, -280)');
  const b = pioneer2ReturnArrival(3, 1);
  check(b.x === 225 && b.z === -280, 'Episode 1, client 3: (225, 3, -280)');
  const c = pioneer2ReturnArrival(1, 2);
  check(c.x === 5 && c.y === 0 && c.z === -185, 'Episode 2, client 1: (5, 0, -185)');
  const d4 = pioneer2ReturnArrival(2, 3);
  check(d4.x === 219 && d4.y === 3 && d4.z === -280, 'Episode 4 (wire 3) uses the Episode 1 table');
  check(a.angle === 0x4000, 'the arrival facing is the P2 arrival angle (ASSUMED)');
  check(!(a.x === 214 && a.z === -236), 'the arrival is not DAT_0097df90');
}

{
  // The revive rule (PlayerRestoreHealthAndTP_0068fddc): a field (unsafe, no quest)
  // is max HP / 2 with TP kept; a quest or a safe map is full HP and TP.
  const field = reviveRestore(100, 80, { quest: false, unsafe: true });
  check(field.hp === 50 && field.tp === null, 'a Reverser on a field: half HP, TP kept');
  check(reverserHp(1) === 1, 'half HP is at least 1');
  const quest = reviveRestore(100, 80, { quest: true, unsafe: true });
  check(quest.hp === 100 && quest.tp === 80, 'a Reverser in a quest: full HP and TP');
  const safe = reviveRestore(100, 80, { quest: false, unsafe: false });
  check(safe.hp === 100 && safe.tp === 80, 'a Reverser on a safe map: full HP and TP');
}

{
  // The Moon Atomizer's 6x33: the sender's client id at +2, the revived player at +4.
  const body = new Uint8Array([0x33, 0x02, 0x02, 0x00, 0x01, 0x00, 0x00, 0x00]);
  const r = parseRevivePlayer(body);
  check(r !== null && r.clientId === 2 && r.target === 1, '6x33: sender 2 revives client 1');
  check(parseRevivePlayer(new Uint8Array([0x33, 0x02, 0x02, 0x00])) === null, '6x33 shorter than 6 bytes is rejected');
  check(parseRevivePlayer(new Uint8Array([0x4f, 0x01, 0x02, 0x00, 0x01, 0x00])) === null, 'a 6x4F body is not a 6x33');
  // The revive state: one 6x4F, the HP set, no second revive while alive.
  const sent: string[] = [];
  const dmg = new PlayerDamage({
    motion: () => {},
    push: () => {},
    face: () => {},
    sendHit: () => {},
    sendShieldAttack: () => {},
    sendDeath: () => {},
    sendRevivable: () => {},
    sendRevived: () => sent.push('revived'),
    log: () => {},
  });
  dmg.reset(100, 100);
  dmg.hit(500, 0, 0);
  let n = 0;
  while (dmg.state !== 'revivable' && n < 1000) {
    dmg.tick();
    n++;
  }
  dmg.revive(50);
  check(dmg.state === 'reviving' && dmg.hp === 50 && !dmg.dead, 'the revive from the revivable state: alive at the given HP');
  check(sent.length === 1, 'the revive sends one 6x4F');
  dmg.revive(50);
  check(sent.length === 1, 'a second revive while alive sends nothing');
}

{
  // The Moon Atomizer's send side (tool 03 04 00; FUN_005deb74 -> FUN_0069a18c):
  // the 6x27 use, then the 6x33 {sender, target} to the nearest dead teammate.
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  check(hex(buildRevivePlayer(2, 1)) === '33 02 02 00 01 00 00 00', 'buildRevivePlayer: 6x33 bytes (sender +2, target +4)');
  const sent: Array<[number, string]> = [];
  const game = {
    on: () => {},
    conn: { onCommand: () => {}, send: () => {} },
    info: null,
    players: new Map(),
    selfId: 2,
    active: true,
    sendSubcommand: (sub: number, body: Uint8Array) => sent.push([sub, hex(body)]),
  } as never;
  const inv = (h: string, id: number): InventoryItem => ({ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { ...itemFromHex(h), id } });
  const atomizer = inv('03040000 00000000 00000000 00000000 00000000', 0x10);
  const ch = { meseta: 0, inventory: [atomizer], techLevels: [], stats: {}, charClass: 0, sectionId: 0 } as unknown as CharacterFile;
  const items = new GameItems(game, { character: () => ch, fullCharacter: () => null } as never);
  const none = { atomizerTarget: () => null };
  check(!items.canUse(atomizer, none), 'Moon Atomizer: no dead teammate in range, not usable');
  items.use(0x10, none);
  check(sent.length === 0 && ch.inventory.length === 1, 'no target: nothing sent, the item is not used up');
  const one = { atomizerTarget: () => 1 };
  check(items.canUse(atomizer, one), 'Moon Atomizer: a dead teammate in range, usable');
  items.use(0x10, one);
  check(sent.length === 2 && sent[0][0] === 0x27 && sent[1][0] === 0x33, 'use: 6x27 first, then 6x33');
  check(sent[1][1] === '01 00 00 00', 'use: the 6x33 body carries the target (packet +4)');
  check(hex(buildUseItem(2, 0x10)).startsWith('27 02 02 00'), '6x27 keeps its sender id');
  check(ch.inventory.length === 0, 'use: the Atomizer is used up');
}

{
  // The Star Atomizer (tool 03 05 00; the use FUN_005df314 -> FUN_005de664): the 6x66 on
  // record (4,10), 12 bytes, the caster at +4 and three others at +6..+10 (newserv G_UseStarAtomizer_6x66).
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  check(hex(buildStarAtomizer([2, 0, 1, 0xffff])) === '66 03 00 00 02 00 00 00 01 00 ff ff', 'buildStarAtomizer: 6x66 bytes (caster +4, targets +6..+10, 0xFFFF none)');
  const star = parseStarAtomizer(buildStarAtomizer([2, 0, 1, 0xffff]));
  check(star !== null && star.join(',') === '2,0,1,65535', 'parseStarAtomizer: the four client ids back');
  check(parseStarAtomizer(new Uint8Array(10).fill(0).map((_, i) => (i === 0 ? 0x66 : 0))) === null, 'parseStarAtomizer: shorter than 12 bytes is rejected');
  check(parseStarAtomizer(buildRevivePlayer(2, 1)) === null, 'parseStarAtomizer: a 6x33 is not a 6x66');
  // The send-side list: the caster, then the other client ids in range (client id order), 0xFFFF when absent or out of range.
  const at = (m: Record<number, { x: number; z: number }>) => (id: number) => m[id];
  check(nearbyAtomizerList(2, at({ 2: { x: 0, z: 0 }, 0: { x: 3, z: 4 }, 3: { x: 20, z: 0 } }), 10)?.join(',') === '2,0,65535,65535', 'nearby list: self first, client 0 in range (dist 5), 1 absent, 3 out of range');
  check(nearbyAtomizerList(2, at({ 0: { x: 0, z: 0 } }), 10) === null, 'nearby list: no position for the caster, no list');
  check(NO_CLIENT === 0xffff, 'NO_CLIENT is 0xFFFF');
  const sentStar: Array<[number, string]> = [];
  const echoStar: string[] = [];
  const gameStar = {
    on: () => {},
    conn: { onCommand: () => {}, send: () => {} },
    info: null,
    players: new Map(),
    selfId: 2,
    active: true,
    sendSubcommand: (sub: number, body: Uint8Array) => sentStar.push([sub, hex(body)]),
  } as never;
  const inv = (h: string, id: number): InventoryItem => ({ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { ...itemFromHex(h), id } });
  const starItem = inv('03050000 00000000 00000000 00000000 00000000', 0x11);
  const chStar = { meseta: 0, inventory: [starItem], techLevels: [], stats: {}, charClass: 0, sectionId: 0 } as unknown as CharacterFile;
  const itemsStar = new GameItems(gameStar, { character: () => chStar, fullCharacter: () => null } as never);
  const noRecord = { starTargets: () => null };
  check(itemsStar.canUse(starItem, noRecord), 'Star Atomizer: usable without a targeting record (no target check in the exe)');
  itemsStar.use(0x11, noRecord);
  check(sentStar.length === 1 && sentStar[0][0] === 0x27, 'Star Atomizer, no record: the 6x27 only (FUN_0068be94 has no check for subclass 5), no 6x66');
  check(chStar.inventory.length === 0, 'Star Atomizer, no record: used up');
  const starItem2 = inv('03050000 00000000 00000000 00000000 00000000', 0x13);
  chStar.inventory.push(starItem2);
  itemsStar.use(0x13, { starTargets: () => [2, 0, 1, 0xffff], atomizerEcho: (p: Uint8Array) => echoStar.push(hex(p)) });
  check(sentStar.length === 3 && sentStar[1][0] === 0x27 && sentStar[2][0] === 0x66, 'Star Atomizer: 6x27 first, then 6x66');
  check(sentStar[2][1] === '02 00 00 00 01 00 ff ff', 'Star Atomizer: the 6x66 body is the four ids (caster first)');
  check(echoStar.length === 1 && echoStar[0].startsWith('66 03'), 'Star Atomizer: the sender runs its own 6x66 (local echo)');
  check(chStar.inventory.length === 0, 'Star Atomizer: used up');
  // The Moon Atomizer's local echo: the 6x33 packet, once.
  const echoMoon: string[] = [];
  const sentMoon: Array<[number, string]> = [];
  const gameMoon = { ...(gameStar as object), sendSubcommand: (sub: number, body: Uint8Array) => sentMoon.push([sub, hex(body)]) } as never;
  const moon = inv('03040000 00000000 00000000 00000000 00000000', 0x12);
  const chMoon = { meseta: 0, inventory: [moon], techLevels: [], stats: {}, charClass: 0, sectionId: 0 } as unknown as CharacterFile;
  new GameItems(gameMoon, { character: () => chMoon, fullCharacter: () => null } as never).use(0x12, { atomizerTarget: () => 1, atomizerEcho: (p: Uint8Array) => echoMoon.push(hex(p)) });
  check(echoMoon.length === 1 && echoMoon[0] === '33 02 02 00 01 00 00 00', 'Moon Atomizer: the sender runs its own 6x33 (local echo, the 6x33 bytes)');
  check(sentMoon.length === 2 && sentMoon[1][0] === 0x33, 'Moon Atomizer: 6x27 then 6x33 still');
}

console.log(`${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ' ALL PASS'}`);
if (failures) process.exitCode = 1;

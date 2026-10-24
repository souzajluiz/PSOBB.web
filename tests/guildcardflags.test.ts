// g_GuildCardFlags as the quest timer window reads it: unknown_soccer_scoreboard_positioning
// (dump 734415) picks GUI 0x24 while (flags & 7) == 0 and GUI 0xb9 otherwise; the card list add
// (GuildCardList_AddOrMoveToFront_00827f58) sets bit 4, the 6x06 receive sets bit 2.
// Run: node tests/guildcardflags.test.ts
import { GuildCardClient, type CommandLink, type GuildCardSearchResult, type Packet } from '../client/src/net/guildcard.ts';
import { GCF_CARD_RECEIVED, GCF_ENTITY, GCF_LIST_ADD, GUI_POSITION, GuildCardFlagWord, guildCardFlags } from '../client/src/net/guildcardflags.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

// 1. The positioning rule (bits 1, 2, 4 only; the others do not move the timer).
{
  const f = new GuildCardFlagWord();
  check('flags 0: timer at GUI 0x24', f.positionGuiIndex() === 0x24);
  f.set(GCF_CARD_RECEIVED);
  check('bit 2 alone: GUI 0xb9', f.positionGuiIndex() === 0xb9);
  f.clear(GCF_CARD_RECEIVED);
  check('bit 2 cleared: back to 0x24', f.positionGuiIndex() === 0x24);
  f.set(GCF_ENTITY);
  check('bit 1 alone: GUI 0xb9', f.positionGuiIndex() === 0xb9);
  f.reset();
  f.set(0x8);
  f.set(0x10);
  f.set(0x80);
  check('bits 0x8 / 0x10 / 0x80 do not move the timer', f.positionGuiIndex() === 0x24);
  f.set(GCF_LIST_ADD);
  check('bit 4 alone: GUI 0xb9', f.positionGuiIndex() === 0xb9);
  check('value keeps the bits set', f.value === 0x8 + 0x10 + 0x80 + 0x4);
}

// 2. The two GUI points (0x00971f40, stride 8).
check('GUI 0x24 = (254, 37)', GUI_POSITION[0x24]?.x === 254 && GUI_POSITION[0x24]?.y === 37);
check('GUI 0xb9 = (366, 37)', GUI_POSITION[0xb9]?.x === 366 && GUI_POSITION[0xb9]?.y === 37);

// 3. A card list add sets bit 4 on the shared flag word (the exe's g_GuildCardFlags).
{
  guildCardFlags.reset();
  const link: CommandLink = { send: (_p: Packet) => {}, waitFor: () => new Promise(() => {}) } as unknown as CommandLink;
  const client = new GuildCardClient(link, 20);
  check('no list add: the shared word is 0', guildCardFlags.value === 0);
  const result = {
    searcher: 1,
    guildCardNumber: 42,
    address: 0,
    port: 0,
    location: '',
    reconnect: { flag: 0, body: new Uint8Array(8) },
    phaseLabel: '',
    menuId: 0,
    itemId: 0,
  } as unknown as GuildCardSearchResult;
  client.addRecent(result);
  check('addRecent sets bit 4 (list add)', (guildCardFlags.value & GCF_LIST_ADD) !== 0);
  check('the list add moves the timer to 0xb9', guildCardFlags.positionGuiIndex() === 0xb9);
  guildCardFlags.reset();
  check('reset clears it', guildCardFlags.positionGuiIndex() === 0x24);
}

if (failures) console.log(`${failures} failure(s)`);
else console.log('all guild card flag checks pass');
process.exit(failures ? 1 : 0);

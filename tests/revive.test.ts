// The HP and TP a revived player gets, per source (exe evidence in DEVLOG 2026-10-25):
//  - the automatic revival item (Scape Doll, Phoenix Claw, Ragol Ring): Player_DisableMovement
//    -> PlayerRestoreHealthAndTP_0068fda4: HP = max_hp1, TP = max_tp2 (full, unconditional);
//  - the Reverser and the Moon Atomizer (6x33 -> the 0x1d object with the Reverser's data ->
//    entity_hit_by_tech case reverser -> vtable +0x108 = PlayerResetDeadState_0068fdc8 ->
//    PlayerRestoreHealthAndTP_0068fddc): on a field outside a quest and battle, HP = max_hp1 / 2
//    and TP untouched; otherwise HP = max_hp1 and TP = max_tp2.
// Run: node tests/revive.test.ts
import { PlayerDamage, type PlayerDamageEvents } from '../client/src/combat/playerdamage.ts';
import { reverserHp, reviveRestore } from '../client/src/combat/buffs.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL: ${what}`);
  }
};

// Reverser / Moon Atomizer rule (PlayerRestoreHealthAndTP_0068fddc).
{
  const field = reviveRestore(300, 80, { quest: false, unsafe: true });
  check(field.hp === 150 && field.tp === null, 'field, no quest: HP max / 2, TP untouched');
  const quest = reviveRestore(300, 80, { quest: true, unsafe: true });
  check(quest.hp === 300 && quest.tp === 80, 'quest on a field: full HP and TP');
  const safe = reviveRestore(300, 80, { quest: false, unsafe: false });
  check(safe.hp === 300 && safe.tp === 80, 'safe map (Pioneer 2): full HP and TP');
  check(reverserHp(301) === 150, 'half HP rounds down (short division)');
  check(reverserHp(1) === 1, 'half HP is at least 1');
}

// The automatic revival item: a Scape Doll-style death, the fade's end.
interface Recorded {
  sent: string[];
  tpAtRevive: number | null;
  tp: number;
}

function reviveWithItem(maxTp: number, startTp: number): Recorded {
  const rec: Recorded = { sent: [], tpAtRevive: null, tp: startTp };
  const events: PlayerDamageEvents = {
    motion: () => {},
    push: () => {},
    face: () => {},
    sendHit: () => {},
    sendShieldAttack: () => {},
    sendDeath: () => {},
    sendRevivable: () => rec.sent.push('revivable'),
    sendRevived: () => rec.sent.push('4f'),
    sendRevivalItemUsed: () => rec.sent.push('31'),
    sendConsumeItem: () => rec.sent.push('consume'),
    findDropCheckItem: () => ({ id: 0x1234, scapeDoll: true }),
    // The combat renderer's wiring: TP = max_tp2 (PlayerRestoreHealthAndTP_0068fda4).
    restoreTp: () => {
      rec.tp = maxTp;
      rec.tpAtRevive = rec.tp;
      rec.sent.push('tp');
    },
    log: () => {},
  };
  const pd = new PlayerDamage(events);
  pd.reset(100);
  pd.hit(150, 0, 0, 0x1000);
  for (let i = 0; i < 1000 && pd.state !== 'reviving'; i++) pd.tick();
  check(pd.state === 'reviving', `the item path reaches the revive state (${pd.state})`);
  check(pd.hp === 100, 'the item path revives at full HP (max_hp1)');
  return rec;
}

{
  const rec = reviveWithItem(80, 5);
  check(rec.tp === 80 && rec.tpAtRevive === 80, 'the item path restores TP to max_tp2 (the TP the port used to keep)');
  check(rec.sent.join(',') === 'consume,tp,31,4f', 'order: 6x29, TP restore (Player_DisableMovement), 6x31, 6x4F');
}

// The web R key revive is a convenience, not an exe source: 1/8 of max HP, no TP.
{
  const events: PlayerDamageEvents = {
    motion: () => {},
    push: () => {},
    face: () => {},
    sendHit: () => {},
    sendShieldAttack: () => {},
    sendDeath: () => {},
    sendRevivable: () => {},
    sendRevived: () => {},
    log: () => {},
  };
  const pd = new PlayerDamage(events);
  pd.reset(100);
  pd.hit(150, 0, 0, 0x1000);
  for (let i = 0; i < 1000 && pd.state !== 'revivable' && pd.state !== 'alive'; i++) pd.tick();
  pd.revive();
  check(pd.hp === 13, `the R-key revive keeps the 1/8 convenience (${pd.hp})`);
}

console.log(`${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
if (failures) process.exit(1);

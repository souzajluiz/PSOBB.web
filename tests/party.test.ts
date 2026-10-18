// The party members' windows of classic/hud.ts and the remote HP of
// combat/partyhp.ts: slots, stacking and the 15-frame move, layout, the hit
// shake and the 6x4B / 6x2F / 6x9A / 6x4D / 6x4F / 6x70 handling.
//
// Run: node tests/party.test.ts
import {
  PARTY_MOVE_FRAMES,
  PARTY_SPACING,
  PARTY_WINDOW,
  PartyWindows,
  SHAKE_FRAMES,
  StatusWindow,
  WindowShake,
  type HudTextures,
  type PartyValues,
} from '../client/src/classic/hud.ts';
import { PartyHp, syncHp } from '../client/src/combat/partyhp.ts';
import { maxHpFor } from '../client/src/combat/progression.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
};

interface Draw {
  src: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}
function recorder(): { ctx: CanvasRenderingContext2D; draws: Draw[] } {
  const draws: Draw[] = [];
  const ctx = {
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    drawImage(src: { name: string }, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      draws.push({ src: src.name, sx, sy, sw, sh, dx, dy, dw, dh });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws };
}
const tex = { panel: { name: 'panel' }, icons: { name: 'icons' }, font: { name: 'font' } } as unknown as HudTextures;
const still = () => 0;

// --- slots and stacking ---------------------------------------------------------
{
  const p = new PartyWindows();
  p.setSelf(2);
  check(p.windows.map((w) => w.slot).join() === '3,0,1', 'slots follow the own slot: (self + 1 + i) & 3');
  const values: Record<number, PartyValues> = {
    0: { name: 'Bob', level: 7, hp: 50, maxHp: 100, dead: false },
    1: { name: 'Cy', level: 3, hp: 30, maxHp: 30, dead: true },
  };
  p.tick((s) => values[s] ?? null, still);
  check(!p.windows[0].shown && p.windows[1].shown && p.windows[2].shown, 'only present players have a window');
  check(p.windows[1].y === PARTY_WINDOW.y && p.windows[2].y === PARTY_WINDOW.y + PARTY_SPACING, 'stacked from y 116, 55 apart');
  // The second window starts at 116 and moves down over 15 frames.
  check(p.windows[2].renderY > PARTY_WINDOW.y && p.windows[2].renderY < PARTY_WINDOW.y + PARTY_SPACING, `moving (${p.windows[2].renderY})`);
  for (let i = 0; i < PARTY_MOVE_FRAMES; i++) p.tick((s) => values[s] ?? null, still);
  check(p.windows[2].renderY === PARTY_WINDOW.y + PARTY_SPACING, 'arrived after 15 frames');
  // Slot 3 joins: everybody shifts down.
  values[3] = { name: 'Al', level: 1, hp: 10, maxHp: 10, dead: false };
  p.tick((s) => values[s] ?? null, still);
  check(p.windows[0].y === 116 && p.windows[1].y === 171 && p.windows[2].y === 226, 'a new player takes the first place');

  for (let i = 0; i < 100; i++) p.tick((s) => values[s] ?? null, still);
  const rec = recorder();
  p.draw(rec.ctx, tex);
  const bg = rec.draws.filter((d) => d.src === 'panel' && d.sx === 0 && d.sy === 180);
  check(bg.length === 3 && bg.every((d) => d.dx === 30 && d.sw === 114 && d.sh === 46), 'backgrounds: texture 13 (0, 180) 114x46 at x 30');
  const badge = rec.draws.find((d) => d.src === 'icons' && d.dy === 171 + 7);
  check(!!badge && badge.dx === 37 && badge.sx === 0 && badge.sy === 202, 'badge of slot 0 at (7, 7)');
  // HP bar of slot 0: 50 / 100 of 57.
  const fills = rec.draws.filter((d) => d.src === 'panel' && d.sy === 30 && d.dy === 171 + 7);
  const right = Math.max(...fills.map((d) => d.dx + d.dw));
  check(fills.length > 0 && fills[0].dx === 30 + 44 && right === 30 + 44 + 28.5, `HP fill 28.5 wide at (44, 7) (${right})`);
  // "Lv" at (48, 19), the level's right edge at 100.
  const L = rec.draws.find((d) => d.src === 'font' && d.dx === 30 + 48 && d.dy === 171 + 19);
  check(!!L && L.sx === (0x4c & 0xf) * 16 && L.sy === 0x40, '"Lv" at (48, 19)');
  const digit = rec.draws.find((d) => d.src === 'font' && d.dy === 171 + 19 && d.dx + d.dw === 30 + 100);
  check(!!digit && digit.sx === (0x37 & 0xf) * 16, 'level 7 right-aligned at x 100');
  const B = rec.draws.find((d) => d.src === 'font' && d.dx === 30 + 45 && d.dy === 171 + 40);
  check(!!B && B.sx === (0x42 & 0xf) * 16, 'name at (45, 40)');

  // A player leaving: its window goes and the others move up.
  delete values[0];
  p.tick((s) => values[s] ?? null, still);
  check(!p.windows[1].shown && p.windows[2].y === 171, 'the windows close up');
}

// --- hit shake --------------------------------------------------------------------
{
  const s = new WindowShake();
  s.start();
  let moved = 0;
  for (let i = 0; i < 6; i++) {
    s.tick(() => 0.25);
    if (s.x !== 0 || s.y !== 0) moved++;
  }
  check(moved === SHAKE_FRAMES, `shakes ${SHAKE_FRAMES} frames`);
  s.start();
  s.tick(() => 0.25); // angle 0x4000 (down), distance 1.25
  check(Math.abs(s.x) < 1e-9 && Math.abs(s.y - 1.25) < 1e-9, 'rand / 32768 * 65536 angle, * 5 distance');
  const w = new StatusWindow();
  const v = { name: 'A', slot: 0, level: 1, hp: 100, maxHp: 100, tp: 0, maxTp: 0, pb: 0, dead: false };
  w.tick(v, still);
  w.tick(v, still);
  check(w.shake.frames === 0, 'no shake while HP holds');
  w.tick({ ...v, hp: 90 }, still);
  check(w.shake.frames === SHAKE_FRAMES - 1, 'HP going down starts the shake');
}

// --- remote HP ----------------------------------------------------------------------
{
  const h = new PartyHp();
  const m = h.stats(1, { charClass: 0, level: 5, hpStat: 20, hpMaterials: 4 });
  const max = maxHpFor(0, 20, 4, 4);
  check(m.maxHp === max && m.hp === max, `starts full (${max})`);
  const hit = new Uint8Array(0x10);
  const dv = new DataView(hit.buffer);
  hit[0] = 0x4b;
  hit[1] = 4;
  dv.setUint16(2, 1, true);
  dv.setUint16(6, 33, true);
  h.receive(0x4b, hit);
  check(h.get(1)!.hp === 33, '6x4B sets current_hp');
  const ch = new Uint8Array(0x0c);
  const cv = new DataView(ch.buffer);
  ch[0] = 0x2f;
  cv.setUint32(4, 1, true);
  cv.setInt16(8, 10, true);
  cv.setUint16(0x0a, 1, true);
  h.receive(0x2f, ch);
  check(h.get(1)!.hp === 43, '6x2F type 1 adds');
  cv.setUint32(4, 2, true);
  h.receive(0x2f, ch);
  check(h.get(1)!.hp === max, '6x2F type 2 refills');
  cv.setUint32(4, 0, true);
  cv.setInt16(8, 5, true);
  h.receive(0x2f, ch);
  check(h.get(1)!.hp === 5, '6x2F type 0 sets');
  h.receive(0x9a, new Uint8Array([0x9a, 2, 1, 0, 1, 0, 3, 7]));
  check(h.get(1)!.hp === 12, '6x9A what 3 adds HP');
  h.receive(0x4d, new Uint8Array([0x4d, 2, 1, 0, 0, 0, 0, 0]));
  check(h.get(1)!.dead && h.get(1)!.hp === 0, '6x4D: dead');
  h.receive(0x2f, ch);
  check(h.get(1)!.hp === 0, 'a dead player ignores 6x2F');
  h.receive(0x4f, new Uint8Array([0x4f, 1, 1, 0]));
  check(!h.get(1)!.dead && h.get(1)!.hp === Math.trunc(max / 2), '6x4F: revived at half');

  const sync = new Uint8Array(0x4c0);
  const sv = new DataView(sync.buffer);
  sync[0] = 0x70;
  sv.setUint16(0x08, 2, true);
  sv.setUint16(0x2a, 20, true);
  sv.setUint16(0x2c, 6, true);
  sv.setUint16(0x146, 30, true);
  sv.setUint32(0x158, 9, true);
  const s = syncHp(sync);
  check(!!s && s.clientId === 2 && s.hp === 20 && s.hpMaterials === 6 && s.hpStat === 30 && s.level === 10, '6x70 fields');
  const m2 = h.stats(2, { charClass: 6, level: s!.level, hpStat: s!.hpStat, hpMaterials: s!.hpMaterials }, s!.hp);
  check(m2.hp === 20 && m2.maxHp === maxHpFor(6, 30, 9, 6), '6x70 sets HP and max HP');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

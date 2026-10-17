// Levels and the HUD: PlyLevelTbl.prs against newserv's level table, the max
// HP / TP and EXP math of combat/progression.ts, the 6xBF / 6x30 parsers and
// the status window layout / bar animation of classic/hud.ts.
//
// Run: node tests/level.test.ts
// Env: PLY_LEVEL_TBL (a PlyLevelTbl.prs; default ~/Downloads/psobb-master/PlyLevelTbl.prs),
//      NEWSERV (vendor/newserv)
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePlyLevelTbl, LevelTable, MAX_LEVEL, type BaseStats, type LevelDelta } from '../client/src/formats/plyleveltbl.ts';
import {
  isAndroid,
  jobOf,
  killExp,
  levelUpLines,
  maxHpFor,
  maxTpFor,
  PlayerProgression,
  roundEven,
} from '../client/src/combat/progression.ts';
import { parseChangeLevel, parseExpMultiplier, parseGiveExp } from '../client/src/net/game.ts';
import {
  BAR_HOLD_FRAMES,
  BarState,
  FloatingTexts,
  expText,
  glyphTextWidth,
  levelUpText,
  MessageLines,
  numberWidth,
  StatusWindow,
} from '../client/src/classic/hud.ts';
import { parseNewservJson } from './lib/newservjson.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NEWSERV = process.env.NEWSERV ?? join(ROOT, 'vendor/newserv');
const TBL = process.env.PLY_LEVEL_TBL ?? join(process.env.HOME!, 'Downloads/psobb-master/PlyLevelTbl.prs');

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
};

// --- the level table ---------------------------------------------------------

type JsonStats = Record<string, number>;
const jsonPath = join(NEWSERV, 'system/tables/level-table-v4.json');
let table: LevelTable | null = null;
if (existsSync(jsonPath)) {
  const j = parseNewservJson(readFileSync(jsonPath, 'utf8')) as { BaseStats: JsonStats[]; LevelDeltas: JsonStats[][] };
  const base: BaseStats[] = j.BaseStats.map((b) => ({ atp: b.ATP, mst: b.MST, evp: b.EVP, hp: b.HP, dfp: b.DFP, ata: b.ATA, lck: b.LCK }));
  const deltas: LevelDelta[][] = j.LevelDeltas.map((row) =>
    row.map((d) => ({ atp: d.ATP, mst: d.MST, evp: d.EVP, hp: d.HP, dfp: d.DFP, ata: d.ATA, lck: d.LCK, tp: d.TP, exp: d.EXP })),
  );
  table = new LevelTable(base, deltas);
  console.log(`newserv level table: ${base.length} classes`);
} else {
  console.log(`skip: no ${jsonPath}`);
}

if (existsSync(TBL)) {
  const sega = parsePlyLevelTbl(new Uint8Array(readFileSync(TBL)));
  if (table) {
    let same = 0;
    for (let c = 0; c < 12; c++) {
      check(JSON.stringify(sega.base[c]) === JSON.stringify(table.base[c]), `base stats of class ${c}`);
      for (let l = 0; l < 200; l++) {
        if (JSON.stringify(sega.deltas[c][l]) === JSON.stringify(table.deltas[c][l])) same++;
      }
    }
    check(same === 12 * 200, `PlyLevelTbl.prs deltas match newserv's table (${same}/2400)`);
    console.log(`PlyLevelTbl.prs: ${same}/2400 level entries equal to newserv's level-table-v4.json`);
  }
  table ??= sega;
} else {
  console.log(`skip: no ${TBL}`);
}

if (table) {
  // HUmar: level 2 at 50 EXP, level 3 at 200 (the first rows of the table).
  check(table.expForLevel(0, 1) === 50 && table.expForLevel(0, 2) === 200, 'HUmar EXP thresholds');
  check(table.levelForExp(0, 0) === 0 && table.levelForExp(0, 49) === 0 && table.levelForExp(0, 50) === 1 && table.levelForExp(0, 199) === 1, 'levelForExp');
  check(table.maxExp(0) === table.expForLevel(0, MAX_LEVEL) && table.maxExp(0) > 0, 'EXP cap = threshold of level 199');
  for (let c = 0; c < 12; c++) {
    let monotonic = true;
    for (let l = 1; l < 200; l++) if (table.expForLevel(c, l) < table.expForLevel(c, l - 1)) monotonic = false;
    check(monotonic, `class ${c}: thresholds never decrease`);
  }

  // --- progression ------------------------------------------------------------
  const b = table.base[0];
  const p = new PlayerProgression(table, { charClass: 0, level: 0, exp: 0, stats: { ...b }, hpMaterials: 0, tpMaterials: 0 });
  check(p.maxHp === roundEven((b.hp + 0) * 2.0), `HUmar level 1 max HP = (hp + level) * 2.0 (${p.maxHp})`);
  check(p.maxTp === b.mst, `HUmar level 1 max TP = mst * 1.0 (${p.maxTp})`);
  check(p.nextExp === 50 && p.toNext === 50, 'next level at 50');
  p.addExp(30);
  check(p.exp === 30 && !p.canLevelUp, '+30 EXP: no level');
  check(p.levelUp() === null, 'no level up below the threshold');
  p.addExp(30);
  check(p.canLevelUp, '+30 more: level up due');
  const r = p.levelUp(1);
  const d1 = table.delta(0, 1);
  check(r !== null && r.from === 0 && r.to === 1 && p.level === 1, 'level 1 -> 2');
  check(!!r && r.atp === d1.atp && r.mst === d1.mst && r.evp === d1.evp && r.dfp === d1.dfp, 'stat gains are the table row');
  check(!!r && r.hp === maxHpFor(0, b.hp + d1.hp, 1) - maxHpFor(0, b.hp, 0), `HP gain ${r?.hp}`);
  const lines = r ? levelUpLines(r) : [];
  check(lines[0] === `${' '.repeat(15)}LEVEL 2` && lines.some((l) => l.trim().startsWith('HP +')), `level-up lines: ${lines.map((l) => l.trim()).join(' | ')}`);
  // Several levels at once, and the cap.
  p.addExp(1e9);
  check(p.exp === table.maxExp(0), 'EXP clamps to the level-199 threshold');
  const big = p.levelUp();
  check(!!big && p.level === MAX_LEVEL && p.nextExp === null && p.toNext === 0, 'levels up to 199 at once');
  // The server's level is the floor (newserv already leveled the character).
  const q = new PlayerProgression(table, { charClass: 6, level: 0, exp: 0, stats: { ...table.base[6] }, hpMaterials: 0, tpMaterials: 0 });
  check(q.levelUp(3)?.to === 3, 'serverLevel raises the level even without local EXP');
}

// Factors (0x00968fc4): hunter 2.0 / 1.0, ranger 1.85 / 1.0, force 1.45 / 1.5; androids have no TP.
check(jobOf(0) === 0 && jobOf(3) === 1 && jobOf(6) === 2 && jobOf(9) === 0 && jobOf(10) === 2 && jobOf(11) === 1, 'jobs by class flags');
check(isAndroid(2) && isAndroid(4) && isAndroid(5) && isAndroid(9) && !isAndroid(0) && !isAndroid(6), 'androids');
check(maxHpFor(3, 100, 9) === roundEven(109 * Math.fround(1.85)), 'ranger HP factor');
check(maxTpFor(6, 100, 9, 4) === roundEven(4 + 109 * 1.5), 'force TP factor plus materials');
check(maxTpFor(2, 100, 9) === 0, 'android TP = 0');
check(roundEven(2.5) === 2 && roundEven(3.5) === 4 && roundEven(2.4) === 2, 'x87 rounding');
// handle_experience: ep1 killer = base, tagger = 80%, episode 2 = 130%.
check(killExp(100, { episode2: false, killer: true }) === 100, 'kill EXP ep1');
check(killExp(100, { episode2: false, killer: false }) === 80, 'tag EXP');
check(killExp(100, { episode2: true, killer: true }) === 130, 'kill EXP ep2');
check(killExp(7, { episode2: false, killer: true, multiplier: 2 }) === 14, 'lobby multiplier');

// --- 6xBF / 6x30 / 6xDD --------------------------------------------------------
{
  const bf = new Uint8Array([0xbf, 3, 2, 0, 0x39, 0x05, 0, 0, 0x05, 0x10, 0, 0]);
  const g = parseGiveExp(bf);
  check(g?.clientId === 2 && g.amount === 0x539 && g.fromEntityId === 0x1005, '6xBF');
  const lv = new Uint8Array(0x14);
  const dv = new DataView(lv.buffer);
  lv[0] = 0x30;
  lv[1] = 5;
  dv.setUint16(2, 1, true);
  [40, 30, 50, 25, 20, 33, 4, 0].forEach((v, i) => dv.setUint16(4 + i * 2, v, true));
  const c = parseChangeLevel(lv);
  check(!!c && c.clientId === 1 && c.atp === 40 && c.ata === 33 && c.level === 4 && !c.levelDown, '6x30');
  check(parseExpMultiplier(new Uint8Array([0xdd, 1, 3, 0])) === 3, '6xDD');
  check(parseGiveExp(lv) === null && parseChangeLevel(bf) === null, 'parsers check the subcommand');
}

// --- HUD layout ----------------------------------------------------------------

interface Draw {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  src: string;
}
function recorder(): { ctx: CanvasRenderingContext2D; draws: Draw[]; fills: number } {
  const draws: Draw[] = [];
  const state = { fills: 0 };
  const ctx = {
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      state.fills++;
    },
    drawImage(src: { name: string }, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      draws.push({ src: src.name, sx, sy, sw, sh, dx, dy, dw, dh });
    },
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    draws,
    get fills() {
      return state.fills;
    },
  };
}
const tex = { panel: { name: 'panel' }, icons: { name: 'icons' }, font: { name: 'font' } } as unknown as import('../client/src/classic/hud.ts').HudTextures;
{
  const w = new StatusWindow();
  const values = { name: 'Ash', slot: 1, level: 12, hp: 150, maxHp: 200, tp: 40, maxTp: 80, pb: 0, dead: false };
  for (let i = 0; i < 200; i++) w.tick(values);
  const rec = recorder();
  w.draw(rec.ctx, tex);
  const at = (src: string, dx: number, dy: number) => rec.draws.find((d) => d.src === src && d.dx === dx && d.dy === dy);
  check(!!at('panel', 28, 37) && at('panel', 28, 37)!.sw === 228 && at('panel', 28, 37)!.sh === 76, 'window at (28, 37), 228x76 from texture 13');
  check(!!at('panel', 0, 0) && at('panel', 0, 0)!.sx === 118 && at('panel', 0, 0)!.sy === 80, 'corner piece at (0, 0)');
  const badge = at('icons', 28 + 27, 37 + 16);
  check(!!badge && badge.sx === 34 && badge.sy === 202 && badge.sw === 34 && badge.sh === 29, 'colour badge of slot 1');
  check(rec.fills === 1, 'photon blast gauge at 0: one grey pie');
  // HP bar fill: 150/200 of 120 = 90 wide at (118, 61).
  const hpFills = rec.draws.filter((d) => d.src === 'panel' && d.dy === 37 + 24);
  const hpRight = Math.max(...hpFills.map((d) => d.dx + d.dw));
  check(hpFills.length > 0 && hpFills[0].dx === 28 + 90 && hpRight === 28 + 90 + 90, `HP fill ends at ${hpRight}`);
  check(hpFills.every((d) => d.sy === 30 && d.sh === 7), 'bar fill texels v 30..37');
  // Glyphs: "Lv" at (58, 96); the level's right edge at 110.
  const glyphs = rec.draws.filter((d) => d.src === 'font');
  const L = glyphs.find((d) => d.dx === 28 + 30 && d.dy === 37 + 59);
  check(!!L && L.sx === (0x4c & 0xf) * 16 && L.sy === 0x40, '"L" of "Lv" from the atlas');
  const levelDigits = glyphs.filter((d) => d.dy === 37 + 59 && d.dx >= 28 + 60 && d.dx < 28 + 82);
  check(levelDigits.length === 2 && Math.max(...levelDigits.map((d) => d.dx + d.dw)) === 28 + 82, 'level right-aligned at x 82');
  // HP numbers: max right edge 238, "/" at 238 - 30 - 12.
  const slash = glyphs.find((d) => d.sx === (0x2f & 0xf) * 16 && d.sy === 0x20 && d.dy === 37 + 9);
  check(!!slash && slash.dx === 28 + 210 - numberWidth(200) - 12, `"/" at ${slash?.dx}`);
  check(glyphTextWidth('Level Up') === 5 + 'LevelUp'.split('').reduce((n, ch) => n + ({ L: 11, e: 10, v: 12, l: 5, U: 12, p: 10 } as Record<string, number>)[ch], 0), 'glyph widths');
}
{
  // The bar holds the old width for 0x24 frames, then moves 2 per frame.
  const bar = new BarState(0xff00ff15);
  bar.max = 100;
  bar.value = 100;
  for (let i = 0; i < 200; i++) bar.tick();
  check(bar.shown === 120, 'bar full');
  bar.value = 50;
  bar.tick();
  check(bar.shown === 120, 'holds after a hit');
  for (let i = 0; i < BAR_HOLD_FRAMES - 1; i++) bar.tick();
  check(bar.shown === 120, `still held after ${BAR_HOLD_FRAMES} frames`);
  bar.tick();
  check(bar.shown === 118, 'then 2 per frame');
  for (let i = 0; i < 100; i++) bar.tick();
  check(bar.shown === 60, 'settles at the new width');
  // Colour fades over 11.1 frames.
  bar.fadeTo(0xfff2ff19);
  bar.tick();
  check(bar.color !== 0xff00ff15 && bar.color !== 0xfff2ff19, 'colour mid-fade');
  for (let i = 0; i < 12; i++) bar.tick();
  check(bar.color === 0xfff2ff19, 'colour reaches the low colour');
}
{
  // Floating texts: EXP waits 20 frames, lives 20; Level Up lives 60.
  const f = new FloatingTexts();
  f.add(expText(12, () => ({ x: 320, y: 200 })));
  f.add(levelUpText(false, () => ({ x: 320, y: 100 })));
  check(expText(12, () => null).text === 'EXP+12', 'EXP text');
  for (let i = 0; i < 39; i++) f.tick();
  check(f.size === 2, 'both alive at frame 39');
  f.tick();
  check(f.size === 1, 'EXP gone after 20 + 20 frames');
  for (let i = 0; i < 20; i++) f.tick();
  check(f.size === 0, 'Level Up gone after 60 frames');
  // Message lines one every 0x16 frames.
  const m = new MessageLines();
  m.enqueue(['a', 'b', 'c']);
  m.tick();
  check(m.visible.length === 1 && m.pending === 2, 'first line at once');
  for (let i = 0; i < 0x16; i++) m.tick();
  check(m.visible.length === 2, 'second line 0x16 frames later');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

// The lock-on cursor and the target card (PsoBB.exe, Ephinea 1.25.13): the reticle's
// constants and colour rows (combat/reticle.ts, enable_reticle / init_reticle /
// PositionAndRenderReticlePrimitives_007a360c / g_ReticleColorTable 0x009ff540), the
// target card's attribute colours and text (combat/targetcard.ts,
// ui_target_window_attribute, monster_attribute_color 0x009f2ed0), and the cursor
// model's shape from data.gsl when it is there (bm_ply_lock_on_cursor.bml).
// Run: node tests/reticle.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { BmlArchive } from '../client/src/formats/bml.ts';
import { modelTriangles } from '../client/src/formats/minimap.ts';
import { parseNinjaChunkFile } from '../client/src/formats/njcm.ts';
import {
  RETICLE_BAMS,
  RETICLE_COLORS,
  RETICLE_FALLBACK,
  RETICLE_MODEL_Z,
  RETICLE_NOTCH,
  RETICLE_OUTLINE_THRESHOLD,
  RETICLE_Z_OFFSET,
  bamsToRadians,
  reticleColor,
  reticleOutlineVisible,
  reticleRow,
} from '../client/src/combat/reticle.ts';
import {
  TARGET_ATTR_ARGB,
  TARGET_CARD_ANCHOR,
  TARGET_CARD_HEIGHT,
  TARGET_TEXT,
  monsterNameCollection,
  targetAttributeIndex,
  targetCardText,
} from '../client/src/combat/targetcard.ts';
import { ENEMY_ATTR } from '../client/src/combat/enemystatus.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// 1. Reticle constants (dump 575550, 785268, 786060, 786594; the exe's data).
check('bams: three copies at 60, 180 and 300 degrees', RETICLE_BAMS.length === 3 && RETICLE_BAMS[0] === 0x2aaa && RETICLE_BAMS[1] === 0x7fff && RETICLE_BAMS[2] === 0xd554);
check('bams: 0x2aaa is 60 degrees', near(bamsToRadians(0x2aaa), Math.PI / 3, 1e-3));
check('bams: 0x7fff is 180 degrees', near(bamsToRadians(0x7fff), Math.PI, 1e-3));
check('bams: 0xd554 is 300 degrees', near(bamsToRadians(0xd554), (5 * Math.PI) / 3, 1e-3));
check('notch distance is 8.75 (init_reticle)', RETICLE_NOTCH === 8.75);
check('z offset is g_ReticleTranslationZOffset 0.01 (0x009ff520)', near(RETICLE_Z_OFFSET, 0.01, 1e-7));
check('cursor model z is 0.25 (push 0x3e800000)', RETICLE_MODEL_Z === 0.25);
check('outline threshold is g_ReticleOutlineOpacityThreshold (0x0097cfd4)', near(RETICLE_OUTLINE_THRESHOLD, 0.99999, 1e-6));

// 2. Colour table: 14 rows of [opacity, r, g, b] (0x009ff540).
check('colour table has 14 rows', RETICLE_COLORS.length === 14);
check('row 0 is the green of the primary target (0, 0.78, 0)', RETICLE_COLORS[0][0] === 1 && near(RETICLE_COLORS[0][2], 0.78, 1e-6) && RETICLE_COLORS[0][1] === 0 && RETICLE_COLORS[0][3] === 0);
check('row 2 is blue (0, 0, 1)', RETICLE_COLORS[2][1] === 0 && RETICLE_COLORS[2][2] === 0 && RETICLE_COLORS[2][3] === 1);
check('row 3 is red (1, 0, 0)', RETICLE_COLORS[3][1] === 1 && RETICLE_COLORS[3][2] === 0 && RETICLE_COLORS[3][3] === 0);
check('row 4 is the light blue of a support target', near(RETICLE_COLORS[4][1], 0.42, 1e-6) && near(RETICLE_COLORS[4][2], 0.81, 1e-6) && near(RETICLE_COLORS[4][3], 0.96, 1e-6));
check('fallback row is (1, 0, 0.39, 0) (0x009ff620)', RETICLE_FALLBACK[0] === 1 && RETICLE_FALLBACK[1] === 0 && near(RETICLE_FALLBACK[2], 0.39, 1e-6) && RETICLE_FALLBACK[3] === 0);
check('reticleColor returns the row', reticleColor(3) === RETICLE_COLORS[3]);
check('reticleColor falls back for a bad row', reticleColor(99) === RETICLE_FALLBACK);

// 3. Kinds of target.
check('the lock-on enemy is row 0', reticleRow('enemy') === 0);
check('a support target is light blue (row 4)', reticleRow('support') === 4);
check('an other target is row 4', reticleRow('other') === 4);

// 4. Outline visibility.
check('the outline is drawn at opacity 1', reticleOutlineVisible(1));
check('the outline is hidden at opacity 0.5', !reticleOutlineVisible(0.5));
check('the outline is hidden at the threshold itself', !reticleOutlineVisible(RETICLE_OUTLINE_THRESHOLD));

// 5. Target card attribute colours and index (monster_attribute_color, 0x009f2ed0; flag tests of ui_target_window_attribute).
check('attribute colours: native a5ffaa, A.beast f5ff99, machine ff958b, dark e1a9ff, none ffffff',
  TARGET_ATTR_ARGB.length === 5 && TARGET_ATTR_ARGB[0] === 0xffa5ffaa && TARGET_ATTR_ARGB[1] === 0xfff5ff99 && TARGET_ATTR_ARGB[2] === 0xffff958b && TARGET_ATTR_ARGB[3] === 0xffe1a9ff && TARGET_ATTR_ARGB[4] === 0xffffffff);
check('attribute index: native -> 0', targetAttributeIndex(ENEMY_ATTR.native) === 0);
check('attribute index: A.beast -> 1', targetAttributeIndex(ENEMY_ATTR.abeast) === 1);
check('attribute index: machine -> 2', targetAttributeIndex(ENEMY_ATTR.machine) === 2);
check('attribute index: dark -> 3', targetAttributeIndex(ENEMY_ATTR.dark) === 3);
check('attribute index: special (0x40) -> 4 (white)', targetAttributeIndex(0x40) === 4);
check('attribute index: none -> 4', targetAttributeIndex(0) === 4);
check('attribute index: special wins over native', targetAttributeIndex(0x40 | ENEMY_ATTR.native) === 4);
check('attribute index: mini-boss bit alone -> 4', targetAttributeIndex(ENEMY_ATTR.miniboss) === 4);
check('attribute index: native with mini-boss -> 0', targetAttributeIndex(ENEMY_ATTR.native | ENEMY_ATTR.miniboss) === 0);

// 6. Name collection (unitxt_get_monster_name: byte offset 8 -> collection 2, 0x10 -> collection 4 (Ultimate)).
check('monster names: Normal uses collection 2', monsterNameCollection(0) === 2);
check('monster names: Very Hard uses collection 2', monsterNameCollection(2) === 2);
check('monster names: Ultimate uses collection 4', monsterNameCollection(3) === 4);

// 7. Target card text.
check('card anchor is gui slot 0x1f (8, 437)', TARGET_CARD_ANCHOR.x === 8 && TARGET_CARD_ANCHOR.y === 437);
check('card height is 93', TARGET_CARD_HEIGHT === 93);
check('unitxt group 11 ids: native 0xb5, machine 0xb7, label 0xc3', TARGET_TEXT.native === 0xb5 && TARGET_TEXT.machine === 0xb7 && TARGET_TEXT.label === 0xc3);

const fallback = targetCardText({ name: 'Barbarous Wolf', attribute: ENEMY_ATTR.native, difficulty: 0, texts: null, monsterId: 8 });
check('card fallback: port name, Native, Attribute:, green', fallback.name === 'Barbarous Wolf' && fallback.value === 'Native' && fallback.label === 'Attribute:' && fallback.argb === 0xffa5ffaa, JSON.stringify(fallback));

// A fake unitxt table: collection 2 names, collection 11 the attribute labels.
const texts: string[][] = [];
texts[2] = ['', 'Hildebear', 'Hildebear', 'Rappy', 'Monest', 'Savage Wolf', 'Savage Wolf', 'Barbarous Wolf', 'Barbarous Wolf'];
texts[11] = [];
texts[11][TARGET_TEXT.native] = 'Native';
texts[11][TARGET_TEXT.abeast] = 'A.Beast';
texts[11][TARGET_TEXT.machine] = 'Machine';
texts[11][TARGET_TEXT.dark] = 'Dark';
texts[11][TARGET_TEXT.label] = 'Attribute:';
const withTable = targetCardText({ name: 'Savage Wolf', attribute: ENEMY_ATTR.native, difficulty: 0, texts, monsterId: 8 });
check('card with unitxt: the monster name from collection 2 at the id', withTable.name === 'Barbarous Wolf', withTable.name);
const darkCard = targetCardText({ name: 'Dark Belra', attribute: ENEMY_ATTR.dark, difficulty: 3, texts, monsterId: 8 });
check('card with unitxt: Ultimate reads collection 4 (empty here), so the port name stays', darkCard.name === 'Dark Belra', darkCard.name);
check('card with unitxt: dark value text', darkCard.value === 'Dark' && darkCard.argb === 0xffe1a9ff, darkCard.value);
const none = targetCardText({ name: 'Rag Rappy', attribute: 0, difficulty: 0, texts, monsterId: 0xffffffff });
check('card: no attribute shows no value', none.value === '' && none.argb === 0xffffffff, JSON.stringify(none));

// 8. The cursor model from data.gsl, when the user's copy is there (skipped otherwise).
const gslPath = `${homedir()}/Downloads/psobb-client/data/data.gsl`;
if (existsSync(gslPath)) {
  const gsl = new GSLArchive(new Uint8Array(readFileSync(gslPath)));
  const bml = new BmlArchive(gsl.get('bm_ply_lock_on_cursor.bml'));
  const main = parseNinjaChunkFile(bml.get('obj_f_maincarsol.nj')).object?.model ?? null;
  const outline = parseNinjaChunkFile(bml.get('obj_f_blackcarsol.nj')).object?.model ?? null;
  check('cursor model: the BML has the triangle (obj_f_maincarsol.nj)', main !== null);
  check('cursor model: the BML has the outline (obj_f_blackcarsol.nj)', outline !== null);
  if (main) {
    const tri = modelTriangles(main);
    // Three vertices (one triangle, 9 floats); apex at the origin, base 2.318 up.
    check('cursor model: one triangle', tri.length === 9, `length ${tri.length}`);
    const maxY = Math.max(tri[1], tri[4], tri[7]);
    check('cursor model: base 2.318 above the apex (the pointing triangle)', near(maxY, 2.318, 1e-2), `maxY ${maxY}`);
  }
} else {
  console.log('skip cursor model: data.gsl not found');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

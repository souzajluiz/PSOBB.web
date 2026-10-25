// The 14 held weapons whose model names more textures than the item's XVM
// holds (render/heldweapon.ts decodeHeldWeapon, PsoBB.exe texture loader
// 0x005d7549 / 0x005d7546 and the zeroed g_pDefaultTexture at 0x00a8d9dc).
// For each of them: every texture id a poly uses resolves to the XVM texture
// of that index, or, past the XVM's count, to the exe's no-texture result
// (null, listed in `unbound`). No id is out of range.
// Also: no texture op carries -1; a renderargs list without a texture setter
// keeps the previous texture (the exe's device state), so it emits no op.
// Run: node tests/heldweapontex.test.ts (Node 24)
// Env: PSOBB_DATA (client data/ folder), ITEMPMT (optional ItemPMT.prs)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AFSArchive } from '../client/src/formats/archives.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseNinjaChunkFile, type NjcmObject } from '../client/src/formats/njcm.ts';
import { parseItemPMT } from '../client/src/formats/itempmt.ts';
import { decodeHeldWeapon } from '../client/src/render/heldweapon.ts';
import { texturesFromXvm } from '../client/src/render/enemymodel.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const PMT_CANDIDATES = [process.env.ITEMPMT, join(DATA, 'ItemPMT.prs'), join(process.env.HOME!, 'Downloads/psobb-master/ItemPMT.prs')];
const pmtPath = PMT_CANDIDATES.find((p) => p && existsSync(p));
const modelPath = join(DATA, 'ItemModel.afs');
const texturePath = join(DATA, 'ItemTexture.afs');

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};

if (!pmtPath || !existsSync(modelPath) || !existsSync(texturePath)) {
  console.log('held weapon textures: ItemPMT.prs / ItemModel.afs / ItemTexture.afs not found, skipped');
} else {
  const models = new AFSArchive(new Uint8Array(readFileSync(modelPath)));
  const textures = new AFSArchive(new Uint8Array(readFileSync(texturePath)));
  const table = parseItemPMT(new Uint8Array(readFileSync(pmtPath)));

  // The texture ids a model's polys use (walks the object tree).
  const usedIds = (o: NjcmObject, out = new Set<number>()): Set<number> => {
    for (const p of o.model?.polys ?? []) if (p.op === 'texture' && p.id >= 0) out.add(p.id);
    o.children.forEach((c) => usedIds(c, out));
    return out;
  };

  // Every weapon slot whose NJTL names outnumber its XVM textures.
  const gaps: { label: string; type: number; skin: number; names: number; xvm: number; used: number[]; unbound: number[] }[] = [];
  let weapons = 0;
  table.weapons.forEach((list, c1) =>
    list.forEach((w, c2) => {
      if (!w || w.type >= models.entries.length || w.skin >= textures.entries.length) return;
      weapons++;
      const names = parseNinjaChunkFile(prsDecompress(models.get(w.type))).textureNames.length;
      const xvm = texturesFromXvm(prsDecompress(textures.get(w.skin))).length;
      if (names <= xvm) return;
      const h = decodeHeldWeapon(models.get(w.type), textures.get(w.skin));
      gaps.push({
        label: `weapon ${c1}/${c2}`,
        type: w.type,
        skin: w.skin,
        names,
        xvm,
        used: [...usedIds(h.object)].sort((a, b) => a - b),
        unbound: h.unbound,
      });
    }),
  );
  check(weapons > 800, `${weapons} ItemPMT weapons with a model and a texture entry`);

  // The 14 weapon slots (some share a model and skin).
  check(gaps.length === 14, `${gaps.length} weapon slots with more NJTL names than XVM textures (expected 14)`);

  let usesUnbound = 0;
  for (const g of gaps) {
    const h = decodeHeldWeapon(models.get(g.type), textures.get(g.skin));
    // Bound: XVM index k for k < XVM count; unbound: the rest of the names.
    check(h.textures.length === g.names, `${g.label} (${g.type}:${g.skin}): ${h.textures.length} slots for ${g.names} names`);
    check(h.unbound.length === g.names - g.xvm && h.unbound[0] === g.xvm, `${g.label}: unbound ids ${h.unbound.join(',')} are the names past ${g.xvm}`);
    for (let id = 0; id < g.names; id++) {
      const t = h.textures[id];
      if (id < g.xvm) check(!!t, `${g.label}: texture id ${id} resolves to the XVM texture`);
      else check(t === null && h.unbound.includes(id), `${g.label}: texture id ${id} past the XVM count is unbound (no texture)`);
    }
    for (const id of g.used) {
      check(id >= 0 && id < g.names, `${g.label}: poly uses texture id ${id} inside its ${g.names} names`);
      if (id >= g.xvm) usesUnbound++;
    }
  }
  console.log(`held weapon textures: ${gaps.length} slots, ${usesUnbound} poly texture uses past the XVM count (no texture in the exe)`);

  // A renderargs list with no texture setter (the -1 ids of the decoder): the
  // exe calls no setter for it, so the device keeps the texture of the draw
  // before (PsoBB.exe RenderXjVariableBufferOpaqueUP_0083255d). The parser emits
  // no texture op for such a list, so the strips follow the last texture op of
  // their part; only a part's first strips can have none (ASSUMED: untextured,
  // the exe's previous draw is not traced).
  let strips = 0, texOps = 0, negativeTexOps = 0, leading = 0, weaponsWithLeading = 0;
  let weaponsChecked = 0;
  table.weapons.forEach((list) =>
    list.forEach((w) => {
      if (!w || w.type >= models.entries.length || w.skin >= textures.entries.length) return;
      weaponsChecked++;
      const h = decodeHeldWeapon(models.get(w.type), textures.get(w.skin));
      let weaponLeading = 0;
      // The port's mesh builder keeps one texture state per part, across its
      // nodes in order (render/njcmmesh.ts runPolys), so the walk does too.
      let seenTexture = false;
      const walk = (o: NjcmObject) => {
        for (const p of o.model?.polys ?? []) {
          if (p.op === 'texture') {
            texOps++;
            if (p.id < 0) negativeTexOps++;
            seenTexture = true;
          } else if (p.op === 'strips') {
            strips++;
            if (!seenTexture) {
              leading++;
              weaponLeading++;
            }
          }
        }
        o.children.forEach(walk);
      };
      walk(h.object);
      if (weaponLeading > 0) weaponsWithLeading++;
    }),
  );
  check(weaponsChecked > 800, `${weaponsChecked} held weapons walked`);
  check(negativeTexOps === 0, `no texture op carries id -1 (${negativeTexOps} found)`);
  check(texOps > 0 && strips >= texOps, `${texOps} texture ops over ${strips} strip groups`);
  check(leading > 0 && leading < strips, `${leading} strip groups before any texture setter of their part (ASSUMED untextured)`);
  console.log(`held weapon texture state: ${texOps} texture ops, ${strips} strip groups, ${leading} with no earlier setter in ${weaponsWithLeading} weapons (ASSUMED untextured)`);
}

console.log(failures === 0 ? `ALL PASS (${checks} checks)` : `${failures} of ${checks} checks FAILED`);
process.exit(failures === 0 ? 0 : 1);

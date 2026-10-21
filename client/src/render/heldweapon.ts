// The held weapon: the equipped weapon's model in the player's right hand, in
// the field (not in the hubs).
//
// Decompiled from PsoBB.exe (Ephinea 1.25.13):
//   - LoadItemAsset_005d7868 (from genpei_union_guard_handling): the weapon's
//     ItemBase.type (u16 at +4) indexes ItemModel.afs (the NJCM chunk file)
//     and ItemBase.skin (u16 at +6) indexes ItemTexture.afs (the XVM);
//     both entries are PRS-compressed (DecompressItemAssetData_005d73e0).
//     For a weapon the group base is 0, so the entries are the archive indexes.
//   - OnEquipItem_005d241c: the weapon is equip slot 6 and hangs from body node
//     USHORT[0x009cb9ac + 2 * 6] = 48 (RenderWeaponGeneric_005c37a0 draws it
//     under the owner's matrix of node 48).
//   - UpdateItemVisibility_005c3f7c: hidden (flag 0x40) on the safe maps
//     (render/playermove.ts inUnsafeMap / HUB_AREAS are the same test).
// The texture ids in the model are indexes into the NJTL name list, which is
// the XVM's texture order (texturesFromXvm), as in the BML models.

import type * as THREE from 'three';
import { AFSArchive } from '../formats/archives.ts';
import { prsDecompress } from '../formats/prs.ts';
import { parseNinjaChunkFile, type NjcmObject } from '../formats/njcm.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { texturesFromXvm } from './enemymodel.ts';

// Body node (depth-first, as the player's partBones) the weapon hangs from.
export const HAND_NODE = 48;
export const ITEM_MODEL_FILE = 'ItemModel.afs';
export const ITEM_TEXTURE_FILE = 'ItemTexture.afs';

export interface HeldWeapon {
  object: NjcmObject;
  // Indexed by the model's texture id (its NJTL name index): the XVM texture
  // of that index, or null when the XVM has no such texture (see `unbound`).
  textures: (THREE.Texture | null)[];
  // Texture ids the XVM does not fill (the NJTL names past the XVM's count).
  unbound: number[];
}

// One weapon from its two archive entries.
//
// The exe's texture loader (ItemAssetLoaderStartTextureLoad_005d76b4 ->
// unknown_create_textures_from_xvm, PsoBB.exe 0x005d7549 for the fill)
// writes the XVM's texture count (XVMH format1, at +8) over the NJTL count and
// binds XVRT k to NJTL slot k, stopping at that count. The model's own NJTL
// fill (unknown_ItemLoad, 0x005d7546) had set every slot to &g_pDefaultTexture
// (0x00a8d9dc), a BSS object that stays zero: no texture id, no texture object.
// So a slot past the XVM's count has no texture: the exe draws it untextured
// (ASSUMED: the zeroed object is never written; its interior has no exact xref).
// The 14 Tekker / fan weapons are the entries whose NJTL names outnumber their
// XVM textures (1 XVRT, 2 to 4 names).
export function decodeHeldWeapon(modelEntry: Uint8Array, textureEntry: Uint8Array): HeldWeapon {
  const chunks = parseNinjaChunkFile(prsDecompress(modelEntry));
  const xvm = texturesFromXvm(prsDecompress(textureEntry));
  const names = chunks.textureNames.length;
  const textures: (THREE.Texture | null)[] = [];
  const unbound: number[] = [];
  for (let id = 0; id < Math.max(names, xvm.length); id++) {
    if (id < xvm.length) textures.push(xvm[id]);
    else {
      textures.push(null);
      unbound.push(id);
    }
  }
  return { object: chunks.object!, textures, unbound };
}

// The weapon models of the client, loaded once and decoded per (type, skin).
export class HeldWeaponFiles {
  private archives: Promise<[AFSArchive, AFSArchive]>;
  private decoded = new Map<string, Promise<HeldWeapon>>();

  constructor(files: ClientFiles) {
    this.archives = Promise.all([files.read(ITEM_MODEL_FILE), files.read(ITEM_TEXTURE_FILE)]).then(
      ([model, texture]) => [new AFSArchive(model), new AFSArchive(texture)],
    );
  }

  load(type: number, skin: number): Promise<HeldWeapon> {
    const key = `${type}:${skin}`;
    let w = this.decoded.get(key);
    if (!w) {
      w = this.archives.then(([models, textures]) => {
        if (type >= models.entries.length) throw new Error(`no ItemModel.afs entry ${type}`);
        if (skin >= textures.entries.length) throw new Error(`no ItemTexture.afs entry ${skin}`);
        return decodeHeldWeapon(models.get(type), textures.get(skin));
      });
      this.decoded.set(key, w);
    }
    return w;
  }
}

// The MAG in the field: the model of the equipped MAG, drawn behind the player's shoulder
// and moved by its motion records (render/magmotion.ts has the exe's math and the sources).
//
// One rig per player: a root group at the anchor (in the marker's frame, so the player's
// heading applies as the exe's transform does), an orbit group (the offset), a spin group
// (the tilt and spin), and one model group per part with a motion record. The parts are
// ticked at the game's rate (GAME_TICKS_PER_SECOND), not per frame.
import * as THREE from 'three';
import type { MagEdit } from '../formats/itemmagedit.ts';
import type { MagMotionRecord } from '../formats/itemmagmotion.ts';
import { NjcmModelBuilder } from './njcmmesh.ts';
import { HeldWeaponFiles } from './heldweapon.ts';
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';
import { magArchiveEntries, magColourIndex, magPartRotation, magPartTick, newMagPartState, type MagPartState, type Vec3 } from './magmotion.ts';

// The equipped MAG as the field shows it: the PMT entry's model and skin, the colour index.
export interface MagEquip {
  type: number;
  skin: number;
  colour: number;
}

// The data a rig needs, loaded once (itemmagmotion.dat and ItemMagEdit.prs).
export interface MagTables {
  edit: MagEdit;
  motion: MagMotionRecord[];
}

interface MagPartRig {
  record: MagMotionRecord;
  state: MagPartState;
  root: THREE.Group; // at the anchor
  orbit: THREE.Group; // the offset
  spin: THREE.Group; // the tilt and spin
}

export interface MagRig {
  key: string; // 'type:skin:colour'
  parts: MagPartRig[];
  ticks: number; // game ticks owed to the rig (dt x 30)
}

// The rig's key of an equip ('' for none).
export function magKey(e: MagEquip | null): string {
  return e ? `${e.type}:${e.skin}:${magColourIndex(e.colour)}` : '';
}

// The model's colour from ItemMagEdit's table (a, r, g, b), as a THREE colour; white without the table.
export function magDiffuse(tables: MagTables, colour: number): THREE.Color {
  const c = tables.edit.colour(magColourIndex(colour));
  return c ? new THREE.Color().setRGB(c[1], c[2], c[3], THREE.SRGBColorSpace) : new THREE.Color(1, 1, 1);
}

// Builds the rig: one part per motion record of the MAG type (InitializeMagModel_005d8351: the
// part's record index is the table's first byte, 0xff for none). The part models are the same
// file entry (the secondary model is not read: ASSUMED). `startOf(node)` is a part's first
// anchor point (InitializeWeaponProjectilePosition_005dd200 sets it from the node, or the owner).
export async function buildMagRig(
  files: HeldWeaponFiles,
  equip: MagEquip,
  tables: MagTables,
  startOf: (node: number) => Vec3,
): Promise<MagRig | null> {
  const entries = magArchiveEntries(equip);
  const weapon = await files.load(entries.model, entries.texture);
  const parts: MagPartRig[] = [];
  const diffuse = magDiffuse(tables, equip.colour);
  for (const part of tables.edit.parts(equip.type)) {
    if (!part) continue;
    const record = tables.motion[part.record];
    if (!record) continue;
    const model = new NjcmModelBuilder().build([{ name: 'mag', root: weapon.object, textures: (id) => weapon.textures[id] ?? null, diffuse }]);
    const root = new THREE.Group();
    const orbit = new THREE.Group();
    const spin = new THREE.Group();
    spin.rotation.order = 'ZYX'; // the exe's Z, then Y, then X (ASSUMED order of the matrix product)
    spin.add(model.root);
    orbit.add(spin);
    root.add(orbit);
    parts.push({ record, state: newMagPartState(startOf(record.node)), root, orbit, spin });
  }
  if (parts.length === 0) return null;
  return { key: magKey(equip), parts, ticks: 0 };
}

// Advances a rig by `dt` seconds of game ticks and places its groups. `anchorOf(node)` is the
// world point of the body node (null: no such node, the owner's position is used); `toLocal`
// converts a world point to the marker's frame; `standing` is the owner's standing flag.
export function updateMagRig(
  rig: MagRig,
  dt: number,
  owner: Vec3,
  anchorOf: (node: number, out: Vec3) => boolean,
  toLocal: (world: Vec3) => Vec3,
  standing: boolean,
): void {
  rig.ticks = Math.min(rig.ticks + dt * GAME_TICKS_PER_SECOND, 4);
  const target: Vec3 = { x: 0, y: 0, z: 0 };
  const step = (part: MagPartRig) => {
    if (part.record.node < 0 || !anchorOf(part.record.node, target)) {
      target.x = owner.x;
      target.y = owner.y;
      target.z = owner.z;
    }
    magPartTick(part.state, part.record, target, standing);
  };
  while (rig.ticks >= 1) {
    rig.ticks -= 1;
    for (const part of rig.parts) step(part);
  }
  for (const part of rig.parts) {
    const a = toLocal({ x: part.state.anchor.x, y: part.state.anchor.y, z: part.state.anchor.z });
    part.root.position.set(a.x, a.y, a.z);
    part.orbit.position.set(part.state.offset.x, part.state.offset.y, part.state.offset.z);
    const [rx, ry, rz] = magPartRotation(part.state, part.record);
    part.spin.rotation.set(rx, ry, rz, 'ZYX');
  }
}

// Shows or hides a rig (the hubs hide the MAG, UpdateItemVisibility_005c3f7c).
export function setMagRigVisible(rig: MagRig, shown: boolean): void {
  for (const part of rig.parts) part.root.visible = shown;
}

// Frees a rig's geometry (the model's textures are shared).
export function disposeMagRig(rig: MagRig): void {
  for (const part of rig.parts) {
    part.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh) o.geometry.dispose();
    });
  }
}

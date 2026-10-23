// The tekker's 3D item object (formats/tekkeritem.ts has the exe evidence):
// the identified weapon's model, drawn at the description window's place
// (400, 50) in the counter. It has its own WebGL canvas (the counter is 2D);
// the counter copies the canvas each frame and disposes the view on close.
//
// ASSUMED: the model is drawn at scale 1 with 1 unit = 1 pixel, its origin at
// the GUI point, face-on to the camera with no rotation (the exe's matrix from
// FUN_0071b8d4 is not decoded); only weapons (data1[0] = 0) have a model.

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
import { NjcmModelBuilder } from './njcmmesh.ts';
import { HeldWeaponFiles } from './heldweapon.ts';
import { tekkerItemGate, tekkerItemScale, tekkerWeaponModel, TEKKER_ITEM_X, TEKKER_ITEM_Y } from '../formats/tekkeritem.ts';
import { disposeTree } from './dispose.ts';

// The counter's frame: the picture is drawn over the whole 640 x 480 field.
const VIEW_W = 640;
const VIEW_H = 480;

export class TekkerItemView {
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, VIEW_W, VIEW_H, 0, -1000, 1000);
  private model: THREE.Group | null = null;
  private weapons: HeldWeaponFiles;
  private builder = new NjcmModelBuilder();
  private disposed = false;

  constructor(files: ClientFiles) {
    this.weapons = new HeldWeaponFiles(files);
  }

  // Loads the item's model (weapons only). False when the item has none.
  async load(data1: Uint8Array, pmt: ItemPMT | null): Promise<boolean> {
    const key = tekkerWeaponModel(data1, pmt);
    if (!key) return false;
    const weapon = await this.weapons.load(key.type, key.skin);
    if (this.disposed) return false;
    const built = this.builder.build([{ name: 'tekker-item', root: weapon.object, textures: (id) => weapon.textures[id] ?? null }]);
    // Screen space: the origin at the GUI point (y up in the camera), scale from the gate.
    const s = tekkerItemScale(tekkerItemGate());
    built.root.scale.setScalar(s);
    built.root.position.set(TEKKER_ITEM_X, VIEW_H - TEKKER_ITEM_Y, 0);
    this.model = built.root;
    this.scene.add(built.root);
    return true;
  }

  // Draws the object over the counter's field at horizontal offset `extra`
  // (the widescreen shift the counter uses for right-hand windows).
  draw(ctx: CanvasRenderingContext2D, extra: number): void {
    if (!this.model || this.disposed) return;
    if (!this.renderer) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = VIEW_W;
      this.canvas.height = VIEW_H;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(VIEW_W, VIEW_H, false);
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.render(this.scene, this.camera);
    ctx.drawImage(this.canvas!, extra, 0, VIEW_W, VIEW_H);
  }

  // Frees the model's own geometry, materials and the renderer. The textures
  // are the held weapon cache's, so they stay.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.model) {
      this.scene.remove(this.model);
      disposeTree(this.model);
      this.model = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
  }
}

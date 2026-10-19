// Map texture animation driven by a .tam file (see formats/tam.ts):
// UV scrolling for entries with an effect slot, texture swapping for entries
// with a texture animation record. Ticks at the map's 30 Hz rate.

import * as THREE from 'three';
import { TAM_UNITS, type TamFile, type TamScroll, type TamSwap } from '../formats/tam.ts';
import type { MapEntry } from '../formats/nrel.ts';
import { MAP_TICKS_PER_SECOND } from './mapanim.ts';

interface ScrollTrack {
  textures: THREE.Texture[];
  scroll: [number, number];
  speed: [number, number];
}

interface SwapTrack {
  materials: THREE.MeshBasicMaterial[];
  swap: TamSwap;
  step: number;
  counter: number;
}

// FUN_0066f804: offsets are shorts wrapped to +-255 before dividing by 256.
function wrapUnits(v: number): number {
  return (Math.trunc(v) % TAM_UNITS) / TAM_UNITS;
}

export class TextureAnimator {
  private scrolls: ScrollTrack[] = [];
  private swaps: SwapTrack[] = [];
  // Every material copy and texture clone attach() made: nothing else owns them.
  private owned: Array<{ material: THREE.Material; map: THREE.Texture | null }> = [];
  private tam: TamFile;
  private lookup: (id: number) => THREE.Texture | null;

  constructor(tam: TamFile, lookup: (id: number) => THREE.Texture | null) {
    this.tam = tam;
    this.lookup = lookup;
  }

  get count(): number {
    return this.scrolls.length + this.swaps.length;
  }

  // Gives the entry's meshes their own copies of the affected materials.
  attach(entry: MapEntry, root: THREE.Object3D): void {
    if (entry.effect) {
      const def: TamScroll | undefined = this.tam.scrolls.find((s) => s.id === entry.effect!.id);
      if (def) {
        const textures = this.cloneMaterials(root, def.texture).map((m) => m.map!).filter(Boolean);
        if (textures.length) this.scrolls.push({ textures, scroll: [...def.scroll], speed: [...def.speed] });
      }
    }
    if (entry.textureAnim) {
      const swap = this.tam.swaps.find((s) => s.id === entry.textureAnim!.animationId);
      if (swap?.steps.length) {
        const ids = new Set(swap.steps.map((s) => s.texture));
        const materials: THREE.MeshBasicMaterial[] = [];
        for (const id of ids) materials.push(...this.cloneMaterials(root, id));
        if (materials.length) this.swaps.push({ materials, swap, step: 0, counter: 0 });
      }
    }
  }

  private cloneMaterials(root: THREE.Object3D, textureId: number): THREE.MeshBasicMaterial[] {
    const out: THREE.MeshBasicMaterial[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const copy = list.map((m) => {
        if (!(m instanceof THREE.MeshBasicMaterial) || m.userData.textureId !== textureId) return m;
        const c = m.clone();
        if (c.map) {
          c.map = c.map.clone();
          c.map.wrapS = c.map.wrapT = THREE.RepeatWrapping; // FUN_0081a55c forces wrap
          c.map.needsUpdate = true;
        }
        this.owned.push({ material: c, map: c.map });
        out.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? copy : copy[0];
    });
    return out;
  }

  update(dt: number): void {
    const ticks = dt * MAP_TICKS_PER_SECOND;
    for (const s of this.scrolls) {
      s.scroll[0] += s.speed[0] * ticks;
      s.scroll[1] += s.speed[1] * ticks;
      for (const t of s.textures) t.offset.set(wrapUnits(s.scroll[0]), wrapUnits(s.scroll[1]));
    }
    for (const w of this.swaps) {
      w.counter += ticks;
      // A negative frame count (-1 in the data) holds that texture for good.
      while (w.swap.steps[w.step].frames >= 0 && w.counter >= Math.max(1, w.swap.steps[w.step].frames)) {
        w.counter -= Math.max(1, w.swap.steps[w.step].frames);
        w.step = (w.step + 1) % w.swap.steps.length;
        const tex = this.lookup(w.swap.steps[w.step].texture);
        if (tex) for (const m of w.materials) m.map = tex;
      }
    }
  }

  dispose(): void {
    for (const s of this.scrolls) for (const t of s.textures) t.dispose();
    // The swap tracks replace a clone's map by a texture of the map's list (the
    // viewer's), so the clones' own maps are the ones recorded here.
    for (const { material, map } of this.owned) {
      map?.dispose();
      material.dispose();
    }
    this.owned = [];
    this.scrolls = [];
    this.swaps = [];
  }
}

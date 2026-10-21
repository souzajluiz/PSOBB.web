// The placed Battle Mode traps in the field (quest/battletraps.ts), drawn the way the exe
// draws them. The model is bm_o_mine.bml: the trap constructor loads it with
// LoadMineTrapBMLData_006300a4 (VERIFIED, string 0x00932ce0). EnemyDraw_0062e014 draws the
// trap only while its state (+0x32e) is 3 (VERIFIED), the fuse after the trigger: a trap
// that is still armed is not drawn.
//
// The primary model is drawn at the trap's position and the owner's heading (ASSUMED: the
// web's angle is radians, as the object layer's yaw); the secondary model is drawn with it
// (the exe's render flag 0x20 / colour +0x368 is not reproduced, ASSUMED plain).

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { trapDrawn, trapModelParts, type BattleTrap } from '../quest/battletraps.ts';
import { buildEnemy, EnemyArchiveCache, type EnemyArchive } from './enemymodel.ts';
import { disposeTree } from './dispose.ts';
import type { MapViewer } from './mapviewer.ts';

export const TRAP_MODEL_BML = 'bm_o_mine.bml';

export class BattleTrapView {
  private viewer: MapViewer;
  private cache: EnemyArchiveCache;
  private root = new THREE.Group();
  private shown = new Map<BattleTrap, THREE.Group>();
  private archive: EnemyArchive | null = null;
  private loading = false;
  private failed = false;

  constructor(viewer: MapViewer, files: ClientFiles) {
    this.viewer = viewer;
    this.cache = new EnemyArchiveCache(files);
    this.root.name = 'battle-traps';
    viewer.scene.add(this.root);
  }

  // Shows the traps of `traps` in the draw state and removes every other one. The model
  // loads on the first call that needs it; until then the traps wait (the next sync takes them).
  sync(traps: readonly BattleTrap[]): void {
    const want = new Set(traps.filter(trapDrawn));
    for (const [t, g] of this.shown) {
      if (want.has(t)) continue;
      this.root.remove(g);
      disposeTree(g);
      this.shown.delete(t);
    }
    if (want.size === 0) return;
    if (!this.archive) {
      this.load();
      return;
    }
    for (const t of want) if (!this.shown.has(t)) this.add(t);
  }

  // Removes every trap model (the battle ended or the view is left).
  clear(): void {
    this.sync([]);
  }

  dispose(): void {
    this.clear();
    this.viewer.scene.remove(this.root);
  }

  private load(): void {
    if (this.loading || this.failed) return;
    this.loading = true;
    this.cache
      .getAuto(TRAP_MODEL_BML)
      .then((a) => {
        this.archive = a;
      })
      .catch((e: unknown) => {
        this.failed = true;
        console.warn(`battle trap model ${TRAP_MODEL_BML}: ${(e as Error).message}`);
      })
      .finally(() => {
        this.loading = false;
      });
  }

  private add(t: BattleTrap): void {
    const archive = this.archive;
    if (!archive) return;
    const parts = trapModelParts(t.type);
    const built = buildEnemy(archive, [{ model: parts.primary, name: 'trap' }, { model: parts.secondary, name: 'trap fuse' }], 0, this.cache.loadedTextures);
    const g = new THREE.Group();
    g.name = `battle trap ${t.number}`;
    g.add(built.root);
    g.position.set(t.x, t.y, t.z);
    g.rotation.y = t.angle;
    this.root.add(g);
    this.shown.set(t, g);
  }
}

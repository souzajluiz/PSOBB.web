// The model fragments of an exploding machine (rules in combat/shellfragments.ts):
// the enemy's own model, in its rest pose, breaks into one piece per node that
// has a mesh. One tree and one set of materials per burst (the whole object
// shares one alpha), nothing allocated per frame.

import * as THREE from 'three';
import { FRAGMENT_TABLES, ShellFragments, type FragmentNode, type FragmentTable } from '../combat/shellfragments.ts';
import type { EnemyArchive } from './enemymodel.ts';
import type { MapViewer } from './mapviewer.ts';
import { buildObjectTreeWithNodes, MaterialCache } from './njmesh.ts';
import { setModelOpacity } from './hitmodels.ts';

const FRAME = 1 / 30;
const MAX_BURSTS = 6;
const BAMS_RAD = (Math.PI * 2) / 0x10000;

interface Burst {
  shells: ShellFragments;
  root: THREE.Group;
  pieces: THREE.Group[];
  cache: MaterialCache;
}

export class FragmentEffects {
  private viewer: MapViewer;
  private log: (msg: string) => void;
  private bursts: Burst[] = [];
  private acc = 0;
  private disposed = false;
  private hook = (dt: number) => this.frame(dt);

  constructor(viewer: MapViewer, log: (msg: string) => void) {
    this.viewer = viewer;
    this.log = log;
    viewer.frameHooks.add(this.hook);
  }

  /**
   * The fragments of model `modelIndex` of `archive` (the model object the
   * exe built from the same entry), around `at` (the body point), turned by
   * `yaw` (radians, the enemy's heading), with the parameter table `table`.
   */
  spawn(archive: EnemyArchive, modelIndex: number, table: FragmentTable, at: THREE.Vector3, yaw: number, rand: () => number): void {
    if (this.disposed || this.bursts.length >= MAX_BURSTS) return;
    try {
      const m = archive.model(modelIndex);
      const cache = new MaterialCache((id) => (m.textures[id] !== undefined ? archive.texture(m.textures[id]) : null));
      const built = m.kind === 'xj' ? buildObjectTreeWithNodes(m.object, cache) : null;
      if (!built) {
        cache.dispose();
        return;
      }
      built.root.updateMatrixWorld(true);
      const root = new THREE.Group();
      const nodes: FragmentNode[] = [];
      const pieces: THREE.Group[] = [];
      const p = new THREE.Vector3();
      for (const node of built.nodes) {
        const mesh = node.children[0];
        if (!(mesh instanceof THREE.Mesh)) continue;
        p.setFromMatrixPosition(node.matrixWorld);
        nodes.push({ x: p.x, y: p.y, z: p.z });
        // The mesh is drawn at the piece's place with its three angles, without the node's own transform.
        const piece = new THREE.Group();
        piece.rotation.order = 'ZYX';
        mesh.removeFromParent();
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.set(1, 1, 1);
        piece.add(mesh);
        root.add(piece);
        pieces.push(piece);
      }
      if (nodes.length === 0) {
        cache.dispose();
        return;
      }
      const bams = Math.round((yaw / (Math.PI * 2)) * 0x10000) & 0xffff;
      const shells = new ShellFragments(nodes, FRAGMENT_TABLES[table], { x: at.x, y: at.y, z: at.z }, bams, rand);
      const burst: Burst = { shells, root, pieces, cache };
      this.viewer.scene.add(root);
      this.bursts.push(burst);
      this.place(burst);
    } catch (err) {
      this.log(`fragments: ${(err as Error).message}`);
    }
  }

  get count(): number {
    return this.bursts.length;
  }

  private place(b: Burst): void {
    b.shells.pieces.forEach((s, i) => {
      const g = b.pieces[i];
      g.position.set(s.x, s.y, s.z);
      g.rotation.set(s.ax * BAMS_RAD, s.ay * BAMS_RAD, 0);
    });
    setModelOpacity(b.root, b.shells.opacity);
  }

  private drop(b: Burst): void {
    this.viewer.scene.remove(b.root);
    b.cache.dispose();
  }

  private frame(dt: number): void {
    if (this.disposed || this.bursts.length === 0) return;
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= FRAME && ticks < 5) {
      this.acc -= FRAME;
      ticks++;
      this.bursts = this.bursts.filter((b) => {
        b.shells.tick();
        if (b.shells.done) {
          this.drop(b);
          return false;
        }
        this.place(b);
        return true;
      });
    }
    if (this.acc >= FRAME) this.acc = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.viewer.frameHooks.delete(this.hook);
    for (const b of this.bursts) this.drop(b);
    this.bursts = [];
  }
}

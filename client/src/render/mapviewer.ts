// Map viewer: loads map_*n.rel + its .xvm from a DataSource and renders it.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DataSource } from '../data/source.ts';
import { parseMapNRel, type MapGeometry } from '../formats/nrel.ts';
import { parseXvm } from '../formats/xvm.ts';
import { buildObjectTree, MaterialCache } from './njmesh.ts';

export interface MapStats {
  sections: number;
  objects: number;
  meshes: number;
  triangles: number;
  textures: number;
  skippedEntries: number;
}

// "map_city00_00n.rel" -> "map_city00.xvm"; "map_forest01n.rel" -> "map_forest01.xvm"
export function textureArchiveFor(nrel: string): string {
  return nrel.replace(/(_\d\d)?n\.rel$/, '.xvm');
}

export class MapViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mapRoot: THREE.Group | null = null;
  private materials: MaterialCache | null = null;
  private textures: THREE.Texture[] = [];
  private resizeObserver: ResizeObserver;
  private keys = new Set<string>();
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0a1424);
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 20000);
    this.camera.position.set(0, 300, 600);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    canvas.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    canvas.addEventListener('blur', () => this.keys.clear());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // WASD/QE moves camera and orbit target together.
  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const speed = (this.keys.has('shift') ? 1200 : 300) * dt;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();
    if (this.keys.has('w')) move.add(forward);
    if (this.keys.has('s')) move.sub(forward);
    if (this.keys.has('d')) move.add(right);
    if (this.keys.has('a')) move.sub(right);
    if (this.keys.has('e')) move.y += 1;
    if (this.keys.has('q')) move.y -= 1;
    if (move.lengthSq()) {
      move.normalize().multiplyScalar(speed);
      this.camera.position.add(move);
      this.controls.target.add(move);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  async load(source: DataSource, nrelName: string): Promise<MapStats> {
    const nrelData = await source.read(`scene/${nrelName}`);
    const geometry = parseMapNRel(nrelData);
    let xvm: Uint8Array | null = null;
    try {
      xvm = await source.read(`scene/${textureArchiveFor(nrelName)}`);
    } catch {
      xvm = null;
    }
    this.show(geometry, xvm);
    return this.stats(geometry);
  }

  show(geometry: MapGeometry, xvm: Uint8Array | null): void {
    this.clear();
    this.textures = xvm
      ? parseXvm(xvm).map((t) => {
          const tex = new THREE.DataTexture(t.rgba, t.width, t.height, THREE.RGBAFormat);
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.generateMipmaps = true;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          return tex;
        })
      : [];
    this.materials = new MaterialCache((id) => this.textures[id] ?? null);

    const root = new THREE.Group();
    for (const section of geometry.sections) {
      const s = new THREE.Group();
      s.position.set(...section.position);
      s.rotation.set(section.rotation[0], section.rotation[1], section.rotation[2], 'ZYX');
      for (const obj of section.objects) s.add(buildObjectTree(obj, this.materials));
      root.add(s);
    }
    this.scene.add(root);
    this.mapRoot = root;
    this.frameAll();
  }

  frameAll(): void {
    if (!this.mapRoot) return;
    const box = new THREE.Box3().setFromObject(this.mapRoot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, size * 0.45, size * 0.55));
    this.camera.far = Math.max(20000, size * 4);
    this.camera.updateProjectionMatrix();
  }

  private stats(g: MapGeometry): MapStats {
    let objects = 0, meshes = 0, triangles = 0;
    this.mapRoot?.traverse((o) => {
      objects++;
      if (o instanceof THREE.Mesh) {
        meshes++;
        triangles += (o.geometry.index?.count ?? 0) / 3;
      }
    });
    return {
      sections: g.sections.length,
      objects,
      meshes,
      triangles,
      textures: this.textures.length,
      skippedEntries: g.skippedEntries.length,
    };
  }

  clear(): void {
    if (this.mapRoot) {
      this.mapRoot.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.scene.remove(this.mapRoot);
      this.mapRoot = null;
    }
    this.materials?.dispose();
    for (const t of this.textures) t.dispose();
    this.textures = [];
  }
}

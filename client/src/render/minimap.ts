// Draws the minimap of classic/minimap.ts: the floor's rooms
// (map_*r.rel, formats/minimap.ts), the icons and the player markers of
// obj_f_enemy.bml, rendered with three.js into a small offscreen WebGL canvas
// the field HUD copies into its 2D overlay, then the compass sprites of
// RaderMapFrame.xvm. PsoBB.exe (Ephinea 1.25.13) references are in
// classic/minimap.ts.
//
// - Rooms: each discovered room is a flat plate translated to its position
//   and turned by matrix_rotation_euler (X, then Y, then Z; done on the CPU,
//   the floor's rooms are one merged geometry), drawn with the
//   ground colour (0.3 grey) at the room's alpha. The material override
//   (copy_color_to_af0370) replaces the mesh's own white diffuse; the strips
//   ignore the light (strip flags 1).
// - Icons / markers: obj_f_enemy.bml entry 0 (obj_f_enemy, a disc of radius
//   1) is shape 1, entry 1 (obj_f_gate, a box) shapes 0 and 3, entry 2
//   (obj_f_player, an arrow) the player markers
//   (Minimap_CreateObject_00804d94: +0x17c, +0x180, +0x178). ASSUMED: like
//   the rooms, the icon colour replaces the models' material colours.
// - No depth test: the plates lie at y = 0 and are drawn in list order, then
//   the icons, then the markers (the client renders the same order with fog
//   off and one light straight down).

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { BmlArchive } from '../formats/bml.ts';
import { modelTriangles, type MinimapData } from '../formats/minimap.ts';
import { parseNinjaChunkFile, type NjcmModel } from '../formats/njcm.ts';
import { parseXvm } from '../formats/xvm.ts';
import { textureBitmaps } from '../classic/stage.ts';
import {
  BACKGROUND_ALPHA,
  bamsToRad,
  cameraUp,
  CIRCLE_SIZE,
  COMPASS,
  COMPASS_SIZE,
  GROUND_COLOR,
  MAX_ICONS,
  minimapFovy,
  MINIMAP_RECT,
  SWITCH_SIZE,
  type Icon,
  type MinimapState,
} from '../classic/minimap.ts';

const MARKER_CAPACITY = 4;

interface IconModels {
  disc: THREE.BufferGeometry; // obj_f_enemy
  gate: THREE.BufferGeometry; // obj_f_gate
  arrow: THREE.BufferGeometry; // obj_f_player
}

function geometryOf(model: NjcmModel | null): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(model ? modelTriangles(model) : new Float32Array(0), 3));
  return g;
}

function argbColor(argb: number, out: THREE.Color): THREE.Color {
  return out.setRGB(((argb >>> 16) & 0xff) / 255, ((argb >>> 8) & 0xff) / 255, (argb & 0xff) / 255, THREE.LinearSRGBColorSpace);
}

// Assets shared by every floor: the icon models and the compass sprites.
export interface MinimapAssets {
  models: IconModels;
  compass: ImageBitmap[]; // RaderMapFrame.xvm textures 0 and 1
}

export async function loadMinimapAssets(files: ClientFiles): Promise<MinimapAssets> {
  const bml = new BmlArchive((await files.readFirst(['obj_f_enemy.bml'])).data);
  const model = (name: string): NjcmModel | null => (bml.has(name) ? (parseNinjaChunkFile(bml.get(name)).object?.model ?? null) : null);
  const frame = await files.readFirst(['RaderMapFrame.xvm', 'radermapframe.xvm']);
  return {
    models: { disc: geometryOf(model('obj_f_enemy.gj')), gate: geometryOf(model('obj_f_gate.gj')), arrow: geometryOf(model('obj_f_player.gj')) },
    compass: await additiveAsAlpha(await textureBitmaps(parseXvm(frame.data)), 0),
  };
}

// The needle (texture 0) is drawn additively by the exe: opaque colours on a
// black ground. The 2D overlay is transparent over the WebGL view, where a
// 'lighter' composite would add the black's alpha too and leave a black
// square, so the texture gets alpha = its brightest channel (colour divided
// back out) and is drawn with the normal blend instead. Close to additive for
// a bright needle; the ground under it is darkened by 1 - alpha.
async function additiveAsAlpha(bitmaps: ImageBitmap[], index: number): Promise<ImageBitmap[]> {
  const src = bitmaps[index];
  if (!src) return bitmaps;
  const c = new OffscreenCanvas(src.width, src.height);
  const g = c.getContext('2d');
  if (!g) return bitmaps;
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = Math.max(d[i], d[i + 1], d[i + 2]) * (d[i + 3] / 255);
    if (a > 0) {
      const k = 255 / a;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
    d[i + 3] = a;
  }
  g.putImageData(img, 0, 0);
  const out = bitmaps.slice();
  out[index] = await createImageBitmap(c);
  src.close();
  return out;
}


// Releases what loadMinimapAssets made (a HUD disposed while it loaded).
export function disposeMinimapAssets(assets: MinimapAssets): void {
  for (const g of Object.values(assets.models)) g.dispose();
  for (const b of assets.compass) b.close();
}

// The rooms of a floor merged into one geometry: each room's plates are
// transformed on the CPU and carry its colour and alpha per vertex, so the
// floor is one draw call and a fade only rewrites the alpha of a range.
interface RoomBatch {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  colors: THREE.BufferAttribute; // RGBA
  ranges: { start: number; count: number }[]; // vertices per room
  alphas: Float32Array; // last written alpha per room (-1 = hidden)
}

export class MinimapView {
  private renderer: THREE.WebGLRenderer | null = null;
  // The last rendered image, copied out of the WebGL canvas in the same task
  // (no preserveDrawingBuffer); redrawn only when what it shows changed.
  private cache: HTMLCanvasElement | null = null;
  private signature: number[] = [];
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(1, 4 / 3, 1, 10000);
  private roomMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  private batch: RoomBatch | null = null;
  private discs: THREE.InstancedMesh | null = null;
  private gates: THREE.InstancedMesh | null = null;
  private arrows: THREE.InstancedMesh | null = null;
  // Transparent like the rooms so that three.js draws everything in the
  // transparent pass by renderOrder: rooms 0, icons 1, markers 2.
  private iconMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  private assets: MinimapAssets | null = null;
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();
  private size = new THREE.Vector2();
  private viewportScale = new THREE.Matrix4();

  setAssets(assets: MinimapAssets): void {
    this.assets = assets;
    const make = (g: THREE.BufferGeometry, n: number, order: number) => {
      const m = new THREE.InstancedMesh(g, this.iconMaterial, n);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = order;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.scene.add(m);
      return m;
    };
    this.discs = make(assets.models.disc, MAX_ICONS, 1);
    this.gates = make(assets.models.gate, MAX_ICONS, 1);
    this.arrows = make(assets.models.arrow, MARKER_CAPACITY, 2);
    this.signature = [];
  }

  // A floor's rooms (null: the floor has no minimap). The previous floor's
  // geometry is released.
  setRooms(data: MinimapData | null): void {
    this.clearRooms();
    if (!data) return;
    const parts: Float32Array[] = [];
    const ranges: RoomBatch['ranges'] = [];
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    let start = 0;
    for (const r of data.rooms) {
      const tris = modelTriangles(r.model);
      e.set(bamsToRad(r.rotation[0]), bamsToRad(r.rotation[1]), bamsToRad(r.rotation[2]), 'ZYX');
      m.makeRotationFromEuler(e).setPosition(r.position[0], r.position[1], r.position[2]);
      for (let i = 0; i < tris.length; i += 3) {
        v.set(tris[i], tris[i + 1], tris[i + 2]).applyMatrix4(m);
        tris[i] = v.x;
        tris[i + 1] = v.y;
        tris[i + 2] = v.z;
      }
      parts.push(tris);
      ranges.push({ start, count: tris.length / 3 });
      start += tris.length / 3;
    }
    const positions = new Float32Array(start * 3);
    let o = 0;
    for (const p of parts) {
      positions.set(p, o);
      o += p.length;
    }
    const rgba = new Float32Array(start * 4);
    for (let i = 0; i < start; i++) rgba.set([GROUND_COLOR[0], GROUND_COLOR[1], GROUND_COLOR[2], 0], i * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colors = new THREE.BufferAttribute(rgba, 4);
    colors.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', colors);
    const mesh = new THREE.Mesh(geometry, this.roomMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    this.scene.add(mesh);
    this.batch = { mesh, geometry, colors, ranges, alphas: new Float32Array(ranges.length).fill(0) };
    this.signature = [];
  }

  private clearRooms(): void {
    if (!this.batch) return;
    this.scene.remove(this.batch.mesh);
    this.batch.geometry.dispose();
    this.batch = null;
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
      this.renderer.setPixelRatio(1);
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    return this.renderer;
  }

  // The rooms' alpha (0 while undiscovered: the client skips those rooms).
  private fadeRooms(state: MinimapState): void {
    const b = this.batch;
    if (!b) return;
    let dirty = false;
    state.rooms.forEach((room, i) => {
      const range = b.ranges[i];
      if (!range) return;
      const a = room.flags & 1 ? 0 : room.alpha;
      if (b.alphas[i] === a) return;
      b.alphas[i] = a;
      for (let k = range.start; k < range.start + range.count; k++) b.colors.setW(k, a);
      dirty = true;
    });
    if (dirty) b.colors.needsUpdate = true;
  }

  private placeIcons(icons: readonly Icon[]): void {
    const discs = this.discs;
    const gates = this.gates;
    if (!discs || !gates) return;
    discs.count = 0;
    gates.count = 0;
    const t = this.tmp;
    for (const ic of icons) {
      t.position.set(ic.x, 0, ic.z);
      t.rotation.set(0, bamsToRad(ic.heading), 0);
      let mesh: THREE.InstancedMesh;
      if (ic.shape === 1) {
        t.scale.set(CIRCLE_SIZE * ic.scale, 8, CIRCLE_SIZE * ic.scale);
        mesh = discs;
      } else if (ic.shape === 0) {
        t.scale.set(SWITCH_SIZE[0] * ic.scale, 8, ic.scale * SWITCH_SIZE[1]);
        mesh = gates;
      } else if (ic.shape === 3) {
        // 14 when the icon scale is 0.0 (0x0097ecb4), else 17.5.
        t.scale.set(4, 8, ic.scale === 0 ? 14 : 17.5);
        mesh = gates;
      } else {
        // Shape 2 (the arrow, used by the Seabed's dolphin rides) is not
        // produced by the web client.
        continue;
      }
      t.updateMatrix();
      mesh.setMatrixAt(mesh.count, t.matrix);
      mesh.setColorAt(mesh.count, argbColor(ic.color, this.color));
      mesh.count++;
    }
    for (const m of [discs, gates]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private placeMarkers(state: MinimapState): void {
    const arrows = this.arrows;
    if (!arrows) return;
    arrows.count = 0;
    const t = this.tmp;
    for (const mk of state.markers.slice(0, MARKER_CAPACITY)) {
      t.position.set(mk.x, 0, mk.z);
      t.rotation.set(0, bamsToRad(mk.heading), 0);
      t.scale.setScalar(mk.size);
      t.updateMatrix();
      arrows.setMatrixAt(arrows.count, t.matrix);
      arrows.setColorAt(arrows.count, argbColor(mk.color, this.color));
      arrows.count++;
    }
    arrows.instanceMatrix.needsUpdate = true;
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
  }

  // Everything the image depends on, to skip unchanged frames.
  private signatureOf(state: MinimapState, icons: readonly Icon[], pw: number, ph: number): number[] {
    const c = state.camera;
    const out = [state.type, pw, ph, c.x, c.y, c.z, c.yaw, this.assets ? 1 : 0, this.batch ? this.batch.ranges.length : -1];
    for (const r of state.rooms) out.push(r.flags & 1 ? -1 : r.alpha);
    for (const m of state.markers) out.push(m.x, m.z, m.heading, m.color, m.size);
    out.push(-2);
    for (const i of icons) out.push(i.x, i.z, i.color, i.shape, i.scale, i.heading);
    return out;
  }

  // Renders the state's current minimap and draws it into `ctx` (the 640x480
  // virtual space, `scale` device px per unit) at `dx` (the right-edge shift
  // of the radar on a wide screen).
  draw(ctx: CanvasRenderingContext2D, state: MinimapState, scale: number, dx: number): void {
    const rect = MINIMAP_RECT[state.type];
    const x = rect.x + dx;
    // render_minimap_background.
    ctx.fillStyle = `rgba(0, 0, 0, ${BACKGROUND_ALPHA[state.type] / 255})`;
    ctx.fillRect(x, rect.y, rect.w, rect.h);
    const pw = Math.max(1, Math.round(rect.w * scale));
    const ph = Math.max(1, Math.round(rect.h * scale));
    const icons = state.takeIcons();
    const sig = this.signatureOf(state, icons, pw, ph);
    const same = this.cache !== null && sig.length === this.signature.length && sig.every((v, i) => v === this.signature[i]);
    if (!same) {
      this.signature = sig;
      this.render(state, icons, rect, pw, ph);
    }
    if (this.cache) ctx.drawImage(this.cache, x, rect.y, rect.w, rect.h);
    this.drawCompass(ctx, state, dx);
  }

  private render(state: MinimapState, icons: readonly Icon[], rect: { w: number; h: number }, pw: number, ph: number): void {
    const r = this.ensureRenderer();
    const size = r.getSize(this.size);
    if (size.x !== pw || size.y !== ph) r.setSize(pw, ph, false);
    this.fadeRooms(state);
    this.placeIcons(icons);
    this.placeMarkers(state);
    // Camera (unknown_size_minimaps).
    const cam = state.camera;
    const up = cameraUp(cam.yaw);
    this.camera.position.set(cam.x, cam.y, cam.z);
    this.camera.up.set(up.x, 0, up.z);
    this.camera.lookAt(cam.x, cam.y - 1, cam.z);
    this.camera.updateMatrixWorld();
    this.camera.fov = THREE.MathUtils.radToDeg(minimapFovy());
    this.camera.aspect = 4 / 3;
    this.camera.updateProjectionMatrix();
    // set_d3d_projection_matrix: the full screen over the viewport.
    this.camera.projectionMatrix.premultiply(this.viewportScale.makeScale(640 / rect.w, 480 / rect.h, 1));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    r.clear();
    r.render(this.scene, this.camera);
    // Copy in the same task: the drawing buffer is not preserved.
    const cache = (this.cache ??= document.createElement('canvas'));
    if (cache.width !== pw || cache.height !== ph) {
      cache.width = pw;
      cache.height = ph;
    }
    const c2 = cache.getContext('2d');
    if (!c2) return;
    c2.clearRect(0, 0, pw, ph);
    c2.drawImage(r.domElement, 0, 0);
  }

  // MinimapRenderIcon_00804b24.
  private drawCompass(ctx: CanvasRenderingContext2D, state: MinimapState, dx: number): void {
    const tex = this.assets?.compass;
    if (!tex) return;
    const [pulse, needle] = COMPASS[state.type];
    const a = tex[pulse.texture];
    if (a) {
      // unknown_set_blending_save: src alpha, dest 1 - src alpha (blend
      // codes 8 / 6 of d3d8Dev_SetRenderState_Src_Dest_Blend); texture 1
      // has its own alpha.
      ctx.save();
      ctx.globalAlpha *= Math.trunc(state.compassAlpha) / 255;
      ctx.drawImage(a, pulse.x + dx, pulse.y, COMPASS_SIZE, COMPASS_SIZE);
      ctx.restore();
    }
    const b = tex[needle.texture];
    if (b) {
      // unknown_renderstate_blend_save: src alpha, dest ONE (codes 8 / 10):
      // additive. Texture 0 (format 6) is opaque with a black ground, which
      // the addition leaves out; the loader turned it into alpha
      // (additiveAsAlpha), so the normal blend draws it here.
      // RenderMinimapIcon_00819f7c turns the corners by [[c, s], [-s, c]]
      // about the pivot: a canvas rotation by -angle (y down). The full map
      // draws it with heading 0.
      const heading = state.type === 1 ? 0 : state.heading;
      ctx.save();
      ctx.translate(needle.x + needle.pivotX + dx, needle.y + needle.pivotY);
      ctx.rotate(-bamsToRad(heading));
      ctx.drawImage(b, -needle.pivotX, -needle.pivotY, COMPASS_SIZE, COMPASS_SIZE);
      ctx.restore();
    }
  }

  dispose(): void {
    this.clearRooms();
    this.roomMaterial.dispose();
    this.iconMaterial.dispose();
    for (const m of [this.discs, this.gates, this.arrows]) m?.dispose();
    if (this.assets) disposeMinimapAssets(this.assets);
    this.assets = null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.cache = null;
  }
}

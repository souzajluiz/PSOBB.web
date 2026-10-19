// Draws the minimap of classic/minimap.ts: the floor's rooms
// (map_*r.rel, formats/minimap.ts), the icons and the player markers of
// obj_f_enemy.bml, rendered with three.js into a small offscreen WebGL canvas
// the field HUD copies into its 2D overlay, then the compass sprites of
// RaderMapFrame.xvm. PsoBB.exe (Ephinea 1.25.13) references are in
// classic/minimap.ts.
//
// - Rooms: each discovered room is a flat plate translated to its position
//   and turned by matrix_rotation_euler (X, then Y, then Z), drawn with the
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
    compass: await textureBitmaps(parseXvm(frame.data)),
  };
}

export class MinimapView {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(1, 4 / 3, 1, 10000);
  private rooms = new THREE.Group();
  private roomMaterials: THREE.MeshBasicMaterial[] = [];
  private roomGeometries: THREE.BufferGeometry[] = [];
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

  constructor() {
    this.camera.matrixAutoUpdate = true;
    this.scene.add(this.rooms);
  }

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
  }

  // A floor's rooms (null: the floor has no minimap). The previous floor's
  // geometry and materials are released.
  setRooms(data: MinimapData | null): void {
    this.clearRooms();
    if (!data) return;
    for (const r of data.rooms) {
      const g = geometryOf(r.model);
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
      m.color.setRGB(GROUND_COLOR[0], GROUND_COLOR[1], GROUND_COLOR[2], THREE.LinearSRGBColorSpace);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(r.position[0], r.position[1], r.position[2]);
      mesh.rotation.set(bamsToRad(r.rotation[0]), bamsToRad(r.rotation[1]), bamsToRad(r.rotation[2]), 'ZYX');
      mesh.frustumCulled = false;
      mesh.renderOrder = 0;
      mesh.visible = false;
      this.rooms.add(mesh);
      this.roomGeometries.push(g);
      this.roomMaterials.push(m);
    }
  }

  private clearRooms(): void {
    for (const g of this.roomGeometries) g.dispose();
    for (const m of this.roomMaterials) m.dispose();
    this.roomGeometries = [];
    this.roomMaterials = [];
    this.rooms.clear();
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    return this.renderer;
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

  // Renders the state's current minimap and draws it into `ctx` (the 640x480
  // virtual space, `scale` device px per unit) at `dx` (the right-edge shift
  // of the radar on a wide screen).
  draw(ctx: CanvasRenderingContext2D, state: MinimapState, scale: number, dx: number): void {
    const rect = MINIMAP_RECT[state.type];
    const x = rect.x + dx;
    // render_minimap_background.
    ctx.fillStyle = `rgba(0, 0, 0, ${BACKGROUND_ALPHA[state.type] / 255})`;
    ctx.fillRect(x, rect.y, rect.w, rect.h);
    const r = this.ensureRenderer();
    const pw = Math.max(1, Math.round(rect.w * scale));
    const ph = Math.max(1, Math.round(rect.h * scale));
    const size = r.getSize(this.size);
    if (size.x !== pw || size.y !== ph) r.setSize(pw, ph, false);
    // Rooms.
    state.rooms.forEach((room, i) => {
      const mesh = this.rooms.children[i];
      const mat = this.roomMaterials[i];
      if (!mesh || !mat) return;
      mesh.visible = !(room.flags & 1);
      mat.opacity = room.alpha;
    });
    this.placeIcons(state.takeIcons());
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
    ctx.drawImage(r.domElement, x, rect.y, rect.w, rect.h);
    this.drawCompass(ctx, state, dx);
  }

  // MinimapRenderIcon_00804b24.
  private drawCompass(ctx: CanvasRenderingContext2D, state: MinimapState, dx: number): void {
    const tex = this.assets?.compass;
    if (!tex) return;
    const [pulse, needle] = COMPASS[state.type];
    const a = tex[pulse.texture];
    if (a) {
      ctx.save();
      ctx.globalAlpha *= Math.trunc(state.compassAlpha) / 255;
      ctx.drawImage(a, pulse.x + dx, pulse.y, COMPASS_SIZE, COMPASS_SIZE);
      ctx.restore();
    }
    const b = tex[needle.texture];
    if (b) {
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
    this.iconMaterial.dispose();
    for (const m of [this.discs, this.gates, this.arrows]) m?.dispose();
    if (this.assets) {
      for (const g of Object.values(this.assets.models)) g.dispose();
      for (const b of this.assets.compass) b.close();
    }
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}

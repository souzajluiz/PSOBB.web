// NPCs of a floor: the Pioneer 2 / Lab townspeople of map_*e.dat and the
// NPCs of a quest's .dat, drawn with the client's own models (formats/
// npcmodels.ts) at their set-data positions, playing the town idle motion of
// plymotionnpctown.cpt, shown or hidden by their display registers, turning
// to the player who talks to them.
//
// Talking follows EnemyObjectUpdate_0060648c (PsoBB.exe):
//   state 0  the NPC turns towards the talking player by at most 0x400 BAMS a
//            tick; once within one step it faces the player, the player is
//            turned to face it (6x3E with the NPC's angle + 0x8000) and
//   state 1  the talk thread starts at the NPC's label (param5) in the quest
//            (action 100..999) or the area script (action >= 1000);
//   state 2  waits for that thread to end, then
//   state 3  resets: mode 0, and the next tick picks mode 1 (turn back to the
//            spawn angle) or 2 (wander) again.
// The talk start (vtable +0x2c, 0x006072e0) puts the NPC in mode 3 with its
// walk motion, which it plays while it turns; facing the player it goes idle.
// Outside the talk the NPC runs the modes of render/npcwander.ts: the walking
// townspeople (param6 = 1) wander around their spawn point, the others stand.
// Its round hitbox (radius 5, 0x009c3ecc) blocks the players
// (CollisionWorld.bodies) and the other NPCs.

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { NjcmObject } from '../formats/njcm.ts';
import { parseNjcmObject } from '../formats/njcm.ts';
import type { NjMotion } from '../formats/njmotion.ts';
import {
  NPC_CAMERA_MOVER_LERP,
  NPC_CAMERA_MOVER_VIEWS,
  NPC_MOTION_TABLES,
  NPC_TALK_CAMERA_MOVERS,
  NPC_TALK_COS,
  NPC_TALK_NO_TURN,
  NPC_TALK_RANGE,
  NPC_TOWN_MOTION_FILE,
  NPC_TURN_STEP,
  npcModelFor,
  npcParams,
  npcShown,
  QUEST_NPC_TYPE,
  questNpcTemplate,
  parseNpcTownMotions,
  type NpcClass,
  type NpcModelContext,
  type NpcModelSource,
  type NpcParams,
} from '../formats/npcmodels.ts';
import { NPC_ENEMY_TYPES } from '../formats/enemymodels.ts';
import { NPC_PLAYER_FILE, parseNpcPlayerTemplates, type NpcPlayerTemplate } from '../formats/npcplayerchar.ts';
import { LOCOMOTION_FACTOR, locomotionSlot, PLAYER_MOTION_FILE, PlayerMotions, townMotion } from '../formats/plymotion.ts';
import { RelFile } from '../formats/rel.ts';
import type { PlacedEntity } from '../formats/setdata.ts';
import { EnemyArchive, NodeAnimator, texturesFromXvm } from './enemymodel.ts';
import { PlayerAnimator } from './playeranim.ts';
import { buildPlayerModel, classLetter, loadPlayerAssets, type PlayerAssets } from './playermodel.ts';
import type { MapViewer } from './mapviewer.ts';
import { NjcmModelBuilder } from './njcmmesh.ts';
import type { CollisionWorld } from './collision.ts';
import { lerpPoint, type Vec3 } from './playercamera.ts';
import { TickClock } from './smoothrender.ts';
import { NPC_RADIUS, npcBrain, npcCollide, npcTalkEnd, npcTalkStart, npcTick, type NpcBrain, type NpcWorld } from './npcwander.ts';

const BAMS = 0x10000;
const TWO_PI = Math.PI * 2;
const toBams = (rad: number) => Math.round((rad / TWO_PI) * BAMS) & 0xffff;
const fromBams = (b: number) => ((b & 0xffff) / BAMS) * TWO_PI;
// Signed difference b - a in BAMS (-0x8000..0x7fff).
const bamsDiff = (a: number, b: number) => ((((b - a) & 0xffff) + 0x8000) & 0xffff) - 0x8000;

// A built NPC model (no placement).
export interface NpcModel {
  root: THREE.Group;
  nodes: THREE.Object3D[];
  flags: number[];
  missingTextures: number;
  triangles: number;
  height: number; // top of the bind pose bounding box
}

function flagsDepthFirst(o: NjcmObject, out: number[] = []): number[] {
  out.push(o.flags);
  for (const c of o.children) flagsDepthFirst(c, out);
  return out;
}

// Loads and caches what NPC models need (the BML / REL archives, the texture
// archives and the town motions).
export class NpcAssets {
  private files: ClientFiles;
  private bmls = new Map<string, Promise<EnemyArchive>>();
  private rels = new Map<string, Promise<{ object: NjcmObject; textures: THREE.Texture[] }>>();
  private motions: Promise<NjMotion[]> | null = null;
  private templates: Promise<NpcPlayerTemplate[]> | null = null;
  private playerMotionsP: Promise<PlayerMotions> | null = null;
  private playerAssetsByClass = new Map<number, Promise<PlayerAssets>>();

  constructor(files: ClientFiles) {
    this.files = files;
  }

  townMotions(): Promise<NjMotion[]> {
    this.motions ??= this.files.read(NPC_TOWN_MOTION_FILE).then((d) => parseNpcTownMotions(d));
    return this.motions;
  }

  // The quest NPCs' records (npcplayerchar.dat) and the player motion table.
  questTemplates(): Promise<NpcPlayerTemplate[]> {
    this.templates ??= this.files.read(NPC_PLAYER_FILE).then((d) => parseNpcPlayerTemplates(d));
    return this.templates;
  }

  playerMotions(): Promise<PlayerMotions> {
    this.playerMotionsP ??= this.files.read(PLAYER_MOTION_FILE).then((d) => new PlayerMotions(d));
    return this.playerMotionsP;
  }

  playerAssets(charClass: number): Promise<PlayerAssets> {
    let p = this.playerAssetsByClass.get(charClass);
    if (!p) this.playerAssetsByClass.set(charClass, (p = loadPlayerAssets(this.files, charClass)));
    return p;
  }

  // Builds the model the constructor draws (model entry 0 and its texture
  // list, or the REL's NJS_OBJECT with the separate texture archive).
  async build(source: NpcModelSource): Promise<NpcModel> {
    let object: NjcmObject;
    let lookup: (id: number) => THREE.Texture | null;
    if (source.kind === 'bml') {
      let p = this.bmls.get(source.bml);
      if (!p) {
        p = this.files.read(source.bml).then((d) => new EnemyArchive(source.bml, d, 1));
        this.bmls.set(source.bml, p);
      }
      const archive = await p;
      const m = archive.model(0);
      if (m.kind !== 'nj') throw new Error(`${source.bml}: model 0 is not a chunk model`);
      object = m.object;
      lookup = (id) => (m.textures[id] !== undefined ? archive.texture(m.textures[id]) : null);
    } else {
      let p = this.rels.get(source.rel);
      if (!p) {
        p = (async () => {
          const data = await this.files.read(source.rel);
          const rel = new RelFile(data);
          // load_rel_asset: the root's first pointer is the NJS_OBJECT.
          const obj = parseNjcmObject(data, rel.u32(rel.root));
          return { object: obj, textures: texturesFromXvm(await this.files.read(source.textures)) };
        })();
        this.rels.set(source.rel, p);
      }
      const r = await p;
      object = r.object;
      lookup = (id) => r.textures[id] ?? null;
    }
    const built = new NjcmModelBuilder().build([{ name: source.kind === 'bml' ? source.bml : source.rel, root: object, textures: lookup }]);
    built.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built.root);
    return {
      root: built.root,
      nodes: built.partBones[0],
      flags: flagsDepthFirst(object),
      missingTextures: built.stats.missingTextures,
      triangles: built.stats.triangles,
      height: Number.isFinite(box.max.y) ? box.max.y : 16,
    };
  }

  dispose(): void {
    void Promise.all([...this.bmls.values()].map((p) => p.then((a) => a.dispose()).catch(() => null)));
    void Promise.all(
      [...this.rels.values()].map((p) =>
        p.then((r) => r.textures.forEach((t) => t.dispose())).catch(() => null),
      ),
    );
    this.bmls.clear();
    this.rels.clear();
  }
}

export type NpcTalkState = 'idle' | 'turning' | 'talking';

export interface NpcInstance {
  placed: PlacedEntity;
  // Name for the log (the NPC class, or the enemy model's name for an enemy-built NPC).
  name: string;
  // The NPC class; null for the quest NPC (0x118), which is an NPC player, and for
  // the enemy-built NPCs (adoptEnemyNpcs).
  cls: NpcClass | null;
  // The npcplayerchar.dat class of a quest NPC (its motions are the player's).
  charClass: number | null;
  params: NpcParams;
  root: THREE.Object3D;
  // NodeAnimator: the 64-node NPC skeleton; PlayerAnimator: a quest NPC's player model;
  // null for an enemy-built NPC, whose enemy layer animator plays its motion.
  animator: NodeAnimator | PlayerAnimator | null;
  // An enemy-built NPC (TObjNpcEnemy / Rappy / Hildebear / Chaos Bringer NPC): it talks
  // but does not wander (ASSUMED: the wander modes of its vtable are not traced).
  fixed: boolean;
  angle: number; // BAMS, obj+0x60
  height: number;
  state: NpcTalkState;
  shown: boolean;
  brain: NpcBrain; // modes / wander (npcwander.ts)
  motion: 0 | 1; // motion row playing: 0 idle, 1 walk
}

export interface NpcLayerHost {
  // Quest / area-script register reads for the display registers.
  questRegister?: (r: number) => number;
  areaRegister?: (r: number) => number;
  // Starts the talk thread; resolves when it ended.
  talk?: (npc: NpcInstance) => Promise<void> | void;
  // Turn the local player to `angle` (radians) when the NPC starts talking.
  facePlayer?: (angle: number) => void;
  // The camera's current source / target (a camera mover starts there).
  cameraView?: () => { source: Vec3; target: Vec3 } | null;
  // UpdateDefaultNPCCameraOrientation_004d83f4 (the camera turns aside).
  defaultTalkCamera?: () => void;
  // EnemyObjectUpdate state 2 -> 3 (FUN_004d7e4c clears the talk flag): the
  // talk ended and no camera mover of it is running.
  defaultTalkEnd?: () => void;
  log?: (msg: string) => void;
}

export interface NpcLayerStats {
  placed: number;
  hidden: number; // classes the client does not draw on this map
  unresolved: string[];
  errors: string[];
  missingTextures: number;
}

export class NpcLayer {
  private viewer: MapViewer;
  readonly assets: NpcAssets;
  private root: THREE.Group | null = null;
  private generation = 0;
  private tickRemainder = 0;
  host: NpcLayerHost = {};
  instances: NpcInstance[] = [];
  stats: NpcLayerStats = { placed: 0, hidden: 0, unresolved: [], errors: [], missingTextures: 0 };
  private talker: { npc: NpcInstance; target: { x: number; z: number } } | null = null;
  // The talk's camera mover (NpcCamera, update 0x004d5f88) while it lives.
  private mover: { type: number; source: Vec3; target: Vec3 } | null = null;
  private hook = (dt: number) => this.frame(dt);
  // The ticks of frame(), for the smoother (render/smoothrender.ts): the
  // wanderers' steps are drawn between ticks.
  private readonly tickClock = new TickClock();
  private readonly smoothHook = () => {
    for (const n of this.instances) if (n.shown) this.viewer.smoother.track(n.root, this.tickClock);
  };
  private motions: NjMotion[] = [];
  // The floor's map collision: the wanderers walk on it, and the NPC
  // hitboxes are handed to it as bodies that block the player.
  private collision: CollisionWorld | null = null;
  private world: NpcWorld = { collision: null, rand: Math.random };
  // Where the players of the floor stand (the NPCs' collision pass).
  players: () => readonly { x: number; z: number }[] = () => [];

  constructor(viewer: MapViewer, files: ClientFiles) {
    this.viewer = viewer;
    this.assets = new NpcAssets(files);
    viewer.frameHooks.add(this.hook);
    viewer.renderHooks.add(this.smoothHook);
  }

  // Builds the NPCs among `items` (category 'npc'); returns the entries that
  // got a model so the caller does not draw markers for them.
  async show(items: PlacedEntity[], ctx: NpcModelContext): Promise<Set<PlacedEntity>> {
    this.clear();
    const gen = ++this.generation;
    const done = new Set<PlacedEntity>();
    const stats: NpcLayerStats = { placed: 0, hidden: 0, unresolved: [], errors: [], missingTextures: 0 };
    const root = new THREE.Group();
    root.name = 'npcs';
    const instances: NpcInstance[] = [];
    let motions: NjMotion[] = [];
    try {
      motions = await this.assets.townMotions();
    } catch (err) {
      stats.errors.push(`${NPC_TOWN_MOTION_FILE}: ${(err as Error).message}`);
    }
    for (const p of items) {
      const e = p.entity;
      if (e.kind !== 'enemy' || p.category !== 'npc') continue;
      // The enemy factories' quest NPCs are modelled by the enemy layer.
      if (NPC_ENEMY_TYPES.has(e.type)) continue;
      if (e.type === QUEST_NPC_TYPE) {
        try {
          const built = await this.buildQuestNpc(p);
          if (gen !== this.generation) return done;
          if (!built) {
            stats.unresolved.push(p.name);
            continue;
          }
          root.add(built.npc.root);
          instances.push(built.npc);
          done.add(p);
          stats.placed++;
          stats.missingTextures += built.missingTextures;
        } catch (err) {
          stats.errors.push(`${p.name}: ${(err as Error).message}`);
        }
        continue;
      }
      const resolved = npcModelFor(e.type, ctx);
      if (!resolved) {
        // Known class whose model this map does not load, or no model at all.
        if (e.type >= 0xf2 && e.type <= 0xff) {
          stats.hidden++;
          done.add(p);
        } else stats.unresolved.push(p.name);
        continue;
      }
      try {
        const model = await this.assets.build(resolved.source);
        if (gen !== this.generation) return done;
        const group = new THREE.Group();
        group.name = `${resolved.cls.name} #${e.index}`;
        group.position.set(p.world[0], p.world[1], p.world[2]);
        group.add(model.root);
        group.userData.entity = p;
        const idle = NPC_MOTION_TABLES[resolved.cls.family].idle;
        const motion = motions[idle.motion];
        const animator = motion
          ? new NodeAnimator(model.nodes, model.flags, motion, idle.speed, true, ((e.index * 0.618034) % 1) * (motion.frameCount - 1))
          : new NodeAnimator(model.nodes, model.flags, { frameCount: 0, type: 0, spline: false, shortAngles: true, nodes: [] }, 0, true);
        const params = npcParams(e.params);
        const npc: NpcInstance = {
          placed: p,
          name: resolved.cls.name,
          cls: resolved.cls,
          charClass: null,
          params,
          root: group,
          animator,
          fixed: false,
          angle: toBams(p.yaw),
          height: model.height,
          state: 'idle',
          shown: true,
          brain: npcBrain(p.world[0], p.world[1], p.world[2], toBams(p.yaw), e.params),
          motion: 0,
        };
        group.rotation.y = fromBams(npc.angle);
        root.add(group);
        instances.push(npc);
        done.add(p);
        stats.placed++;
        stats.missingTextures += model.missingTextures;
      } catch (err) {
        stats.errors.push(`${p.name}: ${(err as Error).message}`);
      }
    }
    if (gen !== this.generation) return done;
    this.viewer.scene.add(root);
    this.root = root;
    this.instances = instances;
    this.motions = motions;
    this.stats = stats;
    this.updateVisibility();
    return done;
  }

  // The Episode 4 quest NPC (0x118, formats/npcmodels.ts QUEST_NPC_TYPE): an NPC
  // player built from its npcplayerchar.dat record, with the player's town idle /
  // walk motions (ASSUMED: the dispatcher's own motion row is not traced). Returns
  // null when the record does not exist.
  private async buildQuestNpc(p: PlacedEntity): Promise<{ npc: NpcInstance; missingTextures: number } | null> {
    const e = p.entity;
    if (e.kind !== 'enemy') return null;
    const templates = await this.assets.questTemplates();
    const t = templates[questNpcTemplate(e.params[5])];
    if (!t) return null;
    const [assets, motions] = await Promise.all([this.assets.playerAssets(t.charClass), this.assets.playerMotions()]);
    const built = buildPlayerModel(assets, t.appearance);
    const body = assets.parts.get(`pl${classLetter(t.charClass)}bdy00.nj`);
    if (!body) return null;
    built.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built.root);
    const group = new THREE.Group();
    group.name = `quest NPC ${t.name} #${e.index}`;
    group.position.set(p.world[0], p.world[1], p.world[2]);
    group.add(built.root);
    group.userData.entity = p;
    const animator = new PlayerAnimator(built.partBones[0]!, body, motions);
    const angle = toBams(p.yaw);
    const npc: NpcInstance = {
      placed: p,
      name: '__QUEST_NPC__',
      cls: null,
      charClass: t.charClass,
      params: npcParams(e.params),
      root: group,
      animator,
      fixed: false,
      angle,
      height: Number.isFinite(box.max.y) ? box.max.y : 16,
      state: 'idle',
      shown: true,
      brain: npcBrain(p.world[0], p.world[1], p.world[2], angle, e.params),
      motion: 0,
    };
    animator.play(townMotion(t.charClass, locomotionSlot(t.charClass, 'idle')), LOCOMOTION_FACTOR.idle, (slot) => townMotion(t.charClass, slot));
    group.rotation.y = fromBams(angle);
    return { npc, missingTextures: built.stats.missingTextures };
  }

  // The enemy-built NPCs of the floor (0x33 TObjNpcEnemy, 0x45 Rappy, 0x46 Hildebear,
  // 0xa9 Chaos Bringer NPC, 0x118 is built above) are drawn by the enemy layer. Their
  // factories run the same NPC code as the humanoid NPCs: vtable +0x160 is
  // EnemyObjectUpdate_0060648c (the talk), +0x164 the set_params override 0x00606a34
  // (action / label / display registers), +0x2c the talk start 0x006072e0. Verified
  // in PsoBB.exe: vtables 0x00b1e680 (0x33), 0x00b215c0 (0x45), 0x00b22960 (0x46),
  // 0x00b1e000 (0xa9). So each one gets a talk entry here, with the enemy layer's root
  // (the model stays theirs; ASSUMED: no wander, the motion is the enemy's idle row).
  adoptEnemyNpcs(entries: { placed: PlacedEntity; root: THREE.Object3D }[]): void {
    for (const { placed: p, root } of entries) {
      const e = p.entity;
      if (e.kind !== 'enemy') continue;
      const angle = toBams(p.yaw);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      this.instances.push({
        placed: p,
        name: root.name.split(' #')[0] || 'enemy NPC',
        cls: null,
        charClass: null,
        params: npcParams(e.params),
        root,
        animator: null,
        fixed: true,
        angle,
        height: Number.isFinite(box.max.y) ? box.max.y : 16,
        state: 'idle',
        shown: true,
        brain: npcBrain(p.world[0], p.world[1], p.world[2], angle, e.params),
        motion: 0,
      });
    }
    this.updateVisibility();
  }

  // UpdateMovementRestriction_00606f10: each NPC's display registers.
  updateVisibility(): void {
    for (const n of this.instances) {
      const reg = n.params.displayAreaScript ? this.host.areaRegister : this.host.questRegister;
      n.shown = npcShown(n.params, (r) => reg?.(r) ?? 0);
      n.root.visible = n.shown;
    }
    this.publishBodies();
  }

  // The NPC a player at (x, z) facing `yaw` (radians, three.js convention)
  // can talk to: shown, with a talk label, within NPC_TALK_RANGE and in front.
  talkTarget(x: number, z: number, yaw: number): NpcInstance | null {
    let best: NpcInstance | null = null;
    let bestD = NPC_TALK_RANGE * NPC_TALK_RANGE;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (const n of this.instances) {
      if (!n.shown || !n.params.script) continue;
      const dx = n.root.position.x - x;
      const dz = n.root.position.z - z;
      const d = dx * dx + dz * dz;
      if (d > bestD) continue;
      const len = Math.sqrt(d) || 1;
      if ((dx * fx + dz * fz) / len < NPC_TALK_COS) continue;
      best = n;
      bestD = d;
    }
    return best;
  }

  get talking(): boolean {
    return this.talker !== null;
  }

  // Starts the talk with `npc` for a player standing at (x, z).
  startTalk(npc: NpcInstance, x: number, z: number): void {
    if (this.talker) return;
    npc.state = 'turning';
    npcTalkStart(npc.brain);
    this.setMotion(npc, npc.brain.motion);
    this.talker = { npc, target: { x, z } };
  }

  // The floor's map collision (null when the floor has none).
  attach(collision: CollisionWorld | null): void {
    if (this.collision && this.collision !== collision) this.collision.bodies = [];
    this.collision = collision;
    this.world.collision = collision;
    this.publishBodies();
  }

  // Plays row `m` of the NPC's motion table (vtable +0x168, 0x0060c834).
  private setMotion(n: NpcInstance, m: 0 | 1): void {
    if (n.motion === m) return;
    n.motion = m;
    if (!n.animator) return; // an enemy-built NPC: its enemy layer animator plays
    if (n.animator instanceof PlayerAnimator) {
      // A quest NPC: the player's town idle / walk of its class (ASSUMED, see buildQuestNpc).
      const c = n.charClass ?? 0;
      const kind = m === 1 ? 'walk' : 'idle';
      n.animator.play(townMotion(c, locomotionSlot(c, kind)), LOCOMOTION_FACTOR[kind], (slot) => townMotion(c, slot));
      return;
    }
    if (!n.cls) return;
    const row = NPC_MOTION_TABLES[n.cls.family][m === 1 ? 'walk' : 'idle'];
    const motion = this.motions[row.motion];
    if (motion) n.animator.play(motion, row.speed, true);
  }

  // The shown NPCs' hitboxes block the players (CollisionWorld.bodies).
  private publishBodies(): void {
    if (!this.collision) return;
    this.collision.bodies = this.instances.filter((n) => n.shown).map((n) => ({ x: n.root.position.x, z: n.root.position.z, radius: NPC_RADIUS }));
  }

  // NPC whose talk action is `id` (opcode_message names the speaker this way).
  byAction(id: number): NpcInstance | null {
    return this.instances.find((n) => n.params.action === id && n.shown) ?? this.instances.find((n) => n.params.action === id) ?? null;
  }

  private frame(dt: number): void {
    for (const n of this.instances) if (n.shown) n.animator?.update(dt);
    this.tickRemainder += dt * 30;
    const ticks = Math.min(Math.floor(this.tickRemainder), 30);
    this.tickRemainder -= Math.floor(this.tickRemainder);
    for (let i = 0; i < ticks; i++) this.tick();
    this.tickClock.advance(ticks, this.tickRemainder);
    if (ticks) this.publishBodies();
  }

  // One 30 Hz tick: the modes of the NPCs nobody talks to, then the talk.
  private tick(): void {
    const players = this.players();
    for (const n of this.instances) {
      // ASSUMED: a hidden NPC (display registers) neither moves nor collides.
      if (!n.shown || n.fixed || n.brain.mode === 3) continue;
      const b = n.brain;
      const px = b.x, py = b.y, pz = b.z;
      npcTick(b, this.world);
      const bodies = [
        ...players.map((p) => ({ x: p.x, z: p.z, radius: NPC_RADIUS })),
        ...this.instances.filter((o) => o !== n && o.shown).map((o) => ({ x: o.brain.x, z: o.brain.z, radius: NPC_RADIUS })),
      ];
      npcCollide(b, px, py, pz, bodies, this.world);
      n.root.position.set(b.x, b.y, b.z);
      n.angle = b.angle;
      n.root.rotation.y = fromBams(n.angle);
      this.setMotion(n, b.motion);
    }
    this.talkTick();
  }

  // One 30 Hz tick of the talk state machine.
  private talkTick(): void {
    this.moverTick();
    const t = this.talker;
    if (!t || t.npc.state !== 'turning') return;
    const n = t.npc;
    const dx = t.target.x - n.root.position.x;
    const dz = t.target.z - n.root.position.z;
    // fpatan(dx, dz) * 65536 / (2 pi) (0x0092f0f8 / 0x0092f0f0).
    const want = toBams(Math.atan2(dx, dz));
    const diff = bamsDiff(n.angle, want);
    // NPC_TALK_NO_TURN: the NPC keeps its angle, the player turns to it.
    const noTurn = NPC_TALK_NO_TURN.has(n.params.action);
    if (noTurn || Math.abs(diff) < NPC_TURN_STEP) {
      if (!noTurn) {
        n.angle = want;
        n.brain.angle = want;
        n.root.rotation.y = fromBams(n.angle);
      }
      n.state = 'talking';
      this.setMotion(n, 0); // vtable +0x168(0)
      this.host.facePlayer?.(fromBams(want + 0x8000));
      this.startTalkCamera(n);
      void Promise.resolve(this.host.talk?.(n))
        .catch((err) => this.host.log?.(`npc talk: ${(err as Error).message}`))
        .finally(() => {
          n.state = 'idle';
          npcTalkEnd(n.brain);
          // State 3: the camera mover is flagged for deletion, and a talk
          // without a mover ends the camera's talk.
          if (!NPC_TALK_CAMERA_MOVERS.has(n.params.action)) this.host.defaultTalkEnd?.();
          this.mover = null;
          if (this.talker?.npc === n) this.talker = null;
        });
      return;
    }
    n.angle = (n.angle + Math.sign(diff) * NPC_TURN_STEP) & 0xffff;
    n.brain.angle = n.angle;
    n.root.rotation.y = fromBams(n.angle);
  }

  // EnemyObjectUpdate state 1: a camera mover, the default talk camera, or
  // nothing (NPC_TALK_CAMERA_MOVERS).
  private startTalkCamera(n: NpcInstance): void {
    const type = NPC_TALK_CAMERA_MOVERS.get(n.params.action);
    if (type !== undefined) {
      const cur = this.host.cameraView?.();
      const goal = NPC_CAMERA_MOVER_VIEWS.get(type)!;
      const v = (a: [number, number, number]): Vec3 => ({ x: a[0], y: a[1], z: a[2] });
      // NpcCamera_Construct_004d6074 starts from the camera's current view.
      this.mover = { type, source: cur?.source ?? v(goal.source), target: cur?.target ?? v(goal.target) };
      return;
    }
    if (!NPC_TALK_NO_TURN.has(n.params.action)) this.host.defaultTalkCamera?.();
  }

  // NpcCamera update 0x004d5f88: ease toward the type's view.
  private moverTick(): void {
    const m = this.mover;
    if (!m) return;
    const goal = NPC_CAMERA_MOVER_VIEWS.get(m.type)!;
    m.source = lerpPoint(m.source, { x: goal.source[0], y: goal.source[1], z: goal.source[2] }, NPC_CAMERA_MOVER_LERP);
    m.target = lerpPoint(m.target, { x: goal.target[0], y: goal.target[1], z: goal.target[2] }, NPC_CAMERA_MOVER_LERP);
  }

  // The view the talk's camera mover puts on screen (null: none).
  talkCameraView(): { source: Vec3; target: Vec3 } | null {
    return this.mover ? { source: this.mover.source, target: this.mover.target } : null;
  }

  // Head point (world) of an NPC, for the speech balloon.
  head(n: NpcInstance): THREE.Vector3 {
    return n.root.position.clone().add(new THREE.Vector3(0, n.height, 0));
  }

  clear(): void {
    this.generation++;
    this.instances = [];
    this.talker = null;
    this.mover = null;
    if (this.collision) this.collision.bodies = [];
    if (!this.root) return;
    this.viewer.scene.remove(this.root);
    const materials = new Set<THREE.Material>();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    });
    for (const m of materials) m.dispose();
    this.root = null;
  }

  dispose(): void {
    this.clear();
    this.viewer.frameHooks.delete(this.hook);
    this.viewer.renderHooks.delete(this.smoothHook);
    this.assets.dispose();
  }
}


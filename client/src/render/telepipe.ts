// Telepipes in the world (net/telepipe.ts has the state and the commands):
//
//   - the field pipe (ChallengeObjectEntity_Constructor_006e84f0, update
//     ChallengeEntity_Update_006e88d0): made by Ryuker / the Telepipe item on
//     the caster's client (unknown_cast_tech case ryuker, use_telepipe), by
//     another player's 6x68 when that player is on our floor
//     (ProcessTelepipeTeleportRequest_006e9410) and for every pipe of the
//     floor when it loads (SpawnChallengeEntityForUnsafeFloor_006e9548).
//     State 0 opens it (CreateChallengeEnemyEntity_006e8ca4: the particles
//     on the ground below, set_saved_telepipe_information and 6x68 for our
//     own); state 1 waits for the local player to use it (its trigger
//     entity, vtable 0x00b3dae0 +0x2c, sets +0xb0) and goes away when the
//     owner's state no longer names it; using it: the flash 0xB3, 6x2C {10
//     frames}, SE 0xA1, state 2 counts 10 frames, state 3 warps to floor 0
//     (send_change_floor_packet, SetFloorAndMapVariant_00815590);
//   - the Pioneer 2 pipe (TObjLuker, set data type 0x41, param4 = owner;
//     SinowberillMapObjectUpdateHandler_0066e3bc): while the owner's pipe is
//     open it shows the same particles (EnemyEntity_ConstructorComplex
//     _006e915c) and, with the player within 10 units, a window at 0x35
//     naming the pipe's area; the key of binding 0xC (Select Left: the left
//     arrow in the default config) uses it: the flash, 6x2C, SE 0xA1, 10
//     frames, then the warp to the pipe's floor. The owner's own trip closes
//     its pipe (floor 0) and sends 6x68.
//   - Arrival (GetTeleportTargetDataForPlayer_006e9630): Pioneer 2 at the
//     table spot of the client id, the field at the pipe.
//
// ASSUMED: the field pipe is used with the same key and range as the
// Pioneer 2 one (the client reaches its trigger through the targeting
// system, not modelled). The ring 0xB0 is the third particle of the pipe:
// CreateChallengeEnemyEntity_006e8ca4 makes particle index 2 at (x, ground y
// + DAT_0096d960 = 1.8, z) from the table DAT_0096d800 (row 0 = 0xB1 0xB2
// 0xB0), tinted by DAT_0096d928 (colour per owner; 0xFFB2B2 0x99FFB2 0xFFFFB2
// 0, the owner 3 untinted). Type-1 ring: classic/particles.ts RingParams,
// ParticleEffectInstance_Update_0050f3fc.
// The loop sound 0xA0 (SE_TELEPIPE_LOOP, net/telepipe.ts) is
// PlayDirectionalSFX_00814630(0xa0, pipe, pipe pos) every frame of state 1 of
// ChallengeEntity_Update_006e88d0 (dump 0x006e88d0, VERIFIED). It is a
// positional voice at the pipe (`at`), and FUN_008144b0 (dump, VERIFIED) never
// makes slot 0xa0 2D; it is still culled 300 or more away (not in areas
// 0xe / 0x1f / 0x2c). The exe restarts nothing: PlaySFX_008292dc keys a live
// voice by owner and id, refreshes its keep-alive counter to 5, the wave loops
// on its loop points, and the voice ends about 6 ticks after the calls stop
// (ASSUMED: the countdown is per game tick). The port keys by id only: one
// voice, moved to the open pipe nearest the local player (nearestPipe,
// ASSUMED), stopped as soon as no field pipe is open (the tail is shorter).
// No light: the pipe code makes no point light. The object made 15 above the
// pipe (EnemyEntity_Constructor_00503450, vtable 0x00afea00, sub-object
// type 0x1f, DAT_0096d95c = 15) is NOT drawn: its update 0x00503560 counts
// +0x3c down only when it is non-zero (here 0), so it lives until its
// sub-object goes; its drawing was not recovered. The D3D point lights 1..4
// are only defaulted (set_d3d_point_light_defaults) and never enabled; the
// per-entity light definitions are the player's (level-up, technique cast,
// warp). The Ryuker cast object's timing (ChallengeObject_Initialize_006a3df0)
// is not recovered.

import * as THREE from 'three';
import { se, sePlaying, seStop } from '../audio/se.ts';
import { isSafeMap } from '../classic/fieldmenu.ts';
import { KEYS } from '../input/keyconfig.ts';
import { parseParticleEntry, particleQuad, particleShade, ParticleSystem, type ParticleEntry } from '../classic/particles.ts';
import { textureBitmaps } from '../classic/stage.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { PlacedEntity } from '../formats/setdata.ts';
import type { Game } from '../net/game.ts';
import {
  buildImposeHold,
  buildTelepipeState,
  nearestPipe,
  pioneer2Arrival,
  PIPE_COLORS,
  PIPE_PARTICLES,
  PIPE_USE_PARTICLE,
  samePipe,
  SE_TELEPIPE_LOOP,
  SE_TELEPIPE_OPEN,
  SE_TELEPIPE_USE,
  TELEPIPE_HOLD_FRAMES,
  TELEPIPE_USE_RANGE,
  telepipeAllowed,
  telepipeOpen,
  USE_FRAMES_CITY,
  USE_FRAMES_FIELD,
  type TelepipeState,
} from '../net/telepipe.ts';
import type { MapViewer } from './mapviewer.ts';

const FRAME = 1 / 30;
const LUKER_TYPE = 0x41;
const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

export interface Arrival {
  x: number;
  y: number;
  z: number;
  angle: number; // radians
}

export interface TelepipeHost {
  log: (msg: string) => void;
  area: () => number;
  floor: () => number | null;
  episode: () => number;
  selfPose: () => { x: number; y: number; z: number; angle: number } | null;
  ground: (x: number, z: number, fromY: number) => number | null;
  roomAt: (pos: { x: number; y: number; z: number }) => number;
  // The floor's objects (the TObjLuker of Pioneer 2).
  objects: () => readonly PlacedEntity[];
  // Another window or a talk has the keyboard.
  blocked: () => boolean;
  areaName: (floor: number) => string;
  warp: (floor: number, arrival: Arrival) => Promise<void>;
}

interface PipeVisual {
  key: string;
  owner: number;
  group: THREE.Group;
  particles: ParticleSystem;
  sprites: THREE.Sprite[];
  x: number;
  y: number; // the ground under the pipe (the particles' base)
  z: number;
  at: [number, number, number]; // the pipe's own position (the loop sound's)
}

interface Use {
  kind: 'field' | 'city';
  owner: number;
  frames: number;
}

export class TelepipeLayer {
  private viewer: MapViewer;
  private game: Game;
  private files: ClientFiles;
  private host: TelepipeHost;
  private entries = new Map<number, ParticleEntry>();
  private slots = new Map<number, number>(); // effect_nt.xvm GBIX -> slot
  private textures = new Map<number, THREE.Texture>();
  private loaded: Promise<void> | null = null;
  private visuals = new Map<string, PipeVisual>();
  private flashes: PipeVisual[] = [];
  private use: Use | null = null;
  private acc = 0;
  // The key of the pipe whose loop voice (SE 0xA0) is playing, or null.
  private loopKey: string | null = null;
  private disposed = false;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private hook = (dt: number) => this.frame(dt);

  constructor(viewer: MapViewer, game: Game, files: ClientFiles, host: TelepipeHost) {
    this.viewer = viewer;
    this.game = game;
    this.files = files;
    this.host = host;
    viewer.renderer.domElement.addEventListener('keydown', this.onKey, true);
    viewer.frameHooks.add(this.hook);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const dat = await this.files.read('particleentry.dat');
        for (const id of [...PIPE_PARTICLES, PIPE_USE_PARTICLE]) this.entries.set(id, parseParticleEntry(dat, id));
        const nt = await this.files.textures('effect_nt.xvm');
        const bitmaps = await textureBitmaps(nt);
        nt.forEach((t, i) => {
          if (t.gbix === undefined) return;
          this.slots.set(t.gbix, i);
          const tex = new THREE.Texture(bitmaps[i]);
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          this.textures.set(t.gbix, tex);
        });
      } catch (err) {
        this.host.log(`telepipe: particles unavailable (${(err as Error).message})`);
      }
    })();
    return this.loaded;
  }

  // Whether Ryuker / the Telepipe item can open a pipe here
  // (SinowberillChallengePlayer_IsTelepipeEnabled_0068bfa0).
  allowed(): boolean {
    const area = this.host.area();
    const info = this.game.info;
    return telepipeAllowed(area, isSafeMap(area), { battle: !!info?.battle, challenge: !!info?.challenge });
  }

  // Ryuker / the Telepipe item (unknown_cast_tech case ryuker, our own
  // client only): the pipe at the caster's feet. Returns false when the
  // pipe already standing there is ours (state 0's range check).
  open(): boolean {
    const me = this.host.selfPose();
    const floor = this.host.floor();
    if (!me || floor === null || !this.allowed()) return false;
    const self = this.game.selfId;
    const old = this.game.telepipes.get(self);
    if (telepipeOpen(old) && samePipe(old, floor, me.x, me.z) && this.visuals.has(visualKey(old))) {
      this.host.log('telepipe: ours already stands here');
      return false;
    }
    const s: TelepipeState = {
      owner: self,
      floor,
      room: this.host.roomAt(me),
      x: me.x,
      y: me.y,
      z: me.z,
      angle: Math.round(me.angle / BAMS_TO_RAD) & 0xffff,
    };
    this.game.telepipes.set(s);
    this.game.sendSubcommand(0x68, buildTelepipeState(s).subarray(4));
    se(SE_TELEPIPE_OPEN);
    this.host.log(`telepipe: opened on floor ${floor} at (${me.x.toFixed(1)}, ${me.z.toFixed(1)})`);
    this.sync();
    return true;
  }

  // A new floor: the pipes of this floor, or the Pioneer 2 pipes.
  enterFloor(): void {
    this.use = null;
    this.clearVisuals();
    void this.load().then(() => this.sync());
  }

  // The pipes that should stand on this floor.
  private wanted(): Map<string, { owner: number; x: number; y: number; z: number }> {
    const out = new Map<string, { owner: number; x: number; y: number; z: number }>();
    const floor = this.host.floor();
    if (floor === null) return out;
    const area = this.host.area();
    const present = (owner: number) => owner === this.game.selfId || this.game.players.has(owner);
    if (!isSafeMap(area)) {
      for (const s of this.game.telepipes.pipes.values()) {
        if (telepipeOpen(s) && s.floor === floor && present(s.owner)) out.set(visualKey(s), { owner: s.owner, x: s.x, y: s.y, z: s.z });
      }
    } else {
      for (const p of this.lukers()) {
        const s = this.game.telepipes.get(p.owner);
        if (telepipeOpen(s) && present(p.owner)) out.set(`luker:${p.owner}:${p.x}:${p.z}`, p);
      }
    }
    return out;
  }

  private lukers(): Array<{ owner: number; x: number; y: number; z: number }> {
    return this.host
      .objects()
      .filter((p) => p.entity.kind === 'object' && p.entity.type === LUKER_TYPE)
      .map((p) => ({ owner: (p.entity.params as number[])[3] ?? -1, x: p.world[0], y: p.world[1], z: p.world[2] }))
      .filter((p) => p.owner >= 0 && p.owner < 4);
  }

  private sync(): void {
    if (this.disposed || !this.entries.size) return;
    const want = this.wanted();
    for (const [key, v] of this.visuals) {
      if (!want.has(key)) {
        this.viewer.scene.remove(v.group);
        this.visuals.delete(key);
      }
    }
    for (const [key, w] of want) {
      if (!this.visuals.has(key)) this.visuals.set(key, this.makeVisual(key, w.owner, w.x, w.y, w.z));
    }
  }

  // The particles of CreateChallengeEnemyEntity_006e8ca4, on the ground below
  // the pipe (unknown_get_ground_info(pos, 0x100)).
  private makeVisual(key: string, owner: number, x: number, y: number, z: number, ids: readonly number[] = PIPE_PARTICLES): PipeVisual {
    const gy = this.host.ground(x, z, y + 10) ?? y;
    const particles = new ParticleSystem();
    const tint = PIPE_COLORS[owner & 3] || undefined;
    ids.forEach((id, i) => {
      const e = this.entries.get(id);
      if (!e) return;
      particles.add(e, [x, gy + (i === 2 ? 1.8 : 0), z], 0, tint);
    });
    const group = new THREE.Group();
    this.viewer.scene.add(group);
    return { key, owner, group, particles, sprites: [], x, y: gy, z, at: [x, y, z] };
  }

  private clearVisuals(): void {
    for (const v of [...this.visuals.values(), ...this.flashes]) this.viewer.scene.remove(v.group);
    this.visuals.clear();
    this.flashes = [];
  }

  // --- using a pipe ---

  // The pipe the local player stands at, if any.
  nearest(): { kind: 'field' | 'city'; owner: number } | null {
    const me = this.host.selfPose();
    if (!me) return null;
    let best: { kind: 'field' | 'city'; owner: number } | null = null;
    let bestD = TELEPIPE_USE_RANGE * TELEPIPE_USE_RANGE;
    for (const v of this.visuals.values()) {
      const d = (v.x - me.x) ** 2 + (v.z - me.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { kind: v.key.startsWith('luker:') ? 'city' : 'field', owner: v.owner };
      }
    }
    return best;
  }

  // The window at 0x35 naming where the Pioneer 2 pipe goes (render/fieldhud.ts).
  prompt(): string | null {
    const n = this.nearest();
    if (!n || n.kind !== 'city' || this.host.blocked()) return null;
    const s = this.game.telepipes.get(n.owner);
    return telepipeOpen(s) ? this.host.areaName(s.floor) : null;
  }

  get using(): boolean {
    return this.use !== null;
  }

  private key(e: KeyboardEvent): void {
    // The use key is binding 0xC (Select Left), read live (input/keyconfig.ts).
    if (this.disposed || e.key.toLowerCase() !== KEYS.selectLeft || e.repeat || this.use || this.host.blocked()) return;
    const n = this.nearest();
    if (!n) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.start(n.kind, n.owner);
  }

  private start(kind: 'field' | 'city', owner: number): void {
    const me = this.host.selfPose();
    if (!me) return;
    this.use = { kind, owner, frames: 0 };
    // The flash 0xB3, 10 units towards the camera.
    const cam = this.viewer.camera.position;
    const dx = cam.x - me.x;
    const dz = cam.z - me.z;
    const len = Math.hypot(dx, dz) || 1;
    const v = this.makeVisual('flash', owner, me.x + (dx / len) * 10, me.y, me.z + (dz / len) * 10, [PIPE_USE_PARTICLE]);
    v.particles.emitters.forEach((e) => (e.tint = undefined));
    this.flashes.push(v);
    this.game.sendSubcommand(0x2c, buildImposeHold(this.game.selfId, TELEPIPE_HOLD_FRAMES, me.x, me.z).subarray(4));
    se(SE_TELEPIPE_USE);
    this.host.log(`telepipe: using ${kind === 'city' ? 'the Pioneer 2 pipe' : 'the pipe'} of player ${owner}`);
  }

  private async finishUse(u: Use): Promise<void> {
    const self = this.game.selfId;
    if (u.kind === 'field') {
      const a = pioneer2Arrival(self, this.host.episode());
      await this.host.warp(0, { x: a.x, y: a.y, z: a.z, angle: a.angle * BAMS_TO_RAD });
      return;
    }
    const s = this.game.telepipes.get(u.owner);
    if (!telepipeOpen(s)) return;
    const dest = { ...s };
    if (u.owner === self) {
      // The owner's own trip closes the pipe (0x006e8388) and says so.
      const closed = this.game.telepipes.close(self);
      this.game.sendSubcommand(0x68, buildTelepipeState(closed).subarray(4));
    }
    await this.host.warp(dest.floor, { x: dest.x, y: dest.y, z: dest.z, angle: dest.angle * BAMS_TO_RAD });
  }

  // --- frames ---

  private frame(dt: number): void {
    if (this.disposed) return;
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= FRAME && ticks < 5) {
      this.acc -= FRAME;
      ticks++;
      this.tick();
    }
    if (this.acc >= FRAME) this.acc = 0;
    for (const v of [...this.visuals.values(), ...this.flashes]) this.draw(v);
  }

  private tick(): void {
    this.sync();
    // State 1 of ChallengeEntity_Update_006e88d0 plays SE 0xA0 at the pipe
    // every frame (PlayDirectionalSFX_00814630); a voice still playing is
    // not restarted. The voice is positional at the pipe (audio/se.ts `at`);
    // only the pipes of this floor sound. ASSUMED: one voice, moved to the
    // nearest open pipe (see net/telepipe.ts nearestPipe).
    this.loop();
    for (const v of this.visuals.values()) v.particles.step();
    for (const f of this.flashes) f.particles.step(f.particles.count === 0 && f.sprites.length === 0);
    this.flashes = this.flashes.filter((f) => {
      // The flash spawns once (create_particle_effect), then fades out.
      f.particles.emitters.length = 0;
      if (f.particles.count === 0) {
        this.viewer.scene.remove(f.group);
        return false;
      }
      return true;
    });
    const u = this.use;
    if (u) {
      u.frames++;
      if (u.frames >= (u.kind === 'field' ? USE_FRAMES_FIELD : USE_FRAMES_CITY)) {
        this.use = null;
        void this.finishUse(u).catch((err) => this.host.log(`telepipe: ${(err as Error).message}`));
      }
    }
  }

  // The loop voice: one SE 0xA0 voice at the open field pipe nearest the
  // local player (the listener). When the nearest pipe changes the voice
  // moves; with no open pipe it stops.
  private loop(): void {
    const field = [...this.visuals.values()].filter((v) => v.key.startsWith('pipe:'));
    const me = this.host.selfPose();
    const i = nearestPipe(field, me ? { x: me.x, z: me.z } : null);
    const target = i >= 0 ? field[i] : null;
    if (target && this.loopKey !== target.key) {
      seStop(SE_TELEPIPE_LOOP);
      this.loopKey = target.key;
    }
    if (target) {
      if (!sePlaying(SE_TELEPIPE_LOOP)) se(SE_TELEPIPE_LOOP, { loop: true, at: target.at });
    } else if (this.loopKey !== null) {
      seStop(SE_TELEPIPE_LOOP);
      this.loopKey = null;
    }
  }

  // Sprites for the live particles: additive, the colour times the fade,
  // sized and turned as their effect_nt renderer draws them.
  private draw(v: PipeVisual): void {
    const live = v.particles.live;
    while (v.sprites.length < live.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      v.group.add(s);
      v.sprites.push(s);
    }
    const cam = this.viewer.camera;
    v.sprites.forEach((s, i) => {
      const q = live[i];
      if (!q) {
        s.visible = false;
        return;
      }
      const d = q.e.entry;
      const mat = s.material;
      const tex = this.textures.get(d.gbix) ?? null;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const { fade, rgb } = particleShade(q);
      s.visible = !!tex && fade > 0;
      mat.color.setRGB(rgb[0] * fade, rgb[1] * fade, rgb[2] * fade);
      s.position.set(q.p[0], q.p[1], q.p[2]);
      // The quad of the particle's renderer (particleQuad): renderer 3 is
      // axis-aligned on screen, renderer 4 turns with the step.
      const quad = particleQuad(q, this.slots.get(d.gbix));
      if (d.flags & 4 && quad.hw === 0 && quad.hh === 0) {
        s.visible = false;
        return;
      }
      s.scale.set(2 * quad.hw, 2 * quad.hh, 1);
      if (quad.rotated) {
        const a = new THREE.Vector3(...q.p).project(cam);
        const b = new THREE.Vector3(q.p[0] + q.step[0], q.p[1] + q.step[1], q.p[2] + q.step[2]).project(cam);
        mat.rotation = Math.atan2(b.y - a.y, b.x - a.x);
      } else {
        mat.rotation = 0;
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.loopKey !== null) seStop(SE_TELEPIPE_LOOP);
    this.loopKey = null;
    this.clearVisuals();
    this.viewer.renderer.domElement.removeEventListener('keydown', this.onKey, true);
    this.viewer.frameHooks.delete(this.hook);
    for (const t of this.textures.values()) t.dispose();
  }
}

function visualKey(s: TelepipeState): string {
  return `pipe:${s.owner}:${s.floor}:${s.x}:${s.z}`;
}

// The level-up presentation on a player (own or remote), after PsoBB.exe
// (Ephinea 1.25.13). UpdatePlayerStatsAndLevelMessage_006928e4 (6x30) on a
// field calls DisplayLevelUpMessage_00692aa4(player, u"Level Up" /
// u"Level Down"), which:
//   - plays SE 0x58d for the local player (PlayDirectionalSoundBasedOnAction
//     _00692bf4, player +0x32c == 1) - render/combat.ts;
//   - makes the "Level Up" text over the head (CreateJapaneseCharacterEntity
//     _00789758(slot, white, 0x3c frames)) - classic/hud.ts levelUpText;
//   - SpawnChallengeEntity_00697c14(slot): ChallengeEntityObject_Constructor
//     _00697c88 creates the particle effect 0x23 of particleentry.dat at the
//     player (create_particle_effect_3(&player->weapon_position, 0x23, 0x10))
//     with its motion index = the slot. create_particle_effect_3 sets +0x34
//     = 1: update_particle_effect spawns the entry's rate of particles once
//     (at least one) and then destroys the emitter. Flag 0x10 makes each
//     particle follow the entity of that slot (the particle update keeps the
//     offset entity position - spawn position, 0x0050xxxx near
//     FindEntityById_007b4d18);
//   - a light object (BaseGameObject_Constructor_006eb52c, vtable 0x00b3dd18,
//     update update_lighting_of_particle_effect_on_player @ 0x006eb714) with
//     colour {a 1, r 1, g 0.8, b 0.63} (0x00aab48c..), direction (0, -1, 0),
//     10 frames, direction step 0.2, target intensities diffuse 1.0 (+0x5c),
//     ambient 1.0 (+0x58); then UpdateLightDefinition_00794984(slot, 1.0,
//     0.5). The light's frame i (0..10): with half = round(10 * 0.5)
//     (0x0096dacc), for i < half the player's light intensities go from the
//     area's primary light (g_PrimaryLightEntry_00a9d460) to the targets by
//     i / half, its colour is the level-up colour and its direction turns
//     20% per frame towards straight down; from half on the intensities go
//     back by (i - half) / half, the colour moves 10% per frame back to the
//     entity's own and the direction 20% back (LerpPosition_00501a10,
//     vec3_lerp); after frame 10 the object is gone.
// The web renderer has one scene light, so the light is drawn by scaling the
// player's lit (Lambert) materials by (a + d * c * 0.5) / (a0 + d0 * 0.5):
// the ratio of the player's light to the area's at a mean N.L of 0.5.
// ASSUMED (rendering approximation): that ratio and leaving the direction
// out; the particle's spawn point is the player's position (the weapon
// position is not tracked); the light goes back to the area's when the
// object ends.

import * as THREE from 'three';
import { parseParticleEntry, particleQuad, particleShade, ParticleSystem, type ParticleEntry } from '../classic/particles.ts';
import { textureBitmaps } from '../classic/stage.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { MapViewer } from './mapviewer.ts';

export const LEVEL_UP_PARTICLE = 0x23;
export const LEVEL_UP_LIGHT_FRAMES = 10;
export const LEVEL_UP_LIGHT_HALF = Math.round(LEVEL_UP_LIGHT_FRAMES * 0.5);
export const LEVEL_UP_COLOR: readonly [number, number, number] = [1, 0.8, 0.63];
export const LEVEL_UP_DIFFUSE = 1.0;
export const LEVEL_UP_AMBIENT = 1.0;

export interface LightState {
  diffuse: number;
  ambient: number;
  color: [number, number, number];
}

// The shape of update_lighting_of_particle_effect_on_player's light: the frame
// count, the colour (held for the first half, then 10% a frame back to the
// player's own) and the two intensity targets. The cast light
// (TechniqueEffectObject_Constructor_006eb618) is the same object with its own
// numbers: frames charge + 0x32 + cast, the cast colour, diffuse target = the
// area's diffuse (param_7 is g_PrimaryLightEntry's), ambient target 0.35.
export interface LightSpec {
  frames: number;
  color: readonly [number, number, number];
  diffuse: number;
  ambient: number;
}

export const LEVEL_UP_SPEC: LightSpec = {
  frames: LEVEL_UP_LIGHT_FRAMES,
  color: LEVEL_UP_COLOR,
  diffuse: LEVEL_UP_DIFFUSE,
  ambient: LEVEL_UP_AMBIENT,
};

// update_lighting_of_particle_effect_on_player's light, frame by frame. The
// fade is `fVar1 = frames * g_ParticleLightFadeOutScale` (0.5, 0x0096dacc): the
// first half runs while frame < round(fVar1), the ramps divide by fVar1 itself.
export class LevelUpLight {
  frame = 0;
  private color: [number, number, number];
  private readonly spec: LightSpec;
  private readonly half: number;
  private readonly span: number;

  constructor(spec: LightSpec = LEVEL_UP_SPEC) {
    this.spec = spec;
    this.color = [...spec.color];
    this.span = spec.frames * 0.5;
    this.half = Math.round(this.span);
  }

  get done(): boolean {
    return this.frame > this.spec.frames;
  }

  // The player's light for this frame, from the area's primary light, then
  // one frame on.
  tick(primary: { diffuse: number; ambient: number }, own: readonly [number, number, number] = [1, 1, 1]): LightState {
    const i = this.frame;
    const { diffuse: dTarget, ambient: aTarget } = this.spec;
    let diffuse: number;
    let ambient: number;
    if (i < this.half) {
      const t = i / this.span;
      diffuse = t * (dTarget - primary.diffuse) + primary.diffuse;
      ambient = t * (aTarget - primary.ambient) + primary.ambient;
    } else {
      const t = (i - this.span) / this.span;
      diffuse = t * (primary.diffuse - dTarget) + dTarget;
      ambient = t * (primary.ambient - aTarget) + aTarget;
      this.color = this.color.map((c, k) => c + (own[k] - c) * 0.1) as [number, number, number];
    }
    this.frame++;
    return { diffuse, ambient, color: [...this.color] };
  }
}

// The material scale that stands for a player's light (see the header).
export function lightScale(l: LightState, primary: { diffuse: number; ambient: number }): [number, number, number] {
  const base = primary.ambient + primary.diffuse * 0.5;
  return l.color.map((c) => (l.ambient + l.diffuse * c * 0.5) / Math.max(1e-6, base)) as [number, number, number];
}

export interface LevelUpHost {
  // A player's position (feet) in the world, null when not on this floor.
  position(clientId: number): THREE.Vector3 | null;
  litMaterials(clientId: number): THREE.MeshLambertMaterial[];
  // The area's light intensities (the scene's directional / ambient lights).
  primary(): { diffuse: number; ambient: number };
  log(msg: string): void;
}

interface Burst {
  clientId: number;
  particles: ParticleSystem;
  anchor: THREE.Vector3; // the player's position when spawned
  group: THREE.Group;
  sprites: THREE.Sprite[];
}

interface Glow {
  clientId: number;
  light: LevelUpLight;
  saved: Map<THREE.MeshLambertMaterial, THREE.Color>;
}

const FRAME = 1 / 30;

export class LevelUpEffects {
  private viewer: MapViewer;
  private files: ClientFiles;
  private host: LevelUpHost;
  private entry: ParticleEntry | null = null;
  private textures = new Map<number, THREE.Texture>();
  private slots = new Map<number, number>();
  private loaded: Promise<void> | null = null;
  private bursts: Burst[] = [];
  private glows: Glow[] = [];
  private acc = 0;
  private hook = (dt: number) => this.frame(dt);
  private disposed = false;

  constructor(viewer: MapViewer, files: ClientFiles, host: LevelUpHost) {
    this.viewer = viewer;
    this.files = files;
    this.host = host;
    viewer.frameHooks.add(this.hook);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const dat = await this.files.read('particleentry.dat');
        this.entry = parseParticleEntry(dat, LEVEL_UP_PARTICLE);
        const nt = await this.files.textures('effect_nt.xvm');
        const bitmaps = await textureBitmaps(nt);
        nt.forEach((t, i) => {
          if (t.gbix === undefined) return;
          this.slots.set(t.gbix, i);
          if (t.gbix !== this.entry?.gbix) return;
          const tex = new THREE.Texture(bitmaps[i]);
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          this.textures.set(t.gbix, tex);
        });
      } catch (err) {
        this.host.log(`level up: particles unavailable (${(err as Error).message})`);
      }
    })();
    return this.loaded;
  }

  // DisplayLevelUpMessage_00692aa4's particle and light on a player.
  async play(clientId: number): Promise<void> {
    this.startLight(clientId);
    await this.load();
    const e = this.entry;
    const at = this.host.position(clientId);
    if (this.disposed || !e || !at) return;
    const particles = new ParticleSystem();
    particles.slots = this.slots;
    particles.add(e, [at.x, at.y, at.z], null);
    // At least one particle: the spawn loop runs while max(rate, 1) >= 1.
    particles.emitters[0].acc = Math.max(0, 1 - e.rate);
    // The one emission of create_particle_effect_3 (+0x34 = 1).
    particles.step(true);
    particles.emitters.length = 0;
    const group = new THREE.Group();
    this.viewer.scene.add(group);
    this.bursts.push({ clientId, particles, anchor: at.clone(), group, sprites: [] });
  }

  // InstantiateTechniqueEffect_006e104c's cast light on the caster (the cast
  // colour, `frames` = charge + 0x32 + cast, ambient 0.35; the diffuse target is
  // the area's diffuse at the cast). ASSUMED: one light a player at a time, the
  // newer one replaces the older (the exe keeps one definition per slot).
  castLight(clientId: number, color: readonly [number, number, number], frames: number, ambient: number): void {
    this.startLight(clientId, { frames, color, diffuse: this.host.primary().diffuse, ambient });
  }

  private startLight(clientId: number, spec: LightSpec = LEVEL_UP_SPEC): void {
    const old = this.glows.find((g) => g.clientId === clientId);
    if (old) this.endGlow(old);
    this.glows = this.glows.filter((g) => g !== old);
    const saved = new Map<THREE.MeshLambertMaterial, THREE.Color>();
    for (const m of this.host.litMaterials(clientId)) saved.set(m, m.color.clone());
    this.glows.push({ clientId, light: new LevelUpLight(spec), saved });
  }

  private endGlow(g: Glow): void {
    for (const [m, c] of g.saved) m.color.copy(c);
  }

  get active(): number {
    return this.bursts.length + this.glows.length;
  }

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
    for (const b of this.bursts) this.draw(b);
  }

  private tick(): void {
    for (const b of this.bursts) b.particles.step(false);
    this.bursts = this.bursts.filter((b) => {
      if (b.particles.count > 0) return true;
      this.viewer.scene.remove(b.group);
      return false;
    });
    const primary = this.host.primary();
    this.glows = this.glows.filter((g) => {
      if (g.light.done) {
        this.endGlow(g);
        return false;
      }
      const k = lightScale(g.light.tick(primary), primary);
      for (const [m, c] of g.saved) m.color.setRGB(c.r * k[0], c.g * k[1], c.b * k[2]);
      return true;
    });
  }

  // Additive sprites like render/telepipe.ts, moved with the player (flag 0x10).
  private draw(b: Burst): void {
    const now = this.host.position(b.clientId);
    if (now) b.group.position.set(now.x - b.anchor.x, now.y - b.anchor.y, now.z - b.anchor.z);
    const live = b.particles.live;
    while (b.sprites.length < live.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      b.group.add(s);
      b.sprites.push(s);
    }
    const cam = this.viewer.camera;
    b.sprites.forEach((s, i) => {
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
      const quad = particleQuad(q, this.slots.get(d.gbix));
      if (d.flags & 4 && quad.hw === 0 && quad.hh === 0) {
        s.visible = false;
        return;
      }
      s.scale.set(2 * quad.hw, 2 * quad.hh, 1);
      if (quad.rotated) {
        const a = new THREE.Vector3(...q.p).project(cam);
        const c = new THREE.Vector3(q.p[0] + q.step[0], q.p[1] + q.step[1], q.p[2] + q.step[2]).project(cam);
        mat.rotation = Math.atan2(c.y - a.y, c.x - a.x);
      } else {
        mat.rotation = 0;
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.viewer.frameHooks.delete(this.hook);
    for (const g of this.glows) this.endGlow(g);
    this.glows = [];
    for (const b of this.bursts) this.viewer.scene.remove(b.group);
    this.bursts = [];
    for (const t of this.textures.values()) t.dispose();
  }
}

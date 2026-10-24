// Draws and sounds the technique objects of combat/techfire.ts (Foie, Gifoie,
// Rafoie, Barta, Gibarta, Rabarta) and steps the ones the local player or a
// remote player cast. The rules are in combat/techfire.ts; the particles are
// render/hitfx.ts FieldParticles (particleentry.dat entries, run with the
// type 0 simulation), the sounds the SE ids of common.pac.
//
// ASSUMED / not drawn (see docs/DEVLOG.md "Technique visuals: Foie and Barta
// families"): the model particles (the entries whose flag 0x20 hands the
// emitter a model of the technique BML: Gibarta's spikes, Barta's icicle,
// Rabarta's body, Rafoie's ring and fire sphere), the emitters' orientation
// (the exe turns them by the object's angles; the particle engine here only
// has a pitch), the dynamic light of the cast, the pitch of the creation
// sounds, the wall impact of a Foie and the 0x18a stream of a level 25+ Barta.

import * as THREE from 'three';
import {
  FIRE_SE,
  FOIE_WALL,
  FoieBolt,
  GifoieRing,
  foieEmitterOrient,
  RAFOIE_BLAST_LIFT,
  RafoieBlast,
  rafoieBlastEmitters,
  startEmitters,
  type FireObject,
  type FxEmitter,
  type TechTarget,
} from '../combat/techfire.ts';
import type { FieldParticles } from './hitfx.ts';
import type { Orient } from '../classic/particles.ts';

// A persistent emitter lasts until its object is gone (the effect's destructor
// sets its flag |= 1); this is only the upper bound handed to FieldParticles.
const FOREVER = 1 << 20;

export interface TechFireHost {
  fx(): FieldParticles | null;
  /** play_directional_sound_effect at a world point. */
  sound(id: number, x: number, y: number, z: number): void;
}

/** The hit of a player-side object. */
export type FireHit = (obj: FireObject, target: TechTarget) => void;

interface Live {
  obj: FireObject;
  owner: { done: boolean } | null; // an enemy's shot: its removal ends the object too
  baseY: number; // added to the object's y (enemy shots are above their launch ground)
  step: boolean; // stepped here (a player's object); else by its owner's shot loop
  onHit: FireHit | null;
  blasted: boolean;
  impacted: boolean;
}

export class TechFire {
  private live: Live[] = [];
  private readonly host: TechFireHost;
  private readonly hits: TechTarget[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(host: TechFireHost) {
    this.host = host;
  }

  get active(): number {
    return this.live.length;
  }

  /** A player's object (the local player's or a remote player's): stepped by tick(). */
  start(obj: FireObject, onHit: FireHit | null): void {
    this.add({ obj, owner: null, baseY: 0, step: true, onHit, blasted: false, impacted: false });
  }

  /** An enemy's object: its shot loop steps it, this only draws and sounds it. */
  attach(shot: { fire: FireObject; done: boolean }, baseY: number): void {
    this.add({ obj: shot.fire, owner: shot, baseY, step: false, onHit: null, blasted: false, impacted: false });
  }

  private add(l: Live): void {
    this.live.push(l);
    this.begin(l);
  }

  /** One game tick: steps the player-side objects against `targets` and plays what
   * every object did this tick. */
  tick(targets: readonly TechTarget[], n: number): void {
    let ended = false;
    for (let i = 0; i < this.live.length; i++) {
      const l = this.live[i];
      if (l.step && !l.obj.done) {
        l.obj.step(targets, n, this.hits);
        if (l.onHit) for (let k = 0; k < this.hits.length; k++) l.onHit(l.obj, this.hits[k]);
      }
      this.sync(l);
      if (l.obj.done || l.owner?.done) ended = true;
    }
    if (ended) this.live = this.live.filter((l) => !l.obj.done && !l.owner?.done);
  }

  clear(): void {
    for (const l of this.live) l.obj.done = true; // the emitters see it and stop
    this.live = [];
  }

  // The creation: sound, the emitters of the tier.
  private begin(l: Live): void {
    const o = l.obj;
    const fixedRafoie = o instanceof RafoieBlast && o.targetId === null;
    // Rafoie's creation sound is played at +0x7c, which the list form fills with the
    // target list's first words (a point near the map's origin), so only the fixed
    // form is heard from where it is.
    if (o.kind !== 'rafoie' || fixedRafoie) this.host.sound(FIRE_SE.start[o.kind], o.x, o.y + l.baseY, o.z);
    const fx = this.host.fx();
    if (!fx) return;
    const owner = l.owner;
    const alive = (): boolean => !o.done && !owner?.done;
    const sx = o.x;
    const sy = o.y + l.baseY;
    const sz = o.z;
    for (const e of startEmitters(o.kind, o.tier, fixedRafoie)) {
      if (o instanceof GifoieRing) {
        for (let i = 0; i < o.groups; i++) this.follow(fx, e, alive, (v) => this.ringPoint(o, i, l.baseY, v));
      } else if (e.mode === 'follow') this.follow(fx, e, alive, (v) => v.set(o.x, o.y + l.baseY + (e.dy ?? 0), o.z), e.angles ? foieEmitterOrient(o, e.angles) : null);
      else if (e.mode === 'fixed') {
        const v = new THREE.Vector3(sx + Math.sin(o.heading) * (e.ahead ?? 0), sy + (e.dy ?? 0), sz + Math.cos(o.heading) * (e.ahead ?? 0));
        void fx.spawn({ id: e.id, scale: [e.scale, e.scale], duration: FOREVER }, v, false, false, alive);
      } else this.burst(fx, e, sx, sy, sz);
    }
  }

  private ringPoint(o: GifoieRing, i: number, baseY: number, v: THREE.Vector3): THREE.Vector3 {
    const p = this.ringScratch;
    o.emitterAt(i, o.frames, p);
    return v.set(p.x, p.y + baseY, p.z);
  }

  private readonly ringScratch = { x: 0, y: 0, z: 0 };

  private follow(fx: FieldParticles, e: FxEmitter, alive: () => boolean, place: (v: THREE.Vector3) => THREE.Vector3, orient: Orient | null = null): void {
    const v = new THREE.Vector3(); // one per emitter, reused by every update
    place(v);
    void fx.spawn({ id: e.id, scale: [e.scale, e.scale], duration: FOREVER, orient }, () => place(v), false, true, alive);
  }

  private burst(fx: FieldParticles, e: FxEmitter, x: number, y: number, z: number): void {
    void fx.spawn({ id: e.id, scale: [e.scale, e.scale], ...(e.dy !== undefined ? { dy: e.dy } : {}) }, new THREE.Vector3(x, y, z));
  }

  // The events of one tick: Foie's hit sound, Rafoie's blast.
  private sync(l: Live): void {
    const o = l.obj;
    if (o.impact && !l.impacted) {
      l.impacted = true;
      if (o instanceof FoieBolt && o.struck) this.host.sound(FIRE_SE.foieHit, o.struck.x, o.y + l.baseY, o.struck.z);
    }
    if (o.burst && !l.blasted && o instanceof RafoieBlast) {
      l.blasted = true;
      const y = o.y + l.baseY;
      this.host.sound(FIRE_SE.rafoieBlast, o.bx, y, o.bz);
      const fx = this.host.fx();
      if (fx) for (const e of rafoieBlastEmitters(o.tier)) this.burst(fx, e, o.bx, y + RAFOIE_BLAST_LIFT, o.bz);
    }
  }

  /** Foie's wall impact particles (TechniqueEntity_CreateParticleEffects_006e37b0). */
  wallImpact(x: number, y: number, z: number): void {
    const fx = this.host.fx();
    if (fx) for (const id of FOIE_WALL) void fx.spawn({ id }, this.tmp.set(x, y, z).clone());
  }
}

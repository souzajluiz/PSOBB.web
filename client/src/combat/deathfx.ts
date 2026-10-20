// What an enemy shows and sounds when it dies, per enemy, from PsoBB.exe
// (Ephinea 1.25.13, VAs). There is no common death routine: every enemy's
// death state (its ProcessState jump table, entry argument 4 = the state's
// first call, then 0 every frame) calls the particle helpers
// (0x00578778 gensei_dead 0xe4 at the ground, 0x005787a4 ab_dead 0xe5 at the
// ground, 0x005787d0 the explosion 0xfb 0xfc 0xe3, 0x005787fc the dark burst
// 0xe8 0xec after 10 frames), its own particle ids, its own sounds
// (play_directional_sound_effect) and, for the dark enemies of the ruins and
// the Episode 2 areas, the dissolve (combat/hitmodels.ts). Found by listing
// every function that calls on_enemy_killed / EnemyOnKilledHandler_0051f894 /
// set_monster_spawn_initdata_as_dead together with a particle, sound or debris
// call (45 of them; the bosses are ported on their own), and matching them to
// their classes by the vtables (0x00afe..0x00b0.. update slots), the factory
// table 0x009fba60 and the addresses the enemy FSM ports already cite.
//
// The unit of time is the game frame (30 a second). `end` = the death motion
// ended (animation_flags & 0x10, set by Player__Animate when a play-once
// motion reaches its last frame); `{ frame }` = the motion's elapsed frames
// (check_entity_animation_elapsed_threshold); `{ wait }` = frames after the
// step before it.
//
// NOT modelled (named in the DEVLOG): the debris entities the death states
// make (CreateEntity_005786e8 and its siblings, models of bm_ene_common_all),
// the other enemies' death states (no entry: no particle, the old removal).

import type { ParticleSpawn } from './hitfx.ts';

export type DeathWhen = 'kill' | 'end' | { frame: number } | { wait: number };

/** Where a death particle is made. `body` is ASSUMED to be the origin raised by 26 (the exe's +0x300 position). */
export interface DeathPoint {
  base: 'origin' | 'body';
  /** Along the enemy's heading (the exe's int_sin / int_cos of +0x60). */
  forward?: number;
  up?: number;
}

export interface DeathStep {
  when: DeathWhen;
  se?: number;
  particles?: { p: ParticleSpawn; at: DeathPoint }[];
  /** Start the 20-frame dissolve; the enemy is removed when it is done. */
  dissolve?: boolean;
  /** Remove the enemy now (a death state that ends itself). */
  remove?: boolean;
}

export interface DeathPlan {
  steps: DeathStep[];
  /** The model is gone from the kill on (the state sets the removal flag at once). */
  instant?: boolean;
}

export interface DeathContext {
  area: number;
  episode: number;
}

const TEMPLE_A = 0x13;
const TEMPLE_B = 0x14;
const TOWER = 0x23;

const ORIGIN: DeathPoint = { base: 'origin' };
const BODY: DeathPoint = { base: 'body' };

// The helpers' particle lists (gensei / ab_dead are create_particle_effect_ex(ground, id, 0, frames)).
const gensei = (frames: number): ParticleSpawn => ({ id: 0xe4, delay: 0, duration: frames });
const abDead = (frames: number): ParticleSpawn => ({ id: 0xe5, delay: 0, duration: frames });
const EXPLOSION: ParticleSpawn[] = [{ id: 0xfb }, { id: 0xfc }, { id: 0xe3 }];
const DARK_BURST: ParticleSpawn[] = [
  { id: 0xe8, delay: 10, duration: 1 },
  { id: 0xec, delay: 10, duration: 1 },
];
const at = (list: ParticleSpawn[], point: DeathPoint) => list.map((p) => ({ p, at: point }));

/** A dark enemy's death: the burst and the dissolve (on the kill, or after the motion). */
function dark(se: number | undefined, point: DeathPoint, from: 'kill' | 'end'): DeathStep {
  return { when: from, ...(se !== undefined ? { se } : {}), particles: at(DARK_BURST, point), dissolve: true };
}

// The Sinow family: the death motion, 20 frames after it the bits explode
// (SpawnEntityParticles at 20 ahead) and the enemy is gone; the particle 0xf8
// (short_test, 20 frames of emission) starts at the motion's end 10 up and 20
// ahead.
function sinow(killSe: number, endSe: number): DeathPlan {
  return {
    steps: [
      { when: 'kill', se: killSe },
      { when: 'end', particles: [{ p: { id: 0xf8, delay: 0, duration: 0x14 }, at: { base: 'origin', forward: 20, up: 10 } }] },
      { when: { wait: 20 }, se: endSe, particles: at(EXPLOSION, { base: 'origin', forward: 20 }), remove: true },
    ],
  };
}

/**
 * The death plan of an enemy class (`className` = the client class, `type` =
 * the newserv enemy type name) or null.
 */
export function deathPlanFor(className: string, type: string, ctx: DeathContext): DeathPlan | null {
  switch (className) {
    // --- the ruins' dark enemies (the dissolve) ----------------------------
    case 'TObjEneBalClawBody': // Bulclaw 0x00531ee4 state 5: SE 0x202 at the kill; after the motion (sub 3) the burst and the dissolve
      return { steps: [{ when: 'kill', se: 0x202 }, dark(undefined, BODY, 'end')] };
    case 'TObjEneBalClawClaw': // Claw 0x00534e84: SE 0x202, the burst and the dissolve at the kill
      return { steps: [dark(0x202, BODY, 'kill')] };
    case 'TObjEneRe7Berura': // Dark Belra 0x00537388: the burst, the dissolve and SE 0x1f0 (0x1c5 in the temples) at the kill
      return { steps: [dark(ctx.area === TEMPLE_A || ctx.area === TEMPLE_B ? 0x1c5 : 0x1f0, BODY, 'kill')] };
    case 'TObjEneDf2Bringer': // Chaos Bringer 0x0053aa34: SE 0x1dc, the burst and the dissolve at the kill
      return { steps: [dark(0x1dc, BODY, 'kill')] };
    case 'TObjEneDarkGunner': // Dark Gunner 0x00544634: SE 0x202, the burst and the dissolve at the kill
      return { steps: [dark(0x202, BODY, 'kill')] };
    case 'TObjEneSaver': // Delsaber 0x0054e688: the burst at its feet, the dissolve and SE 0x1d2 at the kill
      return { steps: [dark(0x1d2, ORIGIN, 'kill')] };
    case 'TObjEneRe4Sorcerer': // Chaos Sorcerer 0x0059bbe8: the burst, the dissolve and SE 0x1e4 at the kill
      return { steps: [dark(0x1e4, BODY, 'kill')] };
    // --- Episode 2 --------------------------------------------------------------
    case 'TObjEneDellBiter': // Delbiter 0x0054b144: SE 0x2e3 (the tower) or 0x26f at the kill; after the motion the burst, SE 0x285 and the dissolve
      return { steps: [{ when: 'kill', se: ctx.area === TOWER ? 0x2e3 : 0x26f }, dark(0x285, BODY, 'end')] };
    case 'TObjEneMorfos': // Morfos 0x0057aa0c: SE 0x27b at the kill; after the motion the burst at its feet, SE 0x285 and the dissolve
      return { steps: [{ when: 'kill', se: 0x27b }, dark(0x285, ORIGIN, 'end')] };
    case 'TObjEneMe3StelthReal': // Sinow Berill / Spigell 0x0059f3dc
      return sinow(0x243, 0x247);
    case 'TObjEneMe3SinowZoaReal': // Sinow Zoa / Zele 0x005926c4
      return sinow(0x27f, 0x283);
    case 'TObjEneMe1GiGue': // Gi Gue 0x0056b19c: dies at once, 0x205 and 0x206 40 up, SE 0x229
      return {
        instant: true,
        steps: [{ when: 'kill', se: 0x229, particles: at([{ id: 0x205 }, { id: 0x206 }], { base: 'origin', up: 40 }), remove: true }],
      };
    // --- the mines -----------------------------------------------------------
    case 'TObjEneMe1Canadin': // Canadine 0x0053e610: the explosion 5 below its body point and SE 0x143, gone at once
      return { instant: true, steps: [{ when: 'kill', se: 0x143, particles: at(EXPLOSION, { base: 'body', up: -5 }), remove: true }] };
    case 'TObjEneMe3ShinowaReal': // Sinow Beat / Gold 0x0058da40: SE 0x137 twice in the motion (13 and 25)
      return {
        steps: [
          { when: { frame: 13 }, se: 0x137 },
          { when: { frame: 25 }, se: 0x137 },
          { when: 'end', particles: [{ p: { id: 0xf8, delay: 0, duration: 0x14 }, at: { base: 'origin', forward: 20, up: 10 } }] },
          { when: { wait: 20 }, se: 0x13b, particles: at(EXPLOSION, { base: 'origin', forward: 20 }), remove: true },
        ],
      };
    // --- the forest and the caves ----------------------------------------------
    case 'TObjEneRe2Flower': // Poison / Nar Lily 0x00527f20: SE 0xff at the kill; after the motion 10 ahead
      if (type === 'NAR_LILY') {
        // ASSUMED: flag 0x800 (the dissolve variant) is the Nar Lily's.
        return { steps: [{ when: 'kill', se: 0xff }, { when: 'end', se: 0x2e3, particles: at(DARK_BURST, { base: 'origin', forward: 10 }), dissolve: true }] };
      }
      return { steps: [{ when: 'kill', se: 0xff }, { when: 'end', particles: [{ p: abDead(0x46), at: { base: 'origin', forward: 10 } }] }] };
    case 'TObjGrass': // Grass Assassin 0x005225bc: smoke 0xf0 at motion frame 23, then at 32 SE 0xf7 and ab_dead behind it
      return {
        steps: [
          { when: { frame: 23 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { frame: 32 }, se: 0xf7, particles: [{ p: abDead(0x1e), at: { base: 'origin', forward: -15 } }] },
        ],
      };
    case 'TObjEneNanoDrago': // Nano Dragon 0x0057e9ac: SE 0x112, smoke 0xf0 at motion frame 30, 30 frames later ab_dead
      return {
        steps: [
          { when: 'kill', se: 0x112 },
          { when: { frame: 30 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { wait: 30 }, particles: [{ p: abDead(0x1e), at: ORIGIN }] },
        ],
      };
    case 'TObjEneSlime': // Pofuilly Slime 0x00598648: SE 0x108 and the particle 0xfe at its body
      return { steps: [{ when: 'kill', se: 0x108, particles: [{ p: { id: 0xfe }, at: BODY }] }] };
    case 'TObjEneMoja': // Hildebear 0x00516c60: SE 0xde at the kill; the gensei burst where it lands (ASSUMED: at the end of the motion)
      return { steps: [{ when: 'kill', se: 0xde }, { when: 'end', particles: [{ p: gensei(0x1e), at: ORIGIN }] }] };
    default:
      return null;
  }
}

// --- the run ---------------------------------------------------------------------------

export interface DeathActions {
  se: number[];
  spawn: { p: ParticleSpawn; at: DeathPoint }[];
  /** The dissolve started this frame. */
  dissolve: boolean;
  /** The enemy ends now. */
  remove: boolean;
}

/** The steps of one dying enemy, advanced once per game frame. */
export class DeathRun {
  readonly plan: DeathPlan;
  private i = 0;
  private t = 0;
  private last = 0;

  constructor(plan: DeathPlan) {
    this.plan = plan;
  }

  get finished(): boolean {
    return this.i >= this.plan.steps.length;
  }

  /** One game frame; `motionFrame` is the death motion's elapsed frames, `ended` whether it ended. */
  tick(motionFrame: number, ended: boolean): DeathActions {
    const out: DeathActions = { se: [], spawn: [], dissolve: false, remove: false };
    // Several steps may fall due in the same frame (kill + a motion that is already past a frame).
    while (this.i < this.plan.steps.length) {
      const s = this.plan.steps[this.i];
      const w = s.when;
      const due = w === 'kill' ? true : w === 'end' ? ended : 'frame' in w ? motionFrame >= w.frame : this.t - this.last >= w.wait;
      if (!due) break;
      this.i++;
      this.last = this.t;
      if (s.se !== undefined) out.se.push(s.se);
      if (s.particles) out.spawn.push(...s.particles);
      if (s.dissolve) out.dissolve = true;
      if (s.remove) out.remove = true;
    }
    this.t++;
    return out;
  }
}

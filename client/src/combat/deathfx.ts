// What an enemy shows and sounds when it dies, per enemy, from PsoBB.exe
// (Ephinea 1.25.13, VAs). There is no common death routine: every enemy's
// death state (its ProcessState jump table, entry argument 4 = the state's
// first call, then 0 every frame) calls the particle helpers
// (0x00578778 gensei_dead 0xe4 at the ground, 0x005787a4 ab_dead 0xe5 at the
// ground, 0x005787d0 the explosion 0xfb 0xfc 0xe3, 0x005787fc the dark burst
// 0xe8 0xec after 10 frames), its own particle ids, its own sounds
// (play_directional_sound_effect), the ground pools of combat/blooddecals.ts
// (the eleven creators 0x00578148..0x005786e8), the model fragments of
// combat/shellfragments.ts and, for the dark enemies of the ruins and the
// Episode 2 areas, the dissolve (combat/hitmodels.ts). Found by listing every
// function that calls on_enemy_killed / EnemyOnKilledHandler_0051f894 /
// set_monster_spawn_initdata_as_dead together with a particle, sound, pool or
// fragment call (45 of them; the bosses are ported on their own), and matching
// them to their classes by the vtables (the class's code runs from its vtable's
// first function, the destructor, to the next class's), the motion table slot
// the entry state names in +0xb8, and the addresses the enemy FSM ports cite.
//
// The Booma family (the classes whose vtable +0x174 is the shared state 8,
// 0x0052b518) share the death state (VERIFIED 0x0052b518): the class's death
// voice (vtable +0x194) at motion frame 0, the particle 0xf3 at the origin at
// motion frame 16 and the class's blood hook (vtable +0x184) at the same frame.
// The vtables are in .data (0x00aff860 Shark, 0x00b01fc0 Booma, 0x00b041e0
// Dimenian, 0x00b04480 Dolmolm, 0x00b066e0 Merillia, 0x00b0a680 Boota, 0x00b0af40
// Goran; found 2026-10-21 by the state-8 slot at +0x174). The earlier vtable
// addresses (0x00a48060 .. 0x00a53740) were in .bss and are gone.
//
// The unit of time is the game frame (30 a second). `end` = the death motion
// ended (animation_flags & 0x10, set by Player__Animate when a play-once
// motion reaches its last frame); `{ frame }` = the motion's elapsed frames
// (check_entity_animation_elapsed_threshold); `{ wait }` = frames after the
// step before it; `dissolved` = the dissolve finished.
//
// NOT modelled (named in the DEVLOG): the Mothmant's state 7 particle and SE
// 0xf1 (mothmantDeathPlan), the ground effect of the Dorphon (0x005a8d20),
// the tilt angle the Delsaber's state halves (0x7a8cb8), the Canadine that
// dies open (0x0053f5ec); see `UNTRACED`.
//
// Checked against the exe (the salvage pass, 2026-10-21): the helpers' particle
// ids and durations, the blood stain point (0x00535b38), the Canadine row and
// the Dubchic's SE by episode.
//
// Re-traced row by row (2026-10-21, second pass): each row's comment carries its
// VERIFIED address (the death state, or the call that makes the sound / particle /
// pool) or ASSUMED for the part not traced. The helper addresses used to match
// the pools: 0x005781d8 red 15, 0x00578268 red 2.5, 0x005782f8 red 7.5, 0x00578148
// red 25; purple 0x005785c8 25, 0x00578658 15, 0x005786e8 7.5; green 0x005784a8
// 2.5, 0x00578388 25, 0x00578418 15, 0x00578538 7.5 (the texture argument of the
// green ones is a mis-resolved name; ASSUMED texture 1, see the DEVLOG).
// The death particles: 0x00578778 gensei (0xe4), 0x005787a4 ab_dead (0xe5),
// 0x005787d0 the explosion (0xfb 0xfc 0xe3), 0x005787fc the dark burst (0xe8 0xec).
// The per-area sound tables (Episode 4) were read entry by entry: all 11 match.

import type { PoolId } from './blooddecals.ts';
import type { ParticleSpawn } from './hitfx.ts';
import type { FragmentTable } from './shellfragments.ts';

export type DeathWhen = 'kill' | 'end' | 'land' | 'dissolved' | { frame: number } | { wait: number };

/** Where a death particle or pool is made. `body` is ASSUMED to be the origin raised by 26 (the exe's +0x300 position). */
export interface DeathPoint {
  base: 'origin' | 'body';
  /** Along the enemy's heading (the exe's int_sin / int_cos of +0x60). */
  forward?: number;
  /** Across it (the exe's RotateVector2D of a local x). */
  side?: number;
  up?: number;
  /** The blood stain point (create_enemy_blood_stain, 0x00535b38): forward += the BattleParamEntry stats' f32 @0x10 * this (0.5). */
  bloodForward?: number;
  /** A random spot on a ring around the point, radius in [min, max] (Monest's 0xf1 spray). */
  ring?: readonly [number, number];
}

export interface DeathPool {
  pool: PoolId;
  /** The creator's frames of delay (param 7). */
  delay: number;
  at: DeathPoint;
}

export interface DeathStep {
  when: DeathWhen;
  se?: number;
  particles?: { p: ParticleSpawn; at: DeathPoint }[];
  pools?: DeathPool[];
  /** The model fragments of the exploding machine (combat/shellfragments.ts), from the enemy's own model. */
  fragments?: FragmentTable;
  /** Start the 20-frame dissolve; the enemy is removed when it is done. */
  dissolve?: boolean;
  /** The corpse sinks `perFrame` units a frame for `frames` frames; the enemy is removed after them. */
  sink?: { perFrame: number; frames: number };
  /** Remove the enemy now (a death state that ends itself). */
  remove?: boolean;
  /** The owner's own fade (a Pofuilly Slime's alpha, 0x00597594): it steps the fade each frame and removes the enemy when it is spent. */
  fade?: boolean;
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
// create_enemy_blood_stain / the template of the animals: (0, 10, stats @0x10 * 0.5) turned by the heading.
const BLOOD: DeathPoint = { base: 'origin', bloodForward: 0.5, up: 10 };
const ahead = (forward: number): DeathPoint => ({ base: 'origin', forward });

// The helpers' particle lists (gensei / ab_dead are create_particle_effect_ex(ground, id, 0, frames)).
const gensei = (frames: number): ParticleSpawn => ({ id: 0xe4, delay: 0, duration: frames });
const abDead = (frames: number): ParticleSpawn => ({ id: 0xe5, delay: 0, duration: frames });
const EXPLOSION: ParticleSpawn[] = [{ id: 0xfb }, { id: 0xfc }, { id: 0xe3 }];
const DARK_BURST: ParticleSpawn[] = [
  { id: 0xe8, delay: 10, duration: 1 },
  { id: 0xec, delay: 10, duration: 1 },
];
const at = (list: ParticleSpawn[], point: DeathPoint) => list.map((p) => ({ p, at: point }));
const pool = (id: PoolId, delay: number, point: DeathPoint = ORIGIN): DeathPool => ({ pool: id, delay, at: point });

/** The sink of the death states that lower the corpse by 0.1 a frame until a counter passes a limit (0x0092xxxx pairs: 0.1 and 20 / 30 / 15). */
const sink = (frames: number): { perFrame: number; frames: number } => ({ perFrame: 0.1, frames });

/**
 * The Mothmant's lethal death (combat/enemyfsm.ts MothmantAi.beginDeath picks
 * the kind by the 0x2e0 bit 2 test, 0x005187a0). Both states play SE 0xde at
 * the kill (HildebearProcessState_00516ed8 / 00516c60 enter).
 * - 'ground' (state 7, 0x00516ed8): no landing; the body is dead after two
 *   update frames (its state 9 test is `count > 1`), so the removal waits for
 *   the death motion's end. The state's particle (ParticleEffectInstance on
 *   0x00920c58) and SE 0xf1 are not decoded: ASSUMED none.
 * - 'fall' (state 8, 0x00516c60): the fall lands on the floor (the 'land'
 *   step: gensei 30 and the red 2.5 pool, delay 10, at the origin), then the
 *   body sinks 0.1 a frame until it is 20 under the floor (MothmantAi.deathTick).
 */
export function mothmantDeathPlan(kind: 'ground' | 'fall'): DeathPlan {
  if (kind === 'ground') return { steps: [{ when: 'kill', se: 0xde }] };
  return { steps: [{ when: 'kill', se: 0xde }, { when: 'land', particles: [{ p: gensei(0x1e), at: ORIGIN }], pools: [pool('red2_5', 10)] }] };
}

/** A dark enemy's death: the burst and the dissolve (on the kill, or after the motion). */
function dark(se: number | undefined, point: DeathPoint, from: 'kill' | 'end'): DeathStep {
  return { when: from, ...(se !== undefined ? { se } : {}), particles: at(DARK_BURST, point), dissolve: true };
}

/** What the dark enemy leaves when its dissolve is done: a purple pool at its position, then it is gone. */
const darkPool = (id: PoolId): DeathStep => ({ when: 'dissolved', pools: [pool(id, 0)], remove: true });

// The Sinow family (VERIFIED 2026-10-21: Berill 0x0059f3dc, Zoa 0x005926c4): the
// first SE is played at motion frame 18 (check_entity_animation_elapsed_threshold
// (18), or (28), once; sub-state 0), not at the kill. At the motion's end the
// particle 0xf8 (SpawnParticleEffect_005788b8, 20 frames) starts 10 up and 20
// ahead; 20 frames later (the counter passes 0x13) the second SE, the explosion
// (SpawnEntityParticles_005787d0 at 20 ahead, the global 0x00929d5c = 20) and the
// enemy is gone.
function sinow(frame18Se: number, endSe: number): DeathPlan {
  return {
    steps: [
      { when: { frame: 18 }, se: frame18Se },
      { when: 'end', particles: [{ p: { id: 0xf8, delay: 0, duration: 0x14 }, at: { base: 'origin', forward: 20, up: 10 } }] },
      { when: { wait: 20 }, se: endSe, particles: at(EXPLOSION, { base: 'origin', forward: 20 }), remove: true },
    ],
  };
}

// --- per-area sounds (Episode 4) ----------------------------------------------
// The exe reads `table[area]` of an int array per sound (-1: none). The
// Episode 4 areas: 36..39 the wilds, 40 the crater, 41..43 the desert.
type AreaSe = readonly [wilds: number, crater: number, desert: number];
const areaSe = (t: AreaSe, area: number): number | undefined => {
  const v = area >= 36 && area <= 39 ? t[0] : area === 40 ? t[1] : area >= 41 && area <= 43 ? t[2] : -1;
  return v >= 0 ? v : undefined;
};
const AREA_SE = {
  bootaVoice: [0x5d7, 0x632, -1], // 0x009c0614
  goranVoice: [-1, -1, 0x6a2], // 0x009c1114
  astarkVoice: [0x5c9, 0x624, -1], // 0x009c02b4
  astarkBlood: [0x5cb, 0x626, -1], // 0x009c02fc
  dorphonKill: [0x5e2, 0x63d, -1], // 0x009c0b4c
  dorphonGround: [0x5e0, 0x63b, -1], // 0x009c0b04
  girtabluluKill: [-1, -1, 0x690], // 0x009c0dd8
  zuKill: [0x5f8, 0x64b, 0x69c], // 0x009c17a4
  merissaJump: [-1, -1, 0x681], // 0x009c1bf8
  merissaTop: [-1, -1, 0x682], // 0x009c1c1c
  yowieKill: [0x5d2, 0x62d, 0x67b], // 0x009c14a4
} as const satisfies Record<string, AreaSe>;

// --- the Booma family's shared state 8 -----------------------------------------
interface BoomaFamily {
  /** vtable +0x194: the death voice at motion frame 0. */
  voice: number | undefined;
  /** vtable +0x184: what the blood hook makes at motion frame 16. */
  blood: Omit<DeathStep, 'when'>;
}

function boomaFamily(f: BoomaFamily): DeathPlan {
  const blood = f.blood;
  return {
    steps: [
      { when: { frame: 0 }, ...(f.voice !== undefined ? { se: f.voice } : {}) },
      {
        when: { frame: 16 },
        ...blood,
        particles: [{ p: { id: 0xf3 }, at: ORIGIN }, ...(blood.particles ?? [])],
      },
    ],
  };
}

// The blood hooks: a particle (gensei 0xe4 / ab_dead 0xe5, 35 frames) and a
// 7.5 pool with 15 frames of delay at the blood stain point, red for the
// Booma / Boota and green for the others (0x00535b38, 0x005125f0, ...).
const goreHook = (particle: ParticleSpawn, id: PoolId): Omit<DeathStep, 'when'> => ({ particles: [{ p: particle, at: BLOOD }], pools: [pool(id, 15, BLOOD)] });
// The dark ones: a purple 7.5 pool at the position, the dark burst at the body.
const darkHook = (se: number | undefined): Omit<DeathStep, 'when'> => ({
  particles: at(DARK_BURST, BODY),
  pools: [pool('purple7_5', 0)],
  ...(se !== undefined ? { se } : {}),
});

/**
 * The death plan of an enemy class (`className` = the client class, `type` =
 * the newserv enemy type name) or null.
 */
export function deathPlanFor(className: string, type: string, ctx: DeathContext): DeathPlan | null {
  const temple = ctx.area === TEMPLE_A || ctx.area === TEMPLE_B;
  const area = ctx.area;
  switch (className) {
    // --- the ruins' dark enemies (the dissolve, then a purple pool) ----------
    case 'TObjEneBalClawBody': // Bulclaw 0x00531ee4 state 5 (VERIFIED): SE 0x202 at the kill; the burst (0x005787fc at weapon_position) when sub-state 3 starts (the port's 'end': ASSUMED timing); the dissolve; 0x005786e8 when done
      return { steps: [{ when: 'kill', se: 0x202 }, dark(undefined, BODY, 'end'), darkPool('purple7_5')] };
    case 'TObjEneBalClawClaw': // Claw 0x00534e84 (VERIFIED): SE 0x202 and the burst at weapon_position at the kill, InitializeEnemyState (dissolve); 0x005786e8 when done
      return { steps: [dark(0x202, BODY, 'kill'), darkPool('purple7_5')] };
    case 'TObjEneRe7Berura': // Dark Belra 0x00537388 (VERIFIED): the burst at +0x300 and SE 0x1f0 (0x1c5 in the temples, the map test) at the kill, the dissolve; 0x00578658 when done
      return { steps: [dark(temple ? 0x1c5 : 0x1f0, BODY, 'kill'), darkPool('purple15')] };
    case 'TObjEneDf2Bringer': // Chaos Bringer 0x0053aa34 (VERIFIED): SE 0x1dc at the origin, the burst at +0x300 and the dissolve at the kill; 0x00578658 when done
      return { steps: [dark(0x1dc, BODY, 'kill'), darkPool('purple15')] };
    case 'TObjEneDarkGunner': // Dark Gunner 0x00544634 (VERIFIED): SE 0x202 and the burst at weapon_position at the kill, the dissolve; 0x005786e8 when done
      return { steps: [dark(0x202, BODY, 'kill'), darkPool('purple7_5')] };
    case 'TObjEneSaver': // Delsaber 0x0054e688 (VERIFIED): the burst at its origin (&x) and SE 0x1d2 at the kill, the dissolve; 0x005786e8 when done
      return { steps: [dark(0x1d2, ORIGIN, 'kill'), darkPool('purple7_5')] };
    case 'TObjEneRe4Sorcerer': // Chaos Sorcerer 0x0059bbe8 (VERIFIED): SE 0x1e4 and the burst at +0x300 at the kill, the dissolve; 0x00578658 when done
      return { steps: [dark(0x1e4, BODY, 'kill'), darkPool('purple15')] };
    // --- Episode 2 --------------------------------------------------------------
    case 'TObjEneDellBiter': // Delbiter 0x0054b144 (VERIFIED): SE 0x2e3 in the tower map (tower = 35 = 0x23 in the dump's map enum) else 0x26f at the kill; at the motion's end the burst at +0x300, SE 0x285 there, the dissolve; 0x00578658 when done
      return { steps: [{ when: 'kill', se: area === TOWER ? 0x2e3 : 0x26f }, dark(0x285, BODY, 'end'), darkPool('purple15')] };
    case 'TObjEneMorfos': // Morfos 0x0057aa0c (VERIFIED): SE 0x27b at the kill; at the motion's end (the 0x410 state's check, ASSUMED to be the end) the burst and SE 0x285 at its origin, the dissolve; 0x00578658 when done
      return { steps: [{ when: 'kill', se: 0x27b }, dark(0x285, ORIGIN, 'end'), darkPool('purple15')] };
    case 'TObjEneMe3StelthReal': // Sinow Berill / Spigell 0x0059f3dc: SE 0x243 at motion frame 18 (was 'kill'), 0xf8 at the end, SE 0x247 + explosion 20 frames later (VERIFIED)
      return sinow(0x243, 0x247);
    case 'TObjEneMe3SinowZoaReal': // Sinow Zoa / Zele 0x005926c4: SE 0x27f at motion frame 18 (was 'kill'), SE 0x283 + explosion later (VERIFIED)
      return sinow(0x27f, 0x283);
    case 'TObjEneMe1GiGue': // Gi Gue 0x0056b19c (VERIFIED, GiGuesOnDeath): dies at once; 0x205 and 0x206 at y + 40 (0x009262fc), SE 0x229 at the same point
      return {
        instant: true,
        steps: [{ when: 'kill', se: 0x229, particles: at([{ id: 0x205 }, { id: 0x206 }], { base: 'origin', up: 40 }), remove: true }],
      };
    // --- the mines -----------------------------------------------------------
    case 'TObjEneMe1Canadin': // Canadine 0x0053e610 (VERIFIED): the kill path (entry 4, 0x53e63e) plays SE 0x143 (push at 0x53e6bd) and the explosion at the body point with y + [0x00923720] = -5.0 (0x53e667); the model fragments (the model's entry 0, default parameters, not re-traced), gone at once
      return { instant: true, steps: [{ when: 'kill', se: 0x143, particles: at(EXPLOSION, { base: 'body', up: -5 }), fragments: 'default', remove: true }] };
    case 'TObjEneMe3ShinowaReal': // Sinow Beat / Gold 0x0058da40 (VERIFIED): SE 0x137 at motion frame 13 or 25, 0xf8 at the end, SE 0x13b and the explosion 20 frames later
      return {
        steps: [
          { when: { frame: 13 }, se: 0x137 },
          { when: { frame: 25 }, se: 0x137 },
          { when: 'end', particles: [{ p: { id: 0xf8, delay: 0, duration: 0x14 }, at: { base: 'origin', forward: 20, up: 10 } }] },
          { when: { wait: 20 }, se: 0x13b, particles: at(EXPLOSION, { base: 'origin', forward: 20 }), remove: true },
        ],
      };
    case 'TObjEneDubchik': // Dubchic / Gillchic (VERIFIED 2026-10-21): the state 0x555234 calls the kill handler 0x5558bc every tick once flag 0x2000000 is set. The first call makes the shock 0x556ed0 (0xf8 for 30 frames at +0x300, 0x5788d0) and sets the counter +0x344 to 30; it counts down each call and the explosion comes on the 30th call, 29 ticks after the kill. The explosion at +0x300 and the model fragments (0x009bdd88), gone
      return {
        steps: [
          { when: 'kill', particles: [{ p: { id: 0xf8, delay: 0, duration: 30 }, at: BODY }] },
          // The SE by episode (VERIFIED, 0x005558bc: g_CurrentEpisode 0 = Episode 1 -> 0x13b, else 0x156); the wait of 29 is VERIFIED (the counter 0x344 = 30, 0x5558bc).
          { when: { wait: 29 }, se: ctx.episode === 1 ? 0x13b : 0x156, particles: at(EXPLOSION, BODY), fragments: 'dubchic', remove: true },
        ],
      };
    case 'TObjEneEpsilonBody': // Epsilon / Epsigard 0x005588dc (VERIFIED): the 20th state-0 frame after the kill (0x4f0 > 0x13): SE 0x2d7 and the explosion at +0x300, the fragments (0x0092541c), gone
      return { steps: [{ when: { wait: 20 }, se: 0x2d7, particles: at(EXPLOSION, BODY), fragments: 'epsilon', remove: true }] };
    // --- the forest and the caves ----------------------------------------------
    case 'TObjEneRe2Flower': // Poison / Nar Lily 0x00527f20 (VERIFIED): the kill SE is 0xff, or 0x2c8 when the instance flag 0x800 is set (0x00527f20 kill branch); the flag picks the variant, not the name
      if (type === 'NAR_LILY' || type === 'DEL_LILY') {
        // The dark variant (flag 0x800: SE 0x2e3, the dark burst and a purple 7.5 pool 50 late 10 ahead, then the dissolve; VERIFIED 0x00527f20 state 0).
        // ASSUMED: that the Nar and Del Lilies are the flag-0x800 ones (the flag is set by the spawn, not traced).
        return {
          steps: [
            { when: 'kill', se: 0x2c8 },
            { when: 'end', se: 0x2e3, particles: at(DARK_BURST, ahead(10)), pools: [pool('purple7_5', 0x32, ahead(10))], dissolve: true },
          ],
        };
      }
      return {
        steps: [
          { when: 'kill', se: 0xff },
          { when: 'end', particles: [{ p: abDead(0x46), at: ahead(10) }], pools: [pool('green2_5', 0x32, ahead(10))], sink: sink(200) },
        ],
      };
    case 'TObjGrass': // Grass Assassin 0x005225bc (VERIFIED): 0xf0 at the origin at motion frame 23; at 32 SE 0xf7 at the origin, ab_dead (30) at the origin and a green 15 pool (CreateEnemyDropEntity_00578418, delay 10) at the origin. The (0,0,-15) point is only the derolle effect on maps 3..5 (not modelled)
      return {
        steps: [
          { when: { frame: 23 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { frame: 32 }, se: 0xf7, particles: [{ p: abDead(0x1e), at: ORIGIN }], pools: [pool('green15', 10, ORIGIN)] },
        ],
      };
    case 'TObjEneNanoDrago': // Nano Dragon 0x0057e9ac (VERIFIED): SE 0x112 at the kill, 0xf0 at motion frame 30, 30 frames later ab_dead (30) and a green 7.5 pool (0x00578538, delay 15) at the origin; the sink is a timer (map_id2 - 0.3 a frame, ASSUMED start) and the 0x1000000 variant (SE 0x10f) is not modelled
      return {
        steps: [
          { when: 'kill', se: 0x112 },
          { when: { frame: 30 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { wait: 30 }, particles: [{ p: abDead(0x1e), at: ORIGIN }], pools: [pool('green7_5', 15)] },
        ],
      };
    case 'TObjEneSlime': // Pofuilly Slime 0x00598648 (VERIFIED): SE 0x108 at the origin and the particle 0xfe at +0x300 when the death starts; its alpha fade (0x00597594, 5 frames, -0.2 a frame) is the slime's own (SlimeAi.stepDeathFade) and removes it
      return { steps: [{ when: 'kill', se: 0x108, particles: [{ p: { id: 0xfe }, at: BODY }], fade: true }] };
    case 'TObjEneMoja': // Hildebear / Hildeblue 0x00513614 (VERIFIED: the death motion, which the dump names 'Attack'; SE 0xc2 at frame 0, at 27 SE 0xbc, 0xf0 and gensei 50 at the blood point, red 15 (0x005781d8) 20 late). The kill's sink (0.1 a frame, 200) is ASSUMED: its state (not located) was not read
      return {
        steps: [
          { when: 'kill', sink: sink(200) },
          { when: { frame: 0 }, se: 0xc2 },
          { when: { frame: 27 }, se: 0xbc, particles: [{ p: { id: 0xf0 }, at: BLOOD }, { p: gensei(0x32), at: BLOOD }], pools: [pool('red15', 0x14, BLOOD)] },
        ],
      };
    case 'TObjEneBm3Fly': // Mothmant: the lethal death's two states (mothmantDeathPlan)
      return mothmantDeathPlan('fall');
    case 'TObjEneBm3FlyNest': // Monest 0x00519550 (VERIFIED): the spray 0xf1 every 4 frames and SE 0xe4 every 20 in the first 25 motion frames (0xc0 < 25); at the motion's end (0xb0 & 0x10) a red 15 pool (SpawnItem_005781d8, delay 50) and gensei 70 at (-10, 0, -8) rotated by the heading; the sink 0.1 a frame until the counter 0x4e0 passes 20 (200 frames)
      return {
        steps: [
          ...spray(),
          { when: 'end', particles: [{ p: gensei(0x46), at: { base: 'origin', side: -10, forward: -8 } }], pools: [pool('red15', 0x32, { base: 'origin', side: -10, forward: -8 })], sink: sink(200) },
        ],
      };
    case 'TObjEneBm5Wolf': // Savage / Barbarous Wolf 0x0051ba20 (VERIFIED): SE 0xd6 at the kill; at the motion's end a red 7.5 pool (CreateDropEntity_005782f8, 50 late) and gensei 70 at (+12 or -12, 0, -10) rotated by the heading. The side is the state 0xe (+12) or 0xf (-12) that the kill sets from 0x0051bdb8: 0xe when the velocity at the kill is on one side of the facing (f.z * v.x < f.x * v.z, 0x007829cc against 0x00979ac8 = 0), 0xf when it stands still. ASSUMED: the port keeps +12, since the velocity is not in the plan. The sink 0.1 a frame (0x00921384) until the counter passes 20 (0x00921380): 200 frames (VERIFIED)
      return {
        steps: [
          { when: 'kill', se: 0xd6 },
          { when: 'end', particles: [{ p: gensei(0x46), at: { base: 'origin', side: 12, forward: -10 } }], pools: [pool('red7_5', 0x32, { base: 'origin', side: 12, forward: -10 })], sink: sink(200) },
        ],
      };
    // --- the Booma family: the shared state 8 -----------------------------------
    case 'TObjEneBeast': // Booma (vtable 0x00b01fc0, VERIFIED): voice 0xe6 (+0x194 = 0x00535c14, push 0xe6), the blood hook +0x184 = 0x00535b38 (gensei 35, red 7.5 15 late); both at the family's frames 0 and 16
      return boomaFamily({ voice: 0xe6, blood: goreHook(gensei(0x23), 'red7_5') });
    case 'TObjEneShark': // Shark (vtable 0x00aff860, VERIFIED): hook +0x184 = 0x005125f0 (ab_dead 35 at 0x00512653, green 7.5 15 late at 0x0051265f), voice +0x194 = 0x005126bc (0xf9)
      return boomaFamily({ voice: 0xf9, blood: goreHook(abDead(0x23), 'green7_5') });
    case 'TObjEneDimedian': // Dimenian (vtable 0x00b041e0, VERIFIED): the dark hook +0x184 = 0x005517d4 (purple 7.5 at the origin 0x005517de, the dark burst at +0x300 (0x005787fc), SE 0x1f0 at 0x00551801, 0x1c5 in the temples at 0x0055181e); the voice +0x194 = 0x005518ec (0x208)
      return boomaFamily({ voice: 0x208, blood: darkHook(temple ? 0x1c5 : 0x1f0) });
    case 'TObjEneDolmOlm': // Dolmolm / Dolmdarl (vtable 0x00b04480, VERIFIED): hook +0x184 = 0x005527a0 (ab_dead 35 at 0x00552803, green 7.5 15 late at 0x0055280f), voice +0x194 = 0x005528b4 (0x256)
      return boomaFamily({ voice: 0x256, blood: goreHook(abDead(0x23), 'green7_5') });
    case 'TObjEneMerillLia': // Merillia / Meriltas (vtable 0x00b066e0, VERIFIED): hook +0x184 = 0x00574dbc (ab_dead 35 at 0x00574e1f, green 7.5 15 late at 0x00574e2b), voice +0x194 = 0x00575418 (0x20d at the origin; 0x0057416e is a constructor's particle, not the voice)
      return boomaFamily({ voice: 0x20d, blood: goreHook(abDead(0x23), 'green7_5') });
    case 'BootaFamily': // Boota / Ze Boota / Ba Boota (vtable 0x00b0a680, VERIFIED): hook +0x184 = 0x005a58ac (gensei 35, red 7.5 15 late; not the Booma's 0x00535b38), voice +0x194 = 0x005a59ac (table 0x009c0614, all 11 entries)
      return boomaFamily({ voice: areaSe(AREA_SE.bootaVoice, area), blood: goreHook(gensei(0x23), 'red7_5') });
    case 'GoranFamily': // Goran / Pyro Goran / Goran Detonator (vtable 0x00b0af40, VERIFIED): the dark hook +0x184 = 0x005ad5b0 (purple 7.5 at the origin, the dark burst at +0x300, and the area's SE from table 0x009c1114), the voice +0x194 = 0x005ad6c8 (the same table)
      return boomaFamily({ voice: areaSe(AREA_SE.goranVoice, area), blood: darkHook(areaSe(AREA_SE.goranVoice, area)) });
    // --- Episode 2 animals ----------------------------------------------------------
    case 'TObjEneBm9Mericarol': // Mericarol 0x00571194 (VERIFIED: the 0x218 push is at 0x005712e4 in this function, the dump's maybe_mericarol_hit): SE 0x218 at the kill; at the motion's end (flag 0x10), 10 ahead along the heading (0x00926c3c = 10.0), a green 25 pool (CreateEntity_00578388, 50 late) and ab_dead (70); then the body sinks 0.1 a frame (0x00926c44) until the counter passes 0x00926c40 = 30.0: 300 frames
      return {
        steps: [
          { when: 'kill', se: 0x218 },
          { when: 'end', particles: [{ p: abDead(0x46), at: ahead(10) }], pools: [pool('green25', 0x32, ahead(10))], sink: sink(300) },
        ],
      };
    case 'TObjEneBm5GibonU': // Ul / Zol Gibbon 0x00565ecc (VERIFIED): SE 0x233 at the kill; at the motion's end, at (0, 0, -10) by the heading: a red 15 pool (SpawnItem_005781d8) when currently_casting_tech_info.cast == 1, else a red 7.5 (CreateDropEntity_005782f8), both 50 late, and gensei 70; then the sink 0.1 a frame until 20 (200 frames). The Zol = cast 1 is ASSUMED (the type name stands in)
      return {
        steps: [
          { when: 'kill', se: 0x233 },
          { when: 'end', particles: [{ p: gensei(0x46), at: ahead(-10) }], pools: [pool(type === 'ZOL_GIBBON' ? 'red15' : 'red7_5', 0x32, ahead(-10))], sink: sink(200) },
        ],
      };
    case 'TObjEneIllGill': // Ill Gill 0x0052e898 (VERIFIED: IllgillUpdateState, state 8): the kill 0x005310e0 makes 0xf2 at +0x300; SE 0x2dc at motion frame 10, 0xf0 at 30, at 52 SE 0x2e3, the purple 15 pool (CreateEntity_00578658, 10 late) and the dark burst at the origin, then the removal 2 frames later (the counter 'last_footstep_effect_y' 1 -> 0 -> -1). ASSUMED: the state-7 handler (0x0052ea00) plays SE 0x2db at motion frame 30; not added (which state is the death is UNCLEAR)
      return {
        steps: [
          { when: 'kill', particles: [{ p: { id: 0xf2 }, at: BODY }] },
          { when: { frame: 10 }, se: 0x2dc },
          { when: { frame: 30 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { frame: 52 }, se: 0x2e3, particles: at(DARK_BURST, ORIGIN), pools: [pool('purple15', 10)] },
          { when: { wait: 2 }, remove: true },
        ],
      };
    case 'TObjEneDelDepth': // Deldepth 0x00548d60 (VERIFIED, except the counter's start): the kill (0x00549764) plays SE 0x276 at the origin and sets the counter 0x38c to 16 when the mode [0x384]+4 is >= 6 (ASSUMED branch: else the counter keeps its value). The state 0x548d60 counts it down a call a tick; at 0 it plays SE 0x276 again (0x548e61), sets the counter to 5 and state 1; five calls later state 2 (0x548dd8) makes the purple 7.5 pool at the origin (0x5786e8, delay 0) and removes the enemy. So the second SE at +16 and the pool and removal 6 ticks after it (+22)
      return { steps: [{ when: 'kill', se: 0x276 }, { when: { wait: 16 }, se: 0x276 }, { when: { wait: 6 }, pools: [pool('purple7_5', 0)], remove: true }] };
    // --- Episode 4 ---------------------------------------------------------------
    case 'Astark': // Astark 0x005a1f8c (VERIFIED, the death state 9; the kill is 0x005a4a64): the kill 0xf2 at +0x300, the body (0x005a4a64: `lea eax,[ebx+0x300]; push 0xf2`, not the cursor); voice by area (table 0x009c02b4) at motion frame 0; at 27 the second sound (table 0x009c02fc), 0xf0, a green 25 pool (CreateEntity_00578388, 20 late) and ab_dead (50) at the blood point. The state 0x5a1f8c moves nothing down (no y change): it lowers the timer 0x394 by 0.1 a call and removes the enemy when it is below -20, so the removal is ~200 ticks after the kill (the timer is set to 0 at spawn, 0x005a40ca in 0x005a3e2c; ASSUMED that nothing else writes it in life)
      return {
        steps: [
          { when: 'kill', particles: [{ p: { id: 0xf2 }, at: BODY }] },
          { when: { frame: 0 }, ...optSe(areaSe(AREA_SE.astarkVoice, area)) },
          { when: { frame: 27 }, ...optSe(areaSe(AREA_SE.astarkBlood, area)), particles: [{ p: { id: 0xf0 }, at: BLOOD }, { p: abDead(0x32), at: BLOOD }], pools: [pool('green25', 0x14, BLOOD)] },
          // 173 ticks after frame 27 = 200 after the kill (the waits count from the last step that fired).
          { when: { wait: 173 }, remove: true },
        ],
      };
    case 'Dorphon': // Dorphon / Eclair 0x005a72d8 (VERIFIED): SE by area (table 0x009c0b4c) at the kill; at motion frame 28 gensei (70) at +0x300, the ground SE (table 0x009c0b04) and the ground effect (0x005a8d20, not modelled); at the end a red 25 pool at the origin (CreateEntity_00578148)
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.dorphonKill, area)) },
          { when: { frame: 28 }, ...optSe(areaSe(AREA_SE.dorphonGround, area)), particles: [{ p: gensei(0x46), at: BODY }] },
          { when: 'end', pools: [pool('red25', 0)] },
        ],
      };
    case 'Girtablulu': // Girtablulu 0x005aa2d8 (VERIFIED; the dump names it DorphonProcessState9): SE by area (table 0x009c0dd8) at the kill; at the motion's end the burst at +0x300 and the dissolve (0x490 vtable), then a purple 25 pool (CreateEntity_005785c8) at the origin
      return { steps: [{ when: 'kill', ...optSe(areaSe(AREA_SE.girtabluluKill, area)) }, { when: 'end', particles: at(DARK_BURST, BODY), dissolve: true }, darkPool('purple25')] };
    case 'Zu': // Zu / Pazuzu on_zu_killed (dump line 400585; VERIFIED): SE by area (table 0x009c17a4) at the kill; 0xf0 at the origin when the death motion reaches frame 30; 30 frames later gensei (30) and a red 15 pool (SpawnItem_005781d8, 15 late) at the origin; the removal is a timer (not modelled)
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.zuKill, area)) },
          { when: { frame: 30 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { wait: 30 }, particles: [{ p: gensei(0x1e), at: ORIGIN }], pools: [pool('red15', 15)] },
        ],
      };
    case 'MerissaA': // Merissa A / AA on_merissa_dead 0x005b52ec (VERIFIED): the two sounds by area (tables 0x009c1bf8, 0x009c1c1c) at the kill; the green 7.5 pool (sub-entity handler 0x005b6328: at the motion's end (flag 0x10) and once (flag 0x40 at 0x37c), 0x578538 at the origin, 50 late) is linked by the five-word row at 0x009c1a98 of the enemy table: the death 0x005b52ec and the sub-entity 0x005b6328 (VERIFIED)
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.merissaJump, area)) },
          { when: 'kill', ...optSe(areaSe(AREA_SE.merissaTop, area)) },
          { when: 'end', pools: [pool('green7_5', 0x32)] },
        ],
      };
    case 'SatelliteLizardYowie': // Satellite Lizard / Yowie 0x005af0a4 (VERIFIED; the dump names it GoranProcessState): SE by area (table 0x009c14a4) at the kill; at the motion's end, at (+12 for the state 0xe, -12 for 0xf; -10; the kill sets it from 0x005af444 as the Savage Wolf's 0x0051bdb8, ASSUMED: the port keeps +12, the velocity is not in the plan), a red 7.5 pool (CreateDropEntity_005782f8, 50 late) and gensei 70; then the sink 0.1 a frame (0x0092ab48) until the counter passes 20 (0x0092ab44): 200 frames (VERIFIED; it was missing)
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.yowieKill, area)) },
          { when: 'end', particles: [{ p: gensei(0x46), at: { base: 'origin', side: 12, forward: -10 } }], pools: [pool('red7_5', 0x32, { base: 'origin', side: 12, forward: -10 })], sink: sink(200) },
        ],
      };
    default:
      return null;
  }
}

const optSe = (se: number | undefined): { se?: number } => (se !== undefined ? { se } : {});

// Monest 0x00519550: while the motion is under 25 frames a counter (+0x4d0, 4 at the kill) makes the
// particle 0xf1 on a ring of 5..10 around the body, 5 up, every time it passes 3 (frames 0, 4, 8, ...);
// +0x4d4 (0x14) plays SE 0xe4 at the position when it passes 19 (frames 0 and 20).
function spray(): DeathStep[] {
  const out: DeathStep[] = [];
  for (let k = 0; k < 25; k += 4) out.push({ when: { frame: k }, ...(k % 20 === 0 ? { se: 0xe4 } : {}), particles: [{ p: { id: 0xf1 }, at: { base: 'body', up: 5, ring: [5, 10] } }] });
  return out;
}

// --- the enemy ids ----------------------------------------------------------------

/** Why an enemy type has no plan. */
export type NoDeath = 'boss' | 'child' | 'killed-only' | 'untraced' | 'no-model';

/**
 * Every newserv enemy type (formats/entitynames.ts ENEMY_TYPE_NAMES) with the
 * client class that runs it (formats/enemymodels.ts, the set type's constructor)
 * and what the exe does at its death: `plan` = a traced plan in deathPlanFor,
 * otherwise the reason there is none.
 *   boss: ported on its own (combat/dragon.ts, derolle.ts, volopt*.ts, darkfalz*.ts, saintmilion.ts...);
 *   child: a part of another enemy (its parent's death owns the effects);
 *   killed-only: the death state only runs on_enemy_killed (EXP and the drop request): Hidoom, Migium, Pan Arms;
 *   untraced: the death state was not found in the dump (named in the DEVLOG);
 *   no-model: the port makes no enemy for it.
 */
export type DeathRow = { cls: string; plan: true } | { cls: string; plan: false; why: NoDeath };

const P = (cls: string): DeathRow => ({ cls, plan: true });
const N = (cls: string, why: NoDeath): DeathRow => ({ cls, plan: false, why });

export const DEATH_ROWS: Readonly<Record<string, DeathRow>> = {
  UNKNOWN: N('', 'no-model'),
  NONE: N('', 'no-model'),
  NON_ENEMY_NPC: N('', 'no-model'),
  AL_RAPPY: N('TObjEneLappy', 'untraced'), // the Rappy's death is the fake death of combat/enemyfsm.ts (RappyFakeDeath); the state's own sounds / particles were not found
  ASTARK: P('Astark'),
  BA_BOOTA: P('BootaFamily'),
  BARBA_RAY_JOINT: N('TBoss7DeRolLeC', 'boss'),
  BARBA_RAY: N('TBoss7DeRolLeC', 'boss'),
  BARBAROUS_WOLF: P('TObjEneBm5Wolf'),
  BEE_L: N('TObjEneRe4Sorcerer', 'child'),
  BEE_R: N('TObjEneRe4Sorcerer', 'child'),
  BOOMA: P('TObjEneBeast'),
  BOOTA: P('BootaFamily'),
  BULCLAW: P('TObjEneBalClawBody'),
  BULK: N('TObjEneBalClawBody', 'child'),
  CANADINE_GROUP: N('TObjEneMe1Canadin', 'child'),
  CANADINE: P('TObjEneMe1Canadin'),
  CANANE: N('TObjEneMe1CanadinLeader', 'untraced'),
  CHAOS_BRINGER: P('TObjEneDf2Bringer'),
  CHAOS_SORCERER: P('TObjEneRe4Sorcerer'),
  CLAW: P('TObjEneBalClawClaw'),
  DARK_BELRA: P('TObjEneRe7Berura'),
  DARK_FALZ_1: N('TBoss4DarkFalz', 'boss'),
  DARK_FALZ_2: N('TBoss4DarkFalz', 'boss'),
  DARK_FALZ_3: N('TBoss4DarkFalz', 'boss'),
  DARK_GUNNER_CONTROL: N('TObjEneDarkGunCenter', 'no-model'),
  DARK_GUNNER: P('TObjEneDarkGunner'),
  DARVANT: N('TBoss4DarkFalz', 'boss'),
  DE_ROL_LE_BODY: N('TBoss2DeRolLe', 'boss'),
  DE_ROL_LE_MINE: N('TBoss2DeRolLe', 'boss'),
  DE_ROL_LE: N('TBoss2DeRolLe', 'boss'),
  DEATH_GUNNER: P('TObjEneDarkGunner'),
  DEL_LILY: P('TObjEneRe2Flower'),
  DEL_RAPPY_CRATER: N('TObjEneLappy', 'untraced'),
  DEL_RAPPY_DESERT: N('TObjEneLappy', 'untraced'),
  DELBITER: P('TObjEneDellBiter'),
  DELDEPTH: P('TObjEneDelDepth'),
  DELSABER: P('TObjEneSaver'),
  DIMENIAN: P('TObjEneDimedian'),
  DOLMDARL: P('TObjEneDolmOlm'),
  DOLMOLM: P('TObjEneDolmOlm'),
  DORPHON_ECLAIR: P('Dorphon'),
  DORPHON: P('Dorphon'),
  DRAGON: N('TBoss1Dragon', 'boss'),
  DUBCHIC: P('TObjEneDubchik'),
  DUBWITCH: N('TOCtrlDubchik', 'no-model'),
  EGG_RAPPY: N('TObjEneLappy', 'untraced'),
  EPSIGARD: P('TObjEneEpsilonBody'),
  EPSILON: P('TObjEneEpsilonBody'),
  EVIL_SHARK: P('TObjEneShark'),
  GAEL_OR_GIEL: N('', 'no-model'),
  GAL_GRYPHON: N('TBoss5Gryphon', 'boss'),
  GARANZ: N('TObjEneGyaranzo', 'untraced'),
  GEE: N('TObjEneMe1Gee', 'untraced'),
  GI_GUE: P('TObjEneMe1GiGue'),
  GIBBLES: N('TObjEneGibbles', 'untraced'),
  GIGOBOOMA: P('TObjEneBeast'),
  GILLCHIC: P('TObjEneDubchik'),
  GIRTABLULU: P('Girtablulu'),
  GOBOOMA: P('TObjEneBeast'),
  GOL_DRAGON: N('TBoss8Dragon', 'boss'),
  GORAN_DETONATOR: P('GoranFamily'),
  GORAN: P('GoranFamily'),
  GRASS_ASSASSIN: P('TObjGrass'),
  GUIL_SHARK: P('TObjEneShark'),
  HALLO_RAPPY: N('TObjEneLappy', 'untraced'),
  HIDOOM: N('TObjEnePanarms', 'killed-only'),
  HILDEBEAR: P('TObjEneMoja'),
  HILDEBLUE: P('TObjEneMoja'),
  ILL_GILL: P('TObjEneIllGill'),
  KONDRIEU_SPINNER: N('Episode4Boss', 'boss'),
  KONDRIEU: N('Episode4Boss', 'boss'),
  LA_DIMENIAN: P('TObjEneDimedian'),
  LOVE_RAPPY: N('TObjEneLappy', 'untraced'),
  MERICARAND: P('TObjEneBm9Mericarol'),
  MERICAROL: P('TObjEneBm9Mericarol'),
  MERICUS: P('TObjEneBm9Mericarol'),
  MERIKLE: P('TObjEneBm9Mericarol'),
  MERILLIA: P('TObjEneMerillLia'),
  MERILTAS: P('TObjEneMerillLia'),
  MERISSA_A: P('MerissaA'),
  MERISSA_AA: P('MerissaA'),
  MIGIUM: N('TObjEnePanarms', 'killed-only'),
  MONEST: P('TObjEneBm3FlyNest'),
  MORFOS: P('TObjEneMorfos'),
  MOTHMANT: P('TObjEneBm3Fly'),
  NANO_DRAGON: P('TObjEneNanoDrago'),
  NAR_LILY: P('TObjEneRe2Flower'),
  OLGA_FLOW_1: N('TBoss6PlotFalz', 'boss'),
  OLGA_FLOW_2: N('TBoss6PlotFalz', 'boss'),
  PAL_SHARK: P('TObjEneShark'),
  PAN_ARMS: N('TObjEnePanarms', 'killed-only'),
  PAZUZU_CRATER: P('Zu'),
  PAZUZU_DESERT: P('Zu'),
  PIG_RAY: N('TBoss7DeRolLeC', 'boss'),
  POFUILLY_SLIME: P('TObjEneSlime'),
  POISON_LILY: P('TObjEneRe2Flower'),
  POUILLY_SLIME: P('TObjEneSlime'),
  PYRO_GORAN: P('GoranFamily'),
  RAG_RAPPY: N('TObjEneLappy', 'untraced'),
  RECOBOX: N('TObjEneRecobox', 'untraced'),
  RECON: N('TObjEneRecobox', 'untraced'),
  SAINT_MILION_SPINNER: N('Episode4Boss', 'boss'),
  SAINT_MILION: N('Episode4Boss', 'boss'),
  SAINT_RAPPY: N('TObjEneLappy', 'untraced'),
  SAND_RAPPY_CRATER: N('TObjEneLappy', 'untraced'),
  SAND_RAPPY_DESERT: N('TObjEneLappy', 'untraced'),
  SATELLITE_LIZARD_CRATER: P('SatelliteLizardYowie'),
  SATELLITE_LIZARD_DESERT: P('SatelliteLizardYowie'),
  SAVAGE_WOLF: P('TObjEneBm5Wolf'),
  SHAMBERTIN_SPINNER: N('Episode4Boss', 'boss'),
  SHAMBERTIN: N('Episode4Boss', 'boss'),
  SINOW_BEAT: P('TObjEneMe3ShinowaReal'),
  SINOW_BERILL: P('TObjEneMe3StelthReal'),
  SINOW_GOLD: P('TObjEneMe3ShinowaReal'),
  SINOW_SPIGELL: P('TObjEneMe3StelthReal'),
  SINOW_ZELE: P('TObjEneMe3SinowZoaReal'),
  SINOW_ZOA: P('TObjEneMe3SinowZoaReal'),
  SO_DIMENIAN: P('TObjEneDimedian'),
  UL_GIBBON: P('TObjEneBm5GibonU'),
  UL_RAY: N('TBoss7DeRolLeC', 'boss'),
  VOL_OPT_1: N('TBoss3Volopt', 'boss'),
  VOL_OPT_2: N('TBoss3VoloptP02', 'boss'),
  VOL_OPT_AMP: N('TBoss3Volopt', 'boss'),
  VOL_OPT_CORE: N('TBoss3Volopt', 'boss'),
  VOL_OPT_MONITOR: N('TBoss3Volopt', 'boss'),
  VOL_OPT_PILLAR: N('TBoss3Volopt', 'boss'),
  YOWIE_CRATER: P('SatelliteLizardYowie'),
  YOWIE_DESERT: P('SatelliteLizardYowie'),
  ZE_BOOTA: P('BootaFamily'),
  ZOL_GIBBON: P('TObjEneBm5GibonU'),
  ZU_CRATER: P('Zu'),
  ZU_DESERT: P('Zu'),
};

// --- the run ---------------------------------------------------------------------------

export interface DeathActions {
  se: number[];
  spawn: { p: ParticleSpawn; at: DeathPoint }[];
  pools: DeathPool[];
  fragments: FragmentTable[];
  /** The dissolve started this frame. */
  dissolve: boolean;
  /** Units the corpse sinks this frame. */
  sink: number;
  /** The enemy ends now. */
  remove: boolean;
  /** The owner's fade starts this frame (it steps the fade from the next frame). */
  fade: boolean;
}

/** The steps of one dying enemy, advanced once per game frame. */
export class DeathRun {
  readonly plan: DeathPlan;
  private i = 0;
  private t = 0;
  private last = 0;
  private sinkLeft = 0;
  private sinkStep = 0;

  constructor(plan: DeathPlan) {
    this.plan = plan;
  }

  get finished(): boolean {
    return this.i >= this.plan.steps.length && this.sinkLeft <= 0;
  }

  /** One game frame; `motionFrame` is the death motion's elapsed frames, `ended` whether it ended, `dissolved` whether the dissolve is done, `landed` whether a Mothmant's fall reached the floor this frame (the 'land' step). */
  tick(motionFrame: number, ended: boolean, dissolved = false, landed = false): DeathActions {
    const out: DeathActions = { se: [], spawn: [], pools: [], fragments: [], dissolve: false, sink: 0, remove: false, fade: false };
    // Several steps may fall due in the same frame (kill + a motion that is already past a frame).
    while (this.i < this.plan.steps.length) {
      const s = this.plan.steps[this.i];
      const w = s.when;
      // A motion that has ended has passed every frame, so a frame step behind a short motion still fires.
      const due = w === 'kill' ? true : w === 'end' ? ended : w === 'land' ? landed : w === 'dissolved' ? dissolved : 'frame' in w ? motionFrame >= w.frame || ended : this.t - this.last >= w.wait;
      if (!due) break;
      this.i++;
      this.last = this.t;
      if (s.se !== undefined) out.se.push(s.se);
      if (s.particles) out.spawn.push(...s.particles);
      if (s.pools) out.pools.push(...s.pools);
      if (s.fragments) out.fragments.push(s.fragments);
      if (s.dissolve) out.dissolve = true;
      if (s.sink) {
        this.sinkLeft = s.sink.frames;
        this.sinkStep = s.sink.perFrame;
      }
      if (s.remove) out.remove = true;
      if (s.fade) out.fade = true;
    }
    if (this.sinkLeft > 0) {
      out.sink = this.sinkStep;
      if (--this.sinkLeft === 0 && this.i >= this.plan.steps.length) out.remove = true;
    }
    this.t++;
    return out;
  }
}

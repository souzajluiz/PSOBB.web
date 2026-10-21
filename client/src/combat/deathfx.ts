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
// The Booma family (Booma, Shark, Dimenian, Dolmolm, Merillia, Boota, Goran:
// the classes whose vtable +0x174 is the shared state 8, 0x0052b518) share the
// death state: the class's death voice (vtable +0x194) at motion frame 0, the
// particle 0xf3 at motion frame 16 and the class's blood hook (vtable +0x184).
// Each class's hooks were read from its vtable (0x00a48060 Shark, 0x00a4a7c0
// Booma, 0x00a4c9e0 Dimenian, 0x00a4cc80 Dolmolm, 0x00a4eee0 Merillia,
// 0x00a52e80 Boota, 0x00a53740 Goran).
//
// The unit of time is the game frame (30 a second). `end` = the death motion
// ended (animation_flags & 0x10, set by Player__Animate when a play-once
// motion reaches its last frame); `{ frame }` = the motion's elapsed frames
// (check_entity_animation_elapsed_threshold); `{ wait }` = frames after the
// step before it; `dissolved` = the dissolve finished.
//
// NOT modelled (named in the DEVLOG): the knock-back flight of the Mothmant's
// fall, the Deldepth's counter, the ground effect of the Dorphon (0x005a8d20),
// the tilt angle the Delsaber's state halves (0x7a8cb8), the Canadine that
// dies open (0x0053f5ec); see `UNTRACED`.
//
// Checked against the exe (the salvage pass, 2026-10-21): the helpers' particle
// ids and durations, the blood stain point (0x00535b38), the Canadine row and
// the Dubchic's SE by episode. The other rows' sounds, particle ids and timings are
// carried from the first trace and are ASSUMED until each is re-traced.

import type { PoolId } from './blooddecals.ts';
import type { ParticleSpawn } from './hitfx.ts';
import type { FragmentTable } from './shellfragments.ts';

export type DeathWhen = 'kill' | 'end' | 'dissolved' | { frame: number } | { wait: number };

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

/** A dark enemy's death: the burst and the dissolve (on the kill, or after the motion). */
function dark(se: number | undefined, point: DeathPoint, from: 'kill' | 'end'): DeathStep {
  return { when: from, ...(se !== undefined ? { se } : {}), particles: at(DARK_BURST, point), dissolve: true };
}

/** What the dark enemy leaves when its dissolve is done: a purple pool at its position, then it is gone. */
const darkPool = (id: PoolId): DeathStep => ({ when: 'dissolved', pools: [pool(id, 0)], remove: true });

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
    case 'TObjEneBalClawBody': // Bulclaw 0x00531ee4 state 5: SE 0x202 at the kill; after the motion (sub 3) the burst and the dissolve; 0x005786e8 when done
      return { steps: [{ when: 'kill', se: 0x202 }, dark(undefined, BODY, 'end'), darkPool('purple7_5')] };
    case 'TObjEneBalClawClaw': // Claw 0x00534e84: SE 0x202, the burst and the dissolve at the kill; 0x005786e8 when done
      return { steps: [dark(0x202, BODY, 'kill'), darkPool('purple7_5')] };
    case 'TObjEneRe7Berura': // Dark Belra 0x00537388: the burst, the dissolve and SE 0x1f0 (0x1c5 in the temples) at the kill; 0x00578658 when done
      return { steps: [dark(temple ? 0x1c5 : 0x1f0, BODY, 'kill'), darkPool('purple15')] };
    case 'TObjEneDf2Bringer': // Chaos Bringer 0x0053aa34: SE 0x1dc, the burst and the dissolve at the kill; 0x00578658 when done
      return { steps: [dark(0x1dc, BODY, 'kill'), darkPool('purple15')] };
    case 'TObjEneDarkGunner': // Dark Gunner 0x00544634: SE 0x202, the burst and the dissolve at the kill; 0x005786e8 when done
      return { steps: [dark(0x202, BODY, 'kill'), darkPool('purple7_5')] };
    case 'TObjEneSaver': // Delsaber 0x0054e688: the burst at its feet, the dissolve and SE 0x1d2 at the kill; 0x005786e8 when done
      return { steps: [dark(0x1d2, ORIGIN, 'kill'), darkPool('purple7_5')] };
    case 'TObjEneRe4Sorcerer': // Chaos Sorcerer 0x0059bbe8: the burst, the dissolve and SE 0x1e4 at the kill; 0x00578658 when done
      return { steps: [dark(0x1e4, BODY, 'kill'), darkPool('purple15')] };
    // --- Episode 2 --------------------------------------------------------------
    case 'TObjEneDellBiter': // Delbiter 0x0054b144: SE 0x2e3 (the tower) or 0x26f at the kill; after the motion the burst, SE 0x285 and the dissolve; 0x00578658 when done
      return { steps: [{ when: 'kill', se: area === TOWER ? 0x2e3 : 0x26f }, dark(0x285, BODY, 'end'), darkPool('purple15')] };
    case 'TObjEneMorfos': // Morfos 0x0057aa0c: SE 0x27b at the kill; after the motion the burst at its feet, SE 0x285 and the dissolve; 0x00578658 when done
      return { steps: [{ when: 'kill', se: 0x27b }, dark(0x285, ORIGIN, 'end'), darkPool('purple15')] };
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
    case 'TObjEneMe1Canadin': // Canadine 0x0053e610: the explosion at its body point + g_EnemySpawnRotationParams_0x20 (ASSUMED -5: the global's value is not in the dump), SE 0x143 and the model fragments (the model's entry 0, default parameters), gone at once
      return { instant: true, steps: [{ when: 'kill', se: 0x143, particles: at(EXPLOSION, { base: 'body', up: -5 }), fragments: 'default', remove: true }] };
    case 'TObjEneMe3ShinowaReal': // Sinow Beat / Gold 0x0058da40: SE 0x137 twice in the motion (13 and 25)
      return {
        steps: [
          { when: { frame: 13 }, se: 0x137 },
          { when: { frame: 25 }, se: 0x137 },
          { when: 'end', particles: [{ p: { id: 0xf8, delay: 0, duration: 0x14 }, at: { base: 'origin', forward: 20, up: 10 } }] },
          { when: { wait: 20 }, se: 0x13b, particles: at(EXPLOSION, { base: 'origin', forward: 20 }), remove: true },
        ],
      };
    case 'TObjEneDubchik': // Dubchic / Gillchic 0x005558bc: the 0xf8 shock at the body for 30 frames, then SE 0x13b (Episode 1) or 0x156, the explosion and the model fragments (0x009bdd88), gone
      return {
        steps: [
          { when: 'kill', particles: [{ p: { id: 0xf8, delay: 0, duration: 30 }, at: BODY }] },
          { when: { wait: 29 }, se: ctx.episode === 1 ? 0x13b : 0x156, particles: at(EXPLOSION, BODY), fragments: 'dubchic', remove: true },
        ],
      };
    case 'TObjEneEpsilonBody': // Epsilon / Epsigard 0x005588dc: 20 frames after the kill SE 0x2d7, the explosion and the model fragments (0x0092541c)
      return { steps: [{ when: { wait: 19 }, se: 0x2d7, particles: at(EXPLOSION, BODY), fragments: 'epsilon', remove: true }] };
    // --- the forest and the caves ----------------------------------------------
    case 'TObjEneRe2Flower': // Poison / Nar Lily 0x00527f20: SE 0xff (0x2c8: ASSUMED the Nar Lily) at the kill; after the motion 10 ahead
      if (type === 'NAR_LILY' || type === 'DEL_LILY') {
        // ASSUMED: flag 0x800 (the dissolve variant) is the Nar Lily's.
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
    case 'TObjGrass': // Grass Assassin 0x005225bc: smoke 0xf0 at motion frame 23, then at 32 SE 0xf7, ab_dead and a green 15 pool behind it
      return {
        steps: [
          { when: { frame: 23 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { frame: 32 }, se: 0xf7, particles: [{ p: abDead(0x1e), at: ahead(-15) }], pools: [pool('green15', 10, ahead(-15))] },
        ],
      };
    case 'TObjEneNanoDrago': // Nano Dragon 0x0057e9ac: SE 0x112, smoke 0xf0 at motion frame 30, 30 frames later ab_dead and a green 7.5 pool
      return {
        steps: [
          { when: 'kill', se: 0x112 },
          { when: { frame: 30 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { wait: 30 }, particles: [{ p: abDead(0x1e), at: ORIGIN }], pools: [pool('green7_5', 15)] },
        ],
      };
    case 'TObjEneSlime': // Pofuilly Slime 0x00598648: SE 0x108 and the particle 0xfe at its body
      return { steps: [{ when: 'kill', se: 0x108, particles: [{ p: { id: 0xfe }, at: BODY }] }] };
    case 'TObjEneMoja': // Hildebear / Hildeblue 0x00513614: SE 0xc2 at motion frame 0; at 27 SE 0xbc, 0xf0, a red 15 pool (20 frames late) and gensei (50 frames) at the blood point; it sinks 0.1 a frame from the start, 200 frames
      return {
        steps: [
          { when: 'kill', sink: sink(200) },
          { when: { frame: 0 }, se: 0xc2 },
          { when: { frame: 27 }, se: 0xbc, particles: [{ p: { id: 0xf0 }, at: BLOOD }, { p: gensei(0x32), at: BLOOD }], pools: [pool('red15', 0x14, BLOOD)] },
        ],
      };
    case 'TObjEneBm3Fly': // Mothmant 0x00516c60 (motion slot 4, the fall): SE 0xde at the kill; where it lands (ASSUMED: at the end of the motion) a red 2.5 pool and gensei (30 frames)
      return { steps: [{ when: 'kill', se: 0xde }, { when: 'end', particles: [{ p: gensei(0x1e), at: ORIGIN }], pools: [pool('red2_5', 10)] }] };
    case 'TObjEneBm3FlyNest': // Monest 0x00519550 (slot 7): the spray 0xf1 every 4 frames and SE 0xe4 every 20 in the first 25 frames; at the end a red 15 pool, gensei (70) 10 left / 8 behind, and the sink (200 frames)
      return {
        steps: [
          ...spray(),
          { when: 'end', particles: [{ p: gensei(0x46), at: { base: 'origin', side: -10, forward: -8 } }], pools: [pool('red15', 0x32, { base: 'origin', side: -10, forward: -8 })], sink: sink(200) },
        ],
      };
    case 'TObjEneBm5Wolf': // Savage / Barbarous Wolf 0x0051ba20: SE 0xd6 at the kill; at the motion's end a red 7.5 pool (50 frames late) and gensei (70) 12 aside and 10 behind (ASSUMED the front death, animation 0xe); it sinks 200 frames
      return {
        steps: [
          { when: 'kill', se: 0xd6 },
          { when: 'end', particles: [{ p: gensei(0x46), at: { base: 'origin', side: 12, forward: -10 } }], pools: [pool('red7_5', 0x32, { base: 'origin', side: 12, forward: -10 })], sink: sink(200) },
        ],
      };
    // --- the Booma family: the shared state 8 -----------------------------------
    case 'TObjEneBeast': // Booma 0x00535a6c family: voice 0xe6, gensei and a red 7.5 pool
      return boomaFamily({ voice: 0xe6, blood: goreHook(gensei(0x23), 'red7_5') });
    case 'TObjEneShark': // Shark 0x00a48060: voice 0xf9, ab_dead and a green 7.5 pool
      return boomaFamily({ voice: 0xf9, blood: goreHook(abDead(0x23), 'green7_5') });
    case 'TObjEneDimedian': // Dimenian 0x00a4c9e0: voice 0x208; the dark hook: purple 7.5, the burst, SE 0x1f0 (0x1c5 in the temples)
      return boomaFamily({ voice: 0x208, blood: darkHook(temple ? 0x1c5 : 0x1f0) });
    case 'TObjEneDolmOlm': // Dolmolm / Dolmdarl 0x00a4cc80: voice 0x256, ab_dead and a green 7.5 pool
      return boomaFamily({ voice: 0x256, blood: goreHook(abDead(0x23), 'green7_5') });
    case 'TObjEneMerillLia': // Merillia / Meriltas 0x00a4eee0: voice 0x20d, ab_dead and a green 7.5 pool
      return boomaFamily({ voice: 0x20d, blood: goreHook(abDead(0x23), 'green7_5') });
    case 'BootaFamily': // Boota / Ze Boota / Ba Boota 0x00a52e80: voice by area, gensei and a red 7.5 pool
      return boomaFamily({ voice: areaSe(AREA_SE.bootaVoice, area), blood: goreHook(gensei(0x23), 'red7_5') });
    case 'GoranFamily': // Goran / Pyro Goran / Goran Detonator 0x00a53740: voice by area; the dark hook with the same sound
      return boomaFamily({ voice: areaSe(AREA_SE.goranVoice, area), blood: darkHook(areaSe(AREA_SE.goranVoice, area)) });
    // --- Episode 2 animals ----------------------------------------------------------
    case 'TObjEneBm9Mericarol': // Mericarol 0x00571194: SE 0x218 at the kill; at the motion's end a green 25 pool (50 late) and ab_dead (70) 10 ahead; it sinks 300 frames
      return {
        steps: [
          { when: 'kill', se: 0x218 },
          { when: 'end', particles: [{ p: abDead(0x46), at: ahead(10) }], pools: [pool('green25', 0x32, ahead(10))], sink: sink(300) },
        ],
      };
    case 'TObjEneBm5GibonU': // Ul / Zol Gibbon 0x00565ecc: SE 0x233 at the kill; at the motion's end a red pool (7.5; 15 for the Zol: ASSUMED the flag) 50 frames late and gensei (70) 10 behind
      return {
        steps: [
          { when: 'kill', se: 0x233 },
          { when: 'end', particles: [{ p: gensei(0x46), at: ahead(-10) }], pools: [pool(type === 'ZOL_GIBBON' ? 'red15' : 'red7_5', 0x32, ahead(-10))] },
        ],
      };
    case 'TObjEneIllGill': // Ill Gill 0x0052e898 (the kill 0x005310e0 makes 0xf2 at the body): SE 0x2dc at motion frame 10, 0xf0 at 30, at 52 SE 0x2e3, a purple 15 pool (10 late) and the dark burst, gone 11 frames later
      return {
        steps: [
          { when: 'kill', particles: [{ p: { id: 0xf2 }, at: BODY }] },
          { when: { frame: 10 }, se: 0x2dc },
          { when: { frame: 30 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { frame: 52 }, se: 0x2e3, particles: at(DARK_BURST, ORIGIN), pools: [pool('purple15', 10)] },
          { when: { wait: 11 }, remove: true },
        ],
      };
    case 'TObjEneDelDepth': // Deldepth 0x00548d60: SE 0x276, then 5 frames later a purple 7.5 pool and it is gone (ASSUMED: the counter before it is not traced)
      return { steps: [{ when: 'kill', se: 0x276 }, { when: { wait: 5 }, pools: [pool('purple7_5', 0)], remove: true }] };
    // --- Episode 4 ---------------------------------------------------------------
    case 'Astark': // Astark 0x005a1f8c: kill 0xf2 at the body, voice by area at motion frame 0; at 27 the second sound, 0xf0, a green 25 pool (20 late) and ab_dead (50) at the blood point; it sinks 200 frames
      return {
        steps: [
          { when: 'kill', particles: [{ p: { id: 0xf2 }, at: BODY }], sink: sink(200) },
          { when: { frame: 0 }, ...optSe(areaSe(AREA_SE.astarkVoice, area)) },
          { when: { frame: 27 }, ...optSe(areaSe(AREA_SE.astarkBlood, area)), particles: [{ p: { id: 0xf0 }, at: BLOOD }, { p: abDead(0x32), at: BLOOD }], pools: [pool('green25', 0x14, BLOOD)] },
        ],
      };
    case 'Dorphon': // Dorphon / Eclair 0x005a72d8: SE by area at the kill; at motion frame 28 gensei (70) at the body and the ground SE; at the end a red 25 pool
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.dorphonKill, area)) },
          { when: { frame: 28 }, ...optSe(areaSe(AREA_SE.dorphonGround, area)), particles: [{ p: gensei(0x46), at: BODY }] },
          { when: 'end', pools: [pool('red25', 0)] },
        ],
      };
    case 'Girtablulu': // Girtablulu 0x005aa2d8: SE by area at the kill; after the motion the dark burst at the body and the dissolve, then a purple 25 pool
      return { steps: [{ when: 'kill', ...optSe(areaSe(AREA_SE.girtabluluKill, area)) }, { when: 'end', particles: at(DARK_BURST, BODY), dissolve: true }, darkPool('purple25')] };
    case 'Zu': // Zu / Pazuzu 0x005b..: SE by area at the kill, 0xf0 at motion frame 30, 30 frames later gensei (30) and a red 15 pool (15 late)
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.zuKill, area)) },
          { when: { frame: 30 }, particles: [{ p: { id: 0xf0 }, at: ORIGIN }] },
          { when: { wait: 30 }, particles: [{ p: gensei(0x1e), at: ORIGIN }], pools: [pool('red15', 15)] },
        ],
      };
    case 'MerissaA': // Merissa A / AA 0x005b5..: the two sounds by area at the kill; at the motion's end a green 7.5 pool (50 late)
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.merissaJump, area)) },
          { when: 'kill', ...optSe(areaSe(AREA_SE.merissaTop, area)) },
          { when: 'end', pools: [pool('green7_5', 0x32)] },
        ],
      };
    case 'SatelliteLizardYowie': // Satellite Lizard / Yowie 0x005af0a4: SE by area at the kill; at the motion's end a red 7.5 pool (50 late) and gensei (70) 12 aside, 10 behind
      return {
        steps: [
          { when: 'kill', ...optSe(areaSe(AREA_SE.yowieKill, area)) },
          { when: 'end', particles: [{ p: gensei(0x46), at: { base: 'origin', side: 12, forward: -10 } }], pools: [pool('red7_5', 0x32, { base: 'origin', side: 12, forward: -10 })] },
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

  /** One game frame; `motionFrame` is the death motion's elapsed frames, `ended` whether it ended, `dissolved` whether the dissolve is done. */
  tick(motionFrame: number, ended: boolean, dissolved = false): DeathActions {
    const out: DeathActions = { se: [], spawn: [], pools: [], fragments: [], dissolve: false, sink: 0, remove: false };
    // Several steps may fall due in the same frame (kill + a motion that is already past a frame).
    while (this.i < this.plan.steps.length) {
      const s = this.plan.steps[this.i];
      const w = s.when;
      // A motion that has ended has passed every frame, so a frame step behind a short motion still fires.
      const due = w === 'kill' ? true : w === 'end' ? ended : w === 'dissolved' ? dissolved : 'frame' in w ? motionFrame >= w.frame || ended : this.t - this.last >= w.wait;
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
    }
    if (this.sinkLeft > 0) {
      out.sink = this.sinkStep;
      if (--this.sinkLeft === 0 && this.i >= this.plan.steps.length) out.remove = true;
    }
    this.t++;
    return out;
  }
}

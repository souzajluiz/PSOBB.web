// Music of the game floors, decoded from PsoBB.exe (Ephinea 1.25.13).
//
// Each area has a scene record in the table at 0x00a160c0 (12 bytes per area
// id: name, start function, end function; "CITY", "FOREST01", ...). The start
// functions pick the music:
//   - field areas start the interactive music (FUN_00814c7c(index), slbgm.ts);
//   - bosses play an ADX track (FUN_00814afc), some only after an event;
//   - a boss's own form changes swap the track again (audio/bossbgm.ts:
//     setBossPhase);
//   - Pioneer 2 and the Lab (FUN_007a7484 -> FUN_006428bc) create BGM zones
//     (TObjBgmCol objects from the tables at 0x00934f40 / 0x00935040) and a
//     manager (FUN_00642824) that plays FUN_00642c30's track (city.adx outside
//     the lobby) when nothing is playing.

import type { BgmPlayer } from './bgm.ts';
import { bossBgm, type BossBgm } from './bossbgm.ts';

export type FieldBgm =
  | { kind: 'sl'; index: number; delayFrames?: number | undefined; minZ?: number }
  | { kind: 'adx'; name: string; delayFrames?: number | undefined }
  | { kind: 'city'; zones: readonly BgmZone[] }
  | { kind: 'none' };

const sl = (index: number, extra: { delayFrames?: number; minZ?: number } = {}): FieldBgm => ({ kind: 'sl', index, ...extra });
const adx = (name: string, delayFrames?: number): FieldBgm => ({ kind: 'adx', name, delayFrames });

// TObjBgmCol zones: {x, y, z, radius, track} (0x14 bytes each); track indexes
// the name table at 0x009c6fc0 (index 4 = FUN_00642c30, i.e. city.adx).
export interface BgmZone {
  x: number;
  y: number;
  z: number;
  radius: number;
  track: number;
}

export const ZONE_TRACKS = ['SHOP.adx', 'GUILD.adx', 'MEDICAL.adx', 'soutoku.adx', 'city.adx', 'labo.adx'];
export const CITY_TRACK = 4;

const zones = (rows: number[][]): BgmZone[] => rows.map(([x, y, z, radius, track]) => ({ x, y, z, radius, track }));

// Pioneer 2 (areas 0x00 and 0x2D): 12 zones at 0x00934f40.
export const CITY_ZONES = zones([
  [-2.11, 0, -0.24, 72, 4],
  [-165.09, 0, 100, 41, 4],
  [184.49, 0, 144.57, 38, 4],
  [206.61, 0, -104.79, 26, 4],
  [184.93, 0, 209.99, 28, 1],
  [285.81, 0, 234.67, 31, 1],
  [236.71, 0, 309, 80, 1],
  [-163.69, 0, 175.02, 33, 0],
  [213.35, 0, -181, 26, 2],
  [212.49, 0, -279.87, 25, 2],
  [0.66, 0, -1728.83, 52, 3],
  [0, 0, -2000, 81, 3],
]);

// Lab (area 0x12): 12 zones at 0x00935040 (the two labo.adx zones sit at
// x = -10000, out of reach).
export const LAB_ZONES = zones([
  [160.7, 0, 40.87, 41, 4],
  [32.6, 0, 62.73, 28, 4],
  [-21.28, 0, -60.15, 27, 4],
  [-19.82, 0, -159.58, 30, 4],
  [42.22, 0, -151.92, 37, 4],
  [27, 0, 257.4, 37, 1],
  [27, 0, 125.99, 28, 1],
  [-74.8, 0, -61.64, 26, 0],
  [-75.8, 0, -160.94, 26, 0],
  [-10000, 0, 36.28, 52, 5],
  [-10000, 30, -187.68, 32, 5],
  [12.82, 0, -204, 26, 2],
]);

// Music by area id. `episode` is the wire value (1, 2, 3 = Episode 4).
export function fieldBgm(area: number, episode: number): FieldBgm {
  switch (area) {
    case 0x00: // CITY (FUN_007a7484)
    case 0x2d: // CITY02
      return { kind: 'city', zones: CITY_ZONES };
    case 0x12: // LABO (FUN_007a7484 too)
      return { kind: 'city', zones: LAB_ZONES };
    case 0x01: // FOREST01 (FUN_007a7640)
    case 0x02: // FOREST02 (FUN_007a769c)
      return sl(0);
    case 0x03: // CAVE01 (FUN_007a7404)
    case 0x04: // CAVE02 (FUN_007a7454)
    case 0x05:
      return sl(1);
    case 0x06: // MACHINE01 (FUN_007a7810)
    case 0x07: // MACHINE02 (FUN_007a7860)
      return sl(2);
    case 0x08: // ANCIENT01 (FUN_007a6d9c)
    case 0x09: // ANCIENT02/03 (FUN_007a6de8)
    case 0x0a:
      return sl(3);
    case 0x0b: // BOSS01 Dragon (FUN_007a6e18)
      return adx('dragon.adx');
    case 0x0c: // BOSS02 De Rol Le (FUN_007a6f7c)
      return adx('delo.adx');
    case 0x0d: // BOSS03 Vol Opt (FUN_007a6fe4 -> FUN_00440880): the object
      // FUN_00440980 starts the ruins music once the player's z reaches 4000.0
      // (0x008fe174); vol_opt1/vol_opt2.adx follow with the fight (FUN_0043ee2c, FUN_0043eda4).
      return sl(3, { minZ: 4000 });
    case 0x0e: // BOSS04 Dark Falz (FUN_007a7080 -> FUN_0044bb08): FUN_0044baa8
      // waits 0x5a frames, then starts the dark music (or T1.adx when
      // FUN_00454058 says so); dark1/dark2.adx follow with the fight.
      return sl(4, { delayFrames: 0x5b });
    case 0x10: // VERSUS01 / SPACE01 / SPACE02 (FUN_007a7980): only in Episode 2
    case 0x15:
    case 0x16:
      return episode === 2 ? sl(8) : { kind: 'none' };
    case 0x11: // VERSUS02 / RUINS01 / RUINS02 (FUN_007a79e4): only in Episode 2
    case 0x13:
    case 0x14:
      return episode === 2 ? sl(7) : { kind: 'none' };
    case 0x17: // JUNGLE01..05, 06 (Seaside Night), 07 (Tower) (FUN_007a76d4)
    case 0x18:
    case 0x19:
    case 0x1a:
    case 0x1b:
    case 0x22:
    case 0x23:
      return sl(5);
    case 0x1c: // SEABED01/02 (FUN_007a7890)
    case 0x1d:
      return sl(6);
    case 0x1e: // BOSS05 Gal Gryphon (FUN_007a70d4)
      return adx('gryphon.adx');
    case 0x1f: // BOSS06 Olga Flow (FUN_007a71d4 -> FUN_004872e4): FUN_0048722c
      // plays HALL.adx after its counter passes 3 (T2.adx when FUN_00491d94).
      return adx('HALL.adx', 4);
    case 0x20: // BOSS07 Barba Ray (FUN_007a728c)
      return adx('delo2.adx');
    case 0x21: // BOSS08 Gol Dragon (FUN_007a7368)
      return adx('dragon2.adx');
    case 0x24: // WILDS01..04 (FUN_007a7a68)
    case 0x25:
    case 0x26:
    case 0x27:
    case 0x2e: // TEST01
      return sl(9);
    case 0x28: // CRATER01 (FUN_007a75e0)
      return sl(10);
    case 0x29: // DESERT01..03 (FUN_007a7610)
    case 0x2a:
    case 0x2b:
      return sl(11);
    case 0x2c: // BOSS09 Saint-Milion (FUN_0076b688): slbgm_boss09b.ogg when
      // DAT_00a9b078 == 1 (boss variant), else slbgm_boss09.ogg.
      return adx('slbgm_boss09.ogg');
    default:
      return { kind: 'none' };
  }
}

// FUN_0064278c: zone membership edge detection. A zone starts "outside"
// (+0x90 = 1 from the constructor) and reports 1 on the frame the player
// enters it, 0 while inside.
function zoneContains(z: BgmZone, x: number, zz: number): boolean {
  return (x - z.x) ** 2 + (zz - z.z) ** 2 < z.radius * z.radius;
}

// Drives the BGM of the current floor: call enter() when a floor is loaded and
// tick() every game frame (30 per second) with the local player's position.
export class FieldMusic {
  private bgm: BgmPlayer;
  private spec: FieldBgm = { kind: 'none' };
  private frames = 0;
  private started = false;
  private inside: boolean[] = [];
  private zoneTrack = CITY_TRACK; // DAT_00a8f32c, set to 4 by FUN_006428bc
  private acc = 0;
  private boss: BossBgm | null = null;
  private bossPhaseIndex = 0;

  constructor(bgm: BgmPlayer) {
    this.bgm = bgm;
  }

  enter(area: number, episode: number, bossVariant = 0): void {
    this.spec = fieldBgm(area, episode);
    this.boss = bossBgm(area, episode, bossVariant);
    this.bossPhaseIndex = 0;
    this.frames = 0;
    this.started = false;
    this.zoneTrack = CITY_TRACK;
    this.inside = this.spec.kind === 'city' ? this.spec.zones.map(() => false) : [];
    // Saint-Milion's two tracks differ by boss variant (FUN_0076b688), and
    // audio/bossbgm.ts carries both, so its phase 0 names the entry track.
    const first = this.boss?.phases[0];
    if (first && first.kind === 'adx' && this.spec.kind === 'adx') this.spec = { ...this.spec, name: first.name };
    // The end function of the previous area (FUN_007a6dd8, FUN_007a759c, ...)
    // stops the music (FUN_00815434), so every floor starts its track afresh.
    this.bgm.stop();
    this.tick(0, null);
  }

  // dt in seconds; pos = local player position (null while loading).
  tick(dt: number, pos: { x: number; y: number; z: number } | null): void {
    this.acc += dt * 30;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.frames++;
    }
    const s = this.spec;
    if (s.kind === 'none') return;
    if (s.kind === 'city') {
      // FUN_00642824 / FUN_00642724: entering a zone plays its track unless it
      // is already the current one; with no zone around and nothing playing,
      // the city track.
      let entered = -1;
      if (pos) {
        s.zones.forEach((z, i) => {
          const now = zoneContains(z, pos.x, pos.z);
          if (now && !this.inside[i] && entered < 0) entered = i;
          this.inside[i] = now;
        });
      }
      if (entered >= 0 && s.zones[entered].track !== this.zoneTrack) {
        this.zoneTrack = s.zones[entered].track;
        void this.bgm.play(ZONE_TRACKS[this.zoneTrack]);
      } else if (!this.started) {
        void this.bgm.play(ZONE_TRACKS[CITY_TRACK]);
      }
      this.started = true;
      return;
    }
    if (this.started) return;
    if (s.delayFrames && this.frames < s.delayFrames) return;
    if (s.kind === 'sl' && s.minZ !== undefined && (!pos || pos.z < s.minZ)) return;
    this.started = true;
    if (s.kind === 'sl') this.bgm.playInteractive(s.index);
    else void this.bgm.play(s.name);
  }

  // Boss of the current floor, or null on a floor without one.
  get bossMusic(): BossBgm | null {
    return this.boss;
  }

  get bossPhase(): number {
    return this.bossPhaseIndex;
  }

  // The boss changed form (audio/bossbgm.ts): play that phase's track. The
  // boss only ever moves forward, so an earlier phase is ignored.
  setBossPhase(phase: number): boolean {
    const boss = this.boss;
    if (!boss || phase <= this.bossPhaseIndex || phase >= boss.phases.length) return false;
    this.bossPhaseIndex = phase;
    const track = boss.phases[phase];
    this.started = true;
    if (track.kind === 'sl') this.bgm.playInteractive(track.index);
    else void this.bgm.play(track.name);
    return true;
  }
}

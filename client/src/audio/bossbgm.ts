// Boss music, decoded from PsoBB.exe (Ephinea 1.25.13; addresses are VAs).
//
// A boss floor does not keep one track: the area object starts one (the entry
// track, audio/fieldbgm.ts) and the boss itself swaps it when it changes form.
// Every swap is a play_bgm(name) call (FUN_00814afc, which plays
// data/adx/<name> or, for Episode 4, data/ogg/<name>):
//
//   area 0x0B Dragon       dragon.adx  (0x007a6f49)        one track
//   area 0x0C De Rol Le    delo.adx    (0x007a6fb7)        one track
//   area 0x0D Vol Opt      the Ruins music until the player reaches z 4000
//                          (FUN_00440980), then
//                          vol_opt1.adx  init_volopt_stuff 0x0043ee2c
//                          vol_opt2.adx  the form-2 switch 0x0043eda4 (and
//                                        again at 0x00440763)
//   area 0x0E Dark Falz    the dark field music (slbgm index 4) 0x5a frames
//                          after the floor loads, or T1.adx (0x0044bad5) when
//                          FUN_00454058 says so, then
//                          dark1.adx   0x0044d716
//                          dark2.adx   0x0044e0da
//   area 0x1E Gal Gryphon  gryphon.adx (0x007a7199)        one track
//   area 0x1F Olga Flow    HALL.adx (0x0048726b) four frames after the floor
//                          loads (T2.adx, 0x0048725e, during the cutscene),
//                          then
//                          proto1.adx  the form-1 entry 0x0048f2d8
//                          proto2.adx  the form-2 entry 0x0048f1e4
//                          HALL.adx    between forms (0x0048f23c, 0x0048cfae)
//   area 0x20 Barba Ray    delo2.adx   (0x007a72f1)        one track
//   area 0x21 Gol Dragon   dragon2.adx (0x007a7399)        one track
//   area 0x2C Saint-Milion slbgm_boss09.ogg, or slbgm_boss09b.ogg for the
//                          Shambertin/Kondrieu variant (FUN_0076b688:
//                          0x0076b6b2 / 0x0076b6bf)
//
// The form transitions are the boss's own, and the boss is run by the room
// leader, which broadcasts them as 6x subcommands (newserv CommandFormats.hh):
//   6x15 G_VolOptBossActions: action 0..2 are Vol Opt phase 1, 3..7 phase 2
//   6x19 G_DarkFalzActions:   u16 phase (0xFFFF = no change)
//   6xA4 / 6xA5              Olga Flow phase 1 / phase 2 actions
// so a client that only watches the room learns the phase from those.
//
// dark1.adx / dark2.adx are played by the control's own scenes (play_bgm at
// 0x0044D716, frame 0xB9 of APP TYPE1, and at 0x0044E0DA, when DEMO_WARP2 begins).

export type BossTrack = { kind: 'adx'; name: string } | { kind: 'sl'; index: number };

export interface BossBgm {
  name: string; // boss, for logs
  // Track per phase. Phase 0 is what the area object starts (the same track
  // audio/fieldbgm.ts plays on entry), so a one-track boss has one phase.
  phases: BossTrack[];
}

const adx = (name: string): BossTrack => ({ kind: 'adx', name });

// Music by area id. `episode` is the wire value (1, 2, 3 = Episode 4).
// `variant` is the boss's rare flag (param6 & 1 of the set entry), which picks
// Saint-Milion's two tracks.
export function bossBgm(area: number, episode: number, variant = 0): BossBgm | null {
  switch (area) {
    case 0x0b:
      return episode === 2 ? null : { name: 'Dragon', phases: [adx('dragon.adx')] };
    case 0x0c:
      return { name: 'De Rol Le', phases: [adx('delo.adx')] };
    case 0x0d:
      // Phase 0 is the Ruins field music the area object starts; the fight's
      // own track follows.
      return { name: 'Vol Opt', phases: [{ kind: 'sl', index: 3 }, adx('vol_opt1.adx'), adx('vol_opt2.adx')] };
    case 0x0e:
      return { name: 'Dark Falz', phases: [{ kind: 'sl', index: 4 }, adx('dark1.adx'), adx('dark2.adx')] };
    case 0x1e:
      return { name: 'Gal Gryphon', phases: [adx('gryphon.adx')] };
    case 0x1f:
      return { name: 'Olga Flow', phases: [adx('HALL.adx'), adx('proto1.adx'), adx('proto2.adx')] };
    case 0x20:
      return { name: 'Barba Ray', phases: [adx('delo2.adx')] };
    case 0x21:
      return { name: 'Gol Dragon', phases: [adx('dragon2.adx')] };
    case 0x2c:
      return { name: 'Saint-Milion', phases: [adx(variant & 1 ? 'slbgm_boss09b.ogg' : 'slbgm_boss09.ogg')] };
    default:
      return null;
  }
}

// The music phase a boss action subcommand reports, or null when the
// subcommand says nothing about the phase of this area's boss. `body` is the
// whole subcommand including its two header bytes and entity id.
export function bossPhaseOf(area: number, sub: number, body: Uint8Array): number | null {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (area === 0x0d && sub === 0x15 && body.length >= 0x0c) {
    // G_VolOptBossActions_6x15: {15, 03, entity, u16 action, ...}. Actions 0..2
    // are phase 1 (traverse monitors, retract/extend pillars), 3..7 phase 2.
    const action = dv.getUint16(4, true);
    if (action > 7) return null;
    return action <= 2 ? 1 : 2;
  }
  if (area === 0x0e && sub === 0x19 && body.length >= 0x10) {
    // G_DarkFalzActions_6x19: {19, 04, entity, u16 phase, ...}; the phase is the
    // control's SCENE (combat/darkfalz.ts, table 0x009A5940), 0xFFFF means "no
    // change". The fight's tracks are dark1.adx from the first form (scene 6
    // TYPE1; the control itself starts it at frame 0xB9 of APP TYPE1, scene 5)
    // and dark2.adx from DEMO_WARP2 (scene 11) on.
    const scene = dv.getUint16(4, true);
    if (scene === 0xffff) return null;
    if (scene >= 11) return 2;
    if (scene >= 6) return 1;
    return null;
  }
  if (area === 0x1f && (sub === 0xa4 || sub === 0xa5)) {
    // 6xA4 is sent by Olga Flow's form 1, 6xA5 by form 2.
    return sub === 0xa4 ? 1 : 2;
  }
  return null;
}

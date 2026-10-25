// Player weapon attacks: the combo state machine of PsoBB.exe (Ephinea
// 1.25.13, addresses are VAs) for the three attacks of a combo (states 5, 6,
// 7 of the player state machine at player+0x32e).
//
// Start: 6x43 / 6x44 / 6x45 {angle, attack type} (handlers FUN_00698f10,
//   FUN_00699cac, FUN_00699d50) store the type at +0x8a4 and the angle at
//   +0x3fc and enter state 5 / 6 / 7 (FUN_006a11fc, FUN_006a0cfc,
//   FUN_006a07d8). The local player sends the command with send_and_handle_60
//   (FUN_008003e0), so its own attack runs through the same handler
//   (FUN_006a0f58 builds 6x43 facing the locked target if any, FUN_006a0a34 6x44).
// Enter (FUN_006a2f54 on the combo block at +0x8a4): step = 0 / 1 / 2, speed
//   factor +0x8a8 = 1.0 (DAT_0093db28), x 1.25 (DAT_0093db24) for heavy and
//   special attacks; motion = field slot 2 / 3 / 4 (motion set vtable +0x3c,
//   +0x40, +0x44: FUN_006a71b8.. return 2, 3, 4); frame step = record speed *
//   +0x8a8 (FUN_00690300).
// Phases (+0x330, FUN_00698fa8 each tick):
//   0: normal attack -> 3; heavy / special -> 1 (FUN_006a2ad4, charge effect)
//   1: wait for the motion change to apply (FUN_007aa484) -> 2, motion paused
//      (+0xb0 |= 0x40)
//   2: count +0x8bc down from 6; below 0 -> 3, motion resumes
//   3: FUN_00699058: when the motion frame crosses a hit frame
//      (FUN_007aaa30: hit < frame <= hit + step) the hit is done
//      (FUN_00699248 -> 6x46 with the targets) and the combo window opens
//      (FUN_006a2fb4: flags |= 2, timer = COMBO_WINDOW[class][step]);
//      FUN_0069941c: bare hands set "done" (flags |= 1) when the motion
//      ends; other classes count the timer down once the motion ended and set
//      "done" when it runs out (FUN_006a3190).
// Input (FUN_006a1088 / FUN_006a0b88, palette buttons): before the window
//   opened the combo is lost (flags |= 4, FUN_006a31b0); inside it the next
//   attack is queued: flags |= 1, step = min(step + 1, 2), queued type.
// Exit (FUN_006a1000): motion ended (+0xb0 & 0x10) and "done": step 0 -> back
//   to idle, step 1 / 2 -> the next attack (6x44 / 6x45).
// Mechgun (class 8, FUN_00698fa8 phase 3 -> handle_player_attack_animation_damaging_part
//   0x00699058, class 8 branch): the motion loops (mode 1) and each time its
//   frame passes the hit frame (2) the swing sends a 6x46 with the targets
//   re-read from the reticle and fires one burst. The count is attacks_per_step
//   (item +0x1f4, a signed byte): the swing ends when (char)[+0x1f4] <= ++count
//   (0x006990c4, class 8 branch). The grind (+0x1f5 = data1[3]) is NOT the count.
//   After the last burst the burst flag 8 is set, the combo window opens
//   (HandleAttackDamageCalculation 0x006a2fb4) and the motion counts as ended
//   (+0xb0 |= 0x50), so the timer runs out in the exit path (CheckAttackStateFlag
//   0x006a3180). See burstCount / the class 8 branch of tick().
// Not reproduced: the forward step at the start of a combo (+0xd4 = 0.5 /
// 0.2, FUN_006a2d44), the class 15 alternate table (flag from FUN_0068c470).
//
// Motion class (FUN_006a7b80, the motion set's weapon class 0..18): ItemPMT's
// weapon kind table (weaponKinds[data1[1]]), ASSUMED to be what sets it;
// 0 = bare hands.

import type { MotionRecord } from '../formats/plymotion.ts';

// Field motion tables 0x009cbeec (records) / 0x009cbf04 (rlc indices), slots
// 2, 3, 4 = attack 1, 2, 3: [rlc index, mode, speed, flags] by motion type
// (plymotion.ts MOTION_TYPE) and weapon class.
// prettier-ignore
const ATTACK_MOTIONS: readonly (readonly (readonly (readonly [number, number, number, number])[])[])[] = [
  [
    [[195, 3, 1.2, 0x20000004], [196, 3, 1.2, 0xa0000004], [197, 3, 1.7, 0xa0000004]],
    [[99, 3, 1.4, 0x20000004], [100, 3, 1.9, 0xa0000004], [101, 3, 1.9, 0xa0000004]],
    [[114, 3, 1.2, 0x20000004], [115, 3, 1.3, 0xa0000004], [116, 3, 1.7, 0xa0000004]],
    [[127, 3, 1.5, 0x20000004], [128, 3, 1.6, 0xa0000004], [129, 3, 1.4, 0xa0000004]],
    [[140, 3, 1.2, 0x20000004], [141, 3, 1.5, 0xa0000004], [142, 3, 1.8, 0xa0000004]],
    [[153, 3, 1.1, 0x20000004], [154, 3, 1.6, 0xa0000004], [155, 3, 1.5, 0xa0000004]],
    [[2, 3, 1.3, 0x20000004], [2, 3, 1.5, 0xa0000004], [2, 3, 1.7, 0xa0000004]],
    [[12, 3, 1.2, 0x20000004], [12, 3, 1.3, 0xa0000004], [12, 3, 1.7, 0xa0000004]],
    [[25, 1, 0.9, 0x4], [25, 1, 1, 0x80000004], [25, 1, 1.1, 0x80000004]],
    [[38, 3, 0.8, 0x20000004], [38, 3, 0.9, 0xa0000004], [38, 3, 1.1, 0xa0000004]],
    [[99, 3, 1.3, 0x20000004], [100, 3, 1.4, 0xa0000004], [101, 3, 1.4, 0xa0000004]],
    [[64, 3, 1.6, 0x20000004], [65, 3, 1.6, 0xa0000004], [66, 3, 1.6, 0xa0000004]],
    [[78, 3, 1, 0x20000004], [79, 3, 1.3, 0xa0000004], [80, 3, 1.4, 0xa0000004]],
    [[171, 3, 1.6, 0x20000004], [172, 3, 1.3, 0xa0000004], [173, 3, 1.5, 0xa0000004]],
    [[166, 3, 1.1, 0x20000004], [167, 3, 1.3, 0xa0000004], [168, 3, 1.3, 0xa0000004]],
    [[177, 3, 1.2, 0x20000004], [178, 3, 1.3, 0xa0000004], [179, 3, 1.3, 0xa0000004]],
    [[189, 3, 1.2, 0x20000004], [190, 3, 1.2, 0xa0000004], [191, 3, 1.2, 0xa0000004]],
    [[51, 3, 1, 0x20000004], [51, 3, 1, 0xa0000004], [51, 3, 1, 0xa0000004]],
    [[89, 3, 1.3, 0x20000004], [90, 3, 1.3, 0xa0000004], [91, 3, 1.3, 0xa0000004]],
  ],
  [
    [[407, 3, 1.3, 0x20000004], [408, 3, 1.4, 0xa0000004], [409, 3, 1.5, 0xa0000004]],
    [[329, 3, 1.4, 0x20000004], [330, 3, 1.6, 0xa0000004], [331, 3, 1.6, 0xa0000004]],
    [[345, 3, 1.2, 0x20000004], [346, 3, 1.3, 0xa0000004], [347, 3, 1.7, 0xa0000004]],
    [[127, 3, 1.5, 0x20000004], [128, 3, 1.6, 0xa0000004], [129, 3, 1.4, 0xa0000004]],
    [[140, 3, 1.2, 0x20000004], [141, 3, 1.5, 0xa0000004], [142, 3, 1.8, 0xa0000004]],
    [[369, 3, 1.1, 0x20000004], [370, 3, 1.6, 0xa0000004], [371, 3, 1.5, 0xa0000004]],
    [[241, 3, 1.3, 0x20000004], [241, 3, 1.5, 0xa0000004], [241, 3, 1.7, 0xa0000004]],
    [[252, 3, 1.2, 0x20000004], [252, 3, 1.3, 0xa0000004], [252, 3, 1.7, 0xa0000004]],
    [[264, 1, 0.9, 0x4], [264, 1, 1, 0x80000004], [264, 1, 1.1, 0x80000004]],
    [[275, 3, 0.8, 0x20000004], [275, 3, 0.9, 0xa0000004], [275, 3, 1.1, 0xa0000004]],
    [[329, 3, 1.2, 0x20000004], [330, 3, 1.4, 0xa0000004], [331, 3, 1.4, 0xa0000004]],
    [[301, 3, 1.2, 0x20000004], [302, 3, 1.3, 0xa0000004], [303, 3, 1.6, 0xa0000004]],
    [[78, 3, 1, 0x20000004], [79, 3, 1.3, 0xa0000004], [80, 3, 1.4, 0xa0000004]],
    [[382, 3, 1.6, 0x20000004], [383, 3, 1.3, 0xa0000004], [384, 3, 1.7, 0xa0000004]],
    [[377, 3, 1.4, 0x20000004], [378, 3, 1.5, 0xa0000004], [379, 3, 1.5, 0xa0000004]],
    [[388, 3, 1.2, 0x20000004], [389, 3, 1.3, 0xa0000004], [390, 3, 1.3, 0xa0000004]],
    [[401, 3, 1.2, 0x20000004], [402, 3, 1.2, 0xa0000004], [403, 3, 1.3, 0xa0000004]],
    [[288, 3, 1, 0x20000004], [288, 3, 1, 0xa0000004], [288, 3, 1, 0xa0000004]],
    [[319, 3, 1.3, 0x20000004], [320, 3, 1.3, 0xa0000004], [321, 3, 1.3, 0xa0000004]],
  ],
  [
    [[501, 3, 1.4, 0x20000004], [502, 3, 1.7, 0xa0000004], [503, 3, 1.8, 0xa0000004]],
    [[482, 3, 1.1, 0x20000004], [483, 3, 1.5, 0xa0000004], [484, 3, 1.5, 0xa0000004]],
    [[114, 3, 1.3, 0x20000004], [115, 3, 1.3, 0xa0000004], [116, 3, 1.3, 0xa0000004]],
    [[127, 3, 1.3, 0x20000004], [128, 3, 1.3, 0xa0000004], [129, 3, 1.3, 0xa0000004]],
    [[140, 3, 1.3, 0x20000004], [141, 3, 1.3, 0xa0000004], [142, 3, 1.3, 0xa0000004]],
    [[495, 3, 1.2, 0x20000004], [496, 3, 1.4, 0xa0000004], [497, 3, 1.7, 0xa0000004]],
    [[445, 3, 1, 0x20000004], [445, 3, 1.1, 0xa0000004], [445, 3, 1.2, 0xa0000004]],
    [[252, 3, 1, 0x20000004], [252, 3, 1, 0xa0000004], [252, 3, 1, 0xa0000004]],
    [[449, 1, 0.9, 0x4], [449, 1, 1, 0x80000004], [449, 1, 1.1, 0x80000004]],
    [[275, 3, 1.2, 0x20000004], [275, 3, 2, 0xa0000004], [275, 3, 2, 0xa0000004]],
    [[482, 3, 1.4, 0x20000004], [483, 3, 1.4, 0xa0000004], [484, 3, 1.4, 0xa0000004]],
    [[461, 3, 1.4, 0x20000004], [462, 3, 1.6, 0xa0000004], [463, 3, 1.8, 0xa0000004]],
    [[475, 3, 1, 0x20000004], [476, 3, 1.2, 0xa0000004], [477, 3, 1.4, 0xa0000004]],
    [[382, 3, 1.6, 0x20000004], [383, 3, 1.3, 0xa0000004], [384, 3, 1.7, 0xa0000004]],
    [[377, 3, 1.2, 0x20000004], [378, 3, 1.3, 0xa0000004], [379, 3, 1.4, 0xa0000004]],
    [[388, 3, 1.2, 0x20000004], [389, 3, 1.3, 0xa0000004], [390, 3, 1.3, 0xa0000004]],
    [[401, 3, 1.2, 0x20000004], [402, 3, 1.2, 0xa0000004], [403, 3, 1.3, 0xa0000004]],
    [[288, 3, 1, 0x20000004], [288, 3, 1, 0xa0000004], [288, 3, 1.4, 0xa0000004]],
    [[319, 3, 1.3, 0x20000004], [320, 3, 1.3, 0xa0000004], [321, 3, 1.3, 0xa0000004]],
  ],
  [
    [[541, 3, 1.4, 0x20000004], [542, 3, 1.4, 0xa0000004], [543, 3, 1.2, 0xa0000004]],
    [[99, 3, 1.4, 0x20000004], [100, 3, 1.9, 0xa0000004], [101, 3, 1.9, 0xa0000004]],
    [[114, 3, 1.2, 0x20000004], [115, 3, 1.3, 0xa0000004], [116, 3, 1.7, 0xa0000004]],
    [[127, 3, 1.5, 0x20000004], [128, 3, 1.6, 0xa0000004], [129, 3, 1.4, 0xa0000004]],
    [[140, 3, 1.2, 0x20000004], [141, 3, 1.5, 0xa0000004], [142, 3, 1.8, 0xa0000004]],
    [[153, 3, 1.1, 0x20000004], [154, 3, 1.6, 0xa0000004], [155, 3, 1.5, 0xa0000004]],
    [[2, 3, 1.3, 0x20000004], [2, 3, 1.5, 0xa0000004], [2, 3, 1.7, 0xa0000004]],
    [[12, 3, 1.2, 0x20000004], [12, 3, 1.3, 0xa0000004], [12, 3, 1.7, 0xa0000004]],
    [[25, 1, 0.9, 0x4], [25, 1, 1, 0x80000004], [25, 1, 1.1, 0x80000004]],
    [[38, 3, 0.8, 0x20000004], [38, 3, 0.9, 0xa0000004], [38, 3, 1.1, 0xa0000004]],
    [[99, 3, 1.3, 0x20000004], [100, 3, 1.6, 0xa0000004], [101, 3, 1.6, 0xa0000004]],
    [[518, 3, 1.4, 0x20000004], [519, 3, 1.6, 0xa0000004], [520, 3, 1.6, 0xa0000004]],
    [[525, 3, 1, 0x20000004], [526, 3, 1.2, 0xa0000004], [527, 3, 1.3, 0xa0000004]],
    [[532, 3, 1.2, 0x20000004], [533, 3, 1.3, 0xa0000004], [534, 3, 1.3, 0xa0000004]],
    [[166, 3, 1.1, 0x20000004], [167, 3, 1.3, 0xa0000004], [168, 3, 1.3, 0xa0000004]],
    [[177, 3, 1.2, 0x20000004], [178, 3, 1.2, 0xa0000004], [179, 3, 1.5, 0xa0000004]],
    [[189, 3, 1.2, 0x20000004], [190, 3, 1.2, 0xa0000004], [191, 3, 1.2, 0xa0000004]],
    [[51, 3, 1, 0x20000004], [51, 3, 1, 0xa0000004], [51, 3, 1, 0xa0000004]],
    [[89, 3, 1.3, 0x20000004], [90, 3, 1.3, 0xa0000004], [91, 3, 1.4, 0xa0000004]],
  ],
  [
    [[563, 3, 1.6, 0x20000004], [564, 3, 1.6, 0xa0000004], [565, 3, 1.6, 0xa0000004]],
    [[329, 3, 1.4, 0x20000004], [330, 3, 1.6, 0xa0000004], [331, 3, 1.6, 0xa0000004]],
    [[345, 3, 1.2, 0x20000004], [346, 3, 1.3, 0xa0000004], [347, 3, 1.7, 0xa0000004]],
    [[545, 3, 1.8, 0x20000004], [546, 3, 1.8, 0xa0000004], [547, 3, 1.8, 0xa0000004]],
    [[140, 3, 1.2, 0x20000004], [141, 3, 1.5, 0xa0000004], [142, 3, 1.8, 0xa0000004]],
    [[369, 3, 1.1, 0x20000004], [370, 3, 1.6, 0xa0000004], [371, 3, 1.5, 0xa0000004]],
    [[241, 3, 1.3, 0x20000004], [241, 3, 1.5, 0xa0000004], [241, 3, 1.7, 0xa0000004]],
    [[252, 3, 1.2, 0x20000004], [252, 3, 1.3, 0xa0000004], [252, 3, 1.7, 0xa0000004]],
    [[264, 1, 0.9, 0x4], [264, 1, 1, 0x80000004], [264, 1, 1.1, 0x80000004]],
    [[275, 3, 0.8, 0x20000004], [275, 3, 0.9, 0xa0000004], [275, 3, 1.1, 0xa0000004]],
    [[329, 3, 1.2, 0x20000004], [330, 3, 1.4, 0xa0000004], [331, 3, 1.4, 0xa0000004]],
    [[301, 3, 1.2, 0x20000004], [302, 3, 1.3, 0xa0000004], [303, 3, 1.6, 0xa0000004]],
    [[78, 3, 1.1, 0x20000004], [79, 3, 1.3, 0xa0000004], [80, 3, 1.4, 0xa0000004]],
    [[557, 3, 1.2, 0x20000004], [558, 3, 1, 0xa0000004], [559, 3, 1.7, 0xa0000004]],
    [[551, 3, 1.4, 0x20000004], [552, 3, 1.4, 0xa0000004], [553, 3, 1.5, 0xa0000004]],
    [[388, 3, 1.2, 0x20000004], [389, 3, 1.3, 0xa0000004], [390, 3, 1.3, 0xa0000004]],
    [[401, 3, 1.2, 0x20000004], [402, 3, 1.2, 0xa0000004], [403, 3, 1.3, 0xa0000004]],
    [[288, 3, 1, 0x20000004], [288, 3, 1, 0xa0000004], [288, 3, 1, 0xa0000004]],
    [[319, 3, 1.3, 0x20000004], [320, 3, 1.3, 0xa0000004], [321, 3, 1.3, 0xa0000004]],
  ],
  [
    [[407, 3, 1.3, 0x20000004], [408, 3, 1.4, 0xa0000004], [409, 3, 1.5, 0xa0000004]],
    [[329, 3, 1.4, 0x20000004], [330, 3, 1.6, 0xa0000004], [331, 3, 1.6, 0xa0000004]],
    [[345, 3, 1.2, 0x20000004], [346, 3, 1.3, 0xa0000004], [347, 3, 1.7, 0xa0000004]],
    [[127, 3, 1.5, 0x20000004], [128, 3, 1.6, 0xa0000004], [129, 3, 1.4, 0xa0000004]],
    [[140, 3, 1.2, 0x20000004], [141, 3, 1.5, 0xa0000004], [142, 3, 1.8, 0xa0000004]],
    [[369, 3, 1.1, 0x20000004], [370, 3, 1.6, 0xa0000004], [371, 3, 1.5, 0xa0000004]],
    [[569, 3, 1.4, 0x20000004], [569, 3, 1.6, 0xa0000004], [569, 3, 1.8, 0xa0000004]],
    [[252, 3, 1.2, 0x20000004], [252, 3, 1.3, 0xa0000004], [252, 3, 1.7, 0xa0000004]],
    [[264, 1, 0.9, 0x4], [264, 1, 1, 0x80000004], [264, 1, 1.1, 0x80000004]],
    [[275, 3, 0.8, 0x20000004], [275, 3, 0.9, 0xa0000004], [275, 3, 1.1, 0xa0000004]],
    [[329, 3, 1.2, 0x20000004], [330, 3, 1.4, 0xa0000004], [331, 3, 1.4, 0xa0000004]],
    [[301, 3, 1.2, 0x20000004], [302, 3, 1.3, 0xa0000004], [303, 3, 1.6, 0xa0000004]],
    [[78, 3, 1, 0x20000004], [79, 3, 1.3, 0xa0000004], [80, 3, 1.4, 0xa0000004]],
    [[557, 3, 1.2, 0x20000004], [558, 3, 1, 0xa0000004], [559, 3, 1.7, 0xa0000004]],
    [[377, 3, 1.4, 0x20000004], [378, 3, 1.5, 0xa0000004], [379, 3, 1.5, 0xa0000004]],
    [[388, 3, 1.2, 0x20000004], [389, 3, 1.3, 0xa0000004], [390, 3, 1.3, 0xa0000004]],
    [[401, 3, 1.2, 0x20000004], [402, 3, 1.2, 0xa0000004], [403, 3, 1.3, 0xa0000004]],
    [[288, 3, 1.2, 0x20000004], [288, 3, 1, 0xa0000004], [288, 3, 1, 0xa0000004]],
    [[319, 3, 1.3, 0x20000004], [320, 3, 1.3, 0xa0000004], [321, 3, 1.3, 0xa0000004]],
  ],
];

export function attackMotion(motionType: number, weaponClass: number, step: number): MotionRecord {
  const row = ATTACK_MOTIONS[motionType]?.[weaponClass]?.[step] ?? ATTACK_MOTIONS[0][0][Math.min(2, step)];
  return { index: row[0], mode: row[1], next: -1, speed: row[2], flags: row[3] };
}

// Hit frame per class and combo step (FUN_006ac48c -> FUN_006ac4e2):
// 0x00968ca0 + class * 12 + step * 4. Class 3 (daggers) reads 0x00968fdc and
// classes 14 / 15 read 0x00969000 / 0x00969054 with a row per hit (+0x8b2
// counts the hits of the swing).
// prettier-ignore
const HIT_FRAMES: readonly (readonly number[])[] = [
  [17, 19, 19], [13, 19, 14], [13, 17, 22], [0, 0, 0], [16, 18, 17], [19, 13, 27], [3, 3, 3], [3, 3, 3], [2, 2, 2],
  [4, 4, 4], [13, 19, 14], [16, 17, 25], [8, 15, 20], [21, 9, 30], [0, 0, 0], [0, 0, 0], [13, 19, 14], [4, 4, 4], [17, 19, 27],
];
const MULTI_HIT_FRAMES: Record<number, readonly (readonly number[])[]> = {
  3: [[12, 12, 20], [29, 24, 46]],
  14: [[19, 12, 13], [24, 0, 28], [0, 0, 38]],
  15: [[16, 20, 15], [0, 24, 23]],
};

// Frame of hit `hit` (0-based) of a combo step; 0 = no such hit.
export function hitFrame(weaponClass: number, step: number, hit: number): number {
  const multi = MULTI_HIT_FRAMES[weaponClass];
  if (multi) return multi[hit]?.[step] ?? 0;
  return hit === 0 ? (HIT_FRAMES[weaponClass]?.[step] ?? 0) : 0;
}

// Combo window in ticks after the motion ends (0x00969078 + class * 3 + step).
// prettier-ignore
const COMBO_WINDOW: readonly (readonly number[])[] = [
  [2, 1, 1], [9, 7, 1], [15, 9, 1], [12, 8, 1], [15, 9, 1], [12, 13, 1], [6, 7, 3], [7, 6, 4], [31, 29, 27], [18, 15, 10],
  [9, 7, 1], [8, 6, 1], [9, 7, 1], [4, 4, 1], [10, 9, 1], [12, 8, 1], [9, 7, 1], [18, 15, 10], [8, 6, 1],
];
export function comboWindow(weaponClass: number, step: number): number {
  return COMBO_WINDOW[weaponClass]?.[step] ?? 1;
}

// Weapon class of the Mechgun (multi-burst swings, see the header).
export const MECHGUN_CLASS = 8;
// Bursts of a Mechgun swing = the item's attacks_per_step (+0x1f4). Default 1: the
// generic ctor writes it (construct_generic_weapon 0x005e959c, movb $1,0x1f4 at 0x005e9660).
// Items whose constructor or attack writes 3 (exe address of the writer; kind = data1[1],
// names from ItemPMT.prs + unitxt_e, the factory from the g_PlayingSFX table at 0x009c2240,
// index = kind):
//   kind 0x48 Samba Maracas: samba_maracas_constructor, factory init_item_weapon_56 (0x005fc268).
//   kind 0x83 Psychogun (all 17 variants): es_psychogun_constructor, init_item_weapon_101 (0x005f85bc).
//   kind 0x4b Guld Milla (variant 0) / Dual Bird (variant 1): guld_milla_dual_bird_constructor,
//     init_item_weapon_59 (0x005ec354, calls the ctor at 0x005ec3e8), only when group_idx < 2.
//   kind 0xb0 Mille Marteaux: MilleMarteauxExecuteAttack_005f527c (0x005f527c) writes 3 at run
//     time (the item's constructor leaves 1). ASSUMED: the 3 is in place when the swing ends.
//   kind 0x08 Mechgun: mechguns_constructor (inner ctor 0x005f473c, objdump `movb $0x3,0x1f4(%edi)`
//     at 0x005f4767, after the generic ctor). Proven 2026-10-25; it was 1 before (the mechgun
//     test had it as 1 from the generic default alone).
// Every other weapon, and any variant not listed, is 1 (ASSUMED for the kinds not traced).
export function burstCount(kind: number, variant: number): number {
  if (kind === 0x4b) return variant < 2 ? 3 : 1;
  return kind === 0x08 || kind === 0x48 || kind === 0x83 || kind === 0xb0 ? 3 : 1;
}

export const HEAVY_SPEED_FACTOR = 1.25; // DAT_0093db24
export const CHARGE_PAUSE_TICKS = 6; // +0x8bc, phase 2 ends when it drops below 0

const F_DONE = 1;
const F_WINDOW = 2;
const F_LOST = 4;
const F_BURSTS_DONE = 8; // the Mechgun's last burst was made (unknown_flags & 8)

export interface AttackEvents {
  start(step: number, type: number, motion: MotionRecord, stepFactor: number): void; // play the motion
  hit(step: number, type: number, hitIndex: number): void; // a hit frame was reached
  end(): void; // back to idle
}

export interface AttackTick {
  next: { step: number; type: number } | null; // start this attack now (6x44 / 6x45)
  idle: boolean; // the combo is over
}

// One player's attack in progress, ticked at 30 Hz after its motion advanced.
export class AttackState {
  step = 0;
  type = 0;
  phase = 0;
  active = false;
  private flags = 0;
  private timer = 0;
  private pause = 0;
  private hits = 0;
  private bursts = 1; // Mechgun: bursts in this swing (burstCount of the weapon)
  private queued: number | null = null;
  private lastFrame = 0;
  readonly weaponClass: number;
  readonly motionType: number;
  private events: AttackEvents;

  constructor(motionType: number, weaponClass: number, events: AttackEvents) {
    this.motionType = motionType;
    this.weaponClass = weaponClass;
    this.events = events;
  }

  // Replaces the callbacks (the owner rebuilds them per attack).
  setEvents(events: AttackEvents): void {
    this.events = events;
  }

  // Enters attack `step` (0..2) with `type` (0 normal, 1 heavy, 2 special).
  // `bursts` is the weapon's attacks_per_step (burstCount); only the Mechgun reads it.
  begin(step: number, type: number, bursts = 1): void {
    this.active = true;
    this.step = step;
    this.type = type;
    this.flags = 0;
    this.timer = 0;
    this.hits = 0;
    this.bursts = bursts;
    this.queued = null;
    this.lastFrame = 0;
    this.phase = type === 0 ? 3 : 1;
    this.pause = CHARGE_PAUSE_TICKS;
    this.events.start(step, type, attackMotion(this.motionType, this.weaponClass, step), type === 0 ? 1 : HEAVY_SPEED_FACTOR);
  }

  // True while the motion must not advance (heavy / special charge pause).
  // A Mechgun's motion stops once its last burst is made (+0xb0 |= 0x40).
  get paused(): boolean {
    if (!this.active) return false;
    if (this.weaponClass === MECHGUN_CLASS && this.flags & F_BURSTS_DONE) return true;
    return this.phase === 1 || this.phase === 2;
  }

  // A palette attack button was pressed during the attack (FUN_006a31b0).
  // Returns true when the next attack was queued.
  press(type: number): boolean {
    if (!this.active) return false;
    if (!(this.flags & F_WINDOW)) {
      this.flags |= F_LOST;
      return false;
    }
    if (this.flags & F_LOST || this.queued !== null || this.step >= 2) return false;
    this.flags |= F_DONE;
    this.queued = type;
    return true;
  }

  // The Mechgun's phase 3 (handle_player_attack_animation_damaging_part, class 8):
  // each crossing of the hit frame is one burst (the 6x46 with the re-read targets
  // and the shot, through `hit`). A looping motion wraps, so a crossing may
  // be a pass over the wrap. After the last burst the window opens, and the
  // timer runs out in the exit path (CheckAttackStateFlag_006a3180).
  private tickBursts(frame: number): AttackTick {
    if (this.flags & F_BURSTS_DONE) {
      if (--this.timer < 0) this.flags |= F_DONE;
    } else {
      const h = hitFrame(this.weaponClass, this.step, 0);
      const crossed = frame < this.lastFrame ? h <= frame || h > this.lastFrame : this.lastFrame < h && h <= frame;
      if (h > 0 && crossed) {
        this.events.hit(this.step, this.type, this.hits);
        this.hits++;
        if (this.hits >= this.bursts) {
          this.flags |= F_BURSTS_DONE | F_WINDOW;
          this.timer = comboWindow(this.weaponClass, this.step);
        }
      }
    }
    this.lastFrame = frame;
    if (this.flags & F_DONE) return this.finish();
    return { next: null, idle: false };
  }

  // The attack is over: the queued attack starts, or the combo ends.
  private finish(): AttackTick {
    if (this.queued !== null) {
      const next = { step: this.step + 1, type: this.queued };
      this.queued = null;
      return { next, idle: false };
    }
    this.active = false;
    this.events.end();
    return { next: null, idle: true };
  }

  // One game tick. `frame` is the motion frame after this tick's advance,
  // `ended` whether the motion reached its last frame.
  tick(frame: number, ended: boolean): AttackTick {
    if (!this.active) return { next: null, idle: false };
    if (this.phase === 1) {
      this.phase = 2;
      return { next: null, idle: false };
    }
    if (this.phase === 2) {
      if (--this.pause < 0) this.phase = 3;
      return { next: null, idle: false };
    }
    if (this.weaponClass === MECHGUN_CLASS) return this.tickBursts(frame);
    for (;;) {
      const h = hitFrame(this.weaponClass, this.step, this.hits);
      if (!(h > 0 && this.lastFrame < h && h <= frame)) break;
      this.events.hit(this.step, this.type, this.hits);
      this.hits++;
      this.flags |= F_WINDOW;
      this.timer = comboWindow(this.weaponClass, this.step);
    }
    this.lastFrame = frame;
    if (ended) {
      if (this.weaponClass === 0) this.flags |= F_DONE;
      else if (--this.timer < 0) this.flags |= F_DONE;
    }
    if (ended && this.flags & F_DONE) return this.finish();
    return { next: null, idle: false };
  }
}

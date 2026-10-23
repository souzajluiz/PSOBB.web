// The Dubwitch (TOCtrlDubchik, set entry 0x85) of PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs. Its brain: ctor 0x00618ae4 (hp 300, is_invisible flag
// 0x8000000), update 0x00618f.. (update_dubwitch, the states below), death
// kill_dubwitch 0x00619050.
//
// The Dubwitch is a hidden float that waits for its room's Dubchics: a Dubchic
// (TObjEneDubchik, subtype 0: a Dubchic, not a Gillchic) of the same spawn
// section that is dead, or lying down to get up, wakes it (state 0 -> 1). It
// then rises out of sight (1, 2), hovers visible (3) and, when the Dubwitch is
// killed, every such Dubchic of the section is marked dead for good (below).
//
// The link is the set data: the Dubwitch and the Dubchics share their room,
// EnemySet.section (spawn_section_number). Nothing else ties them: a live
// Dubwitch does not make a Dubchic invulnerable or change its revival (the
// Dubchic's state 5 has no check of it).
//
// Bobbing (every state 0..3): the int angle 0x388 grows by 2184 a frame
// (_DAT_0093080c), height = 1.0 * sin(angle) + 20.0 (_DAT_00930804,
// _DAT_009307ec). The timers use g_BaseTimeReference (.bss 0x00a8eb70, no
// value in the dump; ASSUMED 1/30 a frame) and the lift uses
// g_DubwitchCurrentBobbingAmplitude (.bss 0x00a8eb74; ASSUMED 1/30 a frame).
//
// States (update_dubwitch 0x00618f.. and the helpers 0x00619198..0x00619350):
//   0 hidden (is_invisible): bobs; a linked Dubchic dead -> 1 (from the next frame).
//   1 rise (0x00619350): bobs; the timer 0x38c += base time until > 1.0 -> 2.
//   2 lift (0x00619290): bobs; the lift 0x390 += the step until > 1.0 -> 3,
//     then the Dubwitch is visible (unset is_invisible).
//   3 hover (0x00619210): bobs; nothing leaves it.
//   4 sink (0x006191d8): no bobbing; 0x390 -= the step below 0 -> 5. Nothing in
//     the dump sets 4 (the hit handler is not traced): ASSUMED unreachable here.
//   5 drop (0x00619198): no bobbing; 0x38c -= base time below 0 -> 0 and the
//     Dubwitch is hidden again.
//   6 dead (kill_dubwitch, 0x00619050): the cascade below, once.
import { BAMS_TO_RAD, type AiFrame, type AiTarget } from './enemyai.ts';
import { BrainBase } from './enemyfsm.ts';

export const DUBWITCH = {
  // ctor 0x00618ae4: this->hp = max_hp1 = 300 (not the BattleParam row).
  hp: 300,
  bobSpeed: 2184, // _DAT_0093080c
  bobAmplitude: 1, // _DAT_00930804
  floatHeight: 20, // _DAT_009307ec (dubwitch_inactive_float_height)
  riseLimit: 1, // _DAT_009307dc: state 1 ends past it
  liftLimit: 1, // _DAT_009307e0: state 2 ends past it
  sinkFloor: 0, // _DAT_009307e4: state 4 ends below it
  dropFloor: 0, // _DAT_009307e8: state 5 ends below it
  // ASSUMED: the .bss globals are written at run time (not in the dump).
  timeStep: Math.fround(1 / 30),
  liftStep: Math.fround(1 / 30),
  // Dubchic group: DUBCHIC (param6 0) only; the Gillchic is never linked.
} as const;

export type DubwitchState = 'hidden' | 'rise' | 'lift' | 'hover' | 'sink' | 'drop' | 'dead';

export class DubwitchAi extends BrainBase {
  state: DubwitchState = 'hidden';
  // Set by the owner before each tick: a linked Dubchic is dead (or lying
  // down) in this Dubwitch's section (update_dubwitch's scan, state 0).
  linkedDead = false;
  private bobAngle = 0; // +0x388: the bobbing angle (int)
  private height: number = DUBWITCH.floatHeight; // +0x384
  private timer = 0; // +0x38c
  private lift = 0; // +0x390

  constructor(opts: { x: number; z: number; angle: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
  }

  // The hidden states (is_invisible): the model is not drawn and it cannot be
  // hit (render/combat.ts concealed). ASSUMED: is_invisible also makes it
  // untargetable.
  get untargetable(): boolean {
    return this.state === 'hidden' || this.state === 'rise' || this.state === 'lift';
  }

  get hidden(): boolean {
    return this.untargetable;
  }

  private bob(): void {
    this.bobAngle = Math.round(this.bobAngle + DUBWITCH.bobSpeed);
    this.height = DUBWITCH.bobAmplitude * Math.sin(this.bobAngle * BAMS_TO_RAD) + DUBWITCH.floatHeight;
  }

  tick(_targets: readonly AiTarget[] = [], _animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    switch (this.state) {
      case 'hidden':
        this.bob();
        if (this.linkedDead) this.state = 'rise';
        break;
      case 'rise': {
        this.bob();
        const t = this.timer + DUBWITCH.timeStep;
        if (t > DUBWITCH.riseLimit) {
          this.timer = 1;
          this.state = 'lift';
        } else this.timer = t;
        break;
      }
      case 'lift': {
        this.bob();
        const l = DUBWITCH.liftStep + this.lift;
        if (l <= DUBWITCH.liftLimit) this.lift = l;
        else {
          // unset_entity_flags 0x8000004: visible from here on.
          this.lift = 1;
          this.state = 'hover';
        }
        break;
      }
      case 'hover':
        this.bob();
        break;
      case 'sink': {
        const l = this.lift - DUBWITCH.liftStep;
        if (l < DUBWITCH.sinkFloor) {
          this.lift = 0;
          this.state = 'drop';
        } else this.lift = l;
        break;
      }
      case 'drop': {
        const t = this.timer - DUBWITCH.timeStep;
        if (t < DUBWITCH.dropFloor) {
          this.timer = 0;
          this.state = 'hidden';
        } else this.timer = t;
        break;
      }
      default:
        break;
    }
    out.lift = this.height;
    out.hidden = this.hidden;
    return this.finish(out);
  }

  onDamage(_clientId: number): void {
    // No reaction: the Dubwitch has no motion of its own in the dump.
  }

  resume(): string {
    return this.state;
  }

  // The Dubwitch has no damage motion (no flinch is traced).
  flinches(): boolean {
    return false;
  }
}

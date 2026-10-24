// Olga Flow's brain, form 1 only (the Episode 2 boss, class TBoss6PlotFalz, enemy type 0xca,
// area 0x1f; PsoBB.exe, Ephinea 1.25.13, addresses are VAs). The map is docs/bosses/olgaflow-map.md
// (sections 4.2, 4.3, 12.4, 12.5); the dump names are from the Ghidra dump in
// reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c (Olga1* / olga1_*), matched by
// callees, constants and the state numbers they write, never by name alone.
//
// Tags: `exe` = read in the asm / table bytes / dump body of this pass; `ASSUMED` = the value or the
// meaning is a guess (marked where it is used). Not here (left, see the map section 11 and the
// DEVLOG): the attack hit geometry (sword stab, sword wave, tail swipe, fire lancer, mines), the
// controller's 9 sub-states (spawn, fade, kill), the form 2 entity (unreached in this build, map 12.2),
// the beast's movement (UpdateOlga1Position / Rotation, 0x931c0 / 0x93080), effects and sounds.
//
// The table: the beast's 40 state rows at 0x009a70a4 (stride 0x18: motion-pair row, value (+0x420),
// enter fn, leader fn, frame fn; exe, read with tools/exedata.py). Each tick the exe runs the frame fn
// and then, on the leader only (owner +0x37c == 0), the leader fn. The leader (the room leader's brain)
// chooses the next state and sends it as 6xA4 (the state byte at +4, see encodeOlgaA4); the leader
// applies it locally first, like the exe's 0x008003e0, and every other client applies the same packet
// (applyRemote, the exe's handler 0x00497e50 / Olga1UpdateState).
//
// Lessons (docs/HANDOFF.md): remote damage feeds the HP on every client (hit()), no state hangs (every
// state has a timer that ends in a transition, and the state-0x27 leader falls back to the hub), the
// brain owns its death (killed fires once, after the death hold), no per-frame allocation (the history
// is a fixed Int32Array).

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import { BrainBase, loop, once } from './enemyfsm.ts';

// --- wire ----------------------------------------------------------------------

// The 6xA4 subcommand (exe 0x00494290 / 0x00494ae0 / 0x004945ec, the sender; 0x00497e50, the receiver):
// u8 0xa4, u8 5 (20 bytes), u16 entity id @2 (the beast's id), u8 state @4, u8 dir @5 (the target's
// heading byte, signed), u8 kind @6 (0x12 / 0x1c / 0x1c, the attack's variant), u8 extra @7,
// u8 flag 0x440 @8, u8 flag 0x41c @9 (the attack-in-progress mode), u8 random @10 (+0x424).
export const OLGA_A4_SIZE = 20;

export interface OlgaA4 {
  entity: number;
  state: number;
  dir: number;
  kind: number;
  extra: number;
  flag440: number;
  flag41c: number;
  rnd: number;
}

export function encodeOlgaA4(m: OlgaA4): Uint8Array {
  const b = new Uint8Array(OLGA_A4_SIZE);
  b[0] = 0xa4;
  b[1] = 5;
  b[2] = m.entity & 0xff;
  b[3] = (m.entity >> 8) & 0xff;
  b[4] = m.state & 0xff;
  b[5] = m.dir & 0xff;
  b[6] = m.kind & 0xff;
  b[7] = m.extra & 0xff;
  b[8] = m.flag440 & 0xff;
  b[9] = m.flag41c & 0xff;
  b[10] = m.rnd & 0xff;
  return b;
}

// Null when the body is too short or not a 0xa4 (the exe's receive checks the range 0..40 later).
export function decodeOlgaA4(body: Uint8Array): OlgaA4 | null {
  if (body.length < 11 || body[0] !== 0xa4) return null;
  return {
    entity: body[2] | (body[3] << 8),
    state: body[4],
    dir: body[5],
    kind: body[6],
    extra: body[7],
    flag440: body[8],
    flag41c: body[9],
    rnd: body[10],
  };
}

// --- tables --------------------------------------------------------------------

export interface OlgaRow {
  // Motion-pair row (table OLGA1_MOTION_ROWS), -1 keeps the current motion.
  readonly motion: number;
  // The value written to +0x420 on entry (exe, unused by the brain: ASSUMED a render flag).
  readonly value: number;
  // Fn addresses, 0 when the row has none (exe).
  readonly enter: number;
  readonly leader: number;
  readonly frame: number;
}

// The 40 rows 0..39 of 0x009a70a4 (exe, `tools/exedata.py read 009a70a4 u 240`). Row 40 is not a row
// of this table in the bytes read (its first word is an address), so the brain ignores state 40.
export const OLGA1_ROWS: readonly OlgaRow[] = [
  { motion: 2, value: 1, enter: 0x0049978c, leader: 0, frame: 0x0049844c }, // 0 entrance wait
  { motion: 2, value: 1, enter: 0x00499728, leader: 0x00498484, frame: 0x00498554 }, // 1 hub (hold, attack choice)
  { motion: 2, value: 1, enter: 0x004996a4, leader: 0, frame: 0x00498570 }, // 2 attack start
  { motion: 11, value: 1, enter: 0x0049967c, leader: 0, frame: 0x004985a8 }, // 3
  { motion: 11, value: 1, enter: 0x00499654, leader: 0, frame: 0x004985e0 }, // 4
  { motion: 13, value: 1, enter: 0x00499614, leader: 0, frame: 0x00498634 }, // 5 sword wave
  { motion: 13, value: 1, enter: 0x00499614, leader: 0, frame: 0x00498634 }, // 6 sword wave
  { motion: 13, value: 1, enter: 0x00499614, leader: 0, frame: 0x00498634 }, // 7 sword wave
  { motion: 13, value: 1, enter: 0x004995a4, leader: 0, frame: 0x00498674 }, // 8 sword wave move
  { motion: 13, value: 1, enter: 0x004995a4, leader: 0, frame: 0x00498674 }, // 9
  { motion: 13, value: 1, enter: 0x004995a4, leader: 0, frame: 0x00498674 }, // 10
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 11 sword stab
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 12
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 13
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 14
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 15
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 16
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 17
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 18
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 19
  { motion: 12, value: 0, enter: 0x00499530, leader: 0, frame: 0x004986c8 }, // 20
  { motion: 14, value: 1, enter: 0x00499508, leader: 0, frame: 0x0049872c }, // 21 tail swipe
  { motion: 15, value: 1, enter: 0x004994b4, leader: 0, frame: 0x0049876c }, // 22 fire lancer move
  { motion: 20, value: 0, enter: 0x0049946c, leader: 0, frame: 0x00498878 }, // 23
  { motion: 0, value: 1, enter: 0x0049943c, leader: 0x004988d4, frame: 0x004988e8 }, // 24 idle / pre-attack
  { motion: 0, value: 1, enter: 0x00499414, leader: 0x00498934, frame: 0x00498998 }, // 25
  { motion: 3, value: 0, enter: 0x004993a4, leader: 0, frame: 0x004989d4 }, // 26
  { motion: 0, value: 0, enter: 0x0049935c, leader: 0, frame: 0x00498a0c }, // 27
  { motion: 0, value: 0, enter: 0x00499314, leader: 0x00498a50, frame: 0x00498a70 }, // 28
  { motion: 5, value: 0, enter: 0x004992c4, leader: 0, frame: 0x00498ab0 }, // 29
  { motion: 8, value: 2, enter: 0x00499260, leader: 0x00498bbc, frame: 0x00498bec }, // 30
  { motion: 8, value: 2, enter: 0x0049922c, leader: 0, frame: 0x00498c48 }, // 31
  { motion: 9, value: 0, enter: 0x004991ac, leader: 0x00498c64, frame: 0x00498c74 }, // 32
  { motion: 2, value: 0, enter: 0x0049916c, leader: 0, frame: 0x00498d20 }, // 33
  { motion: 2, value: 0, enter: 0x004990fc, leader: 0, frame: 0x00498d8c }, // 34
  { motion: 2, value: 0, enter: 0x004990b4, leader: 0, frame: 0x00498e04 }, // 35
  { motion: 2, value: 0, enter: 0x0049906c, leader: 0x00498e48, frame: 0x00498e88 }, // 36
  { motion: 2, value: 0, enter: 0x00499034, leader: 0x00498ec0, frame: 0x00498ee4 }, // 37
  { motion: 2, value: 0, enter: 0x00498ff4, leader: 0, frame: 0x00498f4c }, // 38
  { motion: -1, value: 0, enter: 0, leader: 0x00498fd8, frame: 0 }, // 39 exit (0x27): no frame fn
];

// The motion pairs (exe 0x009a6dc0, 16 rows of mode, next, leg, body; map 4.3). The brain plays
// the body motion on the body model and the leg motion on the leg model (animators 0 and 1 of the
// spec order: leg model 2, body model 6, enemymodels.ts). Mode 2 plays once and goes on to `next`,
// the other modes loop (ASSUMED from barbaray-map.md). Motion indices are the archive's (map 7).
export interface OlgaMotionRow {
  readonly mode: number;
  readonly next: number;
  readonly leg: number;
  readonly body: number;
}
export const OLGA1_MOTION_ROWS: readonly OlgaMotionRow[] = [
  { mode: 0, next: 0, leg: 44, body: 45 },
  { mode: 0, next: 1, leg: 42, body: 45 },
  { mode: 0, next: 2, leg: 44, body: 56 },
  { mode: 2, next: 0, leg: 40, body: 41 },
  { mode: 2, next: 2, leg: 44, body: 53 },
  { mode: 2, next: 0, leg: 37, body: 38 },
  { mode: 2, next: 2, leg: 37, body: 38 },
  { mode: 2, next: 8, leg: 29, body: 30 },
  { mode: 0, next: 8, leg: 13, body: 14 },
  { mode: 2, next: 1, leg: 47, body: 48 },
  { mode: 2, next: 2, leg: 44, body: 22 },
  { mode: 2, next: 2, leg: 44, body: 23 },
  { mode: 2, next: 2, leg: 44, body: 43 },
  { mode: 2, next: 2, leg: 44, body: 46 },
  { mode: 2, next: 2, leg: 51, body: 52 },
  { mode: 2, next: 16, leg: 44, body: 17 },
];

// The state numbers the brain names (exe, written by the state's own handlers: map 12.5, dump).
export const OLGA1 = {
  entrance: 0,
  hub: 1,
  attackStart: 2,
  swordWaveTop: 5,
  swordWaveMoveTop: 8,
  swordStabTop: 20,
  swordStabLow: 11,
  swordStabMid: 16,
  swordStabEnd: 0x1c,
  swordStabMidEnd: 0x24,
  tailSwipe: 21,
  fireLancer: 22,
  idle: 24,
  exit: 0x27,
  deathMotionBody: 5,
  deathMotionLeg: 3,
} as const;

// Timers ASSUMED or read (frames at 30 a second). The entrance and the hub: 0x5a (map 12.5, exe
// 0x0049978c and 0x00499728); the idle row 24: 0x5a (exe 0x0049943c); a row with no decoded timer
// falls back to its motion's frame count (ASSUMED, the playback speed is not verified: map 12.6).
export const OLGA_TIMER = {
  entrance: 0x5a,
  hub: 0x5a,
  idle: 0x5a,
  exit: 30, // ASSUMED: the state 0x27 hold when the leader sends nothing (no decoded timer)
  fallback: 30,
  cap: 900, // no state holds longer than this (the no-hang rule)
  // The death hold: the controller's sub-state 8 kill timer, 0x1c6 (exe 0x0048f0b8, map 12.4).
  // ASSUMED that the beast's death uses the same timer as the controller's kill.
  death: 0x1c6,
} as const;

// The attack-choice constants (exe, data words read from PsoBB.exe): 0x00902b54 / 0x00902b80 /
// 0x00902b98 = 32768 (the rand divisor), 0x00902b5c = 128, 0x00902ba0 = 160, 0x00902b70 = 1.99,
// 0x00902b68 = 5, 0x00902b84 = 4.99, 0x00902b6c = 0.5, 0x0090258c = 0.5, 0x00902594 = 0.4.
// The range thresholds (exe 0x00902b94 = 230, 0x00902b8c = 140, 0x00902b88 = 40) are the same numbers
// the dump's IsOlga1* helpers store in their globals (0x00a472cc / d4 / dc, set once on first use).
export const OLGA_RANGE = { within: 230, far: 140, close: 40 } as const;

// The leader's damage snapshots (the HP at the last hub entry, +0x4b8) and the two thresholds that
// trigger the 0x17 / 0x18 attacks (+0x494, +0x498). The exe reads them from BattleParam fields 6..11
// of the boss row; not bound in this pass, so the exe's fallback 200 is used (ASSUMED).
const DAMAGE_PROGRESS = 200;

// The attack-selection table of ProcessOlga1AttackSelection (g_Olga1AttackSelectionTable, 5 bytes).
// The address is not bound (the dump names it only): ASSUMED values, chosen so each branch the
// exe's code tests (4, 0x16, 5, 8) is reachable.
const SELECTION_TABLE = [2, 4, 0x16, 5, 8] as const;

// --- helpers -------------------------------------------------------------------

const s8 = (v: number): number => ((Math.round(v) + 128) & 0xff) - 128;

// The state history (+0x380..+0x3fc, newest first): `hist[0]` is the current state.
const HIST = 32;

export interface OlgaFlowInit {
  entityId: number;
  x: number;
  z: number;
  // The heading in BAMS (0..0xffff); the brain's angle is its radians.
  heading: number;
  // The body's height above the floor (the exe's +0x3c; ASSUMED the spawn height).
  height: number;
  hp: number;
  maxHp: number;
  leader: () => boolean;
  // The archive's frame count of a motion (the timers of a row without a decoded one).
  frames?: (motion: number) => number;
  rand: () => number;
}

export type OlgaEvent = { kind: 'send'; packet: Uint8Array } | { kind: 'killed' };

export class OlgaFlowAi extends BrainBase {
  state: string;
  entityId: number;
  hp: number;
  maxHp: number;
  // The current state (+0x37c for the followers, +0x380 for the history), the timer (+0x418) and the
  // two attack flags (+0x440 and +0x41c, the packet's bytes +8 and +9).
  stateIndex: number = OLGA1.entrance;
  timer = 0;
  flag440 = 0;
  flag41c = 0;
  rnd424 = 0;
  // The HP at the hub entry (+0x4b8).
  snapshot: number;
  // Set once the death hold has run out (the brain's kill, exe 0x0048d4b0 through the controller).
  dead = false;
  // Set on the first hit that takes the HP to 0 (the body's death starts; the kill comes after the hold).
  dying = false;
  readonly height: number;
  private readonly isLeader: () => boolean;
  private readonly frames: (motion: number) => number;
  private readonly hist = new Int32Array(HIST);
  private events: OlgaEvent[] = [];
  private motionRow = -1;
  private deathTimer = 0;
  private pendingMotion: EnemyAiMotion | null = null;

  constructor(init: OlgaFlowInit) {
    super(init.x, init.z, init.heading * BAMS_TO_RAD, init.rand);
    this.entityId = init.entityId;
    this.hp = init.hp;
    this.maxHp = init.maxHp;
    this.snapshot = init.hp;
    this.height = init.height;
    this.isLeader = init.leader;
    this.frames = init.frames ?? (() => 30);
    this.state = 'olga1:0';
    this.enter(OLGA1.entrance);
  }

  get legMotion(): EnemyAiMotion | null {
    const row = OLGA1_MOTION_ROWS[this.motionRow];
    return row ? loop(row.leg, 1) : null;
  }

  // The brain's own kill and reward hook: drained by render/combat.ts each tick (the 'killed' event
  // fires once, after the death hold, and is the only place the kill sends are made).
  drainEvents(): OlgaEvent[] {
    if (this.events.length === 0) return this.events;
    const out = this.events;
    this.events = [];
    return out;
  }

  // Whether the leader role is held here (owner +0x37c == 0 in the exe).
  get leader(): boolean {
    return this.isLeader();
  }

  // The HP from the entity (the render keeps stats.hp authoritative for the snapshot).
  setHp(hp: number, maxHp: number): void {
    this.hp = Math.max(0, hp);
    this.maxHp = maxHp;
  }

  // The player's hit (exe: the damage writes +0x334 and the progress thresholds read it). Returns
  // true when this hit takes the HP to 0; the death hold then runs and the kill comes after it.
  hit(damage: number): boolean {
    if (this.dead || this.dying) return false;
    this.hp = Math.max(0, this.hp - Math.max(0, damage));
    if (this.hp > 0) return false;
    this.dying = true;
    this.enterDeath();
    return true;
  }

  // A 6xA4 from the leader (the exe's receive 0x00497e50 / Olga1UpdateState). The follower sets its
  // state and flags and runs the row's enter; the leader's own packet loops back through here too.
  applyRemote(packet: OlgaA4): void {
    if (this.dead || this.dying) return;
    if (packet.state < 0 || packet.state > 0x28) return;
    this.flag440 = packet.flag440 & 0xff;
    this.flag41c = packet.flag41c & 0xff;
    this.rnd424 = packet.rnd & 0xff;
    this.setState(packet.state);
  }

  // The leader's and the follower's tick. `animationEnded` is the body's motion end (ignored: the
  // brain counts its own timers, so a motion never holds a state).
  tick(_targets: readonly AiTarget[], _animationEnded?: boolean): AiFrame {
    const out = this.frame();
    if (this.dead) return this.finish(out);
    if (this.dying) {
      this.deathTimer -= 1;
      if (this.deathTimer < 0) {
        this.dead = true;
        this.state = 'dead';
        this.events.push({ kind: 'killed' });
      }
      return this.finish(out);
    }
    this.timer -= 1;
    // The frame fn of the row: a timer that has run out transitions (the no-hang rule).
    if (this.timer < 0) this.transition();
    if (this.pendingMotion) {
      out.motion = this.pendingMotion;
      this.pendingMotion = null;
    }
    return this.finish(out);
  }

  onDamage(_clientId: number): void {}

  resume(): string {
    return this.state;
  }

  // The brain owns the death (see tick); a kill from outside only stops it.
  override kill(): void {
    this.dead = true;
    this.state = 'dead';
    this.current = null;
  }

  // --- state machine -----------------------------------------------------------

  // The exe's SetOlga1State / Olga1UpdateState: the history shift (+0x384..), the row's motion pair
  // (the body model's motion; mode 2 plays once), and the timer that the row's enter sets.
  private enter(index: number): void {
    this.stateIndex = index;
    this.state = `olga1:${index}`;
    this.hist.copyWithin(1, 0, HIST - 1);
    this.hist[0] = index;
    if (index === OLGA1.hub) this.snapshot = this.hp;
    const row = OLGA1_ROWS[index];
    if (row && row.motion >= 0) {
      this.motionRow = row.motion;
      const mrow = OLGA1_MOTION_ROWS[row.motion];
      const body = mrow ? mrow.body : 0;
      const m = mrow && mrow.mode === 2 ? once(body, 1) : loop(body, 1);
      this.current = m;
      this.pendingMotion = m;
    }
    this.timer = this.durationOf(index);
  }

  private durationOf(index: number): number {
    if (index === OLGA1.entrance) return OLGA_TIMER.entrance;
    if (index === OLGA1.hub) return OLGA_TIMER.hub;
    if (index === OLGA1.idle) return OLGA_TIMER.idle;
    if (index === OLGA1.exit) return OLGA_TIMER.exit;
    const row = OLGA1_ROWS[index];
    if (!row || row.motion < 0) return OLGA_TIMER.fallback;
    const mrow = OLGA1_MOTION_ROWS[row.motion];
    const frames = mrow ? this.frames(mrow.body) : OLGA_TIMER.fallback;
    return Math.max(1, Math.min(OLGA_TIMER.cap, frames || OLGA_TIMER.fallback));
  }

  // The exe's SetOlga1State for a state 0..40 (the range check of 6xA4 is 0..40, exe 0x00497e50).
  setState(index: number): void {
    if (index < 0 || index > 0x28) return;
    this.enter(index);
  }

  // The frame fn's transitions of the decoded rows (map 12.4 / 12.5; dump bodies of
  // Olga1HandleSwordWaveAttack, SwordWaveMoveAttack, SwordStabAttack, RandomFloatAttack, TailSwipe).
  // Hub and exit: the leader picks the next attack (decide), else the hub and the exit alternate
  // (ASSUMED: 0x27 holds 30 frames, the no-hang fallback). Every other row returns to the hub (ASSUMED).
  private transition(): void {
    const n = this.stateIndex;
    if (n === OLGA1.hub || n === OLGA1.exit) {
      if (this.leader) {
        this.decide();
        if (this.stateIndex !== n) return;
      }
      return this.setState(n === OLGA1.hub ? OLGA1.exit : OLGA1.hub);
    }
    if (n === OLGA1.entrance) return this.setState(OLGA1.hub);
    if (n === OLGA1.idle) return this.setState(OLGA1.exit);
    if (n >= 5 && n <= 7) return this.setState(n === OLGA1.swordWaveTop ? OLGA1.hub : n - 1);
    if (n >= 8 && n <= 10) return this.setState(n === OLGA1.swordWaveMoveTop ? OLGA1.hub : n - 1);
    if (n >= 11 && n <= 20) {
      if (n === OLGA1.swordStabLow) return this.setState(OLGA1.swordStabEnd);
      if (n === OLGA1.swordStabMid) return this.setState(OLGA1.swordStabMidEnd);
      return this.setState(n - 1);
    }
    this.setState(OLGA1.hub);
  }

  private enterDeath(): void {
    this.dying = true;
    this.deathTimer = OLGA_TIMER.death;
    this.state = 'dying';
    this.motionRow = -1;
    // The archive's dead_bssgc_pf01_body (motion 5, map 7), played once and held.
    const m = once(OLGA1.deathMotionBody, 1);
    this.current = m;
    this.pendingMotion = m;
  }

  // --- the leader's attack choice (exe 0x00498484 and the helpers it calls) -----

  private hpDown(): number {
    return this.snapshot - this.hp;
  }

  private countHist(state: number, n: number): number {
    const m = Math.min(n, HIST);
    let c = 0;
    for (let i = 0; i < m; i++) if (this.hist[i] === state) c++;
    return c;
  }

  // Olga1UpdateAttack_00498484 (the hub's leader fn): the progress pick, the flag branch, the history.
  private decide(): void {
    // CheckOlga1AttackProgress_00496910: no attack flag, and the HP lost since the snapshot reached the threshold.
    if (this.flag41c === 0 && DAMAGE_PROGRESS <= this.hpDown()) {
      this.send(0x17, 0, 0, 0);
      return;
    }
    if (this.flag41c !== 0) {
      // CheckOlga1AttackProgress_00496880 (the flag set and the progress threshold); else the selection.
      if (DAMAGE_PROGRESS <= this.hpDown()) this.selectAndSend();
      else this.processSelection();
      return;
    }
    if (this.countHist(2, 16) !== 0) {
      const c3 = this.countHist(3, 10);
      const c5 = this.countHist(5, 10);
      if (c3 + c5 !== 0 && this.rng() < ATTACK_CHANCE) this.startAttack();
      else this.processSelection();
      return;
    }
    this.startAttack();
  }

  // The 0x18 / 0x1c attack that the HP progress picks (SelectAndSendOlga1Attack_00494b20): the
  // heading, the kind, and 0x18 or 0x1c. ASSUMED the 0xfb branch is the rare variant.
  private selectAndSend(): void {
    const dir = this.headingByte() + Math.round((this.rng() - 0.5) * 2 * 10);
    this.send(0x18, dir, 0x1c, this.rng() < 0.5 ? 0xfb : 0x14);
  }

  // The state-start attack (StartOlga1Attack_00494290 / GetOlga1AttackDirection_0049448c): the
  // target's heading byte plus a random offset (+-80, 0x00902ba0 = 160), the kind 0x12 or 0x1c.
  private startAttack(): void {
    const dir = this.attackDirection();
    this.send(OLGA1.attackStart, dir.dir, dir.kind, 10);
  }

  // The exe's direction: GetOlga1AttackDirection (0x0049448c). The heading byte is the target's
  // (exe +0x60 >> 8, ASSUMED: the body's own heading); the kind is 0x1c when rand < 0.5 (0x0090258c).
  private attackDirection(): { dir: number; kind: number } {
    const dir = s8(this.headingByte() + Math.round((this.rng() - 0.5) * 160));
    const kind = this.rng() < 0.5 ? 0x1c : 0x12;
    return { dir, kind };
  }

  // ProcessOlga1AttackSelection_00494678, the two halves: the flag set (close, far, or a table pick),
  // and the flag clear (within range: 5..7; else the history's 3 / 5 balance).
  private processSelection(): void {
    if (this.flag41c === 1) {
      const dir = this.attackDirection();
      if (this.height < OLGA_RANGE.close) {
        // Close: 0x15 unless the rand misses the 0.4 / count threshold (then 2).
        const c15 = this.countHist(0x15, 8);
        const s = c15 === 0 || this.rng() < 0.4 / c15 ? 0x15 : 2;
        this.send(s, dir.dir, dir.kind, s === 0x15 ? -2 : 10);
        return;
      }
      if (this.height > OLGA_RANGE.far) {
        this.send(4, dir.dir, dir.kind, 10);
        return;
      }
      const idx = Math.round(this.rng() * 4.99);
      const state = SELECTION_TABLE[idx > 4 ? 0 : idx];
      this.send(state, dir.dir, state === 4 ? (dir.kind === 0x1c ? 0x12 : 0x1c) : dir.kind, state === 0x16 ? 10 : 6 + Math.round(this.rng() * 2));
      return;
    }
    if (this.flag41c !== 0) return;
    if (Math.hypot(this.x, this.z) < OLGA_RANGE.within) {
      this.send(Math.round(this.rng() * 1.99 + 5), 0, 0, 0);
      return;
    }
    // The 3 / 5 balance of the history (32 entries); none found: 5 at rand >= 0.5.
    let pick = 0;
    for (let i = 0; i < HIST; i++) {
      const v = this.hist[i];
      if (v === 3) {
        pick = 5;
        break;
      }
      if (v === 5) {
        pick = 3;
        break;
      }
    }
    if (pick === 0) pick = this.rng() >= 0.5 ? 5 : 3;
    if (pick === 3) this.send(3, 0, 0, 0);
    else this.send(Math.round(this.rng() * 1.99 + 5), 0, 0, 0);
  }

  // The leader's send: the exe's FillOlga1AttackPacket, then 0x008003e0 (sent, and applied locally).
  private send(state: number, dir: number, kind: number, extra: number): void {
    const packet: OlgaA4 = {
      entity: this.entityId,
      state,
      dir: s8(dir),
      kind: s8(kind),
      extra: s8(extra),
      flag440: this.flag440,
      flag41c: this.flag41c,
      rnd: Math.floor(this.rng() * 256),
    };
    this.applyRemote(packet);
    const bytes = encodeOlgaA4(packet);
    this.events.push({ kind: 'send', packet: bytes });
  }

  private headingByte(): number {
    const h16 = Math.round(this.angle / BAMS_TO_RAD) & 0xffff;
    return s8(h16 >> 8);
  }
}

// The attack's chance and the rand scale: g_Olga1AttackInitiationChance (dump; the address is not
// bound): ASSUMED 0.5.
const ATTACK_CHANCE = 0.5;

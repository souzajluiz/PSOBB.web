// The quest script virtual machine.
//
// Shape of the real VM (PsoBB.exe, headers/quests.h in the reference dump):
//   - quest_thread_exec_until_yield (.c:602531) runs one thread until it sets
//     quest_thread_yield_reason, then the next one. A quest is multi-threaded:
//     `thread` / `thread_stg` spawn cooperative threads
//     (QuestThread2_Constructor_006bc800, 0x198 bytes each), and so does a
//     floor handler when the player warps (quest_start_floor_thread at
//     .c:615128 reads floor_handlers[g_CurrentFloor]).
//   - Dispatch is a 772-entry table of (setup_func, opcode_func) pairs
//     (.c:559261): the setup shim reads the inline argument bytes with
//     quest_read_objcode_{1,2,4} and tail-calls the body. opcode_setup_a is
//     the F_ARGS shim: no inline bytes, and it clears the arg stack afterwards
//     (.c:602676).
//   - Two argument sources: g_pQuestGlobalRegisters[256] (the register file,
//     every index masked with 0xFF) and g_QuestOpcodeArgStack[8] filled by the
//     arg_push* opcodes (.c:611281..611345):
//       arg_pushr r  -> the register's value
//       arg_pushl/b/w -> the immediate, zero-extended
//       arg_pusha r  -> &registers[r]
//       arg_pusho l  -> the label table entry for l
//     Register arguments of an F_ARGS opcode are therefore pushed as plain
//     immediates holding the register number, which is what real quests do:
//     `arg_pushb 0x3C; set_player_start_position` means r60-r63.
//   - PC is an offset into the .bin; a label is an index resolved through the
//     label table (quest_objcode_labels[label], .c:603565), and
//     quest_start_thread(0) (0x006bc76c) is the quest entry point.
//
// What this VM runs is a subset: the opcodes a quest needs for its opening
// (floor handlers, map designation, messages, quest flags, counters, registers,
// arithmetic, control flow, player and game state) plus the cosmetic opcodes
// that must not stall it. Every other opcode is decoded for its length, logged
// by name once, and skipped — see docs/PROTOCOL.md for the list of what is not
// implemented.

import { decodeInstruction, type QuestBin, type QuestInstruction } from '../formats/questbin.ts';
import { F_ARGS, F_CLEAR_ARGS } from '../formats/questopcodes.ts';
import type { BattleParamKind } from '../formats/battleparams.ts';
import { BP_OPCODES, KeywordDetector, findInventoryItem, readBattleParamRow, validBpIndex, type QuestInventoryItem } from './miscops.ts';
import { BATTLE_OPCODES, BattleSetup } from './battle.ts';
import { ChallengeMode, type ChallengeEnv } from './cmode.ts';
import type { MomokaExchangeRequest } from './giveaway.ts';

export const QUEST_NUM_REGISTERS = 0x100;
export const QUEST_NUM_FLOORS = 0x12;
export const QUEST_NUM_FLAGS = 0x400;
export const QUEST_NUM_COUNTERS = 0x10;
// quest_stack[] in the exe; a QuestThread2 keeps 376 bytes of local state, so
// about 94 dwords (headers/quests.h).
export const QUEST_STACK_LIMIT = 94;
// Guard against a quest that loops forever without a sync; the real VM has no
// such cap, so hitting it is a bug in this VM or an unimplemented opcode that
// should have blocked.
const MAX_STEPS_PER_FRAME = 200000;
// Typed so that assigning it does not narrow a thread's yield reason: the
// opcode bodies set it while the run loop is still reading it.
const NO_YIELD: YieldReason = 'none';

export type ArgKind = 'int' | 'regAddr' | 'label' | 'string';

export interface ArgValue {
  kind: ArgKind;
  value: number;
  text?: string | undefined;
}

// 'board' is disp_msg_qb__add_msg (5): disp_msg_qb, or add_msg on the open
// quest board text, waits for the decide key.
// 'host' waits for something the game does (the Challenge Mode prize windows,
// quest/cmode.ts); the host's promise lets it go.
export type YieldReason = 'none' | 'sync' | 'ret' | 'exit' | 'message' | 'list' | 'board' | 'blocked' | 'host';

// Which of the exe's two thread runners steps a thread: 1 =
// quest_run_thread_1 (the quest's own and floor threads, QuestThread2), 2 =
// quest_run_thread_2 (QuestThread3: a quest board item's thread,
// CreateQuestThread_006bcdec, which also ends while waiting on the board text
// once the player's UI no longer blocks input).
export type QuestThreadRunner = 1 | 2;

export interface QuestMessage {
  kind: 'message' | 'window' | 'questBoard';
  // `message` carries the speaker: an NPC's talk action (>= 100) or a client id.
  target?: number;
  pages: string[];
  // add_msg on the open quest board adds a line instead of replacing it.
  append?: boolean;
}

export interface QuestNpcRequest {
  clientId: number;
  position: [number, number, number];
  angle: number;
  state: number; // 0 = alive, 1 = dead, 2 = invisible named text box
  template: number;
  talk: boolean; // created by npc_crptalk (slot 3 talker)
}

export interface QuestBoardItem {
  index: number; // 0..5
  label: number;
  name: string;
}

export interface QuestCoordsHandler {
  token: number;
  floor: number;
  position: [number, number, number];
  radius: number;
  label: number;
  kind: 'call' | 'talk' | 'object';
}

// Everything the VM asks of the game. All of it is optional: with no host the
// VM runs headless, which is what tests/quests.test.ts does.
export interface QuestVMHost {
  log?: (msg: string) => void;
  clientId?: () => number;
  difficulty?: () => number; // 0..3
  playerCount?: () => number;
  playersPresent?: () => boolean[];
  playerFloor?: (clientId: number) => number;
  playerRoom?: (clientId: number) => number;
  playerPosition?: (clientId: number) => { x: number; y: number; z: number } | null;
  playerState?: (clientId: number) => number;
  playerDead?: (clientId: number) => boolean;
  playerHpTp?: (clientId: number) => { hp: number; maxHp: number; tp: number; maxTp: number } | null;
  enemiesKilled?: () => number;
  questExit?: () => void;
  darkFalzDead?: () => boolean;
  constructObjects?: (floor: number, room: number, group: number) => void;
  constructEnemies?: (floor: number, room: number, wave: number) => void;
  zoneCleared?: (floor: number, room: number) => boolean;
  // 6x75 (G_UpdateQuestFlag_V3_BB_6x75) when a flag changes.
  setQuestFlag?: (flag: number, set: boolean) => void;
  getQuestFlag?: (flag: number) => boolean;
  // 6x05 (switch flags), through render/gamefield.ts.
  setSwitchFlag?: (floor: number, flag: number, set: boolean) => void;
  getSwitchFlag?: (floor: number, flag: number) => boolean;
  // 6x77 (sync_register / sync_register2).
  syncRegister?: (reg: number, value: number) => void;
  // UI.
  showMessage?: (m: QuestMessage) => void;
  // IsPlayerSlotUIBlockingInput_00716ba0 for the local player (a menu window
  // holds the controls); quest_run_thread_2 reads it while a thread waits on
  // the board text. Without it the check is skipped.
  uiBlockingInput?: () => boolean;
  closeMessage?: (kind: QuestMessage['kind'], target?: number) => void;
  showList?: (choices: string[]) => void;
  // Map and movement.
  mapDesignated?: (floor: number, d: QuestFloorDesignation) => void;
  mainwarpChanged?: (floor: number, enabled: boolean) => void;
  goFloor?: (clientId: number, floor: number) => void;
  npcCreated?: (npc: QuestNpcRequest) => void;
  npcKilled?: (clientId: number) => void;
  // npc_play: 6x69 command 2 (the NPC players follow that client).
  npcPlay?: (clientId: number) => void;
  questBoardChanged?: (items: QuestBoardItem[]) => void;
  random?: () => number; // [0, 1)
  // set_player_start_position (opcode_p_setpos .c:605051): sends 6x24 and
  // moves the player there at once. Position in units, angle in degrees.
  teleport?: (clientId: number, pos: { x: number; y: number; z: number; angle: number }) => void;
  // bb_p2_menu (opcode_BB_p2_menu -> SetBankMenuOpenFlag_006d7370) and
  // p_talk_guild (menu 4): open a Pioneer 2 counter menu (formats/npcmodels.ts
  // P2_MENUS).
  p2Menu?: (menu: number) => void;
  // bb_replace_item (F95B, opcode_unknownF95B .c:611678): the Momoka item
  // exchange's 6xD9, sent for the local player (quest/giveaway.ts).
  momokaExchange?: (req: MomokaExchangeRequest) => void;
  // p_return_guild (opcode_p_return_guild .c:605491): back to the Hunter's
  // Guild on Pioneer 2 (SinowberillChallenge_HandlePlayerFloorChange_00693598).
  returnToGuild?: () => void;
  // pl_add_meseta / pl_add_meseta2 (.c:605706 / .c:605737): 6xC9 for the
  // local player.
  addMeseta?: (amount: number) => void;
  // Battle mode (quest/battle.ts, quest/battlerun.ts): ba_start fired with the
  // rules the ba_* opcodes set; ba_get_place / ba_get_score / get_ba_record read
  // the battle's tables (place table index, points, the local record fields).
  battleStart?: (setup: BattleSetup) => void;
  battlePlace?: (index: number) => { place: number; points: number };
  battleRecord?: () => number[];
  // ba_initial_floor: the (remapped) floor the players start on.
  battleFloor?: (floor: number) => void;
  // Challenge Mode (quest/cmode.ts): what the mode asks of the game.
  cmode?: ChallengeEnv;
  // reset_map (opcode_reset_map .c:608905): clear the floors' state.
  resetMap?: () => void;
  // at_coords_talk / at_coords_call / set_obj_param registered or removed.
  coordsChanged?: (handlers: QuestCoordsHandler[]) => void;
  // get_gender: 0 male, 1 female, 2 unknown (quest/miscops.ts genderOfClass).
  playerGender?: (clientId: number) => number;
  // find_inventory_item / _ex: the local player's inventory.
  inventoryItems?: () => readonly QuestInventoryItem[];
  // set_enemy_*_data: one battle parameter row (raw bytes) replaced for the
  // enemy type chosen with set_override_enemy_bp_index.
  overrideBattleParam?: (kind: BattleParamKind, index: number, row: Uint8Array) => void;
}

export interface QuestFloorDesignation {
  floor: number;
  area: number;
  // 0 = the quest's own set data (from the .dat), 1 = offline free-play
  // template, 2 = online free-play template, 3 = nothing
  // (process_map_designate_v2 / _v3_BB, PsoBB.exe .c:613132 / .c:613155).
  type: number;
  layoutVar: number;
  entitiesVar: number;
}

export interface QuestVMOptions {
  bin: QuestBin;
  episode?: number; // 1, 2 or 4; set_episode overrides it
  host?: QuestVMHost | undefined;
  // Dismiss message boxes and answer lists automatically (tests, headless runs).
  autoAdvance?: boolean;
}

export class QuestThread {
  readonly id: number;
  readonly label: number;
  readonly runner: QuestThreadRunner;
  pc = 0;
  callStack: number[] = [];
  yieldReason: YieldReason = 'none';
  done = false;
  // Local copy of the arg stack, as QuestThread2 keeps one (.c:602576).
  argStack: ArgValue[] = [];
  // reset_map flagged it for removal: it ends once it yields.
  endAfterYield = false;
  // Called once when the thread ends (an NPC's talk waits for its thread,
  // EnemyObjectUpdate_0060648c state 2).
  onDone: (() => void) | null = null;

  constructor(id: number, label: number, pc: number, runner: QuestThreadRunner = 1) {
    this.id = id;
    this.label = label;
    this.pc = pc;
    this.runner = runner;
  }
}

export class QuestVM {
  readonly bin: QuestBin;
  // One dword per register, read as int or float (flet / fadd reinterpret the
  // same storage; newserv QuestScript.cc notes the handler treats it as an int).
  private readonly regBuffer = new ArrayBuffer(QUEST_NUM_REGISTERS * 4);
  readonly regsI = new Int32Array(this.regBuffer);
  readonly regsU = new Uint32Array(this.regBuffer);
  readonly regsF = new Float32Array(this.regBuffer);
  readonly stack: number[] = [];
  readonly floorHandlers = new Int32Array(QUEST_NUM_FLOORS).fill(-1);
  readonly designations = new Map<number, QuestFloorDesignation>();
  readonly mainwarpFloors = new Set<number>();
  readonly counters = new Int32Array(QUEST_NUM_COUNTERS);
  readonly questBoard: QuestBoardItem[] = [];
  readonly coordsHandlers: QuestCoordsHandler[] = [];
  readonly npcs: QuestNpcRequest[] = [];
  // Quest-completion callbacks (the set_qt_* / clr_qt_* family; -1 = unset).
  qtSuccess = -1;
  qtFailure = -1;
  qtCancel = -1;
  qtExit = -1;
  episode: number;
  currentFloor = 0;
  // initial_floor (F945): where the players start once the quest is loaded.
  initialFloor = 0;
  // Challenge-mode area bookkeeping (set_area_total / set_current_area_number
  // / set_area_title); kept so the UI can show it.
  areaTotal = 0;
  currentAreaNumber = 0;
  areaTitle = '';
  // Challenge Mode state and rules (quest/cmode.ts).
  readonly cmode: ChallengeMode;
  // override_warp_dest_floor (F853): area warps go to current floor + 1.
  warpDestOverride = false;
  // The ba_* rules, score weights and announcements (quest/battle.ts).
  readonly battle = new BattleSetup();
  // set_ult_map (F855): the floor uses the Ultimate graphics and set data.
  ultMap = false;
  // disable_bosswarp_option (F8A0): whether a boss warp asks Yes/No.
  bossWarpOption = true;
  // set_player_start_position (0x76), by client id.
  readonly startPositions = new Map<number, { x: number; y: number; z: number; angle: number }>();
  // switch_on / switch_off (0x90 / 0x91): local switch flags, deliberately
  // not synced with 6x05.
  readonly localSwitchFlags = new Map<number, boolean>();
  // npc_text / npc_text_id: what NPCs say in each situation number.
  readonly npcText = new Map<number, string>();
  // enable_keyword_detect / check_for_keyword (quest/miscops.ts).
  readonly keywords = new KeywordDetector();
  // set_override_enemy_bp_index: the battle parameter row that the following
  // set_enemy_*_data opcodes replace (quest_bp_edit_index, 0 at start), and
  // what they replaced, by "kind:index".
  bpEditIndex = 0;
  readonly bpOverrides = new Map<string, Uint8Array>();
  exited = false;
  exitCode = 0;
  // The message or list the quest is waiting on, if any.
  pendingMessage: QuestMessage | null = null;
  // g_QuestStateUnknown3 (the last `message` speaker) and the two window
  // handles add_msg checks (g_QuestDialogHandle1 / 2).
  lastMessageTarget = 0;
  windowOpen = false;
  questBoardOpen = false;
  pendingList: string[] | null = null;
  private pendingListReg = 0;
  // Opcodes that were decoded but not executed, by name, with a count.
  readonly unimplemented = new Map<string, number>();
  private threads: QuestThread[] = [];
  private nextThreadId = 1;
  private nextToken = 1;
  private host: QuestVMHost;
  private autoAdvance: boolean;
  private codeEnd: number;
  private flags = new Uint8Array(QUEST_NUM_FLAGS >> 3);
  private frameCount = 0;

  constructor(opts: QuestVMOptions) {
    this.bin = opts.bin;
    this.host = opts.host ?? {};
    this.cmode = new ChallengeMode(this.host.cmode ?? {});
    this.autoAdvance = opts.autoAdvance ?? !opts.host;
    this.episode = opts.episode ?? 1;
    const h = opts.bin.header;
    this.codeEnd = h.textOffset > h.labelTableOffset ? Math.min(h.size, opts.bin.data.length) : h.labelTableOffset;
  }

  private log(msg: string): void {
    this.host.log?.(msg);
  }

  // Absolute offset of a label, or -1 if the label does not exist.
  labelOffset(label: number): number {
    const o = this.bin.labels[label];
    return o === undefined || o < this.bin.header.textOffset || o >= this.codeEnd ? -1 : o;
  }

  // quest_start_thread(label) (PsoBB.exe 0x006bc76c); runner 2 is
  // CreateQuestThread_006bcdec (a quest board item, classic/questboard.ts).
  startThread(label: number, runner: QuestThreadRunner = 1): QuestThread | null {
    const pc = this.labelOffset(label);
    if (pc < 0) {
      this.log(`quest: thread at label ${label} has no code`);
      return null;
    }
    const t = new QuestThread(this.nextThreadId++, label, pc, runner);
    this.threads.push(t);
    return t;
  }

  // Starts the quest: one thread at label 0.
  start(): void {
    this.startThread(0);
  }

  // The player warped to `floor`: run its handler on a new thread
  // (quest_start_floor_thread, PsoBB.exe .c:615128).
  enterFloor(floor: number): void {
    this.currentFloor = floor;
    this.cmode.floorEntered(floor);
    const label = this.floorHandlers[floor] ?? -1;
    if (label < 0) return;
    this.log(`quest: floor ${floor} handler -> label ${label}`);
    this.startThread(label);
  }

  get liveThreads(): number {
    return this.threads.length;
  }

  // A player said `text` in chat (the keyword detector keeps it for a while).
  sayKeyword(clientId: number, text: string): void {
    this.keywords.say(clientId, text);
  }

  // Dismiss the message box the quest is waiting on.
  dismissMessage(): void {
    if (!this.pendingMessage) return;
    this.pendingMessage = null;
    for (const t of this.threads) if (t.yieldReason === 'message') t.yieldReason = 'none';
  }

  // The decide key while a thread waits on the quest board text
  // (disp_msg_qb__add_msg in quest_run_thread_1 / _2: the key moves every
  // such thread on).
  dismissBoard(): void {
    for (const t of this.threads) if (t.yieldReason === 'board') t.yieldReason = 'none';
  }

  // A thread waits on the quest board text.
  get boardWaiting(): boolean {
    return this.threads.some((t) => t.yieldReason === 'board' && !t.done);
  }

  // ResetQuestDialogState_006b0ba4: the window (g_QuestDialogHandle1) and
  // the quest board text (g_QuestDialogHandle2) close. It touches no thread's
  // yield (quest_run_thread_2 ends its own thread after calling it).
  resetDialogs(): void {
    if (this.windowOpen) {
      this.windowOpen = false;
      if (this.pendingMessage?.kind === 'window') this.pendingMessage = null;
      this.host.closeMessage?.('window');
    }
    if (this.questBoardOpen) {
      this.questBoardOpen = false;
      this.host.closeMessage?.('questBoard');
    }
  }

  // Answer a `list` prompt with the chosen index.
  answerList(index: number): void {
    if (!this.pendingList) return;
    this.pendingList = null;
    this.regsI[this.pendingListReg] = index;
    for (const t of this.threads) if (t.yieldReason === 'list') t.yieldReason = 'none';
  }

  // Runs every live thread until it yields. Call once per game frame.
  frame(): void {
    this.frameCount++;
    this.keywords.update();
    if (this.exited) return;
    if (this.autoAdvance) {
      if (this.pendingMessage) this.dismissMessage();
      if (this.pendingList) this.answerList(0);
      this.dismissBoard();
    }
    // A thread spawned during this frame runs in the same frame, as the exe's
    // object list walk does; the snapshot keeps the loop finite.
    for (let i = 0; i < this.threads.length; i++) {
      const t = this.threads[i];
      if (t.done) continue;
      this.runThread(t);
      if (this.exited) break;
    }
    const finished = this.threads.filter((t) => t.done);
    this.threads = this.threads.filter((t) => !t.done);
    for (const t of finished) {
      const cb = t.onDone;
      t.onDone = null;
      cb?.();
    }
  }

  runFrames(n: number): void {
    for (let i = 0; i < n && !this.exited; i++) this.frame();
  }

  private runThread(t: QuestThread): void {
    if (t.yieldReason === 'board' && t.runner === 2 && this.host.uiBlockingInput && !this.host.uiBlockingInput()) {
      // quest_run_thread_2: the player's UI let go of the controls (the menu
      // holding the quest board closed): the dialogs close and the thread ends.
      this.resetDialogs();
      t.done = true;
      return;
    }
    if (t.yieldReason === 'message' || t.yieldReason === 'list' || t.yieldReason === 'board' || t.yieldReason === 'host') return; // still waiting
    t.yieldReason = NO_YIELD;
    let steps = 0;
    for (;;) {
      if (t.yieldReason !== 'none' || t.done) break;
      if (++steps > MAX_STEPS_PER_FRAME) {
        this.log(`quest: thread ${t.id} ran ${steps} opcodes without a sync; stopping it`);
        t.done = true;
        return;
      }
      if (t.pc < this.bin.header.textOffset || t.pc >= this.codeEnd) {
        this.log(`quest: thread ${t.id} left the bytecode at 0x${t.pc.toString(16)}`);
        t.done = true;
        return;
      }
      const insn = decodeInstruction(this.bin.data, t.pc);
      t.pc += insn.size;
      this.execute(t, insn);
    }
    if (t.yieldReason === 'ret' || t.yieldReason === 'exit' || t.endAfterYield) t.done = true;
  }

  // --- argument access -------------------------------------------------------

  // Inline or arg-stack argument `i` of the instruction.
  private argsOf(t: QuestThread, insn: QuestInstruction): ArgValue[] {
    if (insn.def && insn.def.flags & F_ARGS) return t.argStack;
    return insn.args.map((a) => {
      if (a.arg.t === 'CSTRING' || a.arg.t === 'LABEL16_SET') return { kind: 'string' as const, value: a.value, text: a.text };
      if (a.arg.t === 'LABEL16' || a.arg.t === 'LABEL32') return { kind: 'label' as const, value: a.value };
      return { kind: 'int' as const, value: a.float !== undefined ? a.value : a.value };
    });
  }

  private int(a: ArgValue[], i: number): number {
    const v = a[i];
    return v ? v.value | 0 : 0;
  }

  private uint(a: ArgValue[], i: number): number {
    const v = a[i];
    return v ? v.value >>> 0 : 0;
  }

  // A register-number argument: pushed as a plain immediate by real quests,
  // or as &registers[n] by arg_pusha.
  private reg(a: ArgValue[], i: number): number {
    const v = a[i];
    if (!v) return 0;
    return v.value & 0xff;
  }

  private label(a: ArgValue[], i: number): number {
    const v = a[i];
    return v ? v.value & 0xffff : 0;
  }

  private str(a: ArgValue[], i: number): string {
    return a[i]?.text ?? '';
  }

  private floatArg(insn: QuestInstruction, i: number): number {
    const a = insn.args[i];
    return a?.float ?? 0;
  }

  // --- flags, counters -------------------------------------------------------

  // Quest flag bit order is MSB-first within each byte (newserv
  // PlayerSubordinates.hh FlagsArray::get).
  getFlag(flag: number): boolean {
    if (flag >= QUEST_NUM_FLAGS) return false;
    const external = this.host.getQuestFlag?.(flag);
    if (external !== undefined) return external;
    return !!(this.flags[flag >> 3] & (0x80 >> (flag & 7)));
  }

  setFlag(flag: number, set: boolean): void {
    if (flag >= QUEST_NUM_FLAGS) return;
    const mask = 0x80 >> (flag & 7);
    if (set) this.flags[flag >> 3] |= mask;
    else this.flags[flag >> 3] &= ~mask;
    // gset always sends 6x75; gclear only sends it on BB, which this is.
    this.host.setQuestFlag?.(flag, set);
  }

  // --- the opcode bodies -----------------------------------------------------

  private execute(t: QuestThread, insn: QuestInstruction): void {
    const def = insn.def;
    if (!def) {
      this.log(`quest: opcode ${insn.opcode.toString(16).toUpperCase()} at 0x${insn.offset.toString(16)} is not defined on BB; stopping thread ${t.id}`);
      t.done = true;
      return;
    }
    const name = def.name;
    const a = this.argsOf(t, insn);
    const R = this.regsI;
    const clearArgs = () => {
      if (def.flags & (F_ARGS | F_CLEAR_ARGS)) t.argStack = [];
    };

    switch (name) {
      // --- control flow ---
      case 'nop':
        return;
      case 'ret': {
        const back = t.callStack.pop();
        if (back === undefined) {
          t.yieldReason = 'ret';
          return;
        }
        t.pc = back;
        return;
      }
      case 'sync':
        t.yieldReason = 'sync';
        return;
      case 'exit':
        this.exitCode = this.int(a, 0);
        this.exited = true;
        t.yieldReason = 'exit';
        this.log(`quest: exit ${this.exitCode}`);
        return;
      case 'thread':
      case 'thread_stg':
        this.startThread(this.label(a, 0));
        return;
      case 'call': {
        const target = this.labelOffset(this.label(a, 0));
        if (target < 0) return;
        if (t.callStack.length >= QUEST_STACK_LIMIT) {
          this.log(`quest: call stack overflow in thread ${t.id}`);
          t.done = true;
          return;
        }
        t.callStack.push(t.pc);
        t.pc = target;
        clearArgs();
        return;
      }
      case 'jmp': {
        const target = this.labelOffset(this.label(a, 0));
        if (target >= 0) t.pc = target;
        return;
      }
      case 'jmp_on':
      case 'jmp_off': {
        // labelA, then a register set: jump when every register is nonzero
        // (jmp_on) or every one is zero (jmp_off).
        const regs = (insn.args[1]?.text ?? '').split(',').filter((s) => s.length).map((s) => Number(s) & 0xff);
        const on = name === 'jmp_on';
        const hit = regs.every((r) => (R[r] !== 0) === on);
        if (hit && regs.length) {
          const target = this.labelOffset(this.label(a, 0));
          if (target >= 0) t.pc = target;
        }
        return;
      }
      case 'switch_jmp':
      case 'switch_call': {
        const index = R[this.reg(a, 0)];
        const labels = (insn.args[1]?.text ?? '').split(',').filter((s) => s.length).map(Number);
        if (index < 0 || index >= labels.length) {
          clearArgs();
          return;
        }
        const target = this.labelOffset(labels[index]);
        if (target < 0) {
          clearArgs();
          return;
        }
        if (name === 'switch_call') {
          if (t.callStack.length >= QUEST_STACK_LIMIT) {
            this.log(`quest: call stack overflow in thread ${t.id}`);
            t.done = true;
            return;
          }
          t.callStack.push(t.pc);
        }
        t.pc = target;
        clearArgs();
        return;
      }
      case 'va_start':
        // Pushes r1-r7 (the exe shuttles them through the same stack array).
        for (let r = 1; r <= 7; r++) this.stack.push(R[r]);
        t.argStack = [];
        return;
      case 'va_end':
        for (let r = 7; r >= 1; r--) {
          const v = this.stack.pop();
          if (v !== undefined) R[r] = v;
        }
        return;
      case 'va_call': {
        // Replaces r1-r7 with the args list, then calls the label.
        for (let i = 0; i < 7; i++) R[i + 1] = i < t.argStack.length ? t.argStack[i].value | 0 : 0;
        const target = this.labelOffset(this.label(a, 0));
        t.argStack = [];
        if (target < 0) return;
        if (t.callStack.length >= QUEST_STACK_LIMIT) {
          this.log(`quest: call stack overflow in thread ${t.id}`);
          t.done = true;
          return;
        }
        t.callStack.push(t.pc);
        t.pc = target;
        return;
      }

      // --- arg stack ---
      case 'arg_pushr':
        t.argStack.push({ kind: 'int', value: R[this.reg(a, 0)] });
        return;
      case 'arg_pushl':
      case 'arg_pushb':
      case 'arg_pushw':
        t.argStack.push({ kind: 'int', value: this.uint(a, 0) });
        return;
      case 'arg_pusha':
        t.argStack.push({ kind: 'regAddr', value: this.reg(a, 0) });
        return;
      case 'arg_pusho':
        t.argStack.push({ kind: 'label', value: this.label(a, 0) });
        return;
      case 'arg_pushs':
        t.argStack.push({ kind: 'string', value: insn.args[0]?.value ?? 0, text: insn.args[0]?.text ?? '' });
        return;

      // --- registers ---
      case 'let':
        R[this.reg(a, 0)] = R[this.reg(a, 1)];
        return;
      case 'leti':
      case 'letb':
      case 'letw':
        R[this.reg(a, 0)] = this.int(a, 1);
        return;
      case 'leta':
      case 'leto':
        // The exe stores a real address here; a register index is the closest
        // thing this VM has, and nothing it implements dereferences it.
        R[this.reg(a, 0)] = this.int(a, 1);
        return;
      case 'set':
        R[this.reg(a, 0)] = 1;
        return;
      case 'clear':
        R[this.reg(a, 0)] = 0;
        return;
      case 'rev':
        R[this.reg(a, 0)] = R[this.reg(a, 0)] ? 0 : 1;
        return;
      case 'stack_push':
        this.stack.push(R[this.reg(a, 0)]);
        return;
      case 'stack_pop':
        R[this.reg(a, 0)] = this.stack.pop() ?? 0;
        return;
      case 'stack_pushm': {
        const base = this.reg(a, 0);
        const n = this.int(a, 1);
        for (let i = 0; i < n; i++) this.stack.push(R[(base + i) & 0xff]);
        return;
      }
      case 'stack_popm': {
        const base = this.reg(a, 0);
        const n = this.int(a, 1);
        for (let i = n - 1; i >= 0; i--) R[(base + i) & 0xff] = this.stack.pop() ?? 0;
        return;
      }
      case 'sync_register':
      case 'sync_register2': {
        const r = this.reg(a, 0);
        R[r] = this.int(a, 1);
        this.host.syncRegister?.(r, R[r]);
        clearArgs();
        return;
      }

      // --- integer arithmetic ---
      case 'add':
        R[this.reg(a, 0)] += R[this.reg(a, 1)];
        return;
      case 'addi':
        R[this.reg(a, 0)] += this.int(a, 1);
        return;
      case 'sub':
        R[this.reg(a, 0)] -= R[this.reg(a, 1)];
        return;
      case 'subi':
        R[this.reg(a, 0)] -= this.int(a, 1);
        return;
      case 'mul':
        R[this.reg(a, 0)] = Math.imul(R[this.reg(a, 0)], R[this.reg(a, 1)]);
        return;
      case 'muli':
        R[this.reg(a, 0)] = Math.imul(R[this.reg(a, 0)], this.int(a, 1));
        return;
      case 'div': {
        const d = R[this.reg(a, 1)];
        if (d) R[this.reg(a, 0)] = (R[this.reg(a, 0)] / d) | 0;
        return;
      }
      case 'divi': {
        const d = this.int(a, 1);
        if (d) R[this.reg(a, 0)] = (R[this.reg(a, 0)] / d) | 0;
        return;
      }
      case 'mod': {
        const d = R[this.reg(a, 1)];
        if (d) R[this.reg(a, 0)] = R[this.reg(a, 0)] % d;
        return;
      }
      case 'modi': {
        const d = this.int(a, 1);
        if (d) R[this.reg(a, 0)] = R[this.reg(a, 0)] % d;
        return;
      }
      case 'and':
        R[this.reg(a, 0)] &= R[this.reg(a, 1)];
        return;
      case 'andi':
        R[this.reg(a, 0)] &= this.int(a, 1);
        return;
      case 'or':
        R[this.reg(a, 0)] |= R[this.reg(a, 1)];
        return;
      case 'ori':
        R[this.reg(a, 0)] |= this.int(a, 1);
        return;
      case 'xor':
        R[this.reg(a, 0)] ^= R[this.reg(a, 1)];
        return;
      case 'xori':
        R[this.reg(a, 0)] ^= this.int(a, 1);
        return;

      // --- float arithmetic (the same registers, read as floats) ---
      case 'flet':
        this.regsF[this.reg(a, 0)] = this.regsF[this.reg(a, 1)];
        return;
      case 'fleti':
        this.regsF[this.reg(a, 0)] = this.floatArg(insn, 1);
        return;
      case 'fadd':
        this.regsF[this.reg(a, 0)] += this.regsF[this.reg(a, 1)];
        return;
      case 'faddi':
        this.regsF[this.reg(a, 0)] += this.floatArg(insn, 1);
        return;
      case 'fsub':
        this.regsF[this.reg(a, 0)] -= this.regsF[this.reg(a, 1)];
        return;
      case 'fsubi':
        this.regsF[this.reg(a, 0)] -= this.floatArg(insn, 1);
        return;
      case 'fmul':
        this.regsF[this.reg(a, 0)] *= this.regsF[this.reg(a, 1)];
        return;
      case 'fmuli':
        this.regsF[this.reg(a, 0)] *= this.floatArg(insn, 1);
        return;
      case 'fdiv': {
        const d = this.regsF[this.reg(a, 1)];
        if (d) this.regsF[this.reg(a, 0)] /= d;
        return;
      }
      case 'fdivi': {
        const d = this.floatArg(insn, 1);
        if (d) this.regsF[this.reg(a, 0)] /= d;
        return;
      }
      case 'dec2float':
        this.regsF[this.reg(a, 0)] = R[this.reg(a, 1)];
        return;
      case 'float2dec':
        R[this.reg(a, 0)] = Math.round(this.regsF[this.reg(a, 1)]);
        return;

      // --- comparisons (signed by default; the ujmp* family is unsigned) ---
      case 'jmp_eq':
      case 'jmpi_eq':
      case 'jmp_ne':
      case 'jmpi_ne':
      case 'jmp_gt':
      case 'jmpi_gt':
      case 'jmp_lt':
      case 'jmpi_lt':
      case 'jmp_ge':
      case 'jmpi_ge':
      case 'jmp_le':
      case 'jmpi_le':
      case 'ujmp_gt':
      case 'ujmpi_gt':
      case 'ujmp_lt':
      case 'ujmpi_lt':
      case 'ujmp_ge':
      case 'ujmpi_ge':
      case 'ujmp_le':
      case 'ujmpi_le': {
        const immediate = name.startsWith('jmpi') || name.startsWith('ujmpi');
        const unsigned = name.startsWith('u');
        const left = unsigned ? this.regsU[this.reg(a, 0)] : R[this.reg(a, 0)];
        const rightRaw = immediate ? this.int(a, 1) : R[this.reg(a, 1)];
        const right = unsigned ? rightRaw >>> 0 : rightRaw;
        const op = name.replace(/^u?jmpi?_/, '');
        const hit =
          op === 'eq' ? left === right
          : op === 'ne' ? left !== right
          : op === 'gt' ? left > right
          : op === 'lt' ? left < right
          : op === 'ge' ? left >= right
          : left <= right;
        if (hit) {
          const target = this.labelOffset(this.label(a, 2));
          if (target >= 0) t.pc = target;
        }
        return;
      }

      // --- quest flags (6x75) ---
      case 'gset':
        this.setFlag(this.uint(a, 0), true);
        return;
      case 'gclear':
        this.setFlag(this.uint(a, 0), false);
        return;
      case 'grev':
        this.setFlag(this.uint(a, 0), !this.getFlag(this.uint(a, 0)));
        return;
      case 'glet':
        this.setFlag(this.uint(a, 0), R[this.reg(a, 1)] !== 0);
        return;
      case 'gget':
        R[this.reg(a, 1)] = this.getFlag(this.uint(a, 0)) ? 1 : 0;
        return;

      // --- quest counters ---
      case 'read_counter': {
        const i = this.int(a, 0);
        R[this.reg(a, 1)] = i >= 0 && i < QUEST_NUM_COUNTERS ? this.counters[i] : 0;
        clearArgs();
        return;
      }
      case 'write_counter': {
        const i = this.int(a, 0);
        if (i >= 0 && i < QUEST_NUM_COUNTERS) this.counters[i] = this.int(a, 1);
        clearArgs();
        return;
      }

      // --- switch flags (6x05) ---
      case 'set_switch_flag_sync':
      case 'clear_switch_flag_sync': {
        const floor = this.int(a, 0);
        const flag = this.int(a, 1);
        this.host.setSwitchFlag?.(floor, flag, name === 'set_switch_flag_sync');
        clearArgs();
        return;
      }
      case 'read_switch_flag': {
        const base = this.reg(a, 0);
        R[(base + 1) & 0xff] = this.switchFlag(this.currentFloor, R[base]) ? 1 : 0;
        return;
      }
      case 'read_switch_flag_on_floor': {
        const base = this.reg(a, 0);
        R[(base + 2) & 0xff] = this.switchFlag(R[base], R[(base + 1) & 0xff]) ? 1 : 0;
        return;
      }

      // --- floors and maps ---
      case 'set_floor_handler': {
        const floor = this.int(a, 0);
        const label = this.label(a, 1);
        if (floor >= 0 && floor < QUEST_NUM_FLOORS) this.floorHandlers[floor] = label;
        clearArgs();
        return;
      }
      case 'clr_floor_handler': {
        const floor = this.int(a, 0);
        if (floor >= 0 && floor < QUEST_NUM_FLOORS) this.floorHandlers[floor] = -1;
        clearArgs();
        return;
      }
      case 'map_designate': {
        // regsA[0] = floor (and the area), [1] = type, [2] = major variation
        const base = this.reg(a, 0);
        const floor = R[base];
        this.designate({ floor, area: floor, type: R[(base + 1) & 0xff], layoutVar: R[(base + 2) & 0xff], entitiesVar: 0 });
        return;
      }
      case 'map_designate_ex': {
        const base = this.reg(a, 0);
        this.designate({
          floor: R[base],
          area: R[(base + 1) & 0xff],
          type: R[(base + 2) & 0xff],
          layoutVar: R[(base + 3) & 0xff],
          entitiesVar: R[(base + 4) & 0xff],
        });
        return;
      }
      case 'bb_map_designate':
        this.designate({ floor: this.int(a, 0), area: this.int(a, 1), type: this.int(a, 2), layoutVar: this.int(a, 3), entitiesVar: this.int(a, 4) });
        return;
      case 'set_episode': {
        const v = this.int(a, 0);
        this.episode = v === 1 ? 2 : v === 2 ? 4 : 1;
        // set_episode resets the floor configuration (newserv QuestScript.cc).
        this.designations.clear();
        return;
      }
      case 'set_mainwarp':
        this.mainwarpFloors.add(this.int(a, 0));
        this.host.mainwarpChanged?.(this.int(a, 0), true);
        clearArgs();
        return;
      case 'clear_mainwarp':
        this.mainwarpFloors.delete(this.int(a, 0));
        this.host.mainwarpChanged?.(this.int(a, 0), false);
        clearArgs();
        return;
      case 'go_floor': {
        const clientId = R[this.reg(a, 0)];
        const floor = R[this.reg(a, 1)];
        this.host.goFloor?.(clientId, floor);
        return;
      }

      // --- messages ---
      // The exe keeps three text outputs (opcode bodies .c:604091..604228):
      // the speech balloon of `message` (DisplayChatBubble_007184f8 over the
      // speaker: the NPC whose talk action is the id, or the player of that
      // client id), the window of `window_msg` (g_QuestDialogHandle1) and the
      // quest board text of `disp_msg_qb` (g_QuestDialogHandle2). add_msg
      // replaces the window's text when it is open, else adds to the quest
      // board, else speaks again as the last `message` speaker. message and
      // window pages wait for the button (yield window_msg__message__chat_box);
      // the quest board text waits for it too (disp_msg_qb__add_msg), without
      // locking the player (no UIState_SetLockedState_00717d68).
      case 'message': {
        this.lastMessageTarget = this.int(a, 0);
        this.pendingMessage = { kind: 'message', target: this.lastMessageTarget, pages: [this.str(a, 1)] };
        this.host.showMessage?.(this.pendingMessage);
        t.yieldReason = 'message';
        clearArgs();
        return;
      }
      case 'window_msg': {
        this.windowOpen = true;
        this.pendingMessage = { kind: 'window', pages: [this.str(a, 0)] };
        this.host.showMessage?.(this.pendingMessage);
        t.yieldReason = 'message';
        clearArgs();
        return;
      }
      case 'add_msg': {
        const page = this.str(a, 0);
        if (this.windowOpen) {
          this.pendingMessage = { kind: 'window', pages: [page] };
          this.host.showMessage?.(this.pendingMessage);
          t.yieldReason = 'message';
        } else if (this.questBoardOpen) {
          this.host.showMessage?.({ kind: 'questBoard', pages: [page], append: true });
          t.yieldReason = 'board';
        } else {
          this.pendingMessage = { kind: 'message', target: this.lastMessageTarget, pages: [page] };
          this.host.showMessage?.(this.pendingMessage);
          t.yieldReason = 'message';
        }
        clearArgs();
        return;
      }
      case 'message_end':
      case 'window_msg_end': {
        const kind = name === 'message_end' ? 'message' : 'window';
        if (kind === 'window') this.windowOpen = false;
        this.pendingMessage = null;
        this.host.closeMessage?.(kind, kind === 'message' ? this.lastMessageTarget : undefined);
        for (const other of this.threads) if (other.yieldReason === 'message') other.yieldReason = 'none';
        return;
      }
      case 'list': {
        this.pendingListReg = this.reg(a, 0);
        this.pendingList = this.str(a, 1).split('\n');
        this.host.showList?.(this.pendingList);
        t.yieldReason = 'list';
        clearArgs();
        return;
      }
      case 'disp_msg_qb': {
        // opcode_disp_msg_qb: a new text window at GUI 0x74, then the thread
        // waits for the decide key (disp_msg_qb__add_msg).
        this.questBoardOpen = true;
        this.host.showMessage?.({ kind: 'questBoard', pages: [this.str(a, 0)] });
        t.yieldReason = 'board';
        clearArgs();
        return;
      }
      case 'close_msg_qb':
        // opcode_close_msg_qb only closes g_QuestDialogHandle2: a thread
        // still in disp_msg_qb__add_msg keeps waiting for the decide key
        // (the runners read only the key), so it is not released here.
        this.questBoardOpen = false;
        this.host.closeMessage?.('questBoard');
        return;
      case 'set_quest_board_handler': {
        // The item only shows while its display register (r74 + index) is
        // not 0 (classic/questboard.ts).
        const index = this.int(a, 0);
        const item = { index, label: this.label(a, 1), name: this.str(a, 2) };
        const at = this.questBoard.findIndex((x) => x.index === index);
        if (at >= 0) this.questBoard[at] = item;
        else this.questBoard.push(item);
        this.host.questBoardChanged?.(this.questBoard);
        clearArgs();
        return;
      }
      case 'clear_quest_board_handler': {
        const index = this.int(a, 0);
        const at = this.questBoard.findIndex((x) => x.index === index);
        if (at >= 0) this.questBoard.splice(at, 1);
        this.host.questBoardChanged?.(this.questBoard);
        clearArgs();
        return;
      }

      // --- quest completion callbacks ---
      case 'set_qt_success':
        this.qtSuccess = this.label(a, 0);
        return;
      case 'set_qt_failure':
        this.qtFailure = this.label(a, 0);
        return;
      case 'set_qt_cancel':
        this.qtCancel = this.label(a, 0);
        return;
      case 'set_qt_exit':
        this.qtExit = this.label(a, 0);
        return;
      case 'clr_qt_success':
        this.qtSuccess = -1;
        return;
      case 'clr_qt_failure':
        this.qtFailure = -1;
        return;
      case 'clr_qt_cancel':
        this.qtCancel = -1;
        return;
      case 'clr_qt_exit':
        this.qtExit = -1;
        return;

      // --- NPCs and coordinate handlers ---
      case 'npc_crp':
      case 'npc_crptalk':
      case 'npc_crp_id': {
        const base = this.reg(a, 0);
        const r = (i: number) => R[(base + i) & 0xff];
        const npc: QuestNpcRequest =
          name === 'npc_crp_id'
            ? { clientId: r(5), position: [r(0), r(1), r(2)], angle: r(3), state: r(4), template: r(6), talk: false }
            : {
                clientId: name === 'npc_crptalk' ? 3 : 1,
                position: [r(0), r(1), r(2)],
                angle: r(3),
                state: r(4),
                template: r(5),
                talk: name === 'npc_crptalk',
              };
        this.npcs.push(npc);
        this.host.npcCreated?.(npc);
        this.log(`quest: ${name} client ${npc.clientId}, template ${npc.template}, state ${npc.state} at ${npc.position.join(',')}`);
        return;
      }
      case 'npc_play': {
        this.host.npcPlay?.(this.int(a, 0));
        clearArgs();
        return;
      }
      case 'npc_kill': {
        const id = this.int(a, 0);
        const at = this.npcs.findIndex((n) => n.clientId === id);
        if (at >= 0) this.npcs.splice(at, 1);
        this.host.npcKilled?.(id);
        clearArgs();
        return;
      }
      case 'at_coords_call':
      case 'at_coords_talk':
      case 'set_obj_param': {
        const base = this.reg(a, 0);
        const token = this.nextToken++;
        this.coordsHandlers.push({
          token,
          floor: this.currentFloor,
          position: [R[base], R[(base + 1) & 0xff], R[(base + 2) & 0xff]],
          radius: R[(base + 3) & 0xff],
          label: R[(base + 4) & 0xff],
          kind: name === 'at_coords_call' ? 'call' : name === 'at_coords_talk' ? 'talk' : 'object',
        });
        // Both families hand the token back: at_coords_* in regsA[0],
        // set_obj_param in its second register argument.
        if (name === 'set_obj_param') R[this.reg(a, 1)] = token;
        else R[base] = token;
        this.host.coordsChanged?.(this.coordsHandlers);
        return;
      }

      // --- player and game state ---
      case 'get_client_id':
        R[this.reg(a, 0)] = this.host.clientId?.() ?? 0;
        return;
      case 'get_difficulty_level_v1':
      case 'get_difficulty_level_v2': {
        const d = this.host.difficulty?.() ?? 0;
        // v1 reports Ultimate as 2 (newserv QuestScript.cc).
        R[this.reg(a, 0)] = name === 'get_difficulty_level_v1' ? Math.min(d, 2) : d;
        return;
      }
      case 'get_number_of_players':
        R[this.reg(a, 0)] = this.host.playerCount?.() ?? 1;
        return;
      case 'get_players_present': {
        const base = this.reg(a, 0);
        const present = this.host.playersPresent?.() ?? [true, false, false, false];
        for (let i = 0; i < 4; i++) R[(base + i) & 0xff] = present[i] ? 1 : 0;
        return;
      }
      case 'get_player_room': {
        const clientId = this.int(a, 0);
        const base = this.reg(a, 1);
        const floor = this.host.playerFloor?.(clientId);
        if (floor === undefined || floor < 0) {
          R[base] = -1;
          R[(base + 1) & 0xff] = -1;
        } else {
          R[base] = floor;
          R[(base + 1) & 0xff] = this.host.playerRoom?.(clientId) ?? 0;
        }
        clearArgs();
        return;
      }
      case 'get_coord_of_player': {
        const base = this.reg(a, 0);
        const p = this.host.playerPosition?.(R[this.reg(a, 1)]);
        R[base] = Math.round(p?.x ?? 0);
        R[(base + 1) & 0xff] = Math.round(p?.y ?? 0);
        R[(base + 2) & 0xff] = Math.round(p?.z ?? 0);
        return;
      }
      case 'get_player_state':
        R[this.reg(a, 1)] = this.host.playerState?.(R[this.reg(a, 0)]) ?? 1;
        return;
      case 'p_dead':
        R[this.reg(a, 0)] = this.host.playerDead?.(this.int(a, 1)) ? 1 : 0;
        clearArgs();
        return;
      case 'if_zone_clear': {
        const base = this.reg(a, 1);
        R[this.reg(a, 0)] = this.host.zoneCleared?.(R[base], R[(base + 1) & 0xff]) ? 1 : 0;
        return;
      }
      case 'gettime':
        // Seconds since 2000-01-01 00:00:00 (newserv QuestScript.cc).
        R[this.reg(a, 0)] = Math.floor((Date.now() - Date.UTC(2000, 0, 1)) / 1000) | 0;
        return;
      case 'get_random': {
        const base = this.reg(a, 0);
        const min = R[base];
        const max = R[(base + 1) & 0xff];
        const rand = this.host.random ?? Math.random;
        // rand() gives 15 bits, scaled to [0, max) then clamped to [min, max).
        const scaled = Math.floor(rand() * 0x8000 * (max / 0x8000));
        R[this.reg(a, 1)] = Math.max(min, Math.min(max - 1, scaled));
        return;
      }
      case 'set_player_start_position': {
        // valueA = client id, regsB[0..3] = x, y, z, angle. Where a player
        // actually appears is the TObjPlayerSet of the floor's set data
        // (render/gameview.ts); this records what the quest asked for.
        const base = this.reg(a, 1);
        const pos = { x: R[base], y: R[(base + 1) & 0xff], z: R[(base + 2) & 0xff], angle: R[(base + 3) & 0xff] };
        this.startPositions.set(this.int(a, 0), pos);
        this.host.teleport?.(this.int(a, 0), pos);
        clearArgs();
        return;
      }

      // --- floor and area bookkeeping ---
      case 'initial_floor':
        // The floor the players start on (not remapped, unlike
        // ba_initial_floor). 86 of the 167 BB quests use it.
        this.initialFloor = this.int(a, 0);
        clearArgs();
        return;
      case 'set_current_area_number':
        this.currentAreaNumber = this.int(a, 0);
        clearArgs();
        return;
      case 'set_area_total':
        this.areaTotal = this.int(a, 0);
        clearArgs();
        return;
      case 'set_area_title':
        this.areaTitle = this.str(a, 0);
        clearArgs();
        return;
      case 'override_warp_dest_floor':
        this.warpDestOverride = true;
        return;
      case 'restore_warp_dest_floor':
        this.warpDestOverride = false;
        return;

      // --- switch flags without a 6x05 ---
      case 'switch_on':
      case 'switch_off': {
        // These deliberately do not sync (newserv: "Does NOT send 6x05").
        const flag = this.int(a, 0);
        this.localSwitchFlags.set(flag, name === 'switch_on');
        clearArgs();
        return;
      }

      // --- NPC dialogue strings ---
      case 'npc_text': {
        // valueA = situation number, strB = what every NPC says in it.
        this.npcText.set(this.int(a, 0), this.str(a, 1));
        clearArgs();
        return;
      }
      case 'npc_text_id':
        // regA = client id, regB = situation, labelC = the string's label.
        // The text lives in a data label, which this VM does not read.
        this.npcText.set(R[this.reg(a, 1)], `<label ${this.label(a, 2)}>`);
        return;

      // --- more game state ---
      case 'chk_ene_num':
        R[this.reg(a, 0)] = this.host.enemiesKilled?.() ?? 0;
        return;
      case 'get_player_hp_tp': {
        const base = this.reg(a, 1);
        const hp = this.host.playerHpTp?.(this.int(a, 0));
        for (let i = 0; i < 4; i++) R[(base + i) & 0xff] = hp ? [hp.maxHp, hp.hp, hp.maxTp, hp.tp][i] : -1;
        clearArgs();
        return;
      }
      case 'set_ult_map':
      case 'unset_ult_map':
        // Overrides the floor's graphics (and the set data table, which is
        // SetDataTableUlti.rel in Episode 1 Ultimate) with the Ultimate ones.
        this.ultMap = name === 'set_ult_map';
        return;
      case 'enable_bosswarp_option':
      case 'disable_bosswarp_option':
        // Whether the Yes/No menu appears at a boss warp.
        this.bossWarpOption = name === 'enable_bosswarp_option';
        return;
      case 'dark_falz_is_dead':
        R[this.reg(a, 0)] = this.host.darkFalzDead?.() ? 1 : 0;
        return;
      case 'p_hpstat': {
        // regA = 1 when current_hp / max_hp < 1 / valueA for that client.
        // The client id is the second argument; the fraction's denominator is
        // the value already in regA (newserv's note on 0x69).
        const r = this.reg(a, 0);
        const hp = this.host.playerHpTp?.(this.int(a, 1));
        const denominator = R[r];
        R[r] = hp && denominator > 0 && hp.maxHp > 0 && hp.hp / hp.maxHp < 1 / denominator ? 1 : 0;
        clearArgs();
        return;
      }
      case 'npc_crptalk_id':
      case 'npc_crppk': {
        const base = this.reg(a, 0);
        const r = (i: number) => R[(base + i) & 0xff];
        const npc: QuestNpcRequest = {
          clientId: name === 'npc_crptalk_id' ? r(6) : 1,
          position: [r(0), r(1), r(2)],
          angle: r(3),
          state: r(4),
          template: r(5),
          talk: name === 'npc_crptalk_id',
        };
        this.npcs.push(npc);
        this.host.npcCreated?.(npc);
        return;
      }
      case 'construct_delayed_object':
      case 'construct_delayed_enemy': {
        // regsA[0] = floor, [1] = room, [2] = group (objects) / wave (enemies).
        const base = this.reg(a, 0);
        const floor = R[base];
        const room = R[(base + 1) & 0xff];
        const group = R[(base + 2) & 0xff];
        if (name === 'construct_delayed_object') this.host.constructObjects?.(floor, room, group);
        else this.host.constructEnemies?.(floor, room, group);
        return;
      }
      case 'get_game_version':
        // 4 on Xbox and BB (newserv QuestScript.cc).
        R[this.reg(a, 0)] = 4;
        return;
      case 'bb_p2_menu':
        this.host.p2Menu?.(this.int(a, 0));
        clearArgs();
        return;
      case 'bb_replace_item': {
        // The arguments are the two packed items (argItemBytes), the two
        // tokens (xored with the sender's slot, as the exe does) and the labels.
        const slot = this.host.clientId?.() ?? 0;
        this.host.momokaExchange?.({
          find: this.int(a, 0) >>> 0,
          replace: this.int(a, 1) >>> 0,
          token1: (this.int(a, 2) ^ slot) >>> 0,
          token2: (this.int(a, 3) ^ slot) >>> 0,
          label1: this.label(a, 4),
          label2: this.label(a, 5),
        });
        clearArgs();
        return;
      }
      case 'p_talk_guild':
        // CreateMedicalCenterDialog_006cafb8 for that player: the guild menu.
        if (this.int(a, 0) === (this.host.clientId?.() ?? 0)) this.host.p2Menu?.(4);
        clearArgs();
        return;
      case 'p_return_guild':
        this.host.returnToGuild?.();
        return;
      case 'pl_add_meseta':
        // Only the local player's own reward goes to the server (6xC9).
        if (this.int(a, 0) === (this.host.clientId?.() ?? 0)) this.host.addMeseta?.(this.int(a, 1));
        clearArgs();
        return;
      case 'pl_add_meseta2':
        this.host.addMeseta?.(this.int(a, 0));
        clearArgs();
        return;
      case 'update_switch_flag': {
        // regsA = switch flag, floor, flags (6x05); sent to everyone.
        const base = this.reg(a, 0);
        this.host.setSwitchFlag?.(R[(base + 1) & 0xff], R[base], (R[(base + 2) & 0xff] & 1) !== 0);
        return;
      }
      case 'del_obj_param': {
        const token = R[this.reg(a, 0)];
        const at = this.coordsHandlers.findIndex((h) => h.token === token);
        if (at >= 0) this.coordsHandlers.splice(at, 1);
        this.host.coordsChanged?.(this.coordsHandlers);
        return;
      }
      case 'shift_left':
        // opcode_shift_left (.c:608860): count masked to 5 bits.
        R[this.reg(a, 0)] = R[this.reg(a, 0)] << (R[this.reg(a, 1)] & 0x1f);
        return;
      case 'shift_right':
        // opcode_shift_right (.c:608870): arithmetic shift.
        R[this.reg(a, 0)] = R[this.reg(a, 0)] >> (R[this.reg(a, 1)] & 0x1f);
        return;
      case 'get_gender':
        // opcode_get_gender (.c:608085): regA = client id, regB = 0/1/2.
        R[this.reg(a, 1)] = this.host.playerGender?.(R[this.reg(a, 0)]) ?? 2;
        return;
      case 'find_inventory_item':
      case 'find_inventory_item_ex': {
        const base = this.reg(a, 0);
        const want = [0, 1, 2, 3].map((i) => R[(base + i) & 0xff]);
        R[this.reg(a, 1)] = findInventoryItem(this.host.inventoryItems?.() ?? [], want, name === 'find_inventory_item_ex') | 0;
        return;
      }
      case 'enable_keyword_detect':
        this.keywords.enable();
        return;
      case 'check_for_keyword':
        // opcode_Keyword (.c:611368): args are the result register, client id, string.
        R[this.reg(a, 0)] = this.keywords.check(this.int(a, 1), this.str(a, 2)) ? 1 : 0;
        clearArgs();
        return;
      case 'set_override_enemy_bp_index':
        this.bpEditIndex = this.int(a, 0);
        clearArgs();
        return;
      case 'set_enemy_physical_data':
      case 'set_enemy_attack_data':
      case 'set_enemy_resist_data':
      case 'set_enemy_movement_data': {
        // The label's data replaces the whole row (.c:608666..608822); an
        // index outside 0..0x5f is ignored (maybe_valid_bp_index).
        const kind = BP_OPCODES[name];
        const off = this.labelOffset(this.label(a, 0));
        const row = off < 0 ? null : readBattleParamRow(this.bin.data, off, kind);
        if (row && validBpIndex(this.bpEditIndex)) {
          this.bpOverrides.set(`${kind}:${this.bpEditIndex}`, row);
          this.host.overrideBattleParam?.(kind, this.bpEditIndex, row);
        }
        return;
      }
      case 'qexit':
        // A fade to black and out of the game, as a 6x73 would do.
        this.exited = true;
        t.yieldReason = 'exit';
        this.host.questExit?.();
        return;

      // --- Battle mode (quest/battle.ts) ---
      case 'ba_get_place':
      case 'ba_get_score': {
        // The exe indexes its sorted place table with the register's value.
        const r = this.host.battlePlace?.(R[this.reg(a, 0)]) ?? { place: 0, points: 0 };
        R[this.reg(a, 1)] = name === 'ba_get_place' ? r.place : r.points;
        return;
      }
      case 'get_ba_record': {
        const base = this.reg(a, 0);
        const rec = this.host.battleRecord?.() ?? [];
        for (let i = 0; i < 7; i++) R[(base + i) & 0xff] = rec[i] ?? 0;
        return;
      }
      // --- Challenge Mode (quest/cmode.ts; the opcodes' sources are cited there) ---
      case 'cmode_stage':
        this.cmode.setStage(this.uint(a, 0));
        clearArgs();
        return;
      case 'set_cmode_char_template':
        this.cmode.setTemplate(this.int(a, 0));
        clearArgs();
        return;
      case 'set_cmode_difficulty':
        this.cmode.setDifficulty(this.int(a, 0));
        clearArgs();
        return;
      case 'exp_multiplication': {
        const base = this.reg(a, 0);
        this.cmode.setExpMultiplier(R[base], R[(base + 1) & 0xff], R[(base + 2) & 0xff]);
        return;
      }
      case 'cmode_check_all_players_dead':
        R[this.reg(a, 0)] = this.cmode.allPlayersDead();
        return;
      case 'cmode_check_any_player_dead':
        R[this.reg(a, 0)] = this.cmode.anyPlayerDead();
        return;
      case 'nop_F821':
        // Consumes an item id (increment_item_id_for_player) and does nothing else.
        this.cmode.env.newItemId?.();
        return;
      case 'nop_F822':
        return;
      case 'get_num_kills':
        // opcode_get_num_kills: the player's kill count, 0 for an absent one.
        R[this.reg(a, 1)] = Math.min(999, this.cmode.env.kills?.(R[this.reg(a, 0)]) ?? 0);
        return;
      case 'reset_kills':
        this.cmode.env.resetKills?.(R[this.reg(a, 0)]);
        return;
      case 'set_cmode_base_time':
        this.cmode.setBaseTime(R[this.reg(a, 0)]);
        return;
      case 'set_cmode_rank_result':
        this.cmode.setRankResult(this.uint(a, 0), this.str(a, 1));
        clearArgs();
        return;
      case 'set_cmode_rank_override':
        this.cmode.addRankOverride(this.uint(a, 0), this.str(a, 1));
        clearArgs();
        return;
      case 'set_cmode_rank_threshold': {
        const base = this.reg(a, 0);
        R[this.reg(a, 1)] = this.cmode.setRankThreshold(R[base], R[(base + 1) & 0xff], R[(base + 2) & 0xff]);
        return;
      }
      case 'check_rank_time':
        R[this.reg(a, 1)] = this.cmode.checkRankTime(R[this.reg(a, 0)]);
        return;
      case 'item_create_cmode': {
        const base = this.reg(a, 0);
        R[this.reg(a, 1)] = this.cmode.createPrize(Array.from({ length: 6 }, (_, i) => R[(base + i) & 0xff]));
        return;
      }
      case 'award_item_select':
      case 'award_item_name':
      case 'award_item_ok': {
        // The exe yields until the window closes (quest_thread_yield_reason =
        // award_item_select / _name / _ok).
        const pending = name === 'award_item_select' ? this.cmode.selectAward() : name === 'award_item_name' ? this.cmode.nameAward() : this.cmode.confirmAward();
        if (pending) {
          t.yieldReason = 'host';
          const reg = name === 'award_item_ok' ? this.reg(a, 0) : -1;
          void pending.then((v) => {
            if (reg >= 0 && typeof v === 'number') R[reg] = v;
            if (t.yieldReason === 'host') t.yieldReason = 'none';
          });
        } else if (name === 'award_item_ok') {
          R[this.reg(a, 0)] = 0;
        }
        return;
      }
      case 'award_item_give':
        R[this.reg(a, 0)] = this.cmode.giveAward();
        return;
      case 'chl_set_timerecord':
        this.cmode.setTimeRecord(R[this.reg(a, 0)]);
        return;
      case 'chl_get_timerecord':
        R[this.reg(a, 0)] = this.cmode.getTimeRecord();
        return;
      case 'chl_set_min_time_online':
        this.cmode.setMinStageTime(R[this.reg(a, 0)]);
        return;
      case 'set_cmode_grave_rates': {
        const base = this.reg(a, 0);
        const num: number[] = [];
        const den: number[] = [];
        for (let i = 0; i < 10; i++) {
          num.push(R[(base + 2 * i) & 0xff]);
          den.push(R[(base + 2 * i + 1) & 0xff]);
        }
        this.cmode.setGraveRates(num, den);
        return;
      }
      case 'get_chl_retry_choice': {
        // opcode_disp_chl_retry_menu: the register is left alone while the
        // leader has not chosen (the quest polls it).
        const v = this.cmode.retryRegister;
        if (v !== null) R[this.reg(a, 0)] = v;
        return;
      }
      case 'chl_create_retry_menu':
        this.cmode.openRetryMenu();
        return;
      case 'disable_retry_menu':
        this.cmode.disableRetry();
        return;
      case 'chl_show_dead_player_list':
        this.cmode.showDeadList();
        return;
      case 'get_cmode_prize_rank':
        R[this.reg(a, 0)] = this.cmode.prizeRank();
        return;
      case 'is_there_grave_message':
        R[this.reg(a, 0)] = this.cmode.hasGraveMessage() ? 1 : 0;
        return;
      case 'reset_map':
        // opcode_reset_map (.c:608900): the registers go to 0, every quest
        // thread is flagged for removal (the running one finishes its turn
        // first), then the floors' state is cleared and the Challenge
        // bookkeeping with it (clear_unknown_challenge_object).
        R.fill(0);
        for (const o of this.threads) if (o !== t) o.done = true;
        t.endAfterYield = true;
        this.cmode.resetStage();
        this.host.resetMap?.();
        return;

      default:
        if (BATTLE_OPCODES.has(name)) {
          const ok = this.battle.apply(name, { arg: (i) => this.int(a, i), reg: (i) => this.reg(a, i), regs: R, text: (i) => this.str(a, i) });
          if (ok && name === 'ba_initial_floor' && this.battle.initialFloor !== null) {
            this.initialFloor = this.battle.initialFloor;
            this.host.battleFloor?.(this.battle.initialFloor);
          }
          if (ok && name === 'ba_start') this.host.battleStart?.(this.battle);
          clearArgs();
          return;
        }
        // Everything else: the arguments were decoded (so the PC is right) but
        // the body is not implemented. Accepted no-ops are not logged.
        if (!ACCEPTED_NO_OPS.has(name)) {
          const n = (this.unimplemented.get(name) ?? 0) + 1;
          this.unimplemented.set(name, n);
          if (n === 1) this.log(`quest: opcode ${name} is not implemented (skipped)`);
        }
        clearArgs();
        return;
    }
  }

  // A switch flag as the quest sees it: switch_on / switch_off keep a local
  // value that was never synced, so it wins over the shared state.
  switchFlag(floor: number, flag: number): boolean {
    const local = floor === this.currentFloor ? this.localSwitchFlags.get(flag) : undefined;
    return local ?? this.host.getSwitchFlag?.(floor, flag) ?? false;
  }

  private designate(d: QuestFloorDesignation): void {
    if (d.floor >= QUEST_NUM_FLOORS) return;
    // process_map_designate_v3_BB (PsoBB.exe .c:613155): type 1 and 3 only
    // record the mode, types 0 and 2 also set the map and its variations.
    this.designations.set(d.floor, d);
    this.host.mapDesignated?.(d.floor, d);
  }

  // Summary for the log / the debug console.
  summary(): string {
    const floors = [...this.designations.values()].sort((x, y) => x.floor - y.floor);
    const handlers = [...this.floorHandlers.entries()].filter(([, l]) => l >= 0).map(([f, l]) => `${f}:L${l}`);
    return (
      `episode ${this.episode}, ${floors.length} designated floors ` +
      `(${floors.map((f) => `${f.floor}->area ${f.area} type ${f.type} var ${f.layoutVar}/${f.entitiesVar}`).join('; ')}), ` +
      `handlers ${handlers.join(' ') || 'none'}, mainwarp ${[...this.mainwarpFloors].sort((x, y) => x - y).join(',') || 'none'}`
    );
  }
}

// Opcodes with no effect this client can model, but which must not be reported
// as missing: visual, audio, camera, HUD and input-lock opcodes. A quest's
// opening is full of them.
const ACCEPTED_NO_OPS = new Set([
  'p_action_disable', 'p_action_enable', 'hud_hide', 'hud_show', 'cine_enable', 'cine_disable',
  'fadein', 'fadeout', 'fadeout_all', 'cam_quake', 'cam_adj', 'cam_zmin', 'cam_zmout', 'cam_pan',
  'default_camera_pos1', 'default_camera_pos2', 'fleti_fixed_camera', 'fixed_camera_on', 'fixed_camera_off',
  'disable_movement1', 'disable_movement2', 'enable_movement1', 'enable_movement2',
  'bgm', 'sound_effect', 'sound_effect_pos', 'create_bgmctrl', 'turn_off_bgm_p2', 'turn_on_bgm_p2',
  'particle', 'particle2', 'particle_id', 'particle_pos', 'add_color_overlay', 'scroll_text',
  'chat_box', 'chat_bubble', 'npc_talk_on', 'npc_talk_off', 'npc_stop', 'npc_nont',
  'p_look_at', 'p_look', 'pl_walk', 'pl_walk_V3', 'p_disablewarp', 'p_enablewarp', 'warp_on', 'warp_off',
  'winset_time', 'window_time', 'winend_time', 'prevent_item_select', 'keyword_detect',
  'quest_name', 'set_area_title_number', 'mesend', 'nop',
  'set_bgm', 'show_timer', 'hide_timer', 'leti_fixed_camera', 'set_slot_invincible', 'set_slot_poison',
  'npc_param', 'enable_npc_visual', 'prepare_npc_visual', 'pl_pkoff', 'pl_pkon',
  'set_eventflag', 'movement_enable', 'movement_disable', 'reset_timer',
]);

export { ACCEPTED_NO_OPS };

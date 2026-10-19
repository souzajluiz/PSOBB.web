// Wave events of one floor, following PsoBB.exe (Ephinea 1.25.13). Pure logic
// (no three.js, no network) so it runs in Node tests; GameField wires the
// callbacks to the enemy layer, the switch flags and the 6x commands.
//
// Trigger (6x67, G_TriggerSetEvent: {entity, floor, event id, client id}):
//   - a TObjEvtCollision (o.dat type 0x0008, ctor FUN_00659ebc: radius =
//     param1 at +0xac, event id = param4 at +0xb0, inactive for 3 frames)
//     sends it when a local player steps within its radius, with its entity
//     id 0x4000 + object index;
//   - the trigger_event action (FUN_0080ce24) sends it with entity 0xFFFF.
//   FUN_008003e0 sends a subcommand AND runs its handler locally, so the
//   sender handles its own 6x67 too. The handler (FUN_00659f5c) calls
//   set_active_map_event_on_floor (0x0080d0b4) on the current floor: the FIRST
//   event with that id whose flag 2 is clear gets a handler object and
//   flags |= 6. For another floor it only sets flag 4 on every event with the
//   id (set_flag_for_map_event_on_floor); set_active_map_events builds their
//   handlers when that floor is entered.
// Handler (quest_event_handler_constructor, update_quest_event; vtable
// PTR_quest_event_handler_Vtbl):
//   state 0: if the event already has flag 0x10 -> state 2. The delay counter
//            (+0x28) counts down; when it goes negative, every e.dat entry with
//            the event's room and wave that is neither built (2) nor dead (8)
//            is constructed (unknown_enemy_spawn 0x00811188). Some built ->
//            state 1, none -> state 2.
//   state 1: when none of the wave's enemies is alive any more
//            (DerolleHasUninitializedSubordinate_00787f04 checks flag 8 of
//            their set entries) -> flags |= 0x10, state 2.
//   state 2: unless flag 8 is set: flags |= 8 and run the action stream; if it
//            triggered no further event (g_QuestEventResult == 0) the "room
//            unlocked" text is shown to players in the room. Then flags &= ~4
//            and the handler is destroyed, which clears flag 2.
// Actions that send (FUN_008003e0, i.e. sent and also applied locally):
//   set_switch_flag   -> 6x05 {entity 0xFFFF, flag, floor, flags 3 for the
//                        first set flag of the run (g_QuestEventInitialized,
//                        0x00aafde4), 1 after}
//   clear_switch_flag -> 6x05 with flags 0
//   trigger_event     -> 6x67 {entity 0xFFFF, floor, id, client id}
// Every client runs its own handlers, so in a party each client sends these;
// newserv forwards them and the duplicates are harmless.
//
// Battle music (FUN_0069821c -> FUN_008114b0): battle while some enemy of the
// player's room is built and not dead; after the last one dies the calm music
// comes back 90 frames (0x5a) later.

import type { WaveEvent } from '../formats/events.ts';

export const EVENT_HANDLER_BUILT = 0x02;
export const EVENT_ACTIVE = 0x04;
export const EVENT_ACTIONS_RUN = 0x08;
export const EVENT_ENEMIES_DEAD = 0x10;

export const ENEMY_BUILT = 0x02; // monster init data flags
export const ENEMY_DEAD = 0x08;

export const BATTLE_LINGER_FRAMES = 0x5a;

// The e.dat entry that owns floor-relative enemy slot `slot` (`first`: each
// entry's first slot, ascending), or -1.
export function setEntryForSlot(slot: number, first: readonly number[]): number {
  if (slot < 0) return -1;
  let lo = 0;
  let hi = first.length - 1;
  if (hi < 0 || slot < first[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (first[mid] <= slot) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Set types whose child slots are enemies that die on their own and send
// their own 6x76 (set_monster_spawn_initdata_as_dead, 0x008113e4): the
// Mothmant (MothmanProcessState_0051950c), the Pofuilly slimes, Hidoom /
// Migium, the Claws. Their entry is cleared by its own head: the Monest, the
// slime control (0x005956d4), the Pan Arms (0x00583a80 / 0x005822e4), the
// Bulclaw. Every other set (the bosses' parts and forms) keeps the old rule:
// any slot of the entry clears it.
export const OWN_KILL_CHILDREN: ReadonlySet<number> = new Set([0x42, 0x64, 0x65, 0xa7]);

// The entry a 6x76 on `slot` marks dead, or -1 (a child slot of an
// OWN_KILL_CHILDREN set). `types`: each entry's set type.
export function killedSetEntry(slot: number, first: readonly number[], types: readonly number[]): number {
  const index = setEntryForSlot(slot, first);
  if (index < 0) return -1;
  if (slot !== first[index] && OWN_KILL_CHILDREN.has(types[index] ?? -1)) return -1;
  return index;
}

export interface WaveEnemy {
  key: number; // set entry index on the floor
  room: number;
  wave: number;
  flags: number; // ENEMY_BUILT | ENEMY_DEAD
}

export interface WaveHooks {
  spawn(enemies: WaveEnemy[]): void; // make them visible / alive
  sendTrigger(eventId: number): void; // 6x67 with entity 0xFFFF
  sendSwitchFlag(flag: number, set: boolean, flags: number): void; // 6x05 with entity 0xFFFF
  setSwitchFlag(flag: number, set: boolean): void; // local switch flag
  constructObjects(room: number, group: number): void;
  roomCleared(room: number): void;
  log(msg: string): void;
}

interface Handler {
  event: WaveEvent;
  state: 0 | 1 | 2;
  delay: number;
  enemies: WaveEnemy[];
}

// Event and enemy state of one floor. Survives leaving the floor (the
// client keeps g_MapEventTablesArray and the monster init data for the whole
// game); call leave() / enter() around floor changes.
export class FloorWaves {
  readonly events: WaveEvent[];
  readonly flags: number[];
  readonly enemies: WaveEnemy[];
  private handlers: Handler[] = [];
  private present = false;
  hooks: WaveHooks;

  // `enemies` are the floor's e.dat entries in order; `section` is the room
  // id the event's `room` is matched against (the client compares the enemy's
  // spawn_section_number).
  constructor(events: WaveEvent[], enemies: Array<{ section: number; wave: number }>, hooks: WaveHooks) {
    this.events = events;
    this.flags = events.map(() => 0);
    this.enemies = enemies.map((e, key) => ({ key, room: e.section, wave: e.wave, flags: 0 }));
    this.hooks = hooks;
  }

  // The local player arrived on this floor: built enemies of the last visit
  // are gone (their objects were destroyed), so are the handlers; events that
  // are still active get new handlers (set_active_map_events).
  enter(): void {
    this.present = true;
    for (const e of this.enemies) e.flags &= ~ENEMY_BUILT;
    this.handlers = [];
    for (let i = 0; i < this.events.length; i++) this.flags[i] &= ~EVENT_HANDLER_BUILT;
    for (let i = 0; i < this.events.length; i++) {
      if (!(this.flags[i] & EVENT_HANDLER_BUILT) && this.flags[i] & EVENT_ACTIVE) this.build(i);
    }
  }

  leave(): void {
    this.present = false;
    this.handlers = [];
    for (let i = 0; i < this.events.length; i++) this.flags[i] &= ~EVENT_HANDLER_BUILT;
    for (const e of this.enemies) e.flags &= ~ENEMY_BUILT;
  }

  private build(i: number): void {
    const ev = this.events[i];
    this.flags[i] |= EVENT_HANDLER_BUILT | EVENT_ACTIVE;
    if (ev.type !== 1) return; // type 0 constructs nothing (handler table 0x00a11e24)
    this.handlers.push({ event: ev, state: 0, delay: ev.delay, enemies: [] });
  }

  // 6x67 for this floor (from the network or sent by us).
  trigger(eventId: number): boolean {
    if (!this.present) {
      let any = false;
      for (let i = 0; i < this.events.length; i++) {
        if (this.events[i].id === eventId) {
          this.flags[i] |= EVENT_ACTIVE;
          any = true;
        }
      }
      return any;
    }
    const i = this.events.findIndex((e, k) => e.id === eventId && !(this.flags[k] & EVENT_HANDLER_BUILT));
    if (i < 0) return false;
    this.build(i);
    return true;
  }

  // Enemy `key` (set entry index on this floor) was defeated, here or by
  // another client (6x76 with flag 8).
  kill(key: number): void {
    const e = this.enemies[key];
    if (e) e.flags |= ENEMY_DEAD;
  }

  // One game frame (30/s).
  frame(): void {
    if (!this.present) return;
    for (const h of [...this.handlers]) this.step(h);
  }

  private step(h: Handler): void {
    const i = h.event.index;
    if (h.state === 0) {
      if (this.flags[i] & EVENT_ENEMIES_DEAD) h.state = 2;
      h.delay--;
      if (h.delay < 0) {
        const spawn = this.enemies.filter((e) => e.room === h.event.room && e.wave === h.event.wave && !(e.flags & (ENEMY_BUILT | ENEMY_DEAD)));
        for (const e of spawn) e.flags |= ENEMY_BUILT;
        h.enemies = spawn;
        if (spawn.length) this.hooks.spawn(spawn);
        h.state = spawn.length ? 1 : 2;
      }
    } else if (h.state === 1) {
      if (h.enemies.every((e) => e.flags & ENEMY_DEAD)) {
        this.flags[i] |= EVENT_ENEMIES_DEAD;
        h.state = 2;
      }
    } else {
      if (!(this.flags[i] & EVENT_ACTIONS_RUN)) {
        this.flags[i] |= EVENT_ACTIONS_RUN;
        const triggered = this.run(h.event);
        if (!triggered) this.hooks.roomCleared(h.event.room);
      }
      this.flags[i] &= ~EVENT_ACTIVE;
      this.flags[i] &= ~EVENT_HANDLER_BUILT;
      this.handlers.splice(this.handlers.indexOf(h), 1);
    }
  }

  // ProcessQuestEventCommands_0080cc44; returns whether an event was triggered.
  private run(ev: WaveEvent): boolean {
    let first = true; // g_QuestEventInitialized
    let triggered = false;
    for (const a of ev.actions) {
      switch (a.op) {
        case 'setSwitchFlag':
          this.hooks.sendSwitchFlag(a.flag, true, first ? 3 : 1);
          this.hooks.setSwitchFlag(a.flag, true);
          first = false;
          break;
        case 'clearSwitchFlag':
          this.hooks.sendSwitchFlag(a.flag, false, 0);
          this.hooks.setSwitchFlag(a.flag, false);
          break;
        case 'triggerEvent':
          triggered = true;
          this.hooks.sendTrigger(a.eventId);
          this.trigger(a.eventId);
          break;
        case 'constructEnemies': {
          const spawn = this.enemies.filter((e) => e.room === a.room && e.wave === a.wave && !(e.flags & (ENEMY_BUILT | ENEMY_DEAD)));
          for (const e of spawn) e.flags |= ENEMY_BUILT;
          if (spawn.length) this.hooks.spawn(spawn);
          break;
        }
        case 'constructObjects':
          this.hooks.constructObjects(a.room, a.group);
          break;
        default:
          break;
      }
    }
    return triggered;
  }

  // Makes a room's wave appear now: the same work as an action stream's
  // construct_enemies (0x09 / 0x0D), reached from the quest opcode
  // construct_delayed_enemy (0x8B) too.
  constructEnemies(room: number, wave: number): void {
    const spawn = this.enemies.filter((e) => e.room === room && e.wave === wave && !(e.flags & (ENEMY_BUILT | ENEMY_DEAD)));
    for (const e of spawn) e.flags |= ENEMY_BUILT;
    if (spawn.length) this.hooks.spawn(spawn);
  }

  // Events whose wave is running (handler built and enemies spawned or due).
  activeEvents(): WaveEvent[] {
    return this.handlers.map((h) => h.event);
  }

  // FUN_008114b0 == 0: some enemy of `room` is built and alive.
  battleIn(room: number): boolean {
    return this.enemies.some((e) => e.room === room && e.flags & ENEMY_BUILT && !(e.flags & ENEMY_DEAD));
  }

  // Alive, built enemies (for the debug kill command).
  aliveEnemies(): WaveEnemy[] {
    return this.enemies.filter((e) => e.flags & ENEMY_BUILT && !(e.flags & ENEMY_DEAD));
  }
}

// Boss warp (TObjWarpBoss, create FUN_0066c4b4): the transporter that takes
// the whole party to a boss arena. Decoded from PsoBB.exe (Ephinea 1.25.13).
//
// Unlike an area warp it does not warp the player who steps in: it asks, then
// gathers everyone, then warps whoever is standing in it. The object has a
// state at +0xE0 (what 6x6A carries, newserv G_SetBossWarpState_6x6A), the
// state it is currently running at +0xE2 and a substate at +0xE4. Its update
// (the base object update around 0x0066a9xx) notices a state change:
//
//   if ((+0xE6 & 1) == 0 && +0xE0 != +0xE2) {
//     if (+0xE4 != -1) { +0xE4 = -1; dispatch(); }  // let the old state clean up
//     +0xE2 = +0xE0; +0xE4 = 0;                     // restart at substate 0
//   }
//
// so a 6x6A restarts the new state at substate 0, and the window handlers read
// +0xE2 (0 = still asking, so the question; 1 = gathering, so the notice).
// One handler per state:
//
//   state 0  idle / confirmation   0x0066b9e0
//     sub 0  -> sub 1
//     sub 1  the local player is inside the radius (+0xAC, 19.0) and the warp
//            is not disabled: open the Yes/No window (unitxt group 11 string
//            0x54, GUI position 0x38, width 368.0, cursor on "No") and the
//            player list (GUI position 0x36) with one row per player of the
//            game, ticked for every player already at the warp (+0x1A8[i]);
//            report this player (0x0064cc10) and -> sub 2. Outside the radius
//            both windows close.
//     sub 2  the list is refreshed every frame (a player whose movement is
//            disabled is drawn in 0xFFFFFF00 instead of 0xFFF0F0F0). "Yes"
//            sends 6x6A state 1 and -> sub 5, "No", a cancel or leaving the
//            radius -> sub 3. Independently, the floor leader sends 6x6A
//            state 2 as soon as all four players are on this floor inside the
//            radius (g_SeabedTuriganeEventActive_009c9558, 1 in the image and
//            cleared by the quest opcode warp_off).
//     sub 3  disable the local player's movement (0x0064bef4) -> sub 4
//     sub 4  back to sub 1 when the player leaves the radius; the leader still
//            sends 6x6A state 2 once everyone is inside.
//     sub 5  waiting for the 6x6A that moves the state on.
//   state 1  gather players         0x0066b5f8
//     sub 0  timer (+0x1C4) = 300 frames, sound effect 6 at the warp -> sub 1
//     sub 1  same windows as state 0 (string 0x55, "the transporter was
//            activated", once this player has confirmed), report this player
//            once; the leader counts the timer down and sends 6x6A state 2
//            when it runs out or when everyone is inside the radius -> sub 2
//   state 2  warp                   0x0066b4fc
//     sub 0  timer (+0x1E0) = 0x96 frames, warp animation -> sub 1
//     sub 1  offline: the local player inside the radius is warped at once
//            (movement disabled first); the timer runs out -> sub 2
//     sub 2  state = 3
//   state 3  destination occupied    0x0066b370
//     sub 1  while someone is inside the radius, a one-line window (string
//            0x53, "battle going on in the next area", GUI position 0x37);
//            state = 0 once the destination is free (+0x1C0 == 0)
//   state 4  locked until a switch flag is set (newserv; the object skips the
//            flag check on Pioneer 2, FUN_0066c838)
//
// The web client has no boss fight running in the destination, so state 3 is
// only entered when a 6x6A says so.

export type BossWarpState = 0 | 1 | 2 | 3 | 4;

export const BOSS_WARP_RADIUS = 19; // +0xAC (FUN_0066c4b4)
export const GATHER_FRAMES = 300; // +0x1C4, state 1 substate 0
export const WARP_FRAMES = 0x96; // +0x1E0, state 2 substate 0
export const GATHER_SOUND = 6; // play_directional_sound_effect(6, warp, 0, 0)
// unitxt group 11.
export const TEXT_OCCUPIED = 0x53;
export const TEXT_CONFIRM = 0x54;
export const TEXT_ACTIVATED = 0x55;
// GUI position table 0x00971f40: 0x36 the player list, 0x37 the one-line
// message, 0x38 the Yes/No window.
export const POS_PLAYER_LIST = [17, 224] as const;
export const POS_MESSAGE = [228, 224] as const;
export const POS_CONFIRM = [244, 224] as const;
export const CONFIRM_WIDTH = 368; // YesNoListMenu_Construct_0073ce70(.., 368.0)

// What one frame of the machine wants from the world.
export interface BossWarpHost {
  inRadius(): boolean; // the local player is inside the warp
  gathered(): boolean; // every player of the game is on this floor, inside it
  isLeader(): boolean; // this client runs the floor
  partySize(): number; // players in the game
  // Opens the confirmation and the player list (null closes them). `confirm`
  // true draws the Yes/No items, false only the notice.
  windows(text: number | null, confirm: boolean): void;
  send(state: BossWarpState): void; // 6x6A for this warp object
  warp(): void; // warp the local player to the destination floor
  sound(id: number): void;
  log(msg: string): void;
}

export class BossWarp {
  state: BossWarpState = 0;
  sub = 0;
  timer = 0;
  // +0x1D4: this player has been reported to the others.
  reported = false;
  // The menu's answer, set by answer(): true = Yes, false = No / cancel.
  private answered: boolean | null = null;

  // The windows show the question while the warp is still asking (+0xE2 == 0)
  // and the "transporter activated" notice once it is gathering.
  private get question(): boolean {
    return this.state === 0;
  }

  // A 6x6A arrived (or this client sent one): the state restarts at substate 0.
  receive(state: BossWarpState): void {
    if (state === this.state) return;
    this.state = state;
    this.sub = 0;
    this.answered = null;
    if (state === 0) this.reported = false;
  }

  // The confirmation closed.
  answer(yes: boolean): void {
    this.answered = yes;
  }

  // One game tick (30 per second).
  frame(host: BossWarpHost): void {
    switch (this.state) {
      case 0:
        return this.idle(host);
      case 1:
        return this.gather(host);
      case 2:
        return this.warp(host);
      case 3:
        return this.occupied(host);
      default:
        return;
    }
  }

  // The leader's "everybody is here" check, shared by states 0 and 1. The
  // substate is set before the packet goes out because send() also runs this
  // client's own handler (the state restarts at substate 0), just as
  // checked_call_packet0x60_subcommand does in the client.
  //
  // DEVIATION (marked): in state 0 the client runs this check for a leader
  // whose party is already complete, which in a one-player online game is true
  // on the frame the question opens, so the warp fires before the player can
  // answer it. Here it needs a party of two or more, so a lone player always
  // answers the question; from state 1 on (someone did accept) the rule is the
  // client's.
  private leaderWarp(host: BossWarpHost, waiting: number, needParty = false): boolean {
    if (!host.isLeader() || !host.gathered()) return false;
    if (needParty && host.partySize() < 2) return false;
    this.sub = waiting;
    host.send(2);
    return true;
  }

  private idle(host: BossWarpHost): void {
    if (this.sub === 0) {
      this.sub = 1;
      return;
    }
    if (this.sub === 1) {
      if (!host.inRadius()) {
        host.windows(null, false);
        return;
      }
      host.windows(this.question ? TEXT_CONFIRM : TEXT_ACTIVATED, this.question);
      this.reported = true;
      this.sub = 2;
      return;
    }
    if (this.sub === 2) {
      if (!host.inRadius()) {
        this.sub = 3;
        return;
      }
      if (this.answered === true) {
        this.answered = null;
        this.sub = 5;
        host.send(1);
        return;
      }
      if (this.answered === false) {
        this.answered = null;
        this.sub = 3;
        return;
      }
      this.leaderWarp(host, 5, true);
      return;
    }
    if (this.sub === 3) {
      host.windows(null, false);
      this.sub = 4;
      return;
    }
    if (this.sub === 4) {
      if (!host.inRadius()) {
        this.sub = 1;
        return;
      }
      this.leaderWarp(host, 5, true);
    }
  }

  private gather(host: BossWarpHost): void {
    if (this.sub === 0) {
      this.timer = GATHER_FRAMES;
      host.sound(GATHER_SOUND);
      host.log('boss warp: gathering players');
      this.sub = 1;
      return;
    }
    if (this.sub !== 1) return;
    if (host.inRadius()) {
      host.windows(this.question ? TEXT_CONFIRM : TEXT_ACTIVATED, this.question);
      if (!this.reported) this.reported = true;
    } else {
      host.windows(null, false);
    }
    this.timer--;
    if (!host.isLeader()) return;
    if (this.timer > 0 && !host.gathered()) return;
    this.sub = 2;
    host.send(2);
  }

  private warp(host: BossWarpHost): void {
    if (this.sub === 0) {
      this.timer = WARP_FRAMES;
      host.windows(null, false);
      host.log('boss warp: warping');
      this.sub = 1;
      return;
    }
    if (this.sub !== 1) {
      if (this.sub === 2) this.receive(3);
      return;
    }
    // The client only warps the local player here when the game is offline;
    // online the server moves everyone with the 6x6A. This client always
    // drives its own floor change, so it warps when it is inside the radius.
    if (host.inRadius()) {
      host.warp();
      this.sub = 2;
      return;
    }
    if (--this.timer <= 0) this.sub = 2;
  }

  private occupied(host: BossWarpHost): void {
    if (this.sub === 0) {
      this.sub = 1;
      return;
    }
    host.windows(host.inRadius() ? TEXT_OCCUPIED : null, false);
  }
}

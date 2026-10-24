// The exe's g_GuildCardFlags (a u16 global), as far as the list window position reads it.
//
// unknown_soccer_scoreboard_positioning (dump 734415, called by ListWindowObject_Constructor_00760f78
// for the quest timer window, CreateQuestWindowTimeObject_00760f42): GUI 0x24 when
// (flags & 7) == 0, GUI 0xb9 otherwise; GUI 0xba when the window's own flag 0x1 is set (the timer
// clears it in UpdateWindowPositionForText_00761040 right after the constructor, so 0xba never
// applies to the timer).
//
// The bits that positioning reads, and the exe sites that set and clear them (dump line numbers):
//   0x1  Entity_CopyFrom_00813930 path (dump 831514, under the 0x17 handler label 0x0081384c);
//        ClearEntityFlags_008139a4 (831541) clears it. The port has no entity records, so it is
//        never set here (ASSUMED: the reference state did not carry it).
//   0x2  handle_packet0x60_subcommand0x6 (dump 758219): a valid 6x06 guild card that is not an
//        update of a card the exe's list already holds (HandleGuildCardUpdate_00781acc returns 0,
//        dump 758294; ASSUMED from its loop). Cleared by QuickMenuObject_CloseGuildCardMenu_00717d10
//        (dump 678948), the card menu's close.
//   0x4  GuildCardList_AddOrMoveToFront_00827f58 (dump 841429), the packet 0x18 handler (table
//        entry 0x18 at dump 776274). Each add sets it. ResetGuildCardList_00828888 (841942) clears
//        it (no caller traced; the port clears it with the session's card book).
//   0x8  trade (0xa6), 0x10 team flag, 0x20 / 0x40 / 0x80 menus: not read by positioning.
export const GCF_ENTITY = 0x1;
export const GCF_CARD_RECEIVED = 0x2;
export const GCF_LIST_ADD = 0x4;

const POSITION_MASK = 0x7;

// The GUI table entries the timer window uses (0x00971f40, 8 bytes per index).
export const GUI_TIMER_NORMAL = 0x24; // (254, 37)
export const GUI_TIMER_GUILD_FLAGS = 0xb9; // (366, 37), the reference's position
export const GUI_POSITION: Readonly<Record<number, { x: number; y: number }>> = {
  [GUI_TIMER_NORMAL]: { x: 254, y: 37 },
  [GUI_TIMER_GUILD_FLAGS]: { x: 366, y: 37 },
};

export class GuildCardFlagWord {
  private bits = 0;

  get value(): number {
    return this.bits;
  }

  set(bit: number): void {
    this.bits = (this.bits | bit) & 0xffff;
  }

  clear(bit: number): void {
    this.bits = this.bits & ~bit & 0xffff;
  }

  reset(): void {
    this.bits = 0;
  }

  // The GUI index unknown_soccer_scoreboard_positioning picks for the window flag clear (0x1 clear).
  positionGuiIndex(): number {
    return (this.bits & POSITION_MASK) === 0 ? GUI_TIMER_NORMAL : GUI_TIMER_GUILD_FLAGS;
  }
}

// The one g_GuildCardFlags of this client (the exe's global).
export const guildCardFlags = new GuildCardFlagWord();

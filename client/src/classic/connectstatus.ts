// The logic of the title's "Connecting.." object, which the dump and
// psobb-client-source call GameListMenuObject (constructor 0x00407bf0, update
// 0x00407c6c / 0x00407f6c, status text 0x004080ac). It has nothing to do with a
// game list: it is the modal "Connecting.." overlay of FUN_007bd97c
// (classic/connecting.ts draws it).
//
// Matching C in psobb-client-source/src, by what each function does:
//   FUN_004081ff  RenderStatusText case 0: empty
//   FUN_0040816f  case 4:      FUN_007ac348(23, 331, FUN_00793e34(0x36, 4))
//   FUN_00408152  case 5:      ... (0x36, 5)
//   FUN_00408135  case 6:      ... (0x36, 6)
//   FUN_00408118  case 7:      ... (0x36, 9)
//   FUN_004080fb  cases 8, 10: ... (0x36, 0xc)
//   FUN_004080de  case 9:      ... (0x36, 0xe)
//   FUN_004080c1  case 0xc:    ... (0x36, 0x14)
// (FUN_007ac348 is the game text draw, FUN_00793e34 the unitxt lookup), which
// is the same table as the Ephinea switch, whose other arms are 1 -> 1,
// 2 -> 2, 3 and 0xb -> 3, and every other value -> 0xd.
// GameListMenuGetState (JP FUN_00409c78) returns the global DAT_00a388c4;
// ResetGameListMenuEntryFields (FUN_00414b60) zeroes four dwords at +0x838,
// SetGameListMenuEntryText (FUN_004153a0) clears 0x100 bytes at +0x13c and
// copies up to 0x7f characters, TerminateGameListMenuAll (FUN_00405760) is a
// `call FUN_00404a34`, and ProcessGameListMenuUpdate (FUN_004149fc) stores the
// floats 1.0, 8.0 and 1.5: none of them belongs to a game list.
//
// The unitxt group 0x36 texts are the Xbox Live errors of the console port
// ("(No.300) Your Xbox console cannot connect to Xbox Live.." ...), so the web
// client keeps showing the bridge's own message and only uses the position.

// Where every status text is drawn (23.0 / 331.0 in the C above).
export const STATUS_POS = { x: 23, y: 331 } as const;
export const STATUS_GROUP = 0x36;
// State 2 waits this many frames (counter +0x28 > 0x96) before state 3.
export const RESULT_WAIT_FRAMES = 0x96;
// The default arm of the switch.
export const STATUS_DEFAULT = 0xd;

// GameListMenuObject_RenderStatusText_004080ac: the unitxt index of a sub
// state (the object's +0x24), or null for none (case 0).
export function statusTextIndex(sub: number): number | null {
  switch (sub) {
    case 0:
      return null;
    case 1:
    case 2:
    case 4:
    case 5:
    case 6:
      return sub;
    case 3:
    case 0xb:
      return 3;
    case 7:
      return 9;
    case 8:
    case 10:
      return 0xc;
    case 9:
      return 0xe;
    case 0xc:
      return 0x14;
    default:
      return STATUS_DEFAULT;
  }
}

// The panel the object can draw (GameListMenuDrawPanel 0x00407fd8): a fan of
// four vertices of colour 0x8f000000 and blend mode 0x60, drawn while bit 0 of
// +0x2c is set by two callers with size 0x008f8eac = (640, 84) at 0x008f8ea4 =
// (0, 28) and 0x008f8ebc = (640, 136) at 0x008f8eb4 = (0, 310). Nothing in the
// exe sets that bit, so the panels stay hidden; they are listed for the
// record.
export const PANELS = [
  { x: 0, y: 28, w: 640, h: 84 },
  { x: 0, y: 310, w: 640, h: 136 },
] as const;
export const PANEL_COLOR = 0x8f000000;

// login_loading_status (get_login_loading_status): what the modal loop
// returns once the object is done.
export const LOGIN_STATUS = { ok: 0, retry: 1, cancel: 2, connected: 3 } as const;

export type ConnectState = 0 | 1 | 2 | 3 | 4;

// GameListMenuObjectStateMachine (0x00407c6c): 0 -> 1, state 1 waits for
// GameListMenuSetSubParameter (state := 2, sub := param), state 2 counts
// 0x96 frames, state 3 reacts to the confirm (Enter or Tab, bits 0xc and
// 0x15) and cancel (Escape, bit 0xd) keys per sub state, state 4 destroys the
// object. `login_loading_status` is the result.
export class ConnectObject {
  state: ConnectState = 0;
  sub = 0; // +0x24
  frame = 0; // +0x28
  status: number = LOGIN_STATUS.ok;
  // SetGameListMenuObjectProperties_007a630c(0xaab384, n, 0, 0, 0): the
  // follow-up the exe's own menu is told, recorded for the caller.
  properties: number | null = null;

  // GameListMenuSetSubParameter_00408200.
  setSub(sub: number): void {
    this.state = 2;
    this.sub = sub;
  }

  tick(confirm: boolean, cancel: boolean): void {
    if (this.state === 0) this.state = 1;
    else if (this.state === 2) {
      if (this.frame > RESULT_WAIT_FRAMES) this.state = 3;
    } else if (this.state === 3) this.react(confirm, cancel);
    else if (this.state === 4) return;
    this.frame++;
  }

  private done(status: number, properties: number | null = null): void {
    this.status = status;
    this.state = 4;
    if (properties !== null) this.properties = properties;
  }

  private react(confirm: boolean, cancel: boolean): void {
    switch (this.sub) {
      case 0:
        this.state = 4;
        break;
      case 4:
        if (confirm) this.done(LOGIN_STATUS.cancel);
        break;
      case 5:
        if (confirm) this.done(LOGIN_STATUS.retry);
        else if (cancel) this.done(LOGIN_STATUS.cancel);
        break;
      case 6:
        if (confirm) this.done(LOGIN_STATUS.connected, 0);
        else if (cancel) this.done(LOGIN_STATUS.cancel);
        break;
      case 7:
        if (confirm) this.done(LOGIN_STATUS.connected, 2);
        else if (cancel) this.done(LOGIN_STATUS.ok);
        break;
      case 8:
      case 10:
        if (confirm) this.done(LOGIN_STATUS.connected, 8);
        break;
      case 9:
      case 0xb:
      case 0xc:
        if (confirm) this.done(LOGIN_STATUS.cancel);
        break;
      default:
        // 1, 2, 3 and everything above 0xc.
        if (confirm) this.done(LOGIN_STATUS.connected, 6);
        else if (cancel) this.done(LOGIN_STATUS.cancel);
    }
  }
}

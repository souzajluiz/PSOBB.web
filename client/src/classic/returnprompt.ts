// The dead prompt: "Do you wish to / return to / Pioneer 2?" with Yes / No,
// asked once the death fade is over (PsoBB.exe, Ephinea 1.25.13).
//
// The chain (VAs, dump names from psobb-client-source):
//   handle_input_state_dead (HandlePlayerInputAndState_0069e458): the death
//     motion, then the death fade. The fade's callback (the countdown helper,
//     p2_return_to_med_helper_constructor with function 0x006920ac) runs at
//     alpha 128. 0x006920ac, on a field (not battle, not quest, not offline),
//     creates the dialog (CreateChallengeEntity_00692510: the object at
//     player+0x378, only for player+0x32c == 1) and then sends the 0x60
//     subcommand HandlePacket0x60SubcommandWithStateCheck_0069acd4, which is the
//     6x4E revivable marker (combat/playerdamage.ts; ASSUMED from newserv).
//   DialogListItem_Constructor_0073f0ec: YesNoListMenu_Construct with
//     unitxt(11, 0x56) as the question at get_gui_position(0x25) = (17, 306)
//     (table 0x00971f40 + 8 * 0x25: 0x00972068 = 17.0, 0x0097206c = 306.0),
//     width 206 (literal), the cursor on index 1 (No).
//   DialogListItem_Update_0073f1d4: the dialog closes when the player is no
//     longer dead (a Reverser / Moon Atomizer revived them) or on No. Yes
//     starts the loading screen (LoadingScreen_Callback_0073f410), which runs
//     return_to_p2_maybe: the 6x21 floor change to Pioneer 2 (floor 0), the
//     respawn state and the floor load. The rows are unitxt(11, 0x6e) "YES" /
//     (11, 0x6f) "NO" in the English set ("Yes" / "No" in JP).
//
// The question is the teammenu.ts Question (YesNoListMenu: a text window and a
// Yes / No list at the right bottom, Enter decides, Backspace is No).

import { Question } from './teammenu.ts';
import type { MenuKey } from './gamelist.ts';
import type { WindowSkin } from './stage.ts';

// unitxt group 11 indices.
export const RETURN_TEXT = 0x56; // "Do you wish to \nreturn to \nPioneer 2?"
export const RETURN_YES = 0x6e;
export const RETURN_NO = 0x6f;
// get_gui_position(0x25) and the width literal of DialogListItem_Constructor_0073f0ec.
export const RETURN_POS = { x: 17, y: 306, w: 206 } as const;

export class ReturnPrompt {
  readonly question: Question;
  readonly yes: string;
  readonly no: string;
  private answered = false;
  private readonly onAnswer: (yes: boolean) => void;

  // `onAnswer` runs once, with true for Yes.
  constructor(text: string, yes: string, no: string, onAnswer: (yes: boolean) => void) {
    this.question = new Question(text, RETURN_POS);
    this.yes = yes;
    this.no = no;
    this.onAnswer = onAnswer;
  }

  get cursor(): number {
    return this.question.cursor;
  }

  get result(): 'yes' | 'no' | null {
    return this.question.result;
  }

  key(e: MenuKey): void {
    if (this.answered) return;
    this.question.key(e);
    if (this.question.result) {
      this.answered = true;
      this.onAnswer(this.question.result === 'yes');
    }
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    this.question.draw(ctx, skin, this.yes, this.no);
  }
}

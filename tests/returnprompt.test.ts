// The dead prompt (classic/returnprompt.ts): the question's layout at the exe's
// position, the cursor on No, Yes / No / Backspace, one answer per prompt, and
// the death path that opens it (combat/playerdamage.ts: the death fade ends in
// the revivable state, which sends 6x4E once and is what the prompt waits on).
// Run: node tests/returnprompt.test.ts
import { ReturnPrompt, RETURN_POS, RETURN_TEXT, RETURN_YES, RETURN_NO } from '../client/src/classic/returnprompt.ts';
import { PlayerDamage, DEATH_FADE_TICKS } from '../client/src/combat/playerdamage.ts';
import { wrapGameText } from '../client/src/classic/chat.ts';

// A stub canvas for the text measure (gametext.ts): every glyph is 7 px wide.
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return new Proxy({}, { get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 7 }) : () => {}), set: () => true });
  }
};

let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL: ${what}`);
  }
};

// unitxt(11, 0x56) of the English set (newserv's usbb-resources/unitxt_e.prs).
const QUESTION = 'Do you wish to \nreturn to \nPioneer 2?';

// The index constants are the unitxt group 11 rows.
check(RETURN_TEXT === 0x56 && RETURN_YES === 0x6e && RETURN_NO === 0x6f, 'unitxt rows 11/0x56, 0x6e, 0x6f');
check(RETURN_POS.x === 17 && RETURN_POS.y === 306 && RETURN_POS.w === 206, 'position (17, 306) and width 206');

// The question wraps on its own newlines into three lines (the English text).
check(wrapGameText(QUESTION, RETURN_POS.w - 20).length === 3, 'the question is three lines');

{
  const answers: boolean[] = [];
  const p = new ReturnPrompt(QUESTION, 'YES', 'NO', (yes) => answers.push(yes));
  check(p.cursor === 1 && p.question.cursor === 1, 'the cursor starts on No');
  check(p.question.rect.x === 17 && p.question.rect.y === 306 && p.question.rect.w === 206, 'the window sits at the exe position');
  check(p.result === null, 'no answer yet');
  p.key({ key: 'Enter' });
  check(answers.length === 1 && answers[0] === false, 'Enter on No answers false');
  check(p.result === 'no', 'the result is no');
  p.key({ key: 'ArrowUp' });
  p.key({ key: 'Enter' });
  check(answers.length === 1, 'one answer per prompt');
}

{
  const answers: boolean[] = [];
  const p = new ReturnPrompt(QUESTION, 'YES', 'NO', (yes) => answers.push(yes));
  p.key({ key: 'ArrowUp' });
  check(p.cursor === 0, 'Up moves to Yes');
  p.key({ key: 'ArrowDown' });
  check(p.cursor === 1, 'Down moves back to No');
  p.key({ key: 'ArrowUp' });
  p.key({ key: 'Enter' });
  check(answers.length === 1 && answers[0] === true, 'Enter on Yes answers true');
  check(p.result === 'yes', 'the result is yes');
}

{
  const answers: boolean[] = [];
  const p = new ReturnPrompt(QUESTION, 'YES', 'NO', (yes) => answers.push(yes));
  p.key({ key: 'Backspace' });
  check(answers.length === 1 && answers[0] === false, 'Backspace is No');
  check(p.result === 'no', 'Backspace leaves the result as no');
}

{
  // The death path: a lethal hit goes through the flinch and the death motion,
  // then the 64-tick fade, and sends 6x4E once when the fade ends.
  const sent: string[] = [];
  const d = new PlayerDamage({
    motion: () => {},
    push: () => {},
    face: () => {},
    sendHit: () => sent.push('hit'),
    sendShieldAttack: () => sent.push('shield'),
    sendDeath: () => sent.push('death'),
    sendRevivable: () => sent.push('revivable'),
    sendRevived: () => sent.push('revived'),
    log: () => {},
  });
  d.reset(100, 100);
  d.hit(500, 0, 0);
  check(!d.dead && d.state === 'heavy', 'a lethal hit (over 25% of max HP) starts the heavy fall first');
  let ticks = 0;
  while (d.state !== 'revivable' && ticks < 1000) {
    d.tick();
    ticks++;
  }
  check(d.state === 'revivable', 'the fade ends in the revivable state');
  check(d.dead, 'revivable counts as dead');
  check(ticks >= DEATH_FADE_TICKS, 'the fade lasts DEATH_FADE_TICKS after the death motion');
  check(sent.filter((s) => s === 'revivable').length === 1 && sent.filter((s) => s === 'death').length === 1, 'one 6x89 / 6x4D and one 6x4E');
  d.tick();
  d.tick();
  check(sent.filter((s) => s === 'revivable').length === 1, 'no second 6x4E');
  // Returning to Pioneer 2 refills HP (combat/playerdamage reset, as enterFloor does).
  d.reset(100);
  check(!d.dead && d.hp === 100 && d.fade === 0, 'a reset after the return is alive at full HP');
}

console.log(`${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ' ALL PASS'}`);
if (failures) process.exitCode = 1;

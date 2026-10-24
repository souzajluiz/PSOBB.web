// Auto run (Q by the manual) and auto walk (E by the manual) of the keyboard.
//
// PsoBB.exe (Ephinea 1.25.13), the movement input of the field (unknown_handle_movement,
// dump 667085..667215): g_MouseControlsSetting_00a97f48 is an auto_walk_status
// (off / run / walk, dump 86299). was_input_pressed(autorun) toggles it to run
// (off or walk -> run, run -> off) and was_input_pressed(autowalk) toggles it to walk
// the same way; neither works with Alt held (is_alt_pressed_). While it is not off the
// forward input is held at the run or walk speed (move_speed = player_run_speed, or
// player_walk_speed when the setting is walk), so the character keeps going without W.
// The exe turns the setting off again when the forward key ramps to the deadzone
// (the forward branch) and when the player stops without a movement key (ASSUMED
// simplification here: any of W / S / A / D turns it off, and the stop test is left out).
//
// The keyboard's bindings for the two rows (keyconfig.ts autorun / autowalk, bindings
// 4 and 5) are 0 in every preset of the exe (PRESET_CODES), so they are unbound by
// default; the manual's Q and E are used when the row has no key (ASSUMED: the manual
// is the default the user sees, the exe's preset is not).

export type AutoMode = 'off' | 'run' | 'walk';

export interface AutoMoveState {
  mode: AutoMode;
  runWas: boolean; // the run key was down on the last frame (a press is an edge)
  walkWas: boolean;
}

export interface AutoMoveKeys {
  run: boolean;
  walk: boolean;
  direction: boolean; // W / S / A / D (or the arrows) is down
}

export const AUTO_RUN_FALLBACK = 'q';
export const AUTO_WALK_FALLBACK = 'e';

// The key a row answers to: the bound key, or the manual's key when the row is unbound.
export function autoKey(bound: string, fallback: string): string {
  return bound || fallback;
}

export function autoMoveStart(): AutoMoveState {
  return { mode: 'off', runWas: false, walkWas: false };
}

// One frame of the setting: a direction key turns it off; a press of the run or walk
// key toggles its mode (off or the other mode -> this mode, this mode -> off).
export function stepAutoMove(s: AutoMoveState, k: AutoMoveKeys): AutoMoveState {
  let mode: AutoMode = k.direction ? 'off' : s.mode;
  if (k.run && !s.runWas) mode = mode === 'run' ? 'off' : 'run';
  if (k.walk && !s.walkWas) mode = mode === 'walk' ? 'off' : 'walk';
  return { mode, runWas: k.run, walkWas: k.walk };
}

// The keyboard axes that hold the auto move (MoverInput: fb forward +, lr right +, -128..128).
// Run is a full forward push (pace above the mover's RUN_THRESHOLD 0.75); walk is a half
// push, below it (ASSUMED values: the exe passes the speed itself).
export const AUTO_RUN_FB = 128;
export const AUTO_WALK_FB = 64;

export function autoMoveAxes(mode: AutoMode): { fb: number; lr: number } | null {
  if (mode === 'run') return { fb: AUTO_RUN_FB, lr: 0 };
  if (mode === 'walk') return { fb: AUTO_WALK_FB, lr: 0 };
  return null;
}

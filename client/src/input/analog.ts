// Analog input of the touch pad's stick and the second-finger camera drag (a
// browser convenience, not in PsoBB.exe's keyboard / mouse controls). The
// stick still sends W / A / S / D for menus and every key-reading view
// (input/virtualpad.ts); while it is held, the player view
// (render/lobbyview.ts) reads the stick's axes from here instead, for an
// analog direction and a walk / run choice by deflection.
//
// The walk / run rule is the exe's pad code:
//   - unknown_handle_shared_inputs (after QuestItemSpawnHandler_007beca0):
//     each stick axis is a short in -128..127; an axis with -31 < v <= 31
//     (0x0097e628 = -31.0, 0x0097e624 = 31.0) is zeroed (the dead zone), and
//     movement_input_amount = min(1.0, hypot(x, y) / 128.0) (0x0097e61c =
//     128.0, 0x0097e618 = 1.0);
//   - standing (unknown_handle_gamepad_input_move_stop, 0x0069b728): an amount
//     of at least g_MovementInputThreshold = 0.1 (0x0093da84) starts the walk
//     state (handle_input_state_move_start, 6x40);
//   - walking (unknown_handle_gamepad_input_move_start, 0x0069bbd0): above 0.1
//     it keeps moving; each frame above g_MovementSpeedCollisionThreshold =
//     0.75 (0x0093da70) counts player->cant_move_because_of_collision up, and
//     once that count reaches g_CollisionStuckThreshold = 6.0 (0x0093da74) it
//     goes to the run state (handle_input_state_move, 6x42);
//   - running (unknown_handle_gamepad_input_move, 0x006a1584): below 0.75 the
//     count is cleared and it walks again; at 0.1 or less it stops.
// The direction is the angle of the (dead-zoned) axes added to the camera's
// angle (modify_direction), so it is analog, not 8-way.
//
// ASSUMED: the stick's rim is a full deflection of 128, and the count is
// cleared when the player stands (the exe only clears it on the run -> walk
// change).

export interface StickAxes {
  lr: number; // right +, -128..127
  fb: number; // forward (screen up) +, -128..127
}

export const AXIS_MAX = 128; // 0x0097e61c
export const AXIS_DEAD = 31; // 0x0097e624 / 0x0097e628
export const MOVE_THRESHOLD = 0.1; // g_MovementInputThreshold 0x0093da84
export const RUN_THRESHOLD = 0.75; // g_MovementSpeedCollisionThreshold 0x0093da70
export const RUN_FRAMES = 6; // g_CollisionStuckThreshold 0x0093da74

const deadZone = (v: number) => (v > -AXIS_DEAD && v <= AXIS_DEAD ? 0 : v);
const axis = (f: number) => Math.max(-AXIS_MAX, Math.min(AXIS_MAX - 1, Math.round(f * AXIS_MAX)));

// Stick axes for a knob offset (screen pixels, y down) on a stick of `radius`:
// the rim is full deflection; each axis gets the exe's dead zone.
export function stickAxes(dx: number, dy: number, radius: number): StickAxes {
  if (!(radius > 0)) return { lr: 0, fb: 0 };
  return { lr: deadZone(axis(dx / radius)), fb: deadZone(axis(-dy / radius)) };
}

// movement_input_amount, 0..1.
export function stickAmount({ lr, fb }: StickAxes): number {
  return Math.min(1, Math.hypot(deadZone(lr), deadZone(fb)) / AXIS_MAX);
}

// The stick's direction in BAMS (0x10000 = a full turn, 0 = forward), the
// exe's unknown_handle_shared_inputs (named dump, after QuestItemSpawnHandler_007beca0):
//   unknown_camera_input_amount_1 = ROUND(fpatan(lr, fb) * 65536 / 2pi) & 0xffff
// with 2pi at 0x0097e5e8 (_g_InputDeadzoneParams) and 65536 at 0x0097e5f0
// (_deadzone_y). A stick at rest is 0.
export const BAMS_FULL = 0x10000; // 0x0097e5f0
export function stickAngleBams(axes: StickAxes | null): number {
  if (!axes) return 0;
  return Math.round((Math.atan2(axes.lr, axes.fb) * BAMS_FULL) / (Math.PI * 2)) & 0xffff;
}

// CheckMovementInput_007c11d0's stick branch (the freeze mash, combat/status.ts
// mash). Each call stores the direction (the exe's tracker +0x00) and reports a
// flick: the direction turned by more than 0x5000 and less than 0xb000 BAMS
// since the last call (112.5 to 247.5 degrees) while the stick is deflected
// past g_MovementSpeedThreshold = 0.5 (0x0097e614, against the shared
// movement_input_amount +0x24).
// ASSUMED: the exe runs the check every game tick (30 per second); here every
// render frame, and the tracker starts at direction 0.
export const FLICK_MIN_BAMS = 0x5000; // exclusive
export const FLICK_MAX_BAMS = 0xb000; // exclusive
export const FLICK_AMOUNT = 0.5; // g_MovementSpeedThreshold 0x0097e614
export class StickFlick {
  private last = 0;

  step(axes: StickAxes | null): boolean {
    const cur = stickAngleBams(axes);
    const turned = (this.last - cur) & 0xffff;
    this.last = cur;
    return turned > FLICK_MIN_BAMS && turned < FLICK_MAX_BAMS && stickAmount(axes ?? { lr: 0, fb: 0 }) > FLICK_AMOUNT;
  }
}

export type Gait = 'stand' | 'walk' | 'run';

// The stand / walk / run states of the stick, stepped once per game frame
// (30 per second; `frames` may be fractional for a render frame).
export class AnalogGait {
  gait: Gait = 'stand';
  private count = 0;

  step(amount: number, frames = 1): Gait {
    if (this.gait === 'stand') {
      if (amount >= MOVE_THRESHOLD) this.gait = 'walk';
      return this.gait;
    }
    if (!(amount > MOVE_THRESHOLD)) {
      this.reset();
      return this.gait;
    }
    if (this.gait === 'run' && amount < RUN_THRESHOLD) {
      this.count = 0;
      this.gait = 'walk';
      return this.gait;
    }
    if (amount > RUN_THRESHOLD) this.count += frames;
    if (this.gait === 'walk' && this.count >= RUN_FRAMES) this.gait = 'run';
    return this.gait;
  }

  reset(): void {
    this.gait = 'stand';
    this.count = 0;
  }
}

// --- shared state between the touch pad and the player view -----------------

let stick: StickAxes | null = null;
let cameraTurn = 0;

// The stick's axes while it is held, null when it is not.
export function setTouchStick(axes: StickAxes | null): void {
  stick = axes ? { lr: axes.lr, fb: axes.fb } : null;
}

export function touchStick(): StickAxes | null {
  return stick;
}

// Second-finger drag: a full canvas width turns the camera half a turn.
// ASSUMED (feel): the exe has no free camera turn on keyboard / mouse.
export const CAMERA_DRAG_TURN = Math.PI;

// Camera angle change (radians, render/playercamera.ts PlayerCamera.angle)
// for a horizontal drag of dx pixels on a canvas `width` pixels wide: a drag
// to the right turns the view to the right.
export function dragTurn(dx: number, width: number): number {
  return width > 0 ? (-dx / width) * CAMERA_DRAG_TURN : 0;
}

export function addCameraTurn(radians: number): void {
  if (Number.isFinite(radians)) cameraTurn += radians;
}

// The turn gathered since the last call (the player view applies it once
// per frame).
export function takeCameraTurn(): number {
  const t = cameraTurn;
  cameraTurn = 0;
  return t;
}

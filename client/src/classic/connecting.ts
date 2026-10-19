// "Connecting.." screen with the warp effect, shown by PsoBB.exe (Ephinea
// 1.25.13) between SELECT CHARACTER and the ship select while the client
// connects to the game server.
//
// FUN_007bd97c is a modal loop around the connection:
//   - FUN_004178f8 creates the 3D scene (FUN_004d3408) and the warp object
//     FUN_004179e8 (vtable 0x00af3738), which starts a fade-in
//     (FUN_00409d28 mode 2 -> FUN_0040a080: alpha 1, -1/15 per frame);
//   - the warp object's update (FUN_00417ccc) fixes the camera at the origin
//     looking down -Z (FUN_004d31f4(9), FUN_004d33c0) and on its second frame
//     creates FUN_00418794, whose children are
//       FUN_0040bf40: particle effects 0x13, 0x15, 0x17, 0x1d, 0x6e
//         (0x008f9ec8) at 100 units in front of the camera (0x008f9edc),
//         rotations (0x4000,0,0) (0,0,0) for 0x17 (table 0x009a3104);
//       FUN_00417f90: effect 0x16 at 65 units (0x008fb12c);
//   - FUN_00407b74 creates the "Connecting.." object (vtable 0x00af2438):
//     render FUN_00407f6c draws "Connecting.." at (23, 331) while its state
//     is below 3; FUN_00408200 moves it to state 2 with the connection
//     result, and update FUN_00407c6c waits 150 frames (0x96) in state 2
//     before showing the result (unitxt group 0x36 errors, FUN_004080ac).

import { drawGameText } from './gametext.ts';
import { makeTinter, ParticleSystem, parseParticleEntry } from './particles.ts';
import type { Screen, Stage } from './stage.ts';

export interface ConnectingAssets {
  particleEntries: Uint8Array; // particleentry.dat
  effect: Map<number, ImageBitmap>; // effect_nt.xvm by GBIX
}

const FRAME = 1 / 30;
const WAIT_AFTER_RESULT = 150; // FUN_00407c6c state 2
const FADE_STEP = 1 / 15; // FUN_0040a080 mode 2 (0xbd888889)

export class ConnectingScreen implements Screen {
  layout = 'stretch' as const;
  private particles = new ParticleSystem();
  private tint = makeTinter();
  private frame = 0;
  private acc = 0;
  private fade = 1;
  private resultFrame = -1;
  private error: string | null = null;
  private finished = false;
  private showingError = false;
  private assets: ConnectingAssets;
  private onDone: () => void;
  private onError: (message: string) => void;

  constructor(assets: ConnectingAssets, task: Promise<unknown>, onDone: () => void, onError: (message: string) => void) {
    this.assets = assets;
    this.onDone = onDone;
    this.onError = onError;
    // effect_nt.xvm slots in file order (the map is filled in that order).
    [...assets.effect.keys()].forEach((gbix, slot) => this.particles.slots.set(gbix, slot));
    task.then(
      () => (this.resultFrame = this.frame),
      (err) => {
        this.error = err instanceof Error ? err.message : String(err);
        this.resultFrame = this.frame;
      },
    );
  }

  private createEffects(): void {
    const at = (z: number): [number, number, number] => [0, 0, -z];
    const ids = [0x13, 0x15, 0x17, 0x1d, 0x6e];
    const rot = [Math.PI / 2, Math.PI / 2, 0, Math.PI / 2, Math.PI / 2];
    ids.forEach((id, i) => this.particles.add(parseParticleEntry(this.assets.particleEntries, id), at(100), rot[i]));
    // FUN_00417f90: rotation from the camera direction (FUN_007a8d98), i.e.
    // the same quarter turn about X.
    this.particles.add(parseParticleEntry(this.assets.particleEntries, 0x16), at(65), Math.PI / 2);
  }

  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= FRAME) {
      this.acc -= FRAME;
      this.tick();
    }
  }

  private tick(): void {
    this.frame++;
    if (this.frame === 2) this.createEffects();
    this.particles.step();
    this.fade = Math.max(0, this.fade - FADE_STEP);
    if (this.resultFrame >= 0 && !this.finished && !this.showingError && this.frame - this.resultFrame > WAIT_AFTER_RESULT) {
      // State 3: status 0 goes on at once; any other status shows its text
      // and waits for the confirm (Enter) or cancel key
      // (GameListMenuObjectStateMachine, 0x00407c6c).
      if (this.error) this.showingError = true;
      else {
        this.finished = true;
        this.onDone();
      }
    }
  }

  key(e: KeyboardEvent): void {
    if (!this.showingError || this.finished || (e.key !== 'Enter' && e.key !== 'Escape')) return;
    this.finished = true;
    this.onError(this.error ?? '');
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 640, 480);
    this.particles.draw(ctx, (g) => this.assets.effect.get(g) ?? null, this.tint);
    // GameListMenuObject_Update_00407f6c: "Connecting.." below state 3, the
    // status text (GameListMenuObject_RenderStatusText_004080ac) in state 3,
    // both at (23, 331) (confirmed in psobb-client-source src/FUN_004080fb.c,
    // FUN_00408118.c, FUN_00408152.c: states 8/10, 7, 5). The exe's status texts are unitxt group 0x36 (left
    // over from the Xbox port); the bridge's error message stands in for them.
    if (this.showingError) this.error?.split('\n').forEach((line, i) => drawGameText(ctx, line, 23, 331 + i * 20));
    else if (!this.finished) drawGameText(ctx, 'Connecting..', 23, 331);
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
      ctx.fillRect(0, 0, 640, 480);
    }
  }
}

// SELECT CHARACTER 3D preview: FUN_00406ab4 creates it (FUN_00406b50,
// vtable 0x00af2308, base display object FUN_007a9e5c) with mode 0
// (FUN_00406a58 -> FUN_0040680c):
//   position (+0x38) (17, -10.5, -40), Y rotation (+0x60) 0xf3d5 BAMS,
//   spinning (+0x11c = 1).
// The scene (FUN_00413b84) sets the request (+0x100) to 1 whenever the cursor
// slot changes, then to 2 if the slot holds a character (after loading it as
// the current character, FUN_006c1a80). Update FUN_00406bd8:
//   state 0  idle: a request r goes to state r - 1
//   state 1  (no request) builds the model from the current character's
//            visual config (FUN_004eba6c), starts motion record 0/1/2
//            (FUN_0040733c: male / female / FOmarl), state 2
//   state 2  waits for the model, then state 3 with timer 0
//   state 3  Y rotation -= 0x100 per frame; timer 900 and 1800 -> record
//            3/4/5 (FUN_00407008), 1350 -> 6/7/8 (FUN_00406fc8), 2250 ->
//            0/1/2 and timer 0 (FUN_00407048); FUN_007aa094 plays the motion
//   a request in states 1..3 drops the model and goes to state r - 1.
// Render FUN_00407084 -> FUN_00407098 (state 3 only): push, translate by the
// position, rotate Y, draw body, head, hair. The select scene sets no camera
// of its own (no perspective call in its functions): the view is taken as the
// identity and the projection as the client default, angle 0x3555 (fovy
// 57.49 deg) over the whole window. That places the model at x = 506 of the
// 4:3 screen, right of the CHARACTERS box. No capture with a character
// exists to confirm it.

import * as THREE from 'three';
import type { CharacterPreview } from '../net/bbsession.ts';
import { CLASS_FLAGS } from '../net/bbsession.ts';
import { addPlayerLights, CharacterActor, type CharaFiles, charaMotionType, GLLayer, njPerspectiveFovy } from './playerview.ts';

const POSITION = [17, -10.5, -40] as const; // 0x41880000, 0xc1280000, 0xc2200000
const START_ANGLE = 0xf3d5;
const SPIN = -0x100;
const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

export class SelectPreview {
  private gl = new GLLayer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(njPerspectiveFovy(0x3555), 4 / 3, 1, 10000);
  private actor: CharacterActor;
  private state = 0;
  private request = 0;
  private current: CharacterPreview | null = null;
  private angle = START_ANGLE;
  private timer = 0;
  private type: 0 | 1 | 2 = 0;

  constructor(files: CharaFiles) {
    this.actor = new CharacterActor(files);
    this.actor.group.position.set(...POSITION);
    this.scene.add(this.actor.group);
    addPlayerLights(this.scene);
  }

  // FUN_00413b84: the cursor moved to `slot`.
  select(slot: CharacterPreview | null): void {
    this.request = 1;
    this.current = slot;
    if (slot && slot.costume !== undefined) this.request = 2;
  }

  // One game frame (FUN_00406bd8).
  tick(): void {
    const r = this.request;
    if (this.state === 0) {
      this.drop();
      if (r) {
        this.request = 0;
        this.state = r - 1;
      }
    } else if (r) {
      this.drop();
      this.request = 0;
      this.state = r - 1;
    } else if (this.state === 1) {
      const p = this.current!;
      // Characters made by older tools may carry class_flags 0: use the class's.
      const flags = p.classFlags || (CLASS_FLAGS[p.charClass] ?? 0);
      this.type = charaMotionType(p.charClass, flags);
      this.actor.setLook({
        charClass: p.charClass,
        classFlags: flags,
        appearance: {
          sectionId: p.sectionId, costume: p.costume ?? 0, skin: p.skin ?? 0, face: p.face ?? 0, head: p.head ?? 0, hair: p.hair ?? 0,
          hairR: p.hairColor?.[0] ?? 0, hairG: p.hairColor?.[1] ?? 0, hairB: p.hairColor?.[2] ?? 0,
          proportionX: p.proportion?.[0] ?? 0, proportionY: p.proportion?.[1] ?? 0,
        },
      });
      this.actor.setMotion(this.type);
      this.angle = START_ANGLE;
      this.state = 2;
    } else if (this.state === 2) {
      this.actor.sync();
      if (this.actor.loaded) {
        this.state = 3;
        this.timer = 0;
      }
    } else if (this.state === 3) {
      this.angle = (this.angle + SPIN) & 0xffff;
      const t = ++this.timer;
      if (t === 900 || t === 1800) this.actor.setMotion(3 + this.type);
      else if (t === 1350) this.actor.setMotion(6 + this.type);
      if (t === 2250) {
        this.actor.setMotion(this.type);
        this.timer = 0;
      }
      this.actor.update(1.000001 / 30); // one motion tick (the remainder carries)
    }
  }

  private drop(): void {
    this.actor.setLook(null);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state !== 3) return;
    const { vw, w, h } = this.gl.fit(ctx);
    const r = this.gl.renderer;
    r.setViewport(0, 0, w, h);
    r.clear();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.actor.group.rotation.y = (this.angle << 16 >> 16) * BAMS_TO_RAD;
    r.render(this.scene, this.camera);
    ctx.drawImage(this.gl.canvas, 0, 0, vw, 480);
  }

  dispose(): void {
    this.actor.dispose();
    this.gl.dispose();
  }
}

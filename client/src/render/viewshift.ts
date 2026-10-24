// The 3D view's shift while the field or lobby main menu is open (PsoBB.exe
// render_player_menu_background, dump 700858 / FUN_00733b2c; the numbers are
// menuViewShift's, classic/mainmenu.ts). The projection is rebuilt from its
// fov and aspect, then premultiplied by the NDC offset and scale, so the
// scene's centre moves to (ox, oy) and the scene scales by s.
//
// The exe's centre in 640 x 480 pixels is (320 + 80 f / 3, 240 - 115.2 f / 3):
// right and UP (the y is screen-down, so the minus is the exe's own formula
// `-(115.2 * scale / 3) * frame + 240`). NDC y is up, so oy = +0.48 at frame 3.
import * as THREE from 'three';
import { menuViewShift } from '../classic/mainmenu.ts';

// Applies shift frame f (0..3) to the camera's projection. Frame 0 (and a
// camera that was never shifted) gives the plain projection: it is rebuilt each
// call, so a menu that closes returns the view to the unshifted matrix.
export function applyMenuViewShift(cam: THREE.PerspectiveCamera, f: number): void {
  cam.updateProjectionMatrix();
  if (!f) return;
  const { ox, oy, s } = menuViewShift(f);
  cam.projectionMatrix.premultiply(new THREE.Matrix4().set(s, 0, 0, ox, 0, s, 0, oy, 0, 0, 1, 0, 0, 0, 0, 1));
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}

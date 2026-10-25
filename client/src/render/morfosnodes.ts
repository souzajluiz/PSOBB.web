// The Morfos' node captures (render/combat.ts morfosView, morfosMuzzle).
// The exe's body draw (unknown_morfos_render2, Ephinea 0x00579ff4..; the node
// callback ProcessAnimationStep_00579f3c, 0x00579f3c) stores the world origin
// of body node 6 at enemy+0x4a0 (the laser's muzzle) and of node 10 at
// enemy+0x4ac (the arm's parent point) while it draws. The game tick reads
// those stored points: the laser's shot (0x0057d0f4) and the arm's update
// (0x0057cd3c, FUN_0057c7b8 = enemy+0x4ac) take the pose of the last draw, not
// this tick's pose.
//
// three keeps a node's matrixWorld from the last render (scene.updateMatrixWorld
// runs in renderer.render), and the tick runs before the next render. So the
// stored point is the node's matrixWorld as it stands before anything refreshes
// it. Callers must read it before they call updateMatrixWorld on the root.
import * as THREE from 'three';

// The world origin of `node` as the last draw left it.
export function drawnWorldOrigin(node: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.setFromMatrixPosition(node.matrixWorld);
}

// The arm's place: the captured world point seen from the enemy root's current
// transform (the exe's arm draws at that absolute point). Refreshes the root's
// matrices, so `captured` must be read first (drawnWorldOrigin).
export function armLocalFromCapture(root: THREE.Object3D, captured: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(captured);
  root.updateMatrixWorld(true);
  return root.worldToLocal(out);
}

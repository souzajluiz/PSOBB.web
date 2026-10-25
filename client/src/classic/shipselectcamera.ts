// Ship select backdrop camera: the 3D lobby behind the Ship Select window.
//
// Evidence (2026-10-25, PsoBB.exe Ephinea 1.25.13, Ghidra dump names are
// community guesses):
//   - the TLobby constructor (init_ship_connection_manager, 776104) sets no
//     camera; the ship menu handler (handle_ship_block_select_packets, 779863)
//     and its state setters (LobbyMenuHandler_SetShipSelectState_0079bb58,
//     779917) do not touch one either;
//   - SetGameListMenuCameraPosition (144485) belongs to the MapObject made in
//     the character select object (153761, next to CreateDressingRoomObject),
//     so it is the character select camera, not this one;
//   - create_lobby_burst_screen (157525) and update_loading_screen_widget
//     (157082, SetDefaultNpcCamera 9) belong to the loading screen that runs
//     when a lobby is entered, not to Ship Select.
// So the exe's Ship Select camera is NOT decoded (position, target, FOV and
// motion are all unproven). The values below are the port's fitted circle over
// lobby 1 (ASSUMED), kept only so the backdrop moves like the reference capture
// by eye. Everything here is ASSUMED.
//
// The camera is set with three.js calls (PerspectiveCamera.position / lookAt);
// the FOV is the viewer's own (MapViewer: 60 degrees vertical, PerspectiveCamera
// fov is vertical too), so it is not set here.

/** ASSUMED: the fitted orbit of the backdrop camera. */
export const SHIP_SELECT_CAMERA = {
  /** Distance from the lobby origin, in lobby units. Fitted. */
  radius: 260,
  /** Camera height above the origin. Fitted. */
  height: 120,
  /** Angle gained per second of frame time (the port's old `t += dt * 0.05`). Fitted. */
  rate: 0.05,
} as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** The camera's angle after `dt` seconds more of the orbit. */
export function shipSelectCameraAngle(angle: number, dt: number): number {
  return angle + dt * SHIP_SELECT_CAMERA.rate;
}

/** The pose at `angle`: on the circle of `radius` at `height`, looking at the origin. */
export function shipSelectCameraPose(angle: number): CameraPose {
  const { radius, height } = SHIP_SELECT_CAMERA;
  return {
    position: { x: Math.sin(angle) * radius, y: height, z: Math.cos(angle) * radius },
    target: { x: 0, y: 0, z: 0 },
  };
}

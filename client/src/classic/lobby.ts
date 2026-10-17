// Lobby: the 3D lobby (render/lobbyview.ts on a WebGL canvas under the stage)
// with the classic 2D HUD on top.
//
// Decoded from PsoBB.exe (Ephinea 1.25.13):
//   - lobby name window: FUN_0079eb78 formats "%s:%02d-%02d" (0x0097cef0) with
//     the ship name kept by the 07 handler (0x00aab2ec), the block number and
//     lobby number + 1, and FUN_0073f510 shows it in a 160 x 27 window
//     (0x009f340c) whose right edge is at position table entry 0xc0 =
//     (622, 37); see ingame.ts. Matches "newserv:01-01" on the capture.
//   - keyboard: newserv's default-keyboard-config.bin (0x16C bytes, the
//     client's key_config) holds {u32, key id} pairs in the order of the key
//     config labels (unitxt group 0: "Move Forward", "Move Backward",
//     "Move Left", "Move Right", "Lock Move Forward", "Lock Walk Forward",
//     "Decide", "Cancel", "Menu Open/Close", "Start", "Select Up"...). Key ids
//     are named by the table at 0x0097b5e0 ({id, L": NAME"}): 0x26 W, 0x22 S,
//     0x10 A, 0x13 D, 0x61 ENTER, 0x50 BACK SPACE, 0x06 HOME, 0x59 SPACE,
//     0x5e/0x5d/0x5c/0x5f arrows, 0x40..0x4b F1..F12, 0x2a..0x33 1..0.
//     So: W/S/A/D move, Enter decides, Backspace cancels, Home opens the menu,
//     arrows move the selection.
// Not decoded yet (drawn provisionally, see DEVLOG): the chat log, the chat
// input box, the name tags' exact font/offset, the lobby menu (Home).

import * as THREE from 'three';
import type { Lobby, LobbyPlayer } from '../net/lobby.ts';
import type { LobbyView } from '../render/lobbyview.ts';
import type { MapViewer } from '../render/mapviewer.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { drawLobbyNameWindow, inGameSpace } from './ingame.ts';
import { drawWindowFrame, type Screen, type Stage, type WindowSkin } from './stage.ts';

// Default key config slots 0..3 (W, S, A, D) mapped to the keys LobbyView
// reads for its movement.
const MOVE_KEYS: Record<string, string> = { w: 'w', s: 's', a: 'a', d: 'd' };
const CHAT_LINES = 6;
const CHAT_MAX = 70; // UTF-16 units; the client's chat buffer limit is not decoded

interface ChatLine {
  name: string;
  text: string;
}

export class LobbyScreen implements Screen {
  transparent = true;
  private lobby: Lobby;
  private view: LobbyView;
  private viewer: MapViewer;
  private skin: WindowSkin;
  private shipName: string;
  private keys = new Set<string>();
  private chat: ChatLine[] = [];
  private input: string | null = null;

  constructor(viewer: MapViewer, view: LobbyView, lobby: Lobby, skin: WindowSkin, shipName: string) {
    this.viewer = viewer;
    this.view = view;
    this.lobby = lobby;
    this.skin = skin;
    this.shipName = shipName;
    // LobbyView reads the pressed keys from the viewer's frame callback;
    // feed it the keys of the stage canvas instead.
    const inner = viewer.onFrame;
    viewer.onFrame = (dt) => inner?.(dt, this.keys);
    lobby.on('chat', (from, gc, text) => this.addChat(from?.name ?? `#${gc}`, text));
    lobby.on('playerJoined', (p: LobbyPlayer) => this.addChat('', `${p.name} joined`));
  }

  get lobbyName(): string {
    const two = (n: number) => String(n).padStart(2, '0');
    return `${this.shipName}:${two(this.lobby.blockNumber)}-${two(this.lobby.lobbyNumber + 1)}`;
  }

  private addChat(name: string, text: string): void {
    this.chat.push({ name, text });
    if (this.chat.length > 50) this.chat.shift();
  }

  update(): void {}

  key(e: KeyboardEvent): void {
    if (this.input !== null) {
      e.preventDefault();
      if (e.key === 'Enter') {
        const t = this.input.trim();
        if (t) this.lobby.sendChat(t);
        this.input = null;
      } else if (e.key === 'Escape') this.input = null;
      else if (e.key === 'Backspace') this.input = this.input.slice(0, -1);
      else if (e.key.length === 1 && this.input.length < CHAT_MAX) this.input += e.key;
      return;
    }
    const k = e.key.toLowerCase();
    if (MOVE_KEYS[k]) {
      this.keys.add(MOVE_KEYS[k]);
      return;
    }
    // Space is "Start" and Enter "Decide" in the default config; both open
    // the chat input here (the client's chat trigger is not decoded yet).
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.keys.clear();
      this.input = '';
    }
  }

  keyUp(e: KeyboardEvent): void {
    const k = MOVE_KEYS[e.key.toLowerCase()];
    if (k) this.keys.delete(k);
  }

  blur(): void {
    this.keys.clear();
  }

  leave(): void {
    this.keys.clear();
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    inGameSpace(ctx, stage, (extra) => {
      this.drawNameTags(ctx, extra);
      drawLobbyNameWindow(ctx, this.skin, this.lobbyName, extra);
      this.drawChat(ctx);
    });
  }

  // Name above each player's head: projected from the model position plus a
  // head offset (provisional: 22 units, white game text centred).
  private drawNameTags(ctx: CanvasRenderingContext2D, extra: number): void {
    const cam = this.viewer.camera;
    const w = 640 + extra;
    const v = new THREE.Vector3();
    for (const [id, pos] of this.view.playerPositions()) {
      const p = this.lobby.players.get(id);
      if (!p) continue;
      v.copy(pos).add(new THREE.Vector3(0, 22, 0)).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * 480;
      const tw = gameTextWidth(p.name);
      drawGameText(ctx, p.name, x - tw / 2 + 1, y - 13, '#000000', 0.8);
      drawGameText(ctx, p.name, x - tw / 2, y - 14, '#ffffff');
    }
  }

  // Provisional chat log (last lines, bottom left) and input window.
  private drawChat(ctx: CanvasRenderingContext2D): void {
    const lines = this.chat.slice(-CHAT_LINES);
    const baseY = this.input !== null ? 400 : 440;
    lines.forEach((l, i) => {
      const y = baseY - (lines.length - i) * 18;
      const s = l.name ? `${l.name} > ${l.text}` : l.text;
      drawGameText(ctx, s, 13, y + 1, '#000000', 0.8);
      drawGameText(ctx, s, 12, y, l.name ? '#ffffff' : '#ffcc33');
    });
    if (this.input !== null) {
      drawWindowFrame(ctx, this.skin.frame, 8, 410, 420, 32);
      const caret = Math.floor(performance.now() / 400) % 2 ? '_' : '';
      drawGameText(ctx, this.input + caret, 18, 419);
    }
  }
}

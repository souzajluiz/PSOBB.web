// Runs a quest in a game: wires the VM to the game and the view, and reloads
// the floor so the quest's own maps and set data replace the free-play ones.
// The text windows, the NPC talk, the counters and the NPC players live in
// quest/town.ts (QuestTown), which this registers the quest with.
//
// The message text goes through the token interpolation the client does for
// window_msg / message / add_msg (the list is in newserv's comment on opcode
// 0x5A, src/QuestScript.cc): <rXX> and <fXX> print a register, <cr> is a
// newline, <hero name> / <hero job> the local character, <color X> a colour
// change (quest/town.ts interpolate, quest/questui.ts plainText).

import type { Game } from '../net/game.ts';
import type { LoadedQuest } from '../net/quests.ts';
import type { GameView } from '../render/gameview.ts';
import { QuestSession } from './session.ts';
import type { QuestBoardItem, QuestVMHost } from './vm.ts';
import type { QuestTown } from './town.ts';
import { BattleRun } from './battlerun.ts';

export interface QuestRunnerOptions {
  quest: LoadedQuest;
  game: Game;
  view: GameView;
  town: QuestTown;
  log?: (msg: string) => void;
  heroStats?: () => { hp: number; maxHp: number; tp: number; maxTp: number } | null;
  enemiesKilled?: () => number;
  onBoardSelect?: (item: QuestBoardItem) => void;
}

export interface QuestRunner {
  session: QuestSession;
  dispose(): void;
}

export async function runQuest(opts: QuestRunnerOptions): Promise<QuestRunner> {
  const log = opts.log ?? (() => {});
  const { game, view, town } = opts;

  // Battle mode (quest/battlerun.ts): created when the quest's ba_start fires.
  let battle: BattleRun | null = null;
  const session = new QuestSession(opts.quest, {
    log,
    host: buildHost(),
  });

  function buildHost(): QuestVMHost {
    const player = (clientId: number) => game.players.get(clientId) ?? null;
    return {
      // Text, menus, rewards, teleports and NPC players (quest/town.ts).
      ...town.vmHost('quest'),
      log,
      playerCount: () => [...game.players.values()].filter((p) => p.npcTemplate === undefined).length,
      playersPresent: () => [0, 1, 2, 3].map((i) => game.players.has(i)),
      playerFloor: (id) => player(id)?.floor ?? -1,
      playerRoom: (id) => {
        const p = player(id);
        return p ? view.roomAt(p.position) : -1;
      },
      playerPosition: (id) => player(id)?.position ?? null,
      // The web client does not model the full action state machine; standing
      // (1) is the honest default and is what every "is the player busy" test
      // in a quest's opening expects.
      playerState: (id) => (player(id) ? 1 : 0),
      playerDead: (id) => !player(id),
      playerHpTp: (id) => {
        // The web client tracks only the local character's stats (net/charfile.ts
        // through the inventory panel); other players report nothing.
        if (id !== game.selfId) return null;
        const c = opts.heroStats?.();
        return c ?? null;
      },
      enemiesKilled: () => opts.enemiesKilled?.() ?? 0,
      questExit: () => log('quest: qexit (the quest asked to leave the game)'),
      darkFalzDead: () => false,
      constructObjects: (floor, room, group) => view.constructObjects(floor, room, group),
      constructEnemies: (floor, room, wave) => view.constructEnemies(floor, room, wave),
      zoneCleared: (floor, room) => view.zoneCleared(floor, room),
      getSwitchFlag: (floor, flag) => view.switchFlag(floor, flag),
      setSwitchFlag: (floor, flag, set) => view.setSwitchFlag(floor, flag, set),
      syncRegister: (reg, value) => game.sendQuestRegister(reg, value),
      mapDesignated: (floor, d) => log(`quest: floor ${floor} -> area ${d.area}, type ${d.type}, variations ${d.layoutVar}/${d.entitiesVar}`),
      mainwarpChanged: (floor, on) => log(`quest: Ragol warp to floor ${floor} ${on ? 'enabled' : 'disabled'}`),
      goFloor: (clientId, floor) => {
        if (clientId === game.selfId) void view.warpTo(floor);
      },
      battleStart: (setup) => {
        battle ??= new BattleRun({ game, view, ui: town.ui, canvas: town.canvasElement, files: town.clientFiles, log });
        battle.start(setup);
      },
      battlePlace: (i) => battle?.placeAt(i) ?? { place: 0, points: 0 },
      battleRecord: () => battle?.records.fields ?? [0, 0, 0, 0, 0, 0, 0],
      questBoardChanged: (items) => {
        opts.onBoardSelect && items.length && log(`quest board: ${items.map((i) => i.name).join(', ')}`);
      },
    };
  }

  // 6x77 from another client: the register the quest synced (sync_register).
  const onSub = (sub: number, clientId: number, body: Uint8Array) => {
    if (disposed || sub !== 0x77 || clientId === game.selfId || body.length < 0x0c) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    session.vm.regsI[dv.getUint16(4, true) & 0xff] = dv.getInt32(8, true);
  };
  game.on('subcommand', onSub);
  let disposed = false;

  town.setQuest(session);
  view.setQuest(session);
  session.start();
  log(`quest loaded: ${session.summary()}`);
  // The quest's designations change what the current floor is, so it has to be
  // loaded again (newserv replaces the game's map with the quest's supermap in
  // on_quest_loaded / Lobby::load_maps at the same point in the exchange).
  await view.reloadCurrentFloor();
  return {
    session,
    dispose() {
      if (disposed) return;
      disposed = true;
      battle?.dispose();
      town.setQuest(null);
      town.ui.clear();
      view.setQuest(null);
    },
  };
}

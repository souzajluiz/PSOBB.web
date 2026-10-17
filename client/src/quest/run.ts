// Runs a quest in a game: wires the VM to the game and the view, shows the
// message windows and the quest board, and reloads the floor so the quest's
// own maps and set data replace the free-play ones.
//
// The message text goes through the token interpolation the client does for
// window_msg / message / add_msg (the list is in newserv's comment on opcode
// 0x5A, src/QuestScript.cc): <rXX> and <fXX> print a register, <cr> is a
// newline, <hero name> / <hero job> the local character, <color X> a colour
// change, and the \tC<x> escapes work directly.

import type { Game } from '../net/game.ts';
import type { LoadedQuest } from '../net/quests.ts';
import type { GameView } from '../render/gameview.ts';
import { CLASS_NAMES } from '../net/bbsession.ts';
import { QuestSession } from './session.ts';
import type { QuestBoardItem, QuestMessage, QuestVMHost } from './vm.ts';

export interface QuestRunnerOptions {
  quest: LoadedQuest;
  game: Game;
  view: GameView;
  // The game canvas: the message window and the quest board are drawn over it.
  anchor: HTMLElement;
  heroName?: () => string;
  heroClass?: () => number;
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
  const { game, view } = opts;
  const ui = new QuestOverlay(opts.anchor);

  const session = new QuestSession(opts.quest, {
    log,
    host: buildHost(),
  });

  function buildHost(): QuestVMHost {
    const player = (clientId: number) => game.players.get(clientId) ?? null;
    return {
      log,
      clientId: () => game.selfId,
      difficulty: () => game.info?.difficulty ?? 0,
      playerCount: () => game.players.size,
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
      constructObjects: (floor, room, group) => log(`quest: construct_delayed_object floor ${floor} room ${room} group ${group} (not implemented)`),
      constructEnemies: (floor, room, wave) => view.constructEnemies(floor, room, wave),
      zoneCleared: (floor, room) => view.zoneCleared(floor, room),
      getQuestFlag: (flag) => game.getQuestFlag(flag),
      setQuestFlag: (flag, set) => game.setQuestFlag(flag, set),
      getSwitchFlag: (floor, flag) => view.switchFlag(floor, flag),
      setSwitchFlag: (floor, flag, set) => view.setSwitchFlag(floor, flag, set),
      syncRegister: (reg, value) => game.sendQuestRegister(reg, value),
      showMessage: (m) => ui.showMessage(interpolate(m, session, opts)),
      closeMessage: (kind) => ui.closeMessage(kind),
      showList: (choices) => ui.showList(choices, (i) => session.vm.answerList(i)),
      mapDesignated: (floor, d) => log(`quest: floor ${floor} -> area ${d.area}, type ${d.type}, variations ${d.layoutVar}/${d.entitiesVar}`),
      mainwarpChanged: (floor, on) => log(`quest: Ragol warp to floor ${floor} ${on ? 'enabled' : 'disabled'}`),
      goFloor: (clientId, floor) => {
        if (clientId === game.selfId) void view.warpTo(floor);
      },
      npcCreated: (npc) => log(`quest: NPC template ${npc.template} as client ${npc.clientId} (no model yet)`),
      questBoardChanged: (items) => ui.showBoard(items, session, (item) => opts.onBoardSelect?.(item)),
    };
  }

  ui.onMessageDismissed = () => session.vm.dismissMessage();
  view.setQuest(session);
  session.start();
  log(`quest loaded: ${session.summary()}`);
  // The quest's designations change what the current floor is, so it has to be
  // loaded again (newserv replaces the game's map with the quest's supermap in
  // on_quest_loaded / Lobby::load_maps at the same point in the exchange).
  await view.reloadCurrentFloor();
  session.enterFloor(view.current?.floor ?? 0);
  return {
    session,
    dispose() {
      ui.dispose();
      view.setQuest(null);
    },
  };
}

// --- token interpolation -----------------------------------------------------

function interpolate(m: QuestMessage, session: QuestSession, opts: QuestRunnerOptions): QuestMessage {
  const hero = opts.heroName?.() ?? '';
  const job = CLASS_NAMES[opts.heroClass?.() ?? 0] ?? '';
  const expand = (s: string) =>
    s
      .replace(/<cr>/gi, '\n')
      .replace(/<r(\d+)>/gi, (_, n: string) => String(session.vm.regsI[Number(n) & 0xff]))
      .replace(/<f(\d+)>/gi, (_, n: string) => session.vm.regsF[Number(n) & 0xff].toFixed(6))
      .replace(/<(?:hero name|name hero)>/gi, hero)
      .replace(/<(?:hero job|name job)>/gi, job)
      .replace(/<time>/gi, '01:12') // the exe always prints this (newserv's note)
      .replace(/<color \d>/gi, '')
      .replace(/\tC[0-9A-Za-z]/g, '')
      .replace(/\t[EJ]/g, '');
  return { ...m, pages: m.pages.map(expand) };
}

// --- overlay -----------------------------------------------------------------

// A plain DOM overlay. The original client draws these windows with the game's
// own text renderer (classic/gametext.ts has the font metrics); this is a
// stand-in so the quest flow can be followed and driven.
class QuestOverlay {
  private root: HTMLElement;
  private messageBox: HTMLElement;
  private boardBox: HTMLElement;
  onMessageDismissed: () => void = () => {};

  private anchor: HTMLElement;
  private onResize = () => this.place();

  constructor(anchor: HTMLElement) {
    this.anchor = anchor;
    this.root = document.createElement('div');
    this.root.className = 'quest-overlay';
    this.root.style.cssText = 'position:absolute;pointer-events:none;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:8px;padding:12px';
    this.messageBox = document.createElement('div');
    this.messageBox.className = 'quest-message';
    this.messageBox.hidden = true;
    this.messageBox.style.cssText =
      'pointer-events:auto;max-width:640px;width:90%;background:rgba(8,16,40,.92);border:2px solid #4a6cff;border-radius:6px;' +
      'padding:10px 14px;color:#e8ecff;font:14px/1.45 monospace;white-space:pre-wrap;cursor:pointer';
    this.boardBox = document.createElement('div');
    this.boardBox.className = 'quest-board';
    this.boardBox.hidden = true;
    this.boardBox.style.cssText =
      'pointer-events:auto;position:absolute;right:12px;top:12px;min-width:180px;background:rgba(8,16,40,.92);' +
      'border:2px solid #4a6cff;border-radius:6px;padding:8px;color:#e8ecff;font:13px/1.4 monospace';
    this.messageBox.addEventListener('click', () => this.advance());
    this.root.append(this.boardBox, this.messageBox);
    const parent = anchor.parentElement ?? document.body;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.append(this.root);
    this.place();
    window.addEventListener('resize', this.onResize);
  }

  // The canvas is only part of its container, so the overlay is sized to the
  // canvas rather than stretched over the whole box.
  private place(): void {
    const a = this.anchor;
    this.root.style.left = `${a.offsetLeft}px`;
    this.root.style.top = `${a.offsetTop}px`;
    this.root.style.width = `${a.offsetWidth}px`;
    this.root.style.height = `${a.offsetHeight}px`;
  }

  private pages: string[] = [];
  private page = 0;

  showMessage(m: QuestMessage): void {
    this.place();
    if (m.kind === 'questBoard') {
      this.boardBox.replaceChildren(textBlock(m.pages.join('\n')));
      this.boardBox.hidden = false;
      return;
    }
    this.pages = m.pages;
    this.page = 0;
    this.render();
  }

  private render(): void {
    this.messageBox.replaceChildren(textBlock(this.pages[this.page] ?? ''), hint(this.pages.length > this.page + 1 ? 'click for more' : 'click to continue'));
    this.messageBox.hidden = false;
  }

  private advance(): void {
    if (this.page + 1 < this.pages.length) {
      this.page++;
      this.render();
      return;
    }
    this.messageBox.hidden = true;
    this.onMessageDismissed();
  }

  showList(choices: string[], pick: (i: number) => void): void {
    this.messageBox.replaceChildren(
      ...choices.map((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = c;
        b.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:2px 0';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.messageBox.hidden = true;
          pick(i);
        });
        return b;
      }),
    );
    this.messageBox.hidden = false;
  }

  showBoard(items: QuestBoardItem[], session: QuestSession, select: (item: QuestBoardItem) => void): void {
    // An item only appears when its display register (r74..r79) is 1.
    const visible = items.filter((it) => session.vm.regsI[74 + it.index] === 1);
    if (!visible.length) {
      this.boardBox.hidden = true;
      return;
    }
    const title = document.createElement('div');
    title.textContent = 'Quest Board';
    title.style.cssText = 'font-weight:bold;margin-bottom:4px';
    this.boardBox.replaceChildren(
      title,
      ...visible.map((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = it.name;
        b.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:2px 0';
        b.addEventListener('click', () => {
          session.vm.startThread(it.label);
          select(it);
        });
        return b;
      }),
    );
    this.boardBox.hidden = false;
  }

  closeMessage(kind: QuestMessage['kind']): void {
    if (kind === 'questBoard') this.boardBox.hidden = true;
    else this.messageBox.hidden = true;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}

function textBlock(text: string): HTMLElement {
  const d = document.createElement('div');
  d.textContent = text;
  return d;
}

function hint(text: string): HTMLElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'margin-top:6px;opacity:.55;font-size:11px';
  return d;
}

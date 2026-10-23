// Everything between the player and the scripts while in a game: talking to
// NPCs, the area script of Pioneer 2 / the Lab, the quest's NPC threads and
// talk zones, the counters (Hunter's Guild, government) with the quest menu,
// the reward, and the quest's NPC players (6x69).
//
// Two script VMs can be live, like the exe's two quest pointers:
//   - the area script (g_CurrentQuestDataPointer): map_city_on_e.bin on
//     Pioneer 2, map_labo_on_e.bin in the Lab (formats/npcmodels.ts
//     cityScriptFile), loaded when the floor is entered. The townspeople talk
//     in it (talk action >= 1000) and the counter clerks open their menus from
//     it with bb_p2_menu;
//   - the quest (g_CurrentQuestPointer, quest/run.ts), whose NPCs talk with
//     actions 100..999 and whose at_coords_talk zones answer the action
//     button.
//
// The Hunter's Guild counter (CreateMedicalCenterDialog_006cafb8 -> the online
// dialog MedicalCenterDialog_Constructor_006cd830 and its states) works on
// quest registers r255 / r253 once a quest runs (GameListMenu_ProcessQuest
// ResultState_006cdd30): r255 = 1 is a success (text 11, then the
// set_qt_success label runs: the reward), r253 = 1 a failure (text 18 and the
// failure label), otherwise "How is everything?" (2) and the offer to cancel
// (8; yes runs the set_qt_cancel label). Without a quest it asks the server
// for the quest menu (A2; flag 1 at the government counter, newserv on_A2)
// and loads the chosen quest (10 -> 44/13, net/quests.ts). The clerk's lines
// are unitxt_shop group 1 (Hunter's Guild), 17 (the G-general counter) and 18
// (the Lab counter), in the clerk window at GUI position 0x2e, 332 x 80
// (MedicalCenterDialog_ProcessState_006ce004; quest/questui.ts).
//
// The shop, bank, tekker and Medical Center counters (bb_p2_menu 0, 2, 3, 5,
// 6, 1) run in the field HUD (classic/shop.ts via render/fieldhud.ts
// openCounter). The Present Counter (8, the Momoka item exchange) runs here
// with the quest's create-item table (quest/giveaway.ts).

import * as THREE from 'three';
import { parseUnitxt } from '../classic/charcreate_text.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { COUNTER_MENUS } from '../classic/shop.ts';
import { cityScriptFile, P2_MENUS, P2_MENU_GOVERNMENT, P2_MENU_GUILD, P2_MENU_PRESENT } from '../formats/npcmodels.ts';
import { itemRowName } from '../classic/itempack.ts';
import type { ItemNames } from '../formats/itemnames.ts';
import { buildMomokaExchange } from '../net/items.ts';
import { argItemBytes, PRESENT_TEXT, PRESENT_TIMEOUT_MS, presentItem, presentOffer, presentTokens, type MomokaExchangeRequest } from './giveaway.ts';
import { buildMesetaReward, buildNpcControl, buildTeleport, NPC_PLAYER_FILE, parseNpcControl, parseNpcPlayerTemplates, type NpcPlayerTemplate } from '../formats/npcplayerchar.ts';
import { parseQuestBin } from '../formats/questbin.ts';
import { CLASS_NAMES } from '../net/bbsession.ts';
import type { Game } from '../net/game.ts';
import type { LobbyPlayer } from '../net/lobby.ts';
import type { QuestClient, QuestMenuEntry } from '../net/quests.ts';
import type { GameView } from '../render/gameview.ts';
import type { NpcInstance } from '../render/npcview.ts';
import { QuestUi } from './questui.ts';
import type { QuestSession } from './session.ts';
import { QuestVM, type QuestCoordsHandler, type QuestMessage, type QuestNpcRequest, type QuestThread, type QuestVMHost } from './vm.ts';

const DEG_TO_RAD = Math.PI / 180;

export interface QuestTownOptions {
  game: Game;
  view: GameView;
  files: ClientFiles;
  canvas: HTMLCanvasElement;
  quests: () => QuestClient | null;
  heroName?: () => string;
  heroClass?: () => number;
  // The item names of the Item Pack (the Present Counter's item names).
  itemNames?: () => ItemNames | null;
  log?: (msg: string) => void;
}

export class QuestTown {
  readonly ui: QuestUi;
  private game: Game;
  private view: GameView;
  private files: ClientFiles;
  private opts: QuestTownOptions;
  private log: (msg: string) => void;
  private area: { area: number; file: string; vm: QuestVM } | null = null;
  private areaScripts = new Map<string, Promise<Uint8Array | null>>();
  quest: QuestSession | null = null;
  // The data files and the game canvas, for the overlays other quest modules add (quest/battlerun.ts).
  get clientFiles(): ClientFiles {
    return this.files;
  }
  get canvasElement(): HTMLCanvasElement {
    return this.opts.canvas;
  }
  private shop: string[][] | null = null;
  private templates: NpcPlayerTemplate[] | null = null;
  private counterOpen = false;
  private rewarded: QuestSession | null = null;
  private insideZones = new Set<number>();
  private momokaWaiter: ((code: number) => void) | null = null;
  private disposers: Array<() => void> = [];

  constructor(opts: QuestTownOptions) {
    this.opts = opts;
    this.game = opts.game;
    this.view = opts.view;
    this.files = opts.files;
    this.log = opts.log ?? (() => {});
    this.ui = new QuestUi(opts.canvas);
    void this.ui.load(opts.files).catch((err) => this.log(`quest windows: ${(err as Error).message}`));
    this.ui.camera = () => this.view.camera;
    this.ui.speakerHead = (target) => this.speakerHead(target);
    // Only what waited moves on: a balloon / window, the board text, or both
    // (the exe's yields each read the decide key themselves).
    this.ui.onAdvance = ({ message, board }) => {
      if (message) {
        this.area?.vm.dismissMessage();
        this.quest?.vm.dismissMessage();
      }
      if (board) {
        this.area?.vm.dismissBoard();
        this.quest?.vm.dismissBoard();
      }
    };
    // While the main menu holds the keys (a Quest Board item's thread runs,
    // classic/questboard.ts), its lists and board text still take them.
    this.view.questKey = (e) => this.ui.menuKey(e);
    this.ui.onAction = () => this.action();
    this.ui.onTick = () => this.tick();
    this.view.inputBlocked = () => this.ui.blocking || this.view.npcs.talking || this.counterOpen;
    const npcs = this.view.npcs;
    npcs.host = {
      log: this.log,
      questRegister: (r) => this.quest?.vm.regsI[r & 0xff] ?? 0,
      areaRegister: (r) => this.area?.vm.regsI[r & 0xff] ?? 0,
      facePlayer: (angle) => this.view.setSelfAngle(angle),
      cameraView: () => this.view.cameraView(),
      defaultTalkCamera: () => this.view.talkCameraTurn(),
      defaultTalkEnd: () => this.view.talkCameraEnd(),
      talk: (npc) => this.talk(npc),
    };
    const onFloor = () => void this.enterFloor();
    this.view.floorHooks.add(onFloor);
    this.disposers.push(() => this.view.floorHooks.delete(onFloor));
    // S->C 0x23: the Momoka exchange's answer (flag = result), see present().
    this.game.on('momokaResult', (code) => {
      const waiter = this.momokaWaiter;
      this.momokaWaiter = null;
      waiter?.(code);
    });
    // Another player's 6x69 makes the same NPC player here.
    this.game.on('subcommand', (sub, clientId, body) => {
      if (sub === 0x69 && clientId !== this.game.selfId) {
        const c = parseNpcControl(body);
        if (c) void this.npcControl(c, false);
      }
    });
    if (this.view.current) void this.enterFloor();
  }

  // --- the area script -----------------------------------------------------

  private async enterFloor(): Promise<void> {
    const cur = this.view.current;
    this.insideZones.clear();
    if (!cur) return;
    const name = cityScriptFile(cur.area, !this.game.info?.solo, 'e');
    if (this.area && this.area.file === name) return;
    this.area = null;
    if (!name) return;
    let p = this.areaScripts.get(name);
    if (!p) {
      p = this.files.read(name).catch(() => null);
      this.areaScripts.set(name, p);
    }
    const data = await p;
    if (!data || this.view.current !== cur) return;
    try {
      const vm = new QuestVM({ bin: parseQuestBin(data), episode: this.game.info?.episode ?? 1, host: this.vmHost('area') });
      vm.start();
      this.area = { area: cur.area, file: name, vm };
      this.log(`area script ${name}: ${vm.bin.labels.length} labels`);
    } catch (err) {
      this.log(`area script ${name}: ${(err as Error).message}`);
    }
  }

  // The host both VMs share for text, menus and the reward. The quest's own
  // host (quest/run.ts) adds the game state on top of this.
  vmHost(kind: 'area' | 'quest'): QuestVMHost {
    return {
      log: this.log,
      clientId: () => this.game.selfId,
      difficulty: () => this.game.info?.difficulty ?? 0,
      showMessage: (m) => this.show(m),
      // The main menu holds the controls (the Quest Board window is one of
      // its windows, classic/questboard.ts).
      uiBlockingInput: () => this.view.hud.menu.isOpen,
      closeMessage: (k, target) => {
        if (k === 'message') this.ui.closeBalloon(target);
        else if (k === 'window') this.ui.closeWindow();
        else this.ui.closeBoard();
      },
      showList: (choices) => {
        const vm = kind === 'area' ? this.area?.vm : this.quest?.vm;
        void this.ui.list(choices, { cancellable: false }).then((i) => vm?.answerList(i ?? 0));
      },
      p2Menu: (n) => void this.counter(n),
      momokaExchange: (req) => this.momokaExchange(req),
      addMeseta: (amount) => {
        this.log(`quest reward: ${amount} meseta (6xC9)`);
        this.game.conn.send(0x62, Math.max(0, this.game.leaderId), buildMesetaReward(amount));
      },
      teleport: (clientId, pos) => this.teleport(clientId, pos),
      returnToGuild: () => void this.returnToGuild(),
      npcCreated: (npc) => void this.npcCreated(npc),
      npcKilled: (id) => this.npcKilled(id),
      getQuestFlag: (flag) => this.game.getQuestFlag(flag),
      setQuestFlag: (flag, set) => this.game.setQuestFlag(flag, set),
    };
  }

  private interpolate(s: string): string {
    const hero = this.opts.heroName?.() ?? '';
    const job = CLASS_NAMES[this.opts.heroClass?.() ?? 0] ?? '';
    const vm = this.quest?.vm;
    return s
      .replace(/<cr>/gi, '\n')
      .replace(/<r(\d+)>/gi, (_, n: string) => String(vm?.regsI[Number(n) & 0xff] ?? 0))
      .replace(/<f(\d+)>/gi, (_, n: string) => (vm?.regsF[Number(n) & 0xff] ?? 0).toFixed(6))
      .replace(/<(?:hero name|name hero)>/gi, hero)
      .replace(/<(?:hero job|name job)>/gi, job)
      .replace(/<quest name>/gi, this.quest?.name ?? '')
      .replace(/<time>/gi, '01:12');
  }

  private show(m: QuestMessage): void {
    const text = this.interpolate(m.pages.join('\n'));
    if (m.kind === 'message') this.ui.say(m.target ?? 0, text);
    else if (m.kind === 'window') this.ui.showWindow(text);
    else this.ui.showBoard(text, m.append);
  }

  // A speaker's head: the NPC whose talk action is `target` (>= 100), else
  // the player with that client id (opcode_message .c:604178).
  private speakerHead(target: number): THREE.Vector3 | null {
    if (target >= 100) {
      const n = this.view.npcs.byAction(target);
      return n ? this.view.npcs.head(n) : null;
    }
    return this.view.playerHead(target);
  }

  // --- talking -----------------------------------------------------------------

  private action(): boolean {
    if (this.counterOpen || this.view.npcs.talking) return false;
    const me = this.view.selfPose();
    if (!me) return false;
    const npc = this.view.npcs.talkTarget(me.x, me.z, me.angle);
    if (npc) {
      this.view.npcs.startTalk(npc, me.x, me.z);
      return true;
    }
    // at_coords_talk: the action button becomes "talk" inside the radius.
    const zone = this.zoneAt(me, 'talk');
    if (zone && this.quest) {
      this.log(`quest: talk zone -> label ${zone.label}`);
      this.quest.vm.startThread(zone.label);
      return true;
    }
    return false;
  }

  // EnemyObjectUpdate_0060648c state 1: the talk thread in the quest or the
  // area script; the NPC waits for it (state 2).
  private talk(npc: NpcInstance): Promise<void> {
    const vm = npc.params.script === 'quest' ? this.quest?.vm : this.area?.vm;
    if (!vm) return Promise.resolve();
    const t: QuestThread | null = vm.startThread(npc.params.label);
    this.log(`NPC ${npc.cls.name} (action ${npc.params.action}) talks: ${npc.params.script} label ${npc.params.label}${t ? '' : ' (no code)'}`);
    if (!t) return Promise.resolve();
    return new Promise((resolve) => (t.onDone = resolve));
  }

  private zoneAt(me: { x: number; y: number; z: number }, kind: QuestCoordsHandler['kind']): QuestCoordsHandler | null {
    const vm = this.quest?.vm;
    if (!vm) return null;
    const floor = this.game.self?.floor ?? 0;
    for (const h of vm.coordsHandlers) {
      if (h.kind !== kind || h.floor !== floor) continue;
      const dx = me.x - h.position[0];
      const dz = me.z - h.position[2];
      if (dx * dx + dz * dz <= h.radius * h.radius) return h;
    }
    return null;
  }

  private tick(): void {
    this.area?.vm.frame();
    // A thread waits on the decide key after disp_msg_qb / add_msg, with or
    // without the text window (close_msg_qb does not end the wait).
    this.ui.boardWait = !!(this.area?.vm.boardWaiting || this.quest?.vm.boardWaiting);
    this.view.npcs.updateVisibility();
    // at_coords_call: the thread starts by itself when the player walks in.
    const me = this.view.selfPose();
    const vm = this.quest?.vm;
    if (!me || !vm) return;
    const floor = this.game.self?.floor ?? 0;
    for (const h of vm.coordsHandlers) {
      if (h.kind !== 'call' || h.floor !== floor) continue;
      const dx = me.x - h.position[0];
      const dz = me.z - h.position[2];
      const inside = dx * dx + dz * dz <= h.radius * h.radius;
      if (inside && !this.insideZones.has(h.token)) {
        this.insideZones.add(h.token);
        vm.startThread(h.label);
      } else if (!inside) this.insideZones.delete(h.token);
    }
  }

  // --- counters ---------------------------------------------------------------

  private async shopText(): Promise<string[][]> {
    if (!this.shop) {
      const { data } = await this.files.readFirst(['unitxt_shop_e.prs', 'unitxt_shop_j.prs']);
      this.shop = parseUnitxt(data);
    }
    return this.shop;
  }

  private async counter(menu: number): Promise<void> {
    const kind = COUNTER_MENUS[menu];
    if (kind) {
      if (this.counterOpen) return;
      this.counterOpen = true;
      try {
        await this.view.hud.openCounter(kind);
      } catch (err) {
        this.log(`counter: ${(err as Error).message}`);
      } finally {
        this.counterOpen = false;
      }
      return;
    }
    if (menu === P2_MENU_PRESENT) {
      if (this.counterOpen) return;
      this.counterOpen = true;
      try {
        await this.present();
      } catch (err) {
        this.log(`counter: ${(err as Error).message}`);
      } finally {
        this.ui.closeWindow();
        this.counterOpen = false;
      }
      return;
    }
    if (menu !== P2_MENU_GUILD && menu !== P2_MENU_GOVERNMENT) {
      this.log(`counter "${P2_MENUS[menu] ?? menu}" (bb_p2_menu ${menu}) is not implemented`);
      return;
    }
    if (this.counterOpen) return;
    this.counterOpen = true;
    try {
      await this.guild(menu === P2_MENU_GOVERNMENT);
    } catch (err) {
      this.log(`counter: ${(err as Error).message}`);
    } finally {
      this.ui.closeWindow();
      this.counterOpen = false;
    }
  }

  // The Present Counter (CreateMedicalCenterDialog_006ca84c and its states,
  // quest/giveaway.ts): welcome, the offer list, Is that OK?, then the 6xD9
  // and its answer. Texts: unitxt_shop group 0.
  private async present(): Promise<void> {
    const shop = await this.shopText();
    const text = (i: number, name = '') => this.interpolate(shop[0]?.[i] ?? '').replace('%s', name);
    const bin = this.quest?.vm.bin;
    await this.ui.tell(text(PRESENT_TEXT.welcome));
    const offer = bin ? presentOffer(bin.data, bin.header.hasFullHeader) : null;
    // ASSUMED: with no table the exe opens an empty list; here the counter closes.
    if (!offer) return;
    const names = this.opts.itemNames?.() ?? null;
    const find = presentItem(offer.find, offer.findCount);
    const findName = itemRowName(find, names);
    const rewards = offer.rewards.map((r) => presentItem(r, offer.rewardCount));
    const rewardNames = rewards.map((r) => itemRowName(r, names));
    const yes = shop[0]?.[0] ?? ' Yes ';
    const no = shop[0]?.[1] ?? ' No ';
    for (;;) {
      await this.ui.tell(text(PRESENT_TEXT.offer, findName));
      const pick = await this.ui.list(rewardNames, { title: text(PRESENT_TEXT.title) });
      if (pick === null) {
        await this.ui.tell(text(PRESENT_TEXT.reminder, findName));
        return;
      }
      this.ui.showWindow(text(PRESENT_TEXT.ok), false);
      const ok = await this.ui.yesNo(yes, no);
      this.ui.closeWindow();
      if (!ok) {
        await this.ui.tell(text(PRESENT_TEXT.changed));
        continue;
      }
      const slot = this.game.selfId;
      const { token1, token2 } = presentTokens(offer.rewardCount, slot);
      this.log(`present counter: ${findName} for ${rewardNames[pick]}`);
      const wait = this.momokaResult(PRESENT_TIMEOUT_MS);
      this.sendMomoka(buildMomokaExchange(slot, find, rewards[pick], token1, token2));
      const code = await wait;
      if (code === null) {
        await this.ui.tell(text(PRESENT_TEXT.timeout));
        return;
      }
      const lines = code === 0 ? PRESENT_TEXT.thanks : code === 1 ? PRESENT_TEXT.missing : code === 2 ? PRESENT_TEXT.full : null;
      if (lines === null) {
        await this.ui.tell(text(PRESENT_TEXT.failed));
        return;
      }
      await this.ui.tell(text(lines, findName));
      await this.ui.tell(text(PRESENT_TEXT.reminder, findName));
      return;
    }
  }

  // F95B (bb_replace_item): the same 6xD9 from a quest script, with its labels.
  private momokaExchange(req: MomokaExchangeRequest): void {
    const slot = this.game.selfId;
    const find = presentItem(argItemBytes(req.find), 0);
    const replace = presentItem(argItemBytes(req.replace), 0);
    this.log(`quest: bb_replace_item (6xD9) ${req.find.toString(16)} -> ${req.replace.toString(16)}`);
    this.sendMomoka(buildMomokaExchange(slot, find, replace, req.token1, req.token2, req.label1, req.label2));
  }

  private sendMomoka(body: Uint8Array): void {
    this.game.sendSubcommand(0xd9, body.subarray(4));
  }

  // The answer to the 6xD9 (S->C 0x23 flag), or null after the timeout.
  private momokaResult(ms: number): Promise<number | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.momokaWaiter = null;
        resolve(null);
      }, ms);
      this.momokaWaiter = (code) => {
        clearTimeout(timer);
        resolve(code);
      };
    });
  }

  private async guild(government: boolean): Promise<void> {
    const shop = await this.shopText();
    const group = government ? (this.view.current?.area === 0x12 ? 18 : 17) : 1;
    const line = (i: number) => this.interpolate(shop[group]?.[i] ?? '');
    const yes = shop[0]?.[0] ?? ' Yes ';
    const no = shop[0]?.[1] ?? ' No ';
    const pages = async (i: number) => {
      for (const p of line(i).split('\tP')) await this.ui.tell(p);
    };
    const quest = this.quest;
    if (quest) {
      // GameListMenu_ProcessQuestResultState_006cdd30.
      const vm = quest.vm;
      if (this.rewarded === quest) {
        // The reward was handed out: "That quest was completed." (7) instead
        // of running the success label again.
        await pages(7);
        return;
      }
      if (vm.regsI[0xff] !== 0) {
        await pages(11);
        this.rewarded = quest;
        if (vm.qtSuccess >= 0) await this.runToEnd(vm, vm.qtSuccess);
        return;
      }
      if (vm.regsI[0xfd] !== 0) {
        await pages(18);
        if (vm.qtFailure >= 0) await this.runToEnd(vm, vm.qtFailure);
        return;
      }
      await pages(2);
      await pages(8);
      if (await this.ui.yesNo(yes, no, 1)) {
        await pages(9);
        if (vm.qtCancel >= 0) await this.runToEnd(vm, vm.qtCancel);
      } else await pages(10);
      return;
    }
    const client = this.opts.quests();
    if (!client) {
      await pages(1);
      return;
    }
    await pages(1);
    await pages(4);
    const cats = await client.requestMenu(government);
    for (;;) {
      const ci = cats.length === 1 ? 0 : await this.ui.list(cats.map((c) => c.name));
      if (ci === null) break;
      const entries = await client.selectCategory(cats[ci]);
      for (;;) {
        const qi = await this.ui.list(entries.map((e) => e.name));
        if (qi === null) break;
        const entry: QuestMenuEntry = entries[qi];
        const info = await client.requestInfo(entry);
        this.ui.showWindow(info.replace(/\t[CEJ][0-9A-Za-z]?/g, ''), false);
        const take = await this.ui.list([yes, no], { title: line(5), x: 266, y: 270, cursor: 0 });
        this.ui.closeWindow();
        if (take !== 0) continue;
        this.log(`guild: loading quest "${entry.name}"`);
        void client.selectQuest(entry);
        await pages(6);
        return;
      }
      if (cats.length === 1) break;
    }
    client.closeMenu();
    await pages(12);
  }

  // Runs a label to its end (the reward), the counter waiting on it.
  private runToEnd(vm: QuestVM, label: number): Promise<void> {
    const t = vm.startThread(label);
    if (!t) return Promise.resolve();
    return new Promise((resolve) => (t.onDone = resolve));
  }

  // p_return_guild: Pioneer 2, at the spawn in front of the guild (source 0).
  private async returnToGuild(): Promise<void> {
    const me = this.game.self;
    if (!me) return;
    this.log('quest: p_return_guild');
    if (me.floor !== 0) await this.view.warpTo(0, 0);
  }

  // set_player_start_position: the exe sends 6x24 for that client
  // (SendPacketToPlayer_00688ee4; newserv forwards it only from its own
  // client) and moves it at once. Position in units, angle in degrees.
  private teleport(clientId: number, pos: { x: number; y: number; z: number; angle: number }): void {
    const p = this.game.players.get(clientId);
    if (!p || p.floor !== this.game.self?.floor) return;
    const rad = pos.angle * DEG_TO_RAD;
    this.view.placePlayer(clientId, pos.x, pos.y, pos.z, rad);
    if (clientId === this.game.selfId) {
      const bams = Math.round((pos.angle * 0x10000) / 360) & 0xffff;
      this.game.conn.send(0x60, 0, buildTeleport(clientId, bams, pos.x, pos.y, pos.z));
    }
  }

  // --- NPC players (6x69) --------------------------------------------------------

  private async npcTemplates(): Promise<NpcPlayerTemplate[]> {
    this.templates ??= parseNpcPlayerTemplates(await this.files.read(NPC_PLAYER_FILE));
    return this.templates;
  }

  // npc_crp & co.: 6x69 (create) to everyone and the NPC here; the slot is
  // the first free one (SendPositionBuffer_007b37f0) unless the opcode names it.
  private async npcCreated(npc: QuestNpcRequest): Promise<void> {
    let slot = npc.clientId;
    if (!this.game.players.has(slot) || this.game.players.get(slot)?.npcTemplate !== undefined) {
      // fine: the requested slot is free or already an NPC
    } else {
      slot = [0, 1, 2, 3].find((i) => !this.game.players.has(i)) ?? -1;
    }
    if (slot < 0) return;
    const c = { param1: npc.state, param2: slot, command: 0, param3: npc.template };
    this.game.conn.send(0x60, 0, buildNpcControl(c));
    await this.npcControl(c, true, { x: npc.position[0], y: npc.position[1], z: npc.position[2], angle: npc.angle });
  }

  private npcKilled(slot: number): void {
    if (this.game.players.get(slot)?.npcTemplate === undefined) return;
    this.game.removeLocalPlayer(slot);
  }

  private async npcControl(c: { param1: number; param2: number; command: number; param3: number }, local: boolean, pos?: { x: number; y: number; z: number; angle: number }): Promise<void> {
    if (c.command === 1) {
      this.log(`6x69: NPC ${c.param1} stops acting`);
      return;
    }
    if (c.command === 2) {
      this.log(`6x69: NPC starts acting (following client ${c.param1})`);
      return;
    }
    if (c.command !== 0 && c.command !== 3) return;
    const slot = c.param2;
    const existing = this.game.players.get(slot);
    if (existing && existing.npcTemplate === undefined) return; // a real player (newserv refuses this too)
    const t = (await this.npcTemplates())[c.param3];
    if (!t) return;
    const me = this.game.self;
    const p: LobbyPlayer = {
      clientId: slot,
      guildCardNumber: 0,
      name: t.name,
      charClass: t.charClass,
      sectionId: t.appearance.sectionId,
      level: 1,
      appearance: t.appearance,
      position: pos ? { x: pos.x, y: pos.y, z: pos.z } : { ...(existing?.position ?? me?.position ?? { x: 0, y: 0, z: 0 }) },
      angle: pos ? pos.angle * DEG_TO_RAD : (existing?.angle ?? 0),
      moving: false,
      gait: 'walk',
      floor: me?.floor ?? 0,
      npcTemplate: t.index,
    };
    this.log(`6x69: NPC player "${t.name}" (template ${t.index}, ${CLASS_NAMES[t.charClass] ?? t.charClass}) in slot ${slot}${local ? '' : ' (from another client)'}`);
    if (existing) this.game.removeLocalPlayer(slot);
    this.game.addLocalPlayer(p);
  }

  // --- quests ----------------------------------------------------------------------

  // quest/run.ts registers the running quest here.
  setQuest(session: QuestSession | null): void {
    this.quest = session;
    this.insideZones.clear();
    if (!session) {
      for (const [id, p] of [...this.game.players]) if (p.npcTemplate !== undefined) this.game.removeLocalPlayer(id);
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.view.inputBlocked = () => false;
    this.view.questKey = null;
    this.view.npcs.host = {};
    this.ui.dispose();
  }
}

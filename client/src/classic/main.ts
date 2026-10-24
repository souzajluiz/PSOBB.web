// Entry point of the classic (original-looking) client.

import { BgmPlayer } from '../audio/bgm.ts';
import { se, SE, SePlayer, setSePlayer } from '../audio/se.ts';
import { setShopDialogItems } from '../net/simplemail.ts';
import { ClientFiles } from '../data/clientfiles.ts';
import { HttpSource, pickDataFolder, type DataSource } from '../data/source.ts';
import { BBSession, type CharacterPreview, type MenuItem as ServerMenuItem } from '../net/bbsession.ts';
import { Game, type GameListEntry } from '../net/game.ts';
import type { BBConnection } from '../net/bbconnection.ts';
import type { Lobby } from '../net/lobby.ts';
import type { GuildCardSearchResult } from '../net/guildcard.ts';
import { membershipFromSave, NO_TEAM, TeamClient } from '../net/team.ts';
import { GameView } from '../render/gameview.ts';
import { LobbyView, loadLobbyMapData, lobbyMapFile } from '../render/lobbyview.ts';
import { MapViewer } from '../render/mapviewer.ts';
import { ConnectingScreen, type ConnectingAssets } from './connecting.ts';
import type { BubbleTextures } from './chat.ts';
import { FieldScreen } from './field.ts';
import { FieldTown } from './townfield.ts';
import type { PartyHost } from './gamelist.ts';
import { LobbyScreen, type LobbyHud, type TransportHost } from './lobby.ts';
import type { TeamHost, TeamItemRow } from './teammenu.ts';
import { QuestLoadingScreen } from './questloading.ts';
import { parseItemPMT } from '../formats/itempmt.ts';
import { ItemNames } from '../formats/itemnames.ts';
import { ShipSelectScreen } from './shipselect.ts';
import { connectBridge } from '../net/wstransport.ts';
import { CharCreateScreen, NAME_MAX, type CharCreateAssets } from './charcreate.ts';
import { TEXTURE_FILES } from './charcreate_data.ts';
import { PlayerModelView } from './charcreate_model.ts';
import { menuTextAligned, parseUnitxt, withAlignedMenuText } from './charcreate_text.ts';
import { CharSelectScreen, type CharSelectAssets } from './charselect.ts';
import { SelectPreview } from './charselect_preview.ts';
import { clearGameTextCache, GAME_TEXT } from './gametext.ts';
import { CharaFiles } from './playerview.ts';
import { phoneFit, Stage, tallLayout, textureBitmaps, VH, VW, type Screen } from './stage.ts';
import { LoginForm } from './loginform.ts';
import { NameForm } from './nameform.ts';
import { TitleScreen, type TitleAssets } from './title.ts';
import { DEFAULT_TEXT, type Credentials, type MenuText } from './titleflow.ts';
import { installWebControls, type WebControls } from '../ui/webcontrols.ts';
import { startPadInput } from '../input/padinput.ts';
import { installNoZoom } from '../ui/nozoom.ts';
import { serverUrl } from '../net/server.ts';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { SoftKeyboard } from '../ui/softkeyboard.ts';
import { Loader } from './loader.ts';
import { applyGamePointer } from './cursor.ts';
import { itemRows } from './itempack.ts';
import { installStageFit, lockLandscape } from './viewport.ts';

const VERSION = 'PSOBB.web';
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const loader = new Loader();
let softKeyboard: SoftKeyboard | null = null;
const keyboardFocused = () => softKeyboard?.focused ?? false;
// The current screen has the tall phone layout (Screen.phoneLayout), and its 3D
// view fills the box (Screen.phoneFill: the lobby and the field).
let stageTall = false;
let stageFill = false;
installNoZoom();
// The native app: hide the status bar so the game is fullscreen (the web build
// is fullscreen through the browser, ui/fullscreen.ts).
if (Capacitor.isNativePlatform()) void StatusBar.hide().catch(() => {});
const fit = installStageFit({
  canvases: [canvas, document.getElementById('world') as HTMLCanvasElement],
  hint: document.getElementById('rotate') as HTMLElement,
  keyboardFocused: () => keyboardFocused(),
  tall: () => stageTall,
  fill: () => stageFill,
  onBox: (box) => softKeyboard?.placeButton(box),
});
phoneFit.on = fit.enabled;

async function dataSource(): Promise<DataSource> {
  loader.step('source');
  if (await HttpSource.available()) {
    const http = new HttpSource();
    http.onProgress = (_path, loaded, total) => loader.bytes(loaded, total);
    return http;
  }
  // The folder picker needs a user gesture (and a browser that has one).
  if (!('showDirectoryPicker' in window)) {
    throw new Error('The game data was not found on this server (/psobb-data), and this browser cannot open a local folder (use Chrome or Edge on a computer).');
  }
  await loader.askFolder();
  const s = await pickDataFolder();
  loader.step('source');
  return s;
}

async function loadKey(name = 'default'): Promise<Uint8Array> {
  const res = await fetch(serverUrl(`/keys/${name}.nsk`));
  if (!res.ok) throw new Error(`key file ${name}.nsk not found`);
  return new Uint8Array(await res.arrayBuffer());
}

function savedUser(): string {
  try {
    return localStorage.getItem('psobb.username') ?? '';
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const source = await dataSource();
  const files = new ClientFiles(source);
  // data.gsl is read (and downloaded) with the first file lookup.
  loader.step('archive');
  await files.has('title.prs');
  loader.step('title');
  // The mail filter's word list (smutdata.prs, the exe's InitializeShopDialog_0070ac88; unitxt
  // groups). Not awaited: the first mail comes after the login. Without the file the list is
  // empty and the mail is shown as sent (the exe copies the text then).
  void (async () => {
    try {
      if (await files.has('smutdata.prs')) setShopDialogItems(parseUnitxt(await files.read('smutdata.prs')));
    } catch (err) {
      console.warn(`[mail] smutdata.prs not read: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
  const bgm = new BgmPlayer(source);
  setSePlayer(new SePlayer(source)); // common.pac + city.pac (area 0), as at start-up
  const stage = new Stage(canvas);
  // The game's own pointer (classic/cursor.ts), read from the user's PsoBB.exe; not awaited.
  void applyGamePointer(source, [canvas, document.getElementById('world') as HTMLCanvasElement]);
  const tex =async (names: string[]) => textureBitmaps(await files.textures(names));
  const hyouji = await textureBitmaps(await files.textures('f256_hyouji.prs'));
  // SinowberillInit_006fb914: an account whose AccountCtrl registry key reads
  // "Episode4" (get_game_version() == 1) gets TitleEP4.prs and the Login menu
  // 30 px lower; any other gets title.prs (the psobb.io reference captures).
  const episode4 = new URLSearchParams(location.search).has('ep4');
  const titleAssets: TitleAssets = {
    title: await textureBitmaps(await files.textures(episode4 ? 'TitleEP4.prs' : 'title.prs')),
    effect: await textureBitmaps(await files.textures('effect_nt.xvm')),
    skin: { frame: hyouji[1], bars: hyouji[2] },
  };
  const selectAssets: CharSelectAssets = {
    grid: await tex(['f256_ad_pic_2.prs']),
    backtext: await tex(['f256_backtext.prs']),
    midashi: await tex(['f512_midashi_eng.prs', 'f512_midashi.prs']),
    tag: (await tex(['f256_tag_eng.prs', 'f256_tag.prs']))[0],
    ad: (await tex(['f256_ad_eng.prs', 'f256_ad.prs']))[0],
    playerTex: (await tex(['f256_player_tex_eng.prs', 'f256_player_tex.prs']))[0],
  };

  // unitxt: unitxt_e.prs (else unitxt_j.prs), with group 11 from unitxt_j.prs
  // when the first one's is misaligned (charcreate_text.ts withAlignedMenuText).
  let unitxtLoad: Promise<string[][]> | null = null;
  const loadUnitxt = (): Promise<string[][]> =>
    (unitxtLoad ??= (async () => {
      const table = parseUnitxt((await files.readFirst(['unitxt_e.prs', 'unitxt_j.prs'])).data);
      if (menuTextAligned(table) || !(await files.has('unitxt_j.prs'))) return table;
      return withAlignedMenuText(table, [parseUnitxt(await files.read('unitxt_j.prs'))]);
    })());

  const charaFiles = new CharaFiles(files);
  let modelView: PlayerModelView | null = null;
  let createAssets: CharCreateAssets | null = null;
  const loadCreateAssets = async (): Promise<CharCreateAssets> =>
    (createAssets ??= {
      tex: await textureBitmaps(await files.textures(TEXTURE_FILES)),
      text: await loadUnitxt(),
    });

  let session: BBSession | null = null;
  let credentials = { username: '', password: '' };
  let title: TitleScreen;

  // --- Game server: connecting warp -> ship select (07) -> lobby (67) ------
  const worldCanvas = document.getElementById('world') as HTMLCanvasElement;
  let viewer: MapViewer | null = null;
  let lobbyView: LobbyView | null = null;
  let shownLobby: Lobby | null = null;
  const world = (): MapViewer => (viewer ??= new MapViewer(worldCanvas));
  const showWorld = (on: boolean) => (worldCanvas.hidden = !on);
  let connectingAssets: ConnectingAssets | null = null;
  const loadConnectingAssets = async (): Promise<ConnectingAssets> => {
    if (connectingAssets) return connectingAssets;
    const effect = new Map<number, ImageBitmap>();
    const nt = await files.textures('effect_nt.xvm');
    const bitmaps = await textureBitmaps(nt);
    nt.forEach((t, i) => t.gbix !== undefined && effect.set(t.gbix, bitmaps[i]));
    return (connectingAssets = { particleEntries: await files.read('particleentry.dat'), effect });
  };
  let unitxt: string[][] | null = null;
  const text = async (group: number, index: number): Promise<string> => {
    unitxt ??= await loadUnitxt();
    return (unitxt[group]?.[index] ?? '').replace(/\t[CEJ][0-9A-Za-z]?/g, '');
  };

  // Behind the ship select the client shows the lobby; the camera path is
  // not decoded yet, so it slowly circles the lobby centre (approximation).
  const showLobbyBackdrop = async (lobbyNumber: number) => {
    const v = world();
    showWorld(true);
    await v.load(source, lobbyMapFile(lobbyNumber));
    v.setOrbitEnabled(false);
    let t = 0;
    v.onFrame = (dt) => {
      t += dt * 0.05;
      v.camera.position.set(Math.sin(t) * 260, 120, Math.cos(t) * 260);
      v.camera.lookAt(0, 0, 0);
    };
  };

  // HUD textures and text: f256_hyouji.prs 13 (main menu panel), the
  // TextureEnglish/texturejapanese texlist (0x00a9cd48: texture 0 = name
  // tab of the word balloons, texture 2 = main menu labels).
  let hudTextures: { panel: ImageBitmap; texlist: ImageBitmap[] } | null = null;
  const loadHudTextures = async () =>
    (hudTextures ??= {
      panel: hyouji[13],
      texlist: await textureBitmaps(await files.textures(['textureenglish.xvm', 'texturejapanese.xvm'])),
    });
  // The word balloons of the lobby and of the field.
  const bubbleTextures = async (): Promise<BubbleTextures> => ({ body: hyouji[1], tab: (await loadHudTextures()).texlist[0], symbol: hyouji.slice(9, 13) });
  const loadHud = async (infoCols: LobbyHud['infoCols']): Promise<LobbyHud> => {
    const tex = await loadHudTextures();
    unitxt ??= await loadUnitxt();
    const table = unitxt;
    return {
      skin: titleAssets.skin,
      bubble: { body: hyouji[1], tab: tex.texlist[0], symbol: hyouji.slice(9, 13) },
      menu: { panel: tex.panel, labels: tex.texlist[2] },
      text: (g, i) => (table[g]?.[i] ?? '').replace(/\t[CEJ][0-9A-Za-z]?/g, ''),
      itemIcons: hyouji[1],
      inventory: () => {
        const c = session?.character;
        if (!c) return null;
        return itemRows(c, { names: itemNames, charClass: c.charClass, level: c.level, stats: c.stats, lobby: true }, (table[12]?.[0] ?? '').replace(/\t[CEJ][0-9A-Za-z]?/g, ''));
      },
      infoCols,
      fullCharacter: () => session?.fullCharacter ?? null,
      character: () => session?.character ?? null,
      saveFile: () => session?.sendSaveFile(),
    };
  };
  // Item names for the Item List window (ItemPMT from the stream file, as the
  // Online tab's inventory panel does).
  let itemNames: ItemNames | null = null;
  // The stream file (ItemPMT, PlyLevelTbl, the battle params), read once on
  // the login connection after login (04EB / 03EB); the game server answers it
  // too, but slowly (seconds), and a game needs it before its floor is shown.
  let streamFile: Promise<Map<string, Uint8Array>> | null = null;
  const loadItemNames = async (stream: Promise<Map<string, Uint8Array>>) => {
    try {
      const pmtFile = (await files.has('ItemPMT.prs')) ? await files.read('ItemPMT.prs') : (await stream).get('ItemPMT.prs');
      if (!pmtFile) return;
      const pmt = parseItemPMT(pmtFile);
      unitxt ??= await loadUnitxt();
      let text: string[][] | null = ItemNames.textMatches(pmt, unitxt) ? unitxt : null;
      if (!text) {
        const res = await fetch(serverUrl('/newserv-text/unitxt_e.prs')).catch(() => null);
        if (res?.ok) {
          const t = parseUnitxt(new Uint8Array(await res.arrayBuffer()));
          if (ItemNames.textMatches(pmt, t)) text = t;
        }
      }
      itemNames = new ItemNames(pmt, text);
    } catch (err) {
      console.warn('[classic] item names unavailable', err);
    }
  };

  // The counter's party menus talk to the server through Game (net/game.ts):
  // 08 the list, 09 a game's info, 10 join, C1 create. Once the 64 is in, the
  // game is entered behind its loading screen (enterGame).
  const partyHost = (lobby: Lobby, shipName: string): PartyHost => {
    const ctx = () => ({ guildCardNumber: session?.init?.guildCardNumber ?? 0, fullCharacter: () => session?.fullCharacter ?? null });
    return {
      listGames: () => Game.list(lobby.conn),
      gameInfo: (entry: GameListEntry) => Game.info(lobby.conn, entry),
      join: async (entry, password) => {
        const game = await Game.join(lobby, ctx(), entry.itemId, password);
        game.name ||= entry.name; // 8A brings it later
        void enterGame(game, shipName);
      },
      create: async (options) => void enterGame(await Game.create(lobby, ctx(), options), shipName),
    };
  };

  // After the 64 the exe shows the warp burst as the loading screen (type
  // lobby: get_warp_type answers 2 for the join flag, see connecting.ts),
  // loads Pioneer 2 behind it and sends 6x3F / 6x1F / 6x3B / 6x23 / 6F once
  // it is loaded (the game loop 0x007bcc4c). Here the field is the Online
  // tab's GameView on the 3D canvas (classic/field.ts). A load that fails
  // shows its message on the loading screen; Enter goes back to the lobby.
  let gameView: GameView | null = null;
  // The game's NPCs, counters and quests (classic/townfield.ts).
  let townField: FieldTown | null = null;
  const enterGame = async (game: Game, shipName: string) => {
    game.log = (m) => console.log(`[game] ${m}`);
    // A Simple Mail in a game (0x81): the lobby is detached here, so the game takes it. The exe's
    // 0081 handler is the connection's, not the lobby's (007c8dc4): the mail is kept and SE 0x586 plays.
    game.on('simpleMail', (body) => {
      const box = session?.mailbox ?? null;
      if (box && box.receive(body) === 'stored') se(SE.newMail);
    });
    const assets = await loadConnectingAssets();
    const bubble = await bubbleTextures();
    // The loading screen covers the window; the 3D canvas (and the field HUD
    // sized from it) stays hidden until the floor is loaded.
    showWorld(false);
    const v = world();
    const load = (async () => {
      lobbyView?.dispose();
      lobbyView = null;
      gameView?.dispose();
      townField?.dispose();
      const view = new GameView(v, game, source, game.log, bgm, { character: () => session?.character ?? null, fullCharacter: () => session?.fullCharacter ?? null, saveCustomize: (cfg) => session?.sendCustomize(cfg) }, {
        labels: false,
        ...(streamFile ? { streamFiles: () => streamFile! } : {}),
        // The Home menu's shared leaves in the field (classic/homeleaves.ts): the game is the connection.
        home: () => ({
          guildCards: () => session?.guildCards ?? null,
          guildCardClient: () => session?.guildCardClient ?? null,
          mailbox: () => session?.mailbox ?? null,
          fullCharacter: () => session?.fullCharacter ?? null,
          team: () => teamHost(game, shipName) ?? null,
          meetUser: (reply) => meetWith(reply, shipName),
        }),
      });
      gameView = view;
      // The field Item Pack names its rows and draws the equipment panel from the item names
      // (render/fieldhud.ts names()); the lobby's Item List has them through the same loader.
      view.hud.setNames(() => itemNames);
      view.onLobbyWarp = () => void leaveGame(game, shipName);
      townField = new FieldTown({ game, view, files, canvas: worldCanvas, character: () => session?.character ?? null, log: game.log });
      Object.assign(window, { classicTown: townField.town });
      await view.enter();
      return view;
    })();
    load.catch(() => {}); // reported by the loading screen
    const loading = new ConnectingScreen(
      assets,
      load,
      () =>
        void load.then((view) => {
          console.log(`[classic] entered game "${game.name}"`);
          showWorld(true);
          const field = new FieldScreen(view, worldCanvas, canvas, bubble, fit.enabled, {
            skin: titleAssets.skin,
            symbolChats: () => session?.character?.symbolChats ?? [],
            text: (g, i) => (unitxt?.[g]?.[i] ?? '').replace(/\t[CEJ][0-9A-Za-z]?/g, ''),
          });
          Object.assign(window, { classicGame: field, classicLobby: undefined });
          show(field);
        }),
      (message) => {
        console.error(`[classic] game "${game.name}": ${message}`);
        void leaveGame(game, shipName);
      },
      { status: false },
    );
    Object.assign(window, { classicGameLoading: loading });
    show(loading);
  };

  // The lobby teleporter (or a failed load): 98 / 84, then the lobby again.
  // The lobby loads behind the same warp burst as the game entry (the exe's
  // unknown_init_lobby calls play_loading_screen_animation(floor) too).
  let leaving: Game | null = null;
  const leaveGame = async (game: Game, shipName: string) => {
    if (leaving === game) return;
    leaving = game;
    if (gameView?.game === game) {
      gameView.dispose();
      gameView = null;
    }
    townField?.dispose();
    townField = null;
    Object.assign(window, { classicGame: undefined, classicTown: undefined });
    const assets = await loadConnectingAssets();
    showWorld(false);
    const back = game.leave().then(async (lobby) => ({ lobby, screen: await buildLobby(lobby, shipName) }));
    const loading = new ConnectingScreen(
      assets,
      back,
      () =>
        void back.then(({ lobby, screen }) => {
          showWorld(true);
          showLobby(lobby, screen);
        }),
      (message) => console.error(`[classic] leaving the game failed: ${message}`),
      { status: false },
    );
    Object.assign(window, { classicGameLoading: loading });
    show(loading);
  };

  // The counter's Team menus (teammenu.ts) over the connection's TeamClient
  // (net/team.ts): one per connection, its membership refreshed from the latest
  // E7 save data at each lobby entry (the 12EA updates keep it current).
  let teamClient: { conn: BBConnection; client: TeamClient } | null = null;
  // The last Guild Card search reply of the member list (the exe keeps the 0041 copy in the
  // list window, +0x9c): Meet the User reconnects with it (BBSession.meetUser).
  let memberReply: GuildCardSearchResult | null = null;
  // Meet the User (BBSession.meetUser): reconnects with a Guild Card search reply and shows the
  // new lobby. The Team Member List and the Guild Card search result both come here.
  const meetWith = (reply: GuildCardSearchResult, shipName: string) => {
    const s = session;
    if (!s) return;
    s.meetUser(reply).then(
      (next) => enterLobby(next, shipName),
      (err: unknown) => console.error(err),
    );
  };
  // The local inventory as the Sent Item list wants it (the meseta row is left out by the window).
  const teamItemRows = (): TeamItemRow[] => {
    const c = session?.character;
    if (!c) return [];
    const rows = itemRows(c, { names: itemNames, charClass: c.charClass, level: c.level, stats: c.stats, lobby: true }, '');
    return rows.map((r) => ({ id: r.id, name: r.name, count: Number.parseInt(r.count.replace(/\D/g, ''), 10) || 1 }));
  };
  const teamHost = (owner: Lobby, shipName = ''): TeamHost | undefined => {
    const s = session;
    if (!s?.init) return undefined;
    const gc = s.init.guildCardNumber;
    const conn = owner.conn;
    if (teamClient?.conn !== conn) teamClient = { conn, client: new TeamClient(conn, NO_TEAM, gc) };
    const c = teamClient.client;
    c.membership = membershipFromSave(s.fullCharacter);
    return {
      membership: () => c.membership,
      selfGuildCard: () => gc,
      createTeam: (name) => c.createTeam(name),
      removeMember: (card) => c.removeMember(card),
      members: () => c.members(),
      setPrivilege: (card, privilege) => c.setPrivilege(card, privilege),
      disband: () => c.disband(),
      crossRanking: () => c.crossRanking(),
      // Team Info (0x2b): 18EA and 19EA / 1AEA.
      intraRanking: () => c.intraRanking(),
      rewards: (owned) => c.rewards(owned),
      // Enter on a member row: the Guild Card search (0040 / 0041) of that card, true on an answer.
      searchMember: async (card) => {
        memberReply = (await session?.guildCardClient?.search(gc, card)) ?? null;
        return memberReply != null;
      },
      // Meet the User: reconnect to the searched member's server with the reply (state 0x12).
      meetMember: (card) => {
        const reply = memberReply;
        if (!session || !reply || reply.guildCardNumber !== card) return;
        memberReply = null;
        meetWith(reply, shipName);
      },
      // Sent Item (state 0x15): the trade-state bit of the local slot (IsTradeStateFlagSet_00825abc
      // on the local player's slot, the trade zone), the inventory rows, and the 6xCB send.
      tradeState: () => owner.tradeZone.bit(owner.selfId),
      itemRows: teamItemRows,
      sendItem: async (card, itemId, amount) => {
        // Player_UnequipWeapon_0068ecf8: no packet while the gate is shut, or in a lobby (the exe's
        // player_is_in_lobby); the answer is the server's 16EA flag (newserv on_transfer_item_via_mail_message_bb).
        if (!owner.tradeZone.bit(owner.selfId) || !(owner instanceof Game)) return -1;
        const payload = new Uint8Array(12);
        const v = new DataView(payload.buffer);
        v.setUint32(0, itemId >>> 0, true);
        v.setUint32(4, amount >>> 0, true);
        v.setUint32(8, card >>> 0, true);
        const answer = conn.waitFor(0x16ea);
        owner.sendSubcommand(0xcb, payload);
        return (await answer).flag;
      },
    };
  };

  // The counter's Transport rows: A0 / A1, then the server's menu (07) is the
  // ship select screen again; the connection and the character stay.
  const transportHost = (shipName: string): TransportHost => {
    const go = async (change: (s: BBSession) => Promise<ServerMenuItem[] | null>) => {
      if (!session) return;
      const menu = await change(session);
      const lobby = session.lobby;
      if (!lobby) return;
      if (menu) await showShipSelect(lobby, menu);
      else await enterLobby(lobby, shipName);
    };
    return { changeShip: () => go((s) => s.changeShip()), changeBlock: () => go((s) => s.changeBlock()) };
  };

  // The lobby's screen, built but not shown: leaveGame builds it behind the
  // loading screen and shows it when the burst is done.
  const buildLobby = async (lobby: Lobby, shipName: string): Promise<LobbyScreen> => {
    const v = world();
    lobbyView?.dispose();
    await v.load(source, lobbyMapFile(lobby.lobbyNumber));
    const mapData = await loadLobbyMapData(source, lobby.lobbyNumber, (m) => console.log(`[classic] ${m}`));
    lobbyView = new LobbyView(v, lobby, mapData, { labels: false });
    console.info(`[lobby#${lobby.seq}] lobby view built: lobby ${lobby.lobbyNumber}, ${lobby.players.size} players, markers [${lobbyView.markerIds()}]`);
    const hud = await loadHud(mapData.infoCols ?? []);
    hud.party = partyHost(lobby, shipName);
    const team = teamHost(lobby, shipName);
    if (team) hud.team = team;
    hud.meetUser = (reply) => meetWith(reply, shipName);
    hud.transport = transportHost(shipName);
    hud.guildCards = () => session?.guildCards ?? null;
    hud.guildCardClient = () => session?.guildCardClient ?? null;
    hud.infoBoardClient = () => session?.infoBoardClient ?? null;
    hud.mailbox = () => session?.mailbox ?? null;
    hud.episode4 = episode4;
    return new LobbyScreen(v, lobbyView, lobby, hud, shipName, fit.enabled);
  };
  const showLobby = (lobby: Lobby, screen: LobbyScreen) => {
    lobby.conn.onClose = () => console.warn('[classic] disconnected from the lobby server');
    shownLobby = lobby;
    console.info(`[lobby#${lobby.seq}] showing lobby ${lobby.lobbyNumber} (${lobby.players.size} players)`);
    Object.assign(window, { classicLobby: screen, classicLobbyState: lobby, classicGame: undefined, classicGameLoading: undefined });
    show(screen);
  };
  // Support aid (read-only): the lobby being shown and the players and markers
  // of its LobbyView. Used from the browser console: psoLobbyDebug().
  Object.assign(window, {
    psoLobbyDebug: () => {
      const lobby = shownLobby;
      if (!lobby) return null;
      return {
        lobbyNumber: lobby.lobbyNumber,
        selfId: lobby.selfId,
        players: [...lobby.players.values()].map((p) => ({ id: p.clientId, name: p.name })),
        markers: lobbyView?.markerIds() ?? [],
      };
    },
  });
  const enterLobby = async (lobby: Lobby, shipName: string) => {
    showWorld(true);
    showLobby(lobby, await buildLobby(lobby, shipName));
  };

  const showShipSelect = async (lobby: Lobby, menu: ServerMenuItem[]) => {
    // Entry 0 is the menu title (item_id 0xFFFFFFFF); the 07 handler keeps
    // it as the ship name and titles the window itself.
    const head = menu[0]?.itemId === 0xffffffff ? menu[0] : null;
    const items = head ? menu.slice(1) : menu;
    const block = head ? /^BLOCK/.test(head.name) : false;
    const shipName = head && !block ? head.name : 'newserv';
    await showLobbyBackdrop(0);
    const screen: ShipSelectScreen = new ShipSelectScreen(
      titleAssets.skin,
      block ? 'Block Select' : 'Ship Select',
      items.map((i) => ({ label: i.name })),
      block ? await text(0x0f, 1) : await text(0x0f, 0),
      async (index) => {
        if (!session) return;
        screen.busy = true;
        try {
          const next = await session.selectMenuItem(items[index]);
          // A 19 answer moved the session to another connection (a new Lobby).
          const current = session.lobby ?? lobby;
          if (next) await showShipSelect(current, next);
          else await enterLobby(current, shipName);
        } catch (err) {
          console.error(err);
          screen.busy = false;
        }
      },
      () => {
        session?.close();
        session = null;
        showWorld(false);
        show(title);
      },
      fit.enabled,
    );
    Object.assign(window, { classicShip: screen });
    show(screen);
  };

  const connectToGame = async (slot: number) => {
    if (!session) return;
    const s = session;
    showWorld(false);
    const task = s.connectGameServer(credentials.username, credentials.password, slot);
    const connecting = new ConnectingScreen(
      await loadConnectingAssets(),
      task,
      () => {
        void task.then(async ({ lobby, menu }) => {
          if (menu) await showShipSelect(lobby, menu);
          else await enterLobby(lobby, 'newserv');
        });
      },
      (message) => {
        console.error(`[classic] ${message}`);
        session?.close();
        session = null;
        show(title);
      },
      { phone: fit.enabled },
    );
    show(connecting);
  };

  // The name on a phone: the HTML form (classic/nameform.ts), made when the
  // creation is first shown (its form is not in the page before that).
  let nameForm: NameForm | null = null;

  // Empty slot -> character creation; the result goes out as E5.
  const showCreate = async (slot: number, slots: Array<CharacterPreview | null>) => {
    const create: CharCreateScreen = new CharCreateScreen(
      await loadCreateAssets(),
      {
        done: async (r) => {
          try {
            if (session) {
              await session.createCharacter(slot, {
                name: r.name,
                charClass: r.charClass,
                sectionId: r.sectionId,
                classFlags: r.classFlags,
                ...r.look,
              });
              showSelect(await session.characterPreviews());
            } else {
              console.log('[classic] created (offline)', r);
              showSelect(slots.map((p, i) => (i === slot ? { slot, level: 1, exp: 0, name: r.name, charClass: r.charClass, sectionId: r.sectionId, playTimeSeconds: 0, classFlags: r.classFlags, ...r.look } : p)));
            }
          } catch (err) {
            console.error(err);
            showSelect(slots);
          }
        },
        cancel: () => showSelect(slots),
      },
      (modelView?.dispose(), (modelView = new PlayerModelView(charaFiles))),
      fit.enabled ? { form: (nameForm ??= new NameForm({ parent: document.body, returnFocus: canvas, maxLength: NAME_MAX })) } : null,
    );
    Object.assign(window, { classicCreate: create, classicModel: modelView });
    show(create);
  };

  const showSelect = (slots: Array<CharacterPreview | null>) => {
    const select = new CharSelectScreen(selectAssets, slots, {
      enter: (slot) => {
        if (!slots[slot]) void showCreate(slot, slots);
        else void connectToGame(slot);
      },
      cancel: () => {
        session?.close();
        session = null;
        show(title);
      },
    }, new SelectPreview(charaFiles), fit.enabled);
    Object.assign(window, { classicSelect: select });
    show(select);
  };

  // Start Game, after the title's fade-out: the login server connection runs
  // under the "Connecting.." object (assumed to be the same connect loop as
  // the game server's, FUN_007bd97c); errors wait for Enter, then the title.
  const startGame = async (c: Credentials) => {
    const task = (async () => {
      session?.close();
      session = new BBSession({ nsk: await loadKey(), connect: (port) => connectBridge(port) });
      await session.login(c.user, c.password);
      const stream = session.streamFiles();
      stream.catch(() => {}); // a game asks the game server instead (render/combat.ts)
      streamFile = stream;
      await loadItemNames(stream);
      credentials = { username: c.user, password: c.password };
      try {
        localStorage.setItem('psobb.username', c.user);
      } catch {
        // storage unavailable; nothing to remember
      }
      return session.characterPreviews();
    })();
    const connecting = new ConnectingScreen(
      await loadConnectingAssets(),
      task,
      () => void task.then(showSelect),
      (message) => {
        console.error(`[classic] ${message}`);
        session?.close();
        session = null;
        show(title);
      },
      { phone: fit.enabled },
    );
    show(connecting);
  };

  // The Login menu's texts: unitxt group 41 (0x29).
  loader.step('text');
  const t41 = async (i: number, fallback: string) => (await text(0x29, i)) || fallback;
  const d = DEFAULT_TEXT;
  const menuText: MenuText = {
    title: await t41(2, d.title),
    items: [await t41(3, d.items[0]), await t41(4, d.items[1]), await t41(5, d.items[2]), await t41(6, d.items[3])],
    empty: await t41(7, d.empty),
    input: {
      title: await t41(8, d.input.title),
      user: await t41(9, d.input.user),
      password: await t41(10, d.input.password),
      confirm: await t41(1, d.input.confirm),
      cancel: await t41(0, d.input.cancel),
    },
    reallyOk: await t41(12, d.reallyOk),
    yes: d.yes,
    no: d.no,
  };

  // The exe keeps user name and password in the registry (ACCOUNT and the
  // encrypted password value, ChallengePlayerInfoWindow_Constructor
  // _007617e8); here the user name is remembered and the password only for
  // this page's lifetime.
  title = new TitleScreen(
    titleAssets,
    {
      start: (c) => void startGame(c),
      // No patch server in the browser: back to a new title scene.
      patch: () => show(title),
      exit: () => (location.href = '/'),
    },
    {
      episode4,
      version: VERSION,
      text: menuText,
      credentials: { user: savedUser(), password: '' },
      // A phone (fit mode): the Input UserID window is the HTML form.
      phone: fit.enabled,
      form: fit.enabled ? new LoginForm({ parent: document.body, returnFocus: canvas }) : null,
    },
  );

  let controls: WebControls | null = null;
  let current: Screen = title;
  loader.step('open');
  function show(s: Screen): void {
    current = s;
    stage.show(s);
    // The stage box follows the screen's layout (tall for the phone's title).
    stageTall = s.phoneLayout === true;
    stageFill = s.phoneFill === true;
    fit.refresh();
    controls?.setPadSuppressed(s.touchPad === false);
    controls?.setPadMenu(s.touchMenu === true);
    // The 3D canvas takes the pointer only where the screen asks (the field);
    // elsewhere the stage gets it as before.
    canvas.style.pointerEvents = s.worldPointer ? 'none' : '';
    worldCanvas.style.pointerEvents = s.worldPointer ? 'auto' : '';
    softKeyboard?.sync();
    // BGM per screen, as the exe requests it: title.adx (FUN_006f8130),
    // CHARA.adx for character select/creation (FUN_004df9ec).
    if (s instanceof TitleScreen) void bgm.play('title.adx');
    else if (s instanceof CharSelectScreen || s instanceof CharCreateScreen) void bgm.play('CHARA.adx');
    // LOBBY.ADX in the lobby (FUN_00642c30); silence while connecting.
    else if (s instanceof ShipSelectScreen || s instanceof LobbyScreen) void bgm.play('LOBBY.ADX');
    else if (s instanceof ConnectingScreen) bgm.stop();
  }

  // ?screen=select jumps to the character list with empty slots,
  // ?screen=create to character creation and ?screen=questloading to the quest
  // loading screen, offline (layout work).
  const jump = new URLSearchParams(location.search).get('screen');
  const frozen = Number.parseFloat(new URLSearchParams(location.search).get('t') ?? '');
  if (Number.isFinite(frozen)) stage.freezeTime = stage.time = frozen;
  if (jump === 'select') showSelect([null, null, null, null]);
  else if (jump === 'create') await showCreate(0, [null, null, null, null]);
  else if (jump === 'connecting') show(new ConnectingScreen(await loadConnectingAssets(), new Promise(() => {}), () => {}, () => {}));
  else if (jump === 'questloading') {
    // Layout work: a download of 1 MB at 30 KB a second, started again once done.
    const loading = new QuestLoadingScreen();
    let loaded = -1;
    setInterval(() => {
      loaded = loaded < 0 || loaded >= 1_000_000 ? 0 : loaded + 3_000;
      loading.progress(loaded, 1_000_000);
    }, 100);
    show(loading);
  } else if (jump === 'connecterror') show(new ConnectingScreen(await loadConnectingAssets(), Promise.reject(new Error('Connection refused.')), () => {}, () => show(title)));
  else {
    show(title);
    // ?screen=menu: the Login menu already open; ?screen=input: the Input
    // UserID window over it (layout work against captures).
    if (jump === 'menu' || jump === 'input') title.flow.skipTo(jump);
  }

  // Loaded: the title (or the ?screen= jump) is drawn after two frames.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  loader.finish();

  const toVirtual = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    if (current.phoneFill && r.height > r.width) {
      // The tall fill: the frame is the box, 640 wide and r.height / s high.
      const s = r.width / VW;
      return [(e.clientX - r.left) / s, (e.clientY - r.top) / s] as const;
    }
    if (current.phoneLayout && r.height > r.width) {
      const t = tallLayout(r.width, r.height);
      return [(e.clientX - r.left - t.ox) / t.s, (e.clientY - r.top - t.oy) / t.s] as const;
    }
    const vy = ((e.clientY - r.top) / r.height) * VH;
    const left43 = (current as { layout?: string }).layout === 'left43';
    const windowSpace = (current as { pointerSpace?: string }).pointerSpace === 'window';
    const vx = left43
      ? ((e.clientX - r.left) / r.height) * VH
      : windowSpace
        ? ((e.clientX - r.left - (r.width - (r.height * VW) / VH) / 2) / r.height) * VH
        : ((e.clientX - r.left) / r.width) * VW;
    return [vx, vy] as const;
  };
  const pointer = (e: MouseEvent, click: boolean) =>
    (current as { pointer?: (x: number, y: number, c: boolean) => void }).pointer?.(...toVirtual(e), click);
  canvas.addEventListener('pointermove', (e) => pointer(e, false));
  canvas.addEventListener('click', (e) => pointer(e, true));

  // On-screen keyboard for the canvas text editors (phones): opened from the
  // gesture that starts an editor (a tap, or a key such as the pad's OK).
  const keyboard = new SoftKeyboard({
    parent: document.body,
    canvas,
    editing: () => current.textInput?.() ?? null,
    send: (k) => {
      for (const type of ['keydown', 'keyup'] as const) {
        canvas.dispatchEvent(new KeyboardEvent(type, { key: k.key, code: k.code, bubbles: true, cancelable: true }));
      }
    },
  });
  softKeyboard = keyboard;
  keyboard.placeButton(fit.box);
  for (const type of ['pointerup', 'click', 'keydown'] as const) canvas.addEventListener(type, () => keyboard.sync());
  const keyboardTick = () => {
    keyboard.update();
    requestAnimationFrame(keyboardTick);
  };
  requestAnimationFrame(keyboardTick);

  referenceOverlay();
  // Fullscreen / mute buttons and the touch pad (browser conveniences).
  controls = installWebControls({ root: document.body, fullscreenElement: document.documentElement, keyTarget: canvas, chat: { kind: 'canvas', keyboard }, below: () => fit.below, tall: () => stageTall, fill: () => stageFill });
  // The gamepad's controls become key events on the canvas (input/padinput.ts, the pad config's map).
  startPadInput(canvas);
  controls.setPadSuppressed(current.touchPad === false);
  controls.setPadMenu(current.touchMenu === true);
  // Landscape lock after the fullscreen button (Android Chrome; iOS has none).
  if (fit.enabled) controls.fullscreen.onChange((on) => lockLandscape(on));
  window.addEventListener('pointerdown', () => fit.refresh(), { once: true });
  Object.assign(window, {
    classicStage: stage,
    classicTitle: title,
    GAME_TEXT,
    clearGameTextCache,
    classicTime: (t: number) => (stage.time = t),
    classicCapture: (name: string, w = 2880, h = 1800) => captureStage(stage, name, w, h),
  });
}

// Development aid: renders the current screen at w x h and saves it through the
// dev server (/__capture) for pixel comparison with the original client.
async function captureStage(stage: Stage, name: string, w: number, h: number): Promise<string> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')! as unknown as CanvasRenderingContext2D;
  stage.renderTo(ctx, w, h);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const res = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
  return res.ok ? `saved .captures/${name}.png` : `capture failed: ${res.status}`;
}

// Development aid: ?ref=<name> overlays /ref/<name>.png (a local capture of the
// original client, not committed) on the stage. Keys: F1 cycles opacity,
// F2 toggles difference blending (identical pixels turn black).
function referenceOverlay(): void {
  const ref = new URLSearchParams(location.search).get('ref');
  if (!ref) return;
  const img = document.createElement('img');
  img.src = `/ref/${ref}.png`;
  img.alt = '';
  Object.assign(img.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', opacity: '0.5' });
  const sync = () => {
    const r = canvas.getBoundingClientRect();
    Object.assign(img.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  new ResizeObserver(sync).observe(canvas);
  sync();
  document.body.append(img);
  const opacities = ['0.5', '1', '0'];
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') img.style.opacity = opacities[(opacities.indexOf(img.style.opacity) + 1) % opacities.length];
    if (e.key === 'F2') img.style.mixBlendMode = img.style.mixBlendMode === 'difference' ? '' : 'difference';
  });
}

main().catch((e) => {
  loader.fail(e);
  console.error(e);
});

import { BgmPlayer } from '../audio/bgm.ts';
import { requireDataSource } from '../data/store.ts';
import {
  BBSession,
  CLASS_NAMES,
  SECTION_IDS,
  sectionIdForName,
  type CharacterPreview,
} from '../net/bbsession.ts';
import { DIFFICULTY_NAMES, EPISODE_NAMES, Game, floorToArea, type GameListEntry } from '../net/game.ts';
import type { Lobby, LobbyPlayer } from '../net/lobby.ts';
import { connectBridge } from '../net/wstransport.ts';
import { AREA_NAMES, GameView } from '../render/gameview.ts';
import { LobbyView, loadLobbyMapData, lobbyMapFile } from '../render/lobbyview.ts';
import { MapViewer } from '../render/mapviewer.ts';
import { initInventoryPanel } from './inventoryPanel.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initOnlineTab(log: (msg: string) => void): void {
  const loginForm = $<HTMLFormElement>('login-form');
  const loginStatus = $<HTMLParagraphElement>('login-status');
  const createForm = $<HTMLFormElement>('create-form');
  const classSelect = $<HTMLSelectElement>('create-class');
  classSelect.replaceChildren(...CLASS_NAMES.map((n, i) => new Option(n, String(i))));

  let session: BBSession | null = null;
  let credentials = { username: '', password: '' };
  let createSlot = -1;
  let lobby: Lobby | null = null;
  let lobbyView: LobbyView | null = null;
  let viewer: MapViewer | null = null;
  let game: Game | null = null;
  let gameView: GameView | null = null;
  let busy = false;
  let bgm: BgmPlayer | null = null; // floor music in games (render/gamefield.ts)
  const inventory = initInventoryPanel($('lobby-panel'), log);

  const setStatus = (msg: string, kind: '' | 'ok' | 'err' = '') => {
    loginStatus.textContent = msg;
    loginStatus.className = `status ${kind}`;
  };
  const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  async function loadKey(name = 'default'): Promise<Uint8Array> {
    const res = await fetch(`/keys/${name}.nsk`);
    if (!res.ok) throw new Error(`key file ${name}.nsk not found (run scripts/setup-newserv.sh)`);
    return new Uint8Array(await res.arrayBuffer());
  }

  function renderSlots(slots: Array<CharacterPreview | null>): void {
    $<HTMLOListElement>('char-slots').replaceChildren(
      ...slots.map((c, i) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        if (!c) {
          li.className = 'empty';
          li.append(`Slot ${i + 1}: empty`);
          button.textContent = 'Create';
          button.addEventListener('click', () => openCreate(i));
        } else {
          const name = document.createElement('div');
          name.className = 'name';
          name.textContent = c.name || '(no name)';
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = `Lv ${c.level} ${CLASS_NAMES[c.charClass] ?? `class ${c.charClass}`} · ${SECTION_IDS[c.sectionId] ?? '?'}`;
          li.append(name, meta);
          button.textContent = 'Play';
          button.addEventListener('click', () => void play(i));
        }
        li.append(button);
        return li;
      }),
    );
  }

  async function refreshSlots(): Promise<void> {
    if (!session) return;
    const slots = await session.characterPreviews();
    renderSlots(slots);
    $('chars-panel').hidden = false;
    log(`character slots: ${slots.map((s) => (s ? s.name : '-')).join(', ')}`);
  }

  function openCreate(slot: number): void {
    createSlot = slot;
    $('create-slot').textContent = String(slot + 1);
    createForm.hidden = false;
    createForm.reset();
    updateSection();
    (createForm.elements.namedItem('name') as HTMLInputElement).focus();
  }

  function updateSection(): void {
    const name = (createForm.elements.namedItem('name') as HTMLInputElement).value;
    $('create-section').textContent = name ? SECTION_IDS[sectionIdForName(name, Number((createForm.elements.namedItem('charClass') as HTMLSelectElement).value))] : '-';
  }

  async function play(slot: number): Promise<void> {
    if (!session) return;
    try {
      setStatus('Joining lobby...');
      await inventory.prepare(session, await requireDataSource());
      lobby = await session.enterLobby(credentials.username, credentials.password, slot);
      $('chars-panel').hidden = true;
      $('login-panel').hidden = true;
      $('lobby-panel').hidden = false;
      await showLobby(lobby);
      wireLobby(lobby);
      setStatus(`In lobby ${lobby.lobbyNumber + 1}`, 'ok');
      $('lobby-canvas').focus();
    } catch (err) {
      setStatus(errorText(err), 'err');
      log(`error: ${errorText(err)}`);
    }
  }

  // Lobby map, collision, spawn points and players.
  async function showLobby(l: Lobby): Promise<void> {
    const source = await requireDataSource();
    $('lobby-title').textContent = `· Lobby ${l.lobbyNumber + 1}, block ${l.blockNumber}`;
    viewer ??= new MapViewer($<HTMLCanvasElement>('lobby-canvas'));
    const mapName = lobbyMapFile(l.lobbyNumber);
    await viewer.load(source, mapName);
    log(`lobby map ${mapName} loaded`);
    const mapData = await loadLobbyMapData(source, l.lobbyNumber, log);
    log(`lobby collision: ${mapData.collision?.faceCount ?? 0} faces, ${mapData.spawns.size} spawn points`);
    lobbyView = new LobbyView(viewer, l, mapData);
    renderPlayers(l);
    games.update();
    inventory.show(session?.character ?? null);
  }

  // --- Games (create / list / join, field floors, back to the lobby) ----------

  const ctx = () => ({ guildCardNumber: session?.init?.guildCardNumber ?? 0, fullCharacter: () => session?.fullCharacter ?? null });

  async function enterGame(start: (l: Lobby) => Promise<Game>): Promise<void> {
    if (!lobby || !session || busy || game) return;
    busy = true;
    games.update();
    try {
      const source = await requireDataSource();
      setStatus('Joining game...');
      const g = await start(lobby);
      g.log = log;
      game = g;
      lobbyView?.dispose();
      lobbyView = null;
      viewer ??= new MapViewer($<HTMLCanvasElement>('lobby-canvas'));
      bgm ??= new BgmPlayer(source);
      const view = new GameView(viewer, g, source, log, bgm);
      gameView = view;
      view.onLobbyWarp = () => void leaveGame();
      Object.assign(window, { psoGameView: view, psoBgm: bgm }); // development aid (console)
      view.onFloor = (f) => {
        $('lobby-title').textContent = `· Game "${g.name}" · ${f.name} (floor ${f.floor}) · ${f.enemies} enemies, ${f.objects} objects`;
        renderPlayers(g);
        games.update();
      };
      wireLobby(g);
      const info = g.info!;
      addChat('*', `entered game "${g.name}" (${EPISODE_NAMES[info.episode] ?? ''}, ${DIFFICULTY_NAMES[info.difficulty] ?? ''})`);
      await view.enter();
      setStatus(`In game "${g.name}"`, 'ok');
      $('lobby-canvas').focus();
    } catch (err) {
      setStatus(errorText(err), 'err');
      log(`error: ${errorText(err)}`);
      if (game && !gameView?.current) {
        busy = false;
        await leaveGame();
      }
    } finally {
      busy = false;
      games.update();
    }
  }

  async function leaveGame(): Promise<void> {
    if (!game || busy) return;
    busy = true;
    games.update();
    try {
      gameView?.dispose();
      gameView = null;
      const g = game;
      game = null;
      const l = await g.leave();
      lobby = l;
      await showLobby(l);
      addChat('*', 'back in the lobby');
      setStatus(`In lobby ${l.lobbyNumber + 1}`, 'ok');
    } catch (err) {
      setStatus(errorText(err), 'err');
    } finally {
      busy = false;
      games.update();
    }
  }

  function buildGamePanel(): { update: () => void } {
    const side = document.querySelector<HTMLElement>('.lobby-side')!;
    const box = document.createElement('div');
    box.className = 'game-box';
    box.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin:12px 0';
    const h = document.createElement('h3');
    h.textContent = 'Games';
    const input = (name: string, placeholder: string) => {
      const i = document.createElement('input');
      i.name = name;
      i.placeholder = placeholder;
      i.maxLength = 14;
      i.autocomplete = 'off';
      return i;
    };
    const name = input('game-name', 'Game name');
    const password = input('game-password', 'Password (optional)');
    const difficulty = document.createElement('select');
    difficulty.setAttribute('aria-label', 'Difficulty');
    difficulty.append(...DIFFICULTY_NAMES.map((n, i) => new Option(n, String(i))));
    const episode = document.createElement('select');
    episode.setAttribute('aria-label', 'Episode');
    episode.append(...Object.entries(EPISODE_NAMES).map(([v, n]) => new Option(n, v)));
    const create = document.createElement('button');
    create.type = 'button';
    create.textContent = 'Create game';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'secondary';
    refresh.textContent = 'Refresh game list';
    const list = document.createElement('ul');
    list.className = 'player-list game-list';
    const warp = document.createElement('select');
    warp.setAttribute('aria-label', 'Warp to floor');
    const warpBtn = document.createElement('button');
    warpBtn.type = 'button';
    warpBtn.textContent = 'Warp';
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'secondary';
    leave.textContent = 'Back to lobby';
    const lobbyControls: HTMLElement[] = [name, password, difficulty, episode, create, refresh, list];
    const gameControls: HTMLElement[] = [warp, warpBtn, leave];
    box.append(h, ...lobbyControls, ...gameControls);
    side.querySelector('#leave-lobby')?.before(box);

    create.addEventListener('click', () => {
      const n = name.value.trim() || `${lobby?.self?.name ?? 'web'} game`;
      void enterGame((l) =>
        Game.create(l, ctx(), { name: n.slice(0, 14), password: password.value, difficulty: Number(difficulty.value), episode: Number(episode.value) }),
      );
    });
    refresh.addEventListener('click', () => void refreshList());
    warpBtn.addEventListener('click', () => {
      if (!gameView) return;
      void gameView.warpTo(Number(warp.value)).catch((err) => setStatus(errorText(err), 'err'));
    });
    leave.addEventListener('click', () => void leaveGame());

    async function refreshList(): Promise<void> {
      if (!lobby || game) return;
      try {
        const entries = await Game.list(lobby.conn);
        const empty = document.createElement('li');
        empty.textContent = 'No games';
        list.replaceChildren(...(entries.length ? entries.map(gameItem) : [empty]));
      } catch (err) {
        setStatus(errorText(err), 'err');
      }
    }

    function gameItem(e: GameListEntry): HTMLLIElement {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:6px';
      const mode = e.solo ? ' solo' : e.battle ? ' battle' : e.challenge ? ' challenge' : '';
      li.append(`${e.name} · ${e.players}/${e.maxPlayers} · Ep${e.episode === 3 ? 4 : e.episode} ${DIFFICULTY_NAMES[e.difficulty] ?? ''}${mode}${e.passworded ? ' (password)' : ''}`);
      const join = document.createElement('button');
      join.type = 'button';
      join.textContent = 'Join';
      join.disabled = !e.joinable;
      join.addEventListener('click', () => void enterGame((l) => Game.join(l, ctx(), e.itemId, e.passworded ? password.value : '')));
      li.append(join);
      return li;
    }

    const update = () => {
      const g = game;
      for (const c of lobbyControls) c.hidden = !!g;
      for (const c of gameControls) c.hidden = !g;
      for (const c of [create, refresh, warpBtn, leave]) c.disabled = busy;
      h.textContent = g ? `Game "${g.name}"` : 'Games';
      if (g?.info) {
        const areas = floorToArea(g.info.episode);
        const current = gameView?.current?.floor ?? 0;
        const options: HTMLOptionElement[] = [];
        for (let f = 0; f < 0x0f; f++) {
          const label = AREA_NAMES[areas[f]];
          if (label) options.push(new Option(`${f}: ${label}`, String(f)));
        }
        warp.replaceChildren(...options);
        warp.value = String(current === 0 ? 1 : 0);
      }
    };
    update();
    return { update };
  }

  const games = buildGamePanel();

  function renderPlayers(l: Lobby): void {
    const items = [...l.players.values()]
      .sort((a, b) => a.clientId - b.clientId)
      .map((p: LobbyPlayer) => {
        const li = document.createElement('li');
        li.textContent = `${p.name} · Lv${p.level} ${CLASS_NAMES[p.charClass] ?? ''}${l === game ? ` · floor ${p.floor}` : ''}`;
        if (p.clientId === l.selfId) li.className = 'me';
        return li;
      });
    $<HTMLUListElement>('lobby-players').replaceChildren(...items);
  }

  function addChat(who: string, text: string): void {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'who';
    name.textContent = `${who}: `;
    li.append(name, text);
    const logEl = $<HTMLOListElement>('chat-log');
    logEl.append(li);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function wireLobby(l: Lobby): void {
    renderPlayers(l);
    const announced = new Set<number>();
    l.on('joined', () => announced.clear());
    l.on('playerJoined', (p) => {
      if (l !== (game ?? lobby)) return;
      renderPlayers(l);
      // Games announce a player again when its 6x70 (appearance) arrives.
      if (!announced.has(p.clientId)) addChat('*', `${p.name} joined`);
      announced.add(p.clientId);
    });
    l.on('playerLeft', (id) => {
      announced.delete(id);
      if (l === (game ?? lobby)) renderPlayers(l);
    });
    l.on('floorChanged', () => {
      if (l === game) renderPlayers(l);
    });
    l.on('chat', (from, gc, text) => addChat(from?.name ?? `#${gc}`, text));
    l.conn.onClose = () => {
      addChat('*', 'disconnected from server');
      setStatus('Disconnected', 'err');
    };
  }

  function leaveLobby(): void {
    gameView?.dispose();
    gameView = null;
    game = null;
    lobbyView?.dispose();
    lobbyView = null;
    lobby = null;
    session?.close();
    session = null;
    $('lobby-panel').hidden = true;
    inventory.hide();
    $('login-panel').hidden = false;
    $<HTMLOListElement>('chat-log').replaceChildren();
    setStatus('Left the lobby. Connect again to pick a character.');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(loginForm);
    credentials = { username: String(data.get('username')), password: String(data.get('password')) };
    const button = loginForm.querySelector('button')!;
    button.disabled = true;
    setStatus('Connecting...');
    session?.close();
    try {
      session = new BBSession({ nsk: await loadKey(), connect: (port) => connectBridge(port), log });
      const init = await session.login(credentials.username, credentials.password);
      setStatus(`Connected. Guild Card ${init.guildCardNumber}`, 'ok');
      $('guild-card').textContent = `Guild Card ${init.guildCardNumber}`;
      await refreshSlots();
    } catch (err) {
      setStatus(errorText(err), 'err');
      log(`error: ${errorText(err)}`);
    } finally {
      button.disabled = false;
    }
  });

  createForm.addEventListener('input', updateSection);
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!session || createSlot < 0) return;
    const data = new FormData(createForm);
    try {
      await session.createCharacter(createSlot, {
        name: String(data.get('name')),
        charClass: Number(data.get('charClass')),
      });
      createForm.hidden = true;
      await refreshSlots();
    } catch (err) {
      setStatus(errorText(err), 'err');
    }
  });
  $('create-cancel').addEventListener('click', () => (createForm.hidden = true));

  $<HTMLFormElement>('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem('text') as HTMLInputElement;
    const text = input.value.trim();
    const room = game ?? lobby;
    if (!text || !room) return;
    room.sendChat(text);
    input.value = '';
  });
  $('leave-lobby').addEventListener('click', leaveLobby);
}

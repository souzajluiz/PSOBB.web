import { requireDataSource } from '../data/store.ts';
import {
  BBSession,
  CLASS_NAMES,
  SECTION_IDS,
  sectionIdForName,
  type CharacterPreview,
} from '../net/bbsession.ts';
import type { Lobby, LobbyPlayer } from '../net/lobby.ts';
import { connectBridge } from '../net/wstransport.ts';
import { LobbyView, loadLobbyMapData, lobbyMapFile } from '../render/lobbyview.ts';
import { MapViewer } from '../render/mapviewer.ts';

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
    $('create-section').textContent = name ? SECTION_IDS[sectionIdForName(name)] : '-';
  }

  async function play(slot: number): Promise<void> {
    if (!session) return;
    try {
      setStatus('Joining lobby...');
      const source = await requireDataSource();
      lobby = await session.enterLobby(credentials.username, credentials.password, slot);
      $('chars-panel').hidden = true;
      $('login-panel').hidden = true;
      $('lobby-panel').hidden = false;
      $('lobby-title').textContent = `· Lobby ${lobby.lobbyNumber + 1}, block ${lobby.blockNumber}`;
      viewer ??= new MapViewer($<HTMLCanvasElement>('lobby-canvas'));
      const mapName = lobbyMapFile(lobby.lobbyNumber);
      await viewer.load(source, mapName);
      log(`lobby map ${mapName} loaded`);
      const mapData = await loadLobbyMapData(source, lobby.lobbyNumber, log);
      log(`lobby collision: ${mapData.collision?.faceCount ?? 0} faces, ${mapData.spawns.size} spawn points`);
      lobbyView = new LobbyView(viewer, lobby, mapData);
      wireLobby(lobby);
      setStatus(`In lobby ${lobby.lobbyNumber + 1}`, 'ok');
      $('lobby-canvas').focus();
    } catch (err) {
      setStatus(errorText(err), 'err');
      log(`error: ${errorText(err)}`);
    }
  }

  function renderPlayers(l: Lobby): void {
    const items = [...l.players.values()]
      .sort((a, b) => a.clientId - b.clientId)
      .map((p: LobbyPlayer) => {
        const li = document.createElement('li');
        li.textContent = `${p.name} · Lv${p.level} ${CLASS_NAMES[p.charClass] ?? ''}`;
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
    l.on('playerJoined', (p) => {
      renderPlayers(l);
      addChat('*', `${p.name} joined`);
    });
    l.on('playerLeft', () => renderPlayers(l));
    l.on('chat', (from, gc, text) => addChat(from?.name ?? `#${gc}`, text));
    l.conn.onClose = () => {
      addChat('*', 'disconnected from server');
      setStatus('Disconnected', 'err');
    };
  }

  function leaveLobby(): void {
    lobbyView?.dispose();
    lobbyView = null;
    lobby = null;
    session?.close();
    session = null;
    $('lobby-panel').hidden = true;
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
    if (!text || !lobby) return;
    lobby.sendChat(text);
    input.value = '';
  });
  $('leave-lobby').addEventListener('click', leaveLobby);
}

import { BBSession, CLASS_NAMES, SECTION_IDS, type CharacterPreview } from './net/bbsession.ts';
import { connectBridge } from './net/wstransport.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');
const statusEl = $<HTMLParagraphElement>('login-status');
const form = $<HTMLFormElement>('login-form');

function log(msg: string): void {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(`[psobb] ${msg}`);
}

function setStatus(msg: string, kind: '' | 'ok' | 'err' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

async function loadKey(name = 'default'): Promise<Uint8Array> {
  const res = await fetch(`/keys/${name}.nsk`);
  if (!res.ok) throw new Error(`key file ${name}.nsk not found (run scripts/setup-newserv.sh)`);
  return new Uint8Array(await res.arrayBuffer());
}

function renderSlots(slots: Array<CharacterPreview | null>): void {
  const list = $<HTMLOListElement>('char-slots');
  list.replaceChildren(
    ...slots.map((c, i) => {
      const li = document.createElement('li');
      if (!c) {
        li.className = 'empty';
        li.textContent = `Slot ${i + 1}: empty`;
        return li;
      }
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = c.name || '(no name)';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `Lv ${c.level} ${CLASS_NAMES[c.charClass] ?? `class ${c.charClass}`} · ${SECTION_IDS[c.sectionId] ?? '?'}`;
      li.append(name, meta);
      return li;
    }),
  );
}

let session: BBSession | null = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const button = form.querySelector('button')!;
  button.disabled = true;
  setStatus('Connecting...');
  session?.close();
  try {
    session = new BBSession({ nsk: await loadKey(), connect: (port) => connectBridge(port), log });
    const init = await session.login(String(data.get('username')), String(data.get('password')));
    setStatus(`Connected. Guild Card ${init.guildCardNumber}`, 'ok');
    $('guild-card').textContent = `Guild Card ${init.guildCardNumber}`;
    const slots = await session.characterPreviews();
    renderSlots(slots);
    $('chars-panel').hidden = false;
    log(`character slots: ${slots.map((s) => (s ? s.name : '-')).join(', ')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg, 'err');
    log(`error: ${msg}`);
  } finally {
    button.disabled = false;
  }
});

log('ready. bridge: ws://127.0.0.1:8080 (override with ?bridge=ws://host:port)');

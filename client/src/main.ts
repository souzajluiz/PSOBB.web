import { detectDevDataSource } from './data/store.ts';
import { initMapsTab } from './ui/mapsTab.ts';
import { initOnlineTab } from './ui/onlineTab.ts';
import { bridgeUrl } from './net/wstransport.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');

function log(msg: string): void {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(`[psobb] ${msg}`);
}

initOnlineTab(log);
const mapsTab = initMapsTab(log);

function showTab(name: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[role=tab]')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  }
  $('tab-online').hidden = name !== 'online';
  $('tab-maps').hidden = name !== 'maps';
  if (name === 'maps') mapsTab.activate();
  history.replaceState(null, '', `#${name}`);
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[role=tab]')) {
  b.addEventListener('click', () => showTab(b.dataset.tab!));
}
showTab(location.hash === '#maps' ? 'maps' : 'online');

void detectDevDataSource();
log(`ready. bridge: ${bridgeUrl()} (override with ?bridge=ws://host:port)`);

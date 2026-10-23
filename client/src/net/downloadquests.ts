// Download quests received over A6 / A7 (the lobby's "download quest" pick).
// The original client saves these to the memory card as <name>.bin / <name>.dat;
// the port has no memory card, so each one is kept here, keyed by the quest
// name, and listed under Download Quests.
//
// Storage: IndexedDB when the browser has it (the file bytes are too big for
// localStorage's quota), else an in-memory map. Every IndexedDB request is
// wrapped so a blocked or private-window database degrades to memory instead
// of throwing. Records hold the PRS-compressed files; a record packs to a .qst
// with packQstFiles (formats/qst.ts, A6 / A7 commands) and parses back with parseQst.

import { packQstFiles } from '../formats/qst.ts';
import { prsCompress } from '../formats/prscompress.ts';
import type { LoadedQuest } from './quests.ts';

export interface DownloadQuestRecord {
  key: string; // the quest name; a second copy of the same quest replaces the first
  name: string;
  binFilename: string;
  datFilename: string;
  bin: Uint8Array; // PRS-compressed
  dat: Uint8Array; // PRS-compressed
  savedAt: number; // ms since the epoch
}

export interface DownloadQuestStore {
  list(): Promise<DownloadQuestRecord[]>;
  put(record: DownloadQuestRecord): Promise<void>;
  remove(key: string): Promise<void>;
}

const DB_NAME = 'psobb-download-quests';
const STORE_NAME = 'quests';

// The record for a quest that just arrived. LoadedQuest holds the decompressed
// files (the server's PRS stream is decoded in net/quests.ts), so they are
// compressed again here; PRS round-trips, so the .qst carries the same data.
export function recordForQuest(q: LoadedQuest, savedAt = Date.now()): DownloadQuestRecord {
  return {
    key: q.name,
    name: q.name,
    binFilename: q.binFilename,
    datFilename: q.datFilename,
    bin: prsCompress(q.bin),
    dat: prsCompress(q.dat),
    savedAt,
  };
}

// The .qst a record exports as: the two files and the "PSO/<name>" string,
// written with the A6 / A7 download commands.
export function downloadQuestToQst(r: DownloadQuestRecord): Uint8Array {
  return packQstFiles(
    [
      { filename: r.binFilename, data: r.bin },
      { filename: r.datFilename, data: r.dat },
    ],
    r.name,
    true,
  );
}

const byName = (a: DownloadQuestRecord, b: DownloadQuestRecord): number => a.name.localeCompare(b.name);

export function memoryDownloadQuestStore(): DownloadQuestStore {
  const map = new Map<string, DownloadQuestRecord>();
  return {
    async list() {
      return [...map.values()].sort(byName);
    },
    async put(r) {
      map.set(r.key, r);
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

// IndexedDB-backed store. Falls back to memory when the factory is missing or
// a request fails (blocked database, private window, cleared site data); after
// a failure the store stays in memory for the rest of the session.
export function downloadQuestStore(factory: IDBFactory | undefined = globalThis.indexedDB): DownloadQuestStore {
  const memory = memoryDownloadQuestStore();
  if (!factory) return memory;
  let db: Promise<IDBDatabase> | null = null;
  let failed = false;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('download quest database is blocked'));
    });
    return db;
  };
  // One request in its own transaction. Returns undefined when the database is unusable.
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
    if (failed) return undefined;
    try {
      const d = await open();
      return await new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch {
      failed = true;
      return undefined;
    }
  };
  return {
    async list() {
      const rows = await run<DownloadQuestRecord[]>('readonly', (s) => s.getAll());
      if (rows === undefined) return memory.list();
      return rows.sort(byName);
    },
    async put(r) {
      const ok = await run('readwrite', (s) => s.put(r));
      if (ok === undefined) await memory.put(r);
    },
    async remove(key) {
      const ok = await run('readwrite', (s) => s.delete(key));
      if (ok === undefined) await memory.remove(key);
    },
  };
}

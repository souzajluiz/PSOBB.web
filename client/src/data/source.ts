// Access to the user's PSOBB data/ folder.
//
// Two sources:
//  - DirectorySource: a folder picked with the File System Access API (Chrome).
//    Nothing leaves the user's machine.
//  - HttpSource: a data/ folder the server exposes at /psobb-data/ (the Docker
//    image, docs/DEPLOY.md; in development the Vite dev server, see
//    vite.config.ts). It makes automated testing possible because the native
//    folder picker cannot be scripted, and it is how the native app gets the data.

import { serverUrl } from '../net/server.ts';

export interface DataSource {
  readonly label: string;
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<Uint8Array>;
  // The client's PsoBB.exe (its pointer is read from its resources,
  // classic/cursor.ts), or null when the exe is not reachable from here.
  readExe?(): Promise<Uint8Array | null>;
}

export class DirectorySource implements DataSource {
  readonly label: string;
  private root: FileSystemDirectoryHandle;
  // The install folder's PsoBB.exe, when the picked folder was the install folder.
  private exe: FileSystemFileHandle | null;

  constructor(root: FileSystemDirectoryHandle, exe: FileSystemFileHandle | null = null) {
    this.root = root;
    this.label = root.name;
    this.exe = exe;
  }

  async readExe(): Promise<Uint8Array | null> {
    if (!this.exe) return null;
    return new Uint8Array(await (await this.exe.getFile()).arrayBuffer());
  }

  private async dir(path: string): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part);
    return d;
  }

  async list(dir: string): Promise<string[]> {
    const d = await this.dir(dir);
    const names: string[] = [];
    for await (const [name, handle] of d as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind === 'file') names.push(name);
    }
    return names.sort();
  }

  async read(path: string): Promise<Uint8Array> {
    const parts = path.split('/');
    const file = parts.pop()!;
    const d = await this.dir(parts.join('/'));
    const handle = await d.getFileHandle(file);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }
}

export class HttpSource implements DataSource {
  readonly label = 'dev server (/psobb-data)';
  private base: string;
  // Download progress of a read (the classic page's loader): called as the
  // body arrives. total is 0 when the server sent no Content-Length.
  onProgress: ((path: string, loaded: number, total: number) => void) | null = null;

  constructor(base = serverUrl('/psobb-data')) {
    this.base = base;
  }

  static async available(base = serverUrl('/psobb-data')): Promise<boolean> {
    try {
      return (await fetch(`${base}/?list=scene`)).ok;
    } catch {
      return false;
    }
  }

  // The server's /psobb-exe: the exe named by its PSOBB_EXE setting (bridge/server.mjs), or 404.
  async readExe(): Promise<Uint8Array | null> {
    try {
      const res = await fetch(serverUrl('/psobb-exe'));
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  async list(dir: string): Promise<string[]> {
    const res = await fetch(`${this.base}/?list=${encodeURIComponent(dir)}`);
    if (!res.ok) throw new Error(`cannot list ${dir}`);
    return (await res.json()) as string[];
  }

  async read(path: string): Promise<Uint8Array> {
    const res = await fetch(`${this.base}/${path.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(`cannot read ${path}`);
    if (!this.onProgress || !res.body) return new Uint8Array(await res.arrayBuffer());
    const total = Number(res.headers.get('content-length')) || 0;
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      this.onProgress(path, loaded, total);
    }
    const out = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

// The file names of each directory, listed once per source. The game asks for
// some files only when they exist (the maps' i.bin, r.rel and tam files, the
// texture archive of a map), so checking the listing first avoids a request
// that the server would answer with a 404.
const listings = new WeakMap<DataSource, Map<string, Promise<ReadonlySet<string>>>>();

export function directoryFiles(source: DataSource, dir: string): Promise<ReadonlySet<string>> {
  let byDir = listings.get(source);
  if (!byDir) listings.set(source, (byDir = new Map()));
  let names = byDir.get(dir);
  if (!names) byDir.set(dir, (names = source.list(dir).then((list) => new Set(list))));
  return names;
}

// The first of `names` (file names in `dir`) that the directory holds, or null.
export async function firstPresent(source: DataSource, dir: string, names: readonly string[]): Promise<string | null> {
  const present = await directoryFiles(source, dir);
  return names.find((name) => present.has(name)) ?? null;
}

// Reads `dir/name` when the directory holds it; null otherwise (no request).
export async function readIfPresent(source: DataSource, path: string): Promise<Uint8Array | null> {
  const cut = path.lastIndexOf('/');
  const present = await directoryFiles(source, cut < 0 ? '' : path.slice(0, cut));
  return present.has(path.slice(cut + 1)) ? source.read(path) : null;
}

export async function pickDataFolder(): Promise<DataSource> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  if (!picker) throw new Error('This browser does not support folder access (use Chrome or Edge)');
  let root = await picker({ id: 'psobb-data', mode: 'read' });
  // The install folder keeps PsoBB.exe (the pointer, classic/cursor.ts).
  let exe: FileSystemFileHandle | null = null;
  try {
    exe = await root.getFileHandle('PsoBB.exe');
  } catch {
    // not the install folder
  }
  // Accept either the install folder or its data/ subfolder.
  try {
    root = await root.getDirectoryHandle('data');
  } catch {
    // already the data folder
  }
  await root.getDirectoryHandle('scene');
  return new DirectorySource(root, exe);
}

// Access to the user's PSOBB data/ folder.
//
// Two sources:
//  - DirectorySource: a folder picked with the File System Access API (Chrome).
//    Nothing leaves the user's machine.
//  - HttpSource: the Vite dev server exposes a local client folder at /psobb-data/
//    (see vite.config.ts). Development only; it makes automated testing possible
//    because the native folder picker cannot be scripted.

export interface DataSource {
  readonly label: string;
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<Uint8Array>;
}

export class DirectorySource implements DataSource {
  readonly label: string;
  private root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
    this.label = root.name;
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

  constructor(base = '/psobb-data') {
    this.base = base;
  }

  static async available(base = '/psobb-data'): Promise<boolean> {
    try {
      return (await fetch(`${base}/?list=scene`)).ok;
    } catch {
      return false;
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
    return new Uint8Array(await res.arrayBuffer());
  }
}

export async function pickDataFolder(): Promise<DataSource> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  if (!picker) throw new Error('This browser does not support folder access (use Chrome or Edge)');
  let root = await picker({ id: 'psobb-data', mode: 'read' });
  // Accept either the install folder or its data/ subfolder.
  try {
    root = await root.getDirectoryHandle('data');
  } catch {
    // already the data folder
  }
  await root.getDirectoryHandle('scene');
  return new DirectorySource(root);
}

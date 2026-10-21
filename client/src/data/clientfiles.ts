// Resolves client file names the way the game does: a loose file in data/
// overrides the entry of the same name inside data.gsl.

import { GSLArchive } from '../formats/archives.ts';
import { prsDecompress } from '../formats/prs.ts';
import { parseXvm, type XvrTexture } from '../formats/xvm.ts';
import type { DataSource } from './source.ts';

// Set data the server keeps its own copy of (newserv system/maps/bb-v4).
export const SERVER_SET_DATA = /^(map_[a-z0-9_]+\.(dat|evt)|SetDataTable[A-Za-z]*\.rel)$/;

export interface ClientFilesOptions {
  // Base URL of the server's set data (the dev server's /newserv-maps/). A
  // game takes its maps' entities from there when it has them: the server
  // numbers enemies and objects from its copies, and client data that differs
  // (Ephinea's) would shift every entity id.
  serverSetData?: string;
}

export class ClientFiles {
  private source: DataSource;
  private gsl: GSLArchive | null = null;
  private indexing: Promise<ReadonlySet<string>> | null = null;
  private cache = new Map<string, Promise<Uint8Array>>();
  private opts: ClientFilesOptions;

  constructor(source: DataSource, opts: ClientFilesOptions = {}) {
    this.source = source;
    this.opts = opts;
  }

  private async serverCopy(name: string): Promise<Uint8Array | null> {
    if (!this.opts.serverSetData || !SERVER_SET_DATA.test(name)) return null;
    const res = await fetch(this.opts.serverSetData + name).catch(() => null);
    return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  }

  // One shared load: concurrent reads must all wait for data.gsl, not only
  // for the loose file list.
  private index(): Promise<ReadonlySet<string>> {
    this.indexing ??= (async () => {
      const loose = new Set(await this.source.list(''));
      if (loose.has('data.gsl')) this.gsl = new GSLArchive(await this.source.read('data.gsl'));
      return loose;
    })();
    return this.indexing;
  }

  // The game finds a file whatever the case of its name (the exe asks for Bo04OpCam.rel,
  // data.gsl has bo04opcam.rel). The exact name wins; else the first case-insensitive match.
  private async resolve(name: string): Promise<string | null> {
    const loose = await this.index();
    if (loose.has(name) || this.gsl?.has(name)) return name;
    const lower = name.toLowerCase();
    for (const n of loose) if (n.toLowerCase() === lower) return n;
    for (const n of this.gsl?.entries.keys() ?? []) if (n.toLowerCase() === lower) return n;
    return null;
  }

  async has(name: string): Promise<boolean> {
    return (await this.resolve(name)) !== null;
  }

  // Every file name in data/ and data.gsl (loose files first, no duplicates).
  async names(): Promise<string[]> {
    const loose = await this.index();
    return [...new Set([...loose, ...(this.gsl?.entries.keys() ?? [])])];
  }

  read(name: string): Promise<Uint8Array> {
    let p = this.cache.get(name);
    if (!p) {
      p = (async () => {
        const server = await this.serverCopy(name);
        if (server) return server;
        const real = await this.resolve(name);
        if (real === null) throw new Error(`client file not found: ${name}`);
        if ((await this.index()).has(real)) return this.source.read(real);
        return this.gsl!.get(real);
      })();
      this.cache.set(name, p);
    }
    return p;
  }

  // First name that exists, e.g. ['title_eng.prs', 'title.prs'].
  async readFirst(names: string[]): Promise<{ name: string; data: Uint8Array }> {
    for (const name of names) if (await this.has(name)) return { name, data: await this.read(name) };
    throw new Error(`none of these client files exist: ${names.join(', ')}`);
  }

  // Texture archive (.xvm, or PRS-compressed XVM in .prs).
  async textures(names: string | string[]): Promise<XvrTexture[]> {
    const { name, data } = await this.readFirst(Array.isArray(names) ? names : [names]);
    return parseXvm(name.endsWith('.prs') ? prsDecompress(data) : data);
  }
}

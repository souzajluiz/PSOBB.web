// Resolves client file names the way the game does: a loose file in data/
// overrides the entry of the same name inside data.gsl.

import { GSLArchive } from '../formats/archives.ts';
import { prsDecompress } from '../formats/prs.ts';
import { parseXvm, type XvrTexture } from '../formats/xvm.ts';
import type { DataSource } from './source.ts';

export class ClientFiles {
  private source: DataSource;
  private loose: Set<string> | null = null;
  private gsl: GSLArchive | null = null;
  private cache = new Map<string, Promise<Uint8Array>>();

  constructor(source: DataSource) {
    this.source = source;
  }

  private async index(): Promise<void> {
    if (this.loose) return;
    this.loose = new Set(await this.source.list(''));
    if (this.loose.has('data.gsl')) this.gsl = new GSLArchive(await this.source.read('data.gsl'));
  }

  async has(name: string): Promise<boolean> {
    await this.index();
    return this.loose!.has(name) || !!this.gsl?.has(name);
  }

  read(name: string): Promise<Uint8Array> {
    let p = this.cache.get(name);
    if (!p) {
      p = (async () => {
        await this.index();
        if (this.loose!.has(name)) return this.source.read(name);
        if (this.gsl?.has(name)) return this.gsl.get(name);
        throw new Error(`client file not found: ${name}`);
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

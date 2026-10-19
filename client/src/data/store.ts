// The active PSOBB data source, shared by the map viewer and the online lobby.

import { HttpSource, pickDataFolder, type DataSource } from './source.ts';

let current: DataSource | null = null;
const listeners: Array<(s: DataSource) => void> = [];

export function getDataSource(): DataSource | null {
  return current;
}

export function setDataSource(s: DataSource): void {
  current = s;
  for (const fn of listeners) fn(s);
}

export function onDataSource(fn: (s: DataSource) => void): void {
  listeners.push(fn);
  if (current) fn(current);
}

// Uses the dev endpoint if available; otherwise asks the user for a folder.
export async function requireDataSource(): Promise<DataSource> {
  if (current) return current;
  if (await HttpSource.available()) {
    const http = new HttpSource();
    setDataSource(http);
    return http;
  }
  const picked = await pickDataFolder();
  setDataSource(picked);
  return picked;
}

export async function detectDevDataSource(): Promise<void> {
  if (!current && (await HttpSource.available())) setDataSource(new HttpSource());
}

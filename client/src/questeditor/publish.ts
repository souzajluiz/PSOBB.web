// Quest editor: "Publish to server". Only available when the page is served by
// the PSOBB.web server and the browser holds an admin session (the cookie of
// /admin, shared because the editor is on the same origin). Everything is
// checked again by the server (bridge/admin-quests.mjs, docs/ADMIN.md): this
// module only builds the request. It imports no editor state, so it can be
// tested on its own.

import type { QuestPackage } from './io.ts';

export type PublishFormat = 'pair' | 'qst';

export interface AdminSession {
  csrf: string;
  user: string;
}

export interface QuestDirectory {
  dir: string;
  files: Array<{ name: string; size: number }>;
}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

// The file name newserv wants for a Blue Burst quest: q9001-bb-e.bin (the .dat
// is q9001-bb.dat, named by the server) or q9001-bb.qst.
export function defaultPublishName(stem: string, format: PublishFormat): string {
  const base = stem.replace(/-bb(-[a-z])?$/, '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[.-]+/, '').replace(/\.{2,}/g, '_').slice(0, 40) || 'quest';
  return format === 'qst' ? `${base}-bb.qst` : `${base}-bb-e.bin`;
}

export const PUBLISH_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*-bb(-[a-z])?\.(bin|qst)$/;

export function publishTarget(category: string, name: string): string {
  return `${category}/${name}`;
}

export function buildPublishBody(pkg: QuestPackage, category: string, name: string): Record<string, string> {
  const body: Record<string, string> = { category, name, confirm: publishTarget(category, name) };
  if (name.endsWith('.qst')) body.qst = toBase64(pkg.qst);
  else {
    body.bin = toBase64(pkg.bin);
    body.dat = toBase64(pkg.dat);
  }
  return body;
}

// null when there is no admin panel here, or no session.
export async function adminSession(fetchFn: typeof fetch = fetch): Promise<AdminSession | null> {
  try {
    const res = await fetchFn('/admin/api/session', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const j = (await res.json()) as { authenticated?: boolean; csrf?: string | null; user?: string | null };
    return j.authenticated && j.csrf ? { csrf: j.csrf, user: j.user ?? 'admin' } : null;
  } catch {
    return null;
  }
}

export async function listQuestDirectories(fetchFn: typeof fetch = fetch): Promise<QuestDirectory[]> {
  const res = await fetchFn('/admin/api/quests/files', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  return ((await res.json()) as { directories: QuestDirectory[] }).directories;
}

export interface PublishResult {
  ok: boolean;
  files: Array<{ name: string; size: number; replaced: boolean }>;
  quest: { questNumber: number; name: string };
}

export async function publishQuest(session: AdminSession, body: Record<string, string>, fetchFn: typeof fetch = fetch): Promise<PublishResult> {
  const res = await fetchFn('/admin/api/quests/publish', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: JSON.stringify(body),
  });
  let data: { error?: string } = {};
  try {
    data = (await res.json()) as { error?: string };
  } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error ?? `the server answered ${res.status}`);
  return data as PublishResult;
}

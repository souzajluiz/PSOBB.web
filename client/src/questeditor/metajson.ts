// Quest editor: the quest's newserv metadata file (q9001-bb.json: category flags, enabled /
// available expressions, AllowStartFromChatCommand ...). Read and written through the admin
// panel's routes (bridge/admin-quests.mjs, docs/ADMIN.md); the server checks everything again.
// Pure helpers and requests, no editor state, so tests can use them on their own.

import type { AdminSession } from './publish.ts';

// Same rule as the server (JSON_NAME_RE in bridge/admin-quests.mjs): q058.json, q058-bb.json, q058-bb-e.json.
export const JSON_NAME_RE = /^[A-Za-z]?\d{1,6}(-[A-Za-z0-9]{1,8}){0,2}\.json$/;
export const MAX_JSON_BYTES = 64 * 1024;

export const JSON_TEMPLATE = '{\n  "AllowStartFromChatCommand": true\n}\n';

// The Blue Burst metadata file name for a quest file stem: q9001-bb-e -> q9001-bb.json
export function defaultJsonName(stem: string): string {
  const base = stem.replace(/\.(bin|dat|qst|json)$/, '').replace(/-bb(-[a-z])?$/, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  return `${base || 'quest'}-bb.json`;
}

// null when `text` is acceptable (a JSON object within the size limit), else the reason.
export function checkJsonText(text: string): string | null {
  if (text.trim() === '') return 'The text is empty.';
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) return `Larger than ${MAX_JSON_BYTES / 1024} KB.`;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return `Not valid JSON: ${(e as Error).message}`;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'The quest .json must be an object ({ ... }).';
  return null;
}

export function buildJsonBody(category: string, name: string, json: string): { category: string; name: string; json: string; confirm: string } {
  return { category, name, json, confirm: `${category}/${name}` };
}

// The file's text, or null when it does not exist.
export async function loadQuestJson(category: string, name: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(`/admin/api/quests/file/${encodeURIComponent(category)}/${encodeURIComponent(name)}`, { credentials: 'same-origin' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  return res.text();
}

export async function saveQuestJson(session: AdminSession, body: ReturnType<typeof buildJsonBody>, fetchFn: typeof fetch = fetch): Promise<{ replaced: boolean }> {
  const res = await fetchFn('/admin/api/quests/json', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: JSON.stringify(body),
  });
  let data: { error?: string; files?: Array<{ replaced: boolean }> } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error ?? `the server answered ${res.status}`);
  return { replaced: data.files?.[0]?.replaced ?? false };
}

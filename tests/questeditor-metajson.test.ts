// Quest editor: the quest .json helpers (name rule, text check, request bodies, fetch calls with a fake fetch).
//
// Run: node tests/questeditor-metajson.test.ts
import { buildJsonBody, checkJsonText, defaultJsonName, JSON_NAME_RE, loadQuestJson, saveQuestJson } from '../client/src/questeditor/metajson.ts';

let failures = 0;
let checks = 0;
const eq = (a: unknown, b: unknown, msg: string) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

eq(defaultJsonName('q9001-bb-e'), 'q9001-bb.json', 'default name from a .bin stem');
eq(defaultJsonName('q9001-bb.qst'), 'q9001-bb.json', 'default name from a .qst file name');
eq(defaultJsonName('q9001'), 'q9001-bb.json', 'default name from a bare number');
eq(defaultJsonName(''), 'quest-bb.json', 'default name from nothing');
for (const ok of ['q058.json', 'q058-bb.json', 'q058-bb-e.json', 'd8825.json', '9001-bb.json']) eq(JSON_NAME_RE.test(ok), true, `name ok: ${ok}`);
for (const bad of ['config.json', '../q1.json', 'q1.json.exe', '.q1.json', 'quest-bb.json', 'q1/x.json', 'q1-bb-e-x-y.json', 'q1.JSON']) eq(JSON_NAME_RE.test(bad), false, `name refused: ${bad}`);

eq(checkJsonText('{"AllowStartFromChatCommand": true}'), null, 'an object is fine');
eq(checkJsonText('{}'), null, 'an empty object is fine');
eq(checkJsonText('  '), 'The text is empty.', 'blank');
eq(checkJsonText('[1]'), 'The quest .json must be an object ({ ... }).', 'array');
eq(checkJsonText('3'), 'The quest .json must be an object ({ ... }).', 'number');
eq(checkJsonText('null'), 'The quest .json must be an object ({ ... }).', 'null');
eq(checkJsonText('{"a":')?.startsWith('Not valid JSON'), true, 'syntax error');
eq(checkJsonText(`{"a":"${'x'.repeat(70000)}"}`), 'Larger than 64 KB.', 'too large');

eq(buildJsonBody('hidden', 'q1-bb.json', '{}'), { category: 'hidden', name: 'q1-bb.json', json: '{}', confirm: 'hidden/q1-bb.json' }, 'body');

const calls: Array<{ url: string; init?: RequestInit }> = [];
const fake = (status: number, body: string) => (async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  return new Response(body, { status });
}) as unknown as typeof fetch;
eq(await loadQuestJson('hidden', 'q1-bb.json', fake(200, '{"a":1}')), '{"a":1}', 'load returns the text');
eq(calls[0].url, '/admin/api/quests/file/hidden/q1-bb.json', 'load url');
eq(await loadQuestJson('hidden', 'q1-bb.json', fake(404, '{"error":"no such file"}')), null, 'load of a missing file is null');
let threw = '';
try {
  await loadQuestJson('hidden', 'q1-bb.json', fake(500, 'x'));
} catch (e) {
  threw = (e as Error).message;
}
eq(threw, 'the server answered 500', 'load error');
const session = { csrf: 'tok', user: 'admin' };
eq(await saveQuestJson(session, buildJsonBody('hidden', 'q1-bb.json', '{}'), fake(200, '{"ok":true,"files":[{"name":"q1-bb.json","size":2,"replaced":true}]}')), { replaced: true }, 'save result');
const last = calls[calls.length - 1];
eq(last.url, '/admin/api/quests/json', 'save url');
eq((last.init?.headers as Record<string, string>)['X-CSRF-Token'], 'tok', 'save sends the CSRF token');
eq(JSON.parse(String(last.init?.body)).confirm, 'hidden/q1-bb.json', 'save sends the confirmation');
threw = '';
try {
  await saveQuestJson(session, buildJsonBody('hidden', 'q1-bb.json', '{'), fake(422, '{"error":"not valid JSON: x"}'));
} catch (e) {
  threw = (e as Error).message;
}
eq(threw, 'not valid JSON: x', 'save error text from the server');

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

// Quest editor: the "Test in game" hook. The editor does not talk to a game server;
// whoever embeds it (the admin panel) registers a handler that takes the built
// quest package and puts it on a server. Until one is registered the call posts
// the package to the opener / parent window ('questeditor:test'), if there is one.
//
//   registerTestInGame((pkg) => uploadToNewserv(pkg));   // in the embedding page
//   await testInGame(editor.document);                    // the editor's button
//
// The same functions are on window.questEditor for pages that cannot import this
// module (see main.ts).

import { buildPackage, type QuestPackage } from './io.ts';
import type { QuestDocument } from './model.ts';

export type TestInGameHandler = (pkg: QuestPackage) => void | Promise<void>;

let handler: TestInGameHandler | null = null;

export function registerTestInGame(fn: TestInGameHandler | null): void {
  handler = fn;
}

export type TestInGameResult = 'handled' | 'posted' | 'no-target';

export async function testInGame(doc: QuestDocument): Promise<TestInGameResult> {
  const pkg = buildPackage(doc);
  if (handler) {
    await handler(pkg);
    return 'handled';
  }
  const target = window.opener && window.opener !== window ? window.opener : window.parent !== window ? window.parent : null;
  if (target) {
    (target as Window).postMessage({ type: 'questeditor:test', package: pkg }, window.location.origin);
    return 'posted';
  }
  return 'no-target';
}

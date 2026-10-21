// The classic field's quest link (client/src/classic/townfield.ts): one
// QuestClient per connection, its quests routed to the game that runs now.
// Run: node tests/townfield.test.ts
import { questLink } from '../client/src/classic/townfield.ts';
import type { BBConnection } from '../client/src/net/bbconnection.ts';
import type { LoadedQuest } from '../client/src/net/quests.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// A connection that only takes the QuestClient's onCommand chain.
const fakeConn = () => ({ onCommand: (_c: unknown) => {}, send: () => {} }) as unknown as BBConnection;
const quest = (name: string) => ({ name }) as unknown as LoadedQuest;

const conn = fakeConn();
const first = questLink(conn);
check(questLink(conn) === first, 'the same connection keeps its quest link');
check(questLink(fakeConn()) !== first, 'another connection gets its own link');
check(first.client !== null, 'the link holds a QuestClient');

// No game running: a loaded quest goes nowhere (and does not throw).
let routed: string[] = [];
first.route(quest('dropped'));
check(routed.length === 0, 'no target: the quest is dropped');

// The running game's target gets the quests.
first.target = (q) => routed.push(q.name);
first.route(quest('mop-up'));
check(routed.join(',') === 'mop-up', 'the target gets the quest');

// The next game replaces the target, the old one gets nothing.
const old = routed;
routed = [];
first.target = null;
first.route(quest('after leave'));
check(routed.length === 0 && old.length === 1, 'a left game (null target) gets nothing');

// The link keeps its client across games: the same QuestClient is handed out.
const client = first.client;
check(questLink(conn).client === client, 'the QuestClient is installed once per connection');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('townfield: all checks passed');

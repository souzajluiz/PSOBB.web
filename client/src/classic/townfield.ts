// Pioneer 2's people on the classic page: the NPC talk, the counters (the
// shops, the bank, the Hunter's Guild) and the quests the guild counter
// starts. The Online tab builds the same QuestTown (quest/town.ts) and quest
// runner (quest/run.ts) for its game; this is that wiring for the classic
// field (classic/field.ts), whose GameView draws on the 3D canvas.
//
// The quest menu and the quest files travel on the game's connection, which
// the lobby keeps: one QuestClient per connection (it chains onCommand), and
// the quest it starts goes to the game that runs now.

import type { ClientFiles } from '../data/clientfiles.ts';
import type { BBConnection } from '../net/bbconnection.ts';
import type { CharacterFile } from '../net/charfile.ts';
import type { Game } from '../net/game.ts';
import { QuestClient, type LoadedQuest } from '../net/quests.ts';
import type { GameView } from '../render/gameview.ts';
import { runQuest, type QuestRunner } from '../quest/run.ts';
import { QuestTown } from '../quest/town.ts';

// The quest client of a connection and the place its quests go to.
export interface QuestLink {
  client: QuestClient;
  // Set by the game that runs now (null: no game, the quest is dropped).
  target: ((q: LoadedQuest) => void) | null;
  // Hands a loaded quest to the target (the QuestClient's onQuest).
  route(q: LoadedQuest): void;
}

const links = new WeakMap<BBConnection, QuestLink>();

// The connection's quest link, installed on the first use.
export function questLink(conn: BBConnection, log: (msg: string) => void = () => {}): QuestLink {
  const have = links.get(conn);
  if (have) return have;
  const link: QuestLink = {
    client: null!,
    target: null,
    route(q) {
      link.target?.(q);
    },
  };
  link.client = new QuestClient(conn, { log, onQuest: (q) => link.route(q) });
  links.set(conn, link);
  return link;
}

export interface FieldTownOptions {
  game: Game;
  view: GameView;
  files: ClientFiles;
  canvas: HTMLCanvasElement;
  character: () => CharacterFile | null;
  log?: (msg: string) => void;
}

// One game's town: the QuestTown (talk, counters, area script) and the running quest.
export class FieldTown {
  readonly town: QuestTown;
  private opts: FieldTownOptions;
  private link: QuestLink;
  private runner: QuestRunner | null = null;
  private target = (q: LoadedQuest) => void this.start(q);

  constructor(opts: FieldTownOptions) {
    this.opts = opts;
    const log = opts.log ?? (() => {});
    this.link = questLink(opts.game.conn, log);
    this.link.target = this.target;
    this.town = new QuestTown({
      game: opts.game,
      view: opts.view,
      files: opts.files,
      canvas: opts.canvas,
      quests: () => this.link.client,
      heroName: () => opts.character()?.name ?? '',
      heroClass: () => opts.character()?.charClass ?? 0,
      log,
    });
  }

  private async start(q: LoadedQuest): Promise<void> {
    const { game, view } = this.opts;
    const log = this.opts.log ?? (() => {});
    try {
      this.runner?.dispose();
      this.runner = await runQuest({
        quest: q,
        game,
        view,
        town: this.town,
        log,
        inventory: () => this.opts.character()?.inventory.map((i) => ({ id: i.data.id, data1: i.data.data1 })) ?? [],
      });
      log(`quest "${this.runner.session.name}" loaded`);
    } catch (err) {
      log(`quest failed to start: ${(err as Error).message}`);
    }
  }

  dispose(): void {
    if (this.link.target === this.target) this.link.target = null;
    this.runner?.dispose();
    this.runner = null;
    this.town.dispose();
  }
}

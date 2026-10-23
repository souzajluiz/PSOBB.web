// One running quest: the parsed .bin and .dat, the VM, and the answers the
// game view needs to load the quest's floors instead of the free-play ones.
//
// What decides a floor's content is its designation, set by the map_designate
// family while the quest's start label runs (process_map_designate_v3_BB,
// PsoBB.exe .c:613155, writes floor_map_designations[floor] and the per-floor
// mode g_QuestData8_00a95628[floor]):
//
//   type 0  the quest's own set data: the .dat's chunks for this floor, on the
//           map and variation the designation names
//   type 1  the offline free-play template of that map and variation
//   type 2  the online free-play template
//   type 3  nothing at all
//
// HandleQuestDat (0x006ba0da) is the other half: for floors whose mode is 1 or
// 2 it calls the free-play asset loaders, and for the rest it appends the
// .dat's own chunks. The geometry is always the designated map's (
// MapLoader_LoadAndSwapGeometry_00806fcc reads floor_map_designations[floor]
// and indexes the map's asset-prefix list with map_variant).

import { parseQuestBin, questEpisode, questOpcodeHistogram, type QuestBin } from '../formats/questbin.ts';
import { parseQuestDat, type QuestDat, type QuestDatFloor } from '../formats/questdat.ts';
import { materializeQuestDat } from '../formats/randomenemies.ts';
import type { LoadedQuest } from '../net/quests.ts';
import { QuestVM, type QuestFloorDesignation, type QuestVMHost } from './vm.ts';

export interface QuestSessionOptions {
  host?: QuestVMHost;
  log?: (msg: string) => void;
  // The game's random seed (the join packet's u32 at 0x198). The random-wave
  // floors of the challenge quests (formats/randomenemies.ts) need it; without
  // it those floors stay empty.
  randomSeed?: number | undefined;
}

export class QuestSession {
  readonly name: string;
  readonly bin: QuestBin;
  readonly dat: QuestDat;
  readonly vm: QuestVM;
  readonly episode: number;
  private log: (msg: string) => void;
  private ticks = 0;
  private frameAcc = 0;
  started = false;

  constructor(quest: LoadedQuest, opts: QuestSessionOptions = {}) {
    this.log = opts.log ?? (() => {});
    this.bin = parseQuestBin(quest.bin);
    const parsed = parseQuestDat(quest.dat);
    if (opts.randomSeed === undefined) {
      this.dat = parsed;
      if ([...parsed.floors.values()].some((f) => f.randomEnemies)) {
        this.log('quest .dat: random enemy floors without a game seed; they stay empty');
      }
    } else {
      this.dat = materializeQuestDat(parsed, opts.randomSeed);
    }
    this.name = this.bin.header.name || quest.name;
    this.episode = questEpisode(this.bin.header);
    this.vm = new QuestVM({ bin: this.bin, episode: this.episode, host: opts.host });
    for (const w of this.dat.warnings) this.log(`quest .dat: ${w}`);
  }

  // Runs the quest's start label (quest_start_thread(0), PsoBB.exe 0x006bc76c).
  // Everything the opening needs — set_episode, the map designations, the
  // floor handlers, the quest board — happens here.
  start(): void {
    if (this.started) return;
    this.started = true;
    this.vm.start();
    this.vm.frame();
    this.log(`quest "${this.name}" started: ${this.vm.summary()}`);
    const missing = [...this.vm.unimplemented.entries()].sort((a, b) => b[1] - a[1]);
    if (missing.length) this.log(`quest opcodes not implemented: ${missing.map(([n, c]) => `${n}(${c})`).join(' ')}`);
  }

  // Advances the VM on the game clock (the exe runs the quest threads once per
  // 30 Hz game tick).
  tick(dt: number): void {
    if (!this.started) return;
    this.frameAcc += dt * 30;
    const frames = Math.min(Math.floor(this.frameAcc), 30);
    this.frameAcc -= Math.floor(this.frameAcc);
    for (let i = 0; i < frames; i++) {
      this.vm.frame();
      this.ticks++;
    }
  }

  // The player warped: run the floor's handler.
  enterFloor(floor: number): void {
    this.vm.enterFloor(floor);
  }

  // The designation of a floor: what the VM set, or what the .bin header
  // records (newserv src/QuestScript.cc:4942 copies every bb_map_designate's
  // immediates into the header at assembly time, so the header is a reliable
  // fallback for a quest whose start label this VM could not finish).
  designation(floor: number): QuestFloorDesignation | null {
    const live = this.vm.designations.get(floor);
    if (live) return live;
    const fa = this.bin.header.floorAssignments.find((f) => f.floor === floor);
    return fa ? { floor: fa.floor, area: fa.area, type: fa.type, layoutVar: fa.layoutVar, entitiesVar: fa.entitiesVar } : null;
  }

  // Every floor the quest designates, in order.
  designatedFloors(): QuestFloorDesignation[] {
    const out = new Map<number, QuestFloorDesignation>();
    for (const fa of this.bin.header.floorAssignments) out.set(fa.floor, { floor: fa.floor, area: fa.area, type: fa.type, layoutVar: fa.layoutVar, entitiesVar: fa.entitiesVar });
    for (const [floor, d] of this.vm.designations) out.set(floor, d);
    return [...out.values()].sort((a, b) => a.floor - b.floor);
  }

  // The quest's own objects, enemies and events for a floor, when the floor
  // takes them from the .dat (designation type 0 or 3, or no designation at
  // all — a floor the quest never designates still gets its .dat chunks, as
  // HandleQuestDat's else branch does).
  floorData(floor: number): QuestDatFloor | null {
    const type = this.designation(floor)?.type ?? 0;
    if (type === 1 || type === 2) return null; // free-play template instead
    return this.dat.floors.get(floor) ?? null;
  }

  // Whether the free-play set data of the designated map should be loaded.
  usesFreePlayEntities(floor: number): boolean {
    const type = this.designation(floor)?.type;
    return type === 1 || type === 2;
  }

  // Which floors the quest can reach through the Pioneer 2 Ragol warp.
  get mainwarpFloors(): Set<number> {
    return this.vm.mainwarpFloors;
  }

  summary(): string {
    const counts = questOpcodeHistogram(this.bin);
    const floors = [...this.dat.floors.values()];
    return (
      `"${this.name}" (quest ${this.bin.header.questNumber}, episode ${this.episode}, ` +
      `${this.bin.labels.length} labels, ${counts.size} opcodes used): ` +
      `${floors.length} floors in the .dat (${floors.reduce((n, f) => n + f.objects.length, 0)} objects, ` +
      `${floors.reduce((n, f) => n + f.enemies.length, 0)} enemies), ${this.vm.summary()}`
    );
  }
}

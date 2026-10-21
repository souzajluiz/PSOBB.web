// Dark Falz, the control object (TBoss4DarkFalz 0xC8; PsoBB.exe, Ephinea
// 1.25.13): the scene machine, the Darvants, and the owner of the three forms
// (combat/darkfalz1.ts, darkfalz2.ts, darkfalz3.ts). See combat/darkfalzcommon.ts
// for the sources and for the leader / follower split.
//
// The control (ctor 0x0044C93C, update `UpdateVoloptAiState`) runs a table of 16
// scenes at 0x009A5940. Per tick: if it is the leader, the scene's "lead"
// procedure (+0xC) decides; every client then runs the "all" procedure (+0x10).
// A scene change is a 6x19 with the scene number (PlayerSendFootstepPacket
// 0x0044BF18); a form's order is a 6x19 with phase 0xFFFF and the packed action,
// which the receiver (0x0044CE6C) hands to the form of the scene it is in
// (scenes 5 / 6 form 1, 7 / 8 / 9 form 2, 12 / 13 / 14 form 3).
//
// The Darvants (ZAKO, class vtable 0xAF7D60, update 0x0045F25C, table
// 0x009A6780): created in the ring of 5 / 15 / 25 / 35 at radius 28.571 + 57.143
// per ring (x1.25 in Ultimate) about (0, -13, 0) by InitializeVoloptSpawnConfig
// (0x0044C430). State 0 rises 1/3 a frame to y 6, state 1 hovers and looks for a
// player within 150 every 60 frames, state 2 chases for 180 frames, state 3 sinks
// to y -13 and goes. In states 1 and 2, every 16th frame the nearest player
// within 8 is hit for the Darvant's ATP. A Darvant that dies (or is still alive
// when the scene leaves ZAKO) adds one to the control's kill count (+0x394); the
// scene ends when the count reaches row 53 iparam1 times the party size.
//
// ASSUMED (neither the dump nor the JP C has it): the spat Darvants' flight
// (class 0xAF7EC0; they dive at a player and die with the TYPE1 scene), the exclusion
// zones of 0x0044C674 (players are not pushed out of the cage props), the camera
// and fade work of the cutscene objects (only their durations are kept), and the
// party size at the moment the control is built (the exe counts the entities of
// the room in its constructor).

import { BrainBase } from './enemyfsm.ts';
import type { AiFrame, AiTarget } from './enemyai.ts';
import type { EnemyShot } from './enemyshots.ts';
import {
  BAMS,
  CASKET,
  DF_DARVANT_MAX,
  DF_ID,
  DfEntity,
  EMPTY_ROW,
  SCENE,
  SCENE_FRAMES,
  SCENE_NAMES,
  STALL_TICKS,
  cosB,
  sinB,
  type DfEvent,
  type DfFight,
  type DfRows,
  type Vec3,
} from './darkfalzcommon.ts';
import { DfForm1, F1, type Form1Row } from './darkfalz1.ts';
import { DfForm2, F2, type Form2Row } from './darkfalz2.ts';
import { DfForm3, F3, f3Spot, type Form3Row } from './darkfalz3.ts';

export { SCENE, SCENE_NAMES, DF_ID } from './darkfalzcommon.ts';

export const DARVANT = {
  // Ring spawn.
  ringCounts: [5, 15, 25, 35] as readonly number[],
  ringRadius: 28.571428,
  ringStep: 57.142856,
  ultimateScale: 1.25,
  centerY: -13,
  // States.
  rise: 0,
  hover: 1,
  chase: 2,
  dead: 3,
  spit: 4,
  riseStep: 1 / 3,
  top: 6,
  sinkLimit: -13,
  look: 150, // [0xA45984]
  lookEvery: 60,
  chaseFrames: 180,
  accel: 0.05 * 0.5833333, // [0xA45990]
  ring: 8, // the circle about the player the chase aims at
  auraReach: 8, // [0xA45A0C]
  auraEvery: 16,
  // The spat ones (ASSUMED): they dive at the player.
  spitSpeed: 1.2,
  spitReach: 8,
  spitLife: 600,
  // The beam's Darvants (Ultimate only, 0x00458E44 / 0x00460D34): three per living
  // player about the body, at radius 12.5 (0x00A45788): (0, -1), (-0.86, 0.5) and
  // (0.86, 0.5) times the radius (constants 0x009001E0..E8). Their state 0 rises
  // 10/9 a frame (0x00460B84, the constant 0x0A459EC) to the top 6, then they hold.
  // ASSUMED: the hold's bob and the chase / look of 0x00460C10 are not ported (the
  // exe's 0x0082EBAC and 0x0083173C are not read), so they hover and keep the aura.
  beamRadius: 12.5,
  beamOffsets: [
    [0, -1],
    [-0.86, 0.5],
    [0.86, 0.5],
  ] as readonly (readonly [number, number])[],
  beamRise: 10 / 9,
} as const;

// One Darvant.
export class Darvant extends DfEntity {
  st: number = DARVANT.rise;
  kind: 'ring' | 'spit' | 'beam' = 'ring';
  vx = 0;
  vz = 0;
  homeX = 0;
  homeZ = 0;
  target = -1;
  timer = 0; // +0x3ac
  clock = 0; // +0x3c0
  speed = 0.4;
  born = 0;
  constructor(entity: number, hp: number) {
    super(entity, hp);
  }
  get targetable(): boolean {
    return !this.gone && this.st !== DARVANT.dead && (this.kind === 'spit' || this.st !== DARVANT.rise);
  }
}

export interface DarkFalzOptions {
  x: number;
  z: number;
  angle: number;
  difficulty: number; // 0..3
  rows: DfRows;
  leader: () => boolean;
  selfId: () => number;
  // The party at the time the control is built (+0x398, 1..4).
  partySize: () => number;
  rng: () => number;
}

const EMPTY_ROWS: DfRows = { darvant: EMPTY_ROW, df1: EMPTY_ROW, df2: EMPTY_ROW, df3: EMPTY_ROW, darvantFalz: EMPTY_ROW };

const clampRange = (v: number, lo: number, hi: number, dflt: number) => (v < lo || v > hi ? dflt : v);

export class DarkFalzAi extends BrainBase implements DfFight {
  state = 'EDITOR';
  readonly difficulty: number;
  readonly ultimate: boolean;
  readonly events: DfEvent[] = [];
  readonly rows: DfRows;
  // 6x19's fields the owner reads each tick (cleared after).
  readonly shots: EnemyShot[] = [];
  readonly superArmor = true;
  scene: number = SCENE.editor;
  private sceneTimer = 0; // +0x388
  private soundTimer = 0; // +0x37c
  made = 0; // +0x390
  kills = 0; // +0x394
  players: number; // +0x398
  private counter = 1; // +0x38c
  form1: DfForm1 | null = null;
  form2: DfForm2 | null = null;
  form3: DfForm3 | null = null;
  readonly darvants: Darvant[] = [];
  private readonly byId = new Map<number, Darvant>();
  private targets: readonly AiTarget[] = [];
  private readonly aliveList: { clientId: number; x: number; z: number }[] = [];
  private aliveCount = 0;
  private readonly isLeader: () => boolean;
  private readonly self: () => number;
  private readonly rand: () => number;
  finished = false;
  private killedSent = false;
  readonly cx: number;
  readonly cz: number;
  private readonly out: AiFrame;
  private readonly tmp: Vec3 = [0, 0, 0];

  constructor(opts: DarkFalzOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.difficulty = opts.difficulty;
    this.ultimate = opts.difficulty === 3;
    this.rows = opts.rows ?? EMPTY_ROWS;
    this.isLeader = opts.leader;
    this.self = opts.selfId;
    this.rand = opts.rng;
    this.cx = opts.x;
    this.cz = opts.z;
    // The constructor counts the room's players: 0 or more than 4 -> 1.
    const n = opts.partySize();
    this.players = n < 1 || n > 4 ? 1 : n;
    this.out = { motion: null, x: this.x, z: this.z, angle: this.angle, hit: null };
  }

  // The control itself is nothing to hit.
  get untargetable(): boolean {
    return true;
  }
  get invulnerable(): boolean {
    return true;
  }
  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  get removed(): boolean {
    return this.finished;
  }

  // --- DfFight -----------------------------------------------------------------

  leader(): boolean {
    return this.isLeader();
  }
  random(): number {
    return this.rand();
  }
  selfId(): number {
    return this.self();
  }
  aliveDarvants(): number {
    return this.made - this.kills;
  }
  shoot(shot: EnemyShot): void {
    this.shots.push(shot);
  }
  alive(): readonly { clientId: number; x: number; z: number }[] {
    return this.aliveList;
  }
  randomAlive(): number {
    // GetRandomAlivePlayerEntityIndex (0x0044D084): up to 4 alive, one at random.
    const n = Math.min(4, this.aliveCount);
    if (n === 0) return 0xffff;
    return this.aliveList[Math.min(n - 1, Math.trunc(this.rand() * n))].clientId;
  }
  playerPos(clientId: number): { x: number; z: number } | null {
    for (let i = 0; i < this.targets.length; i++) if (this.targets[i].clientId === clientId) return this.targets[i];
    return null;
  }

  // 6x19, applied here first and then sent.
  send(phase: number, packed: number): void {
    this.events.push({ kind: 'send', phase, packed });
    this.receive(phase, packed);
  }

  // HandleVoloptEntityStateTransition (0x0044CE6C).
  receive(phase: number, packed: number): void {
    if (phase !== 0xffff && phase >= 0 && phase < 0x10 && phase !== this.scene) this.setScene(phase);
    if (packed === 0xffffffff) return;
    switch (this.scene) {
      case SCENE.appType1:
      case SCENE.type1:
        this.form1?.receive(packed);
        break;
      case SCENE.appType2:
      case SCENE.type2:
      case SCENE.dieType2:
        this.form2?.receive(packed);
        break;
      case SCENE.demoWarp3:
      case SCENE.type3:
      case SCENE.dieType3:
        this.form3?.receive(packed);
        break;
      default:
        break;
    }
  }

  // Ids for the Darvants (VoloptForm7Hazard_CalculateOffset: 1 .. 0x1fd).
  private allocId(): number {
    if (this.counter < 1 || this.counter > DF_DARVANT_MAX) return -1;
    return this.counter++;
  }
  nextDarvantId(): number {
    return this.allocId();
  }

  private newDarvant(kind: 'ring' | 'spit' | 'beam', x: number, y: number, z: number): Darvant | null {
    const id = this.allocId();
    if (id < 0) return null;
    // The beam's ones share the ring's init (0x0045FBD4), so the ring's row (ASSUMED for their HP).
    const row = kind === 'spit' ? this.rows.darvantFalz : this.rows.darvant;
    const d = new Darvant(id, row.hp);
    d.kind = kind;
    d.x = x;
    d.y = y;
    d.z = z;
    d.homeX = x;
    d.homeZ = z;
    d.speed = kind === 'spit' ? row.f1 || 0.5 : row.f1 || 0.4;
    d.timer = 0;
    d.born = this.made;
    this.made++;
    this.darvants.push(d);
    this.byId.set(id, d);
    this.events.push({ kind: 'darvant', entity: id });
    return d;
  }

  // Form 2's beam ends (Ultimate only, 0x00458E44, the branch on difficulty 3 before
  // the stop state): three Darvants per living player about the body (the form's
  // position at the end of the beam). An id that is used up skips one (0x0044CFC0).
  spawnBeamDarvants(x: number, y: number, z: number): void {
    for (let p = 0; p < this.aliveCount; p++) {
      for (const [ox, oz] of DARVANT.beamOffsets) {
        this.newDarvant('beam', x + ox * DARVANT.beamRadius, y, z + oz * DARVANT.beamRadius);
      }
    }
  }

  // The spat Darvant of form 1's HAKILOOP (ASSUMED flight).
  spawnSpit(x: number, z: number, tx: number, tz: number): boolean {
    const d = this.newDarvant('spit', x, 25, z);
    if (!d) return false;
    d.st = DARVANT.spit;
    d.timer = DARVANT.spitLife;
    const a = Math.atan2(tx - x, tz - z);
    d.vx = Math.sin(a) * d.speed * DARVANT.spitSpeed;
    d.vz = Math.cos(a) * d.speed * DARVANT.spitSpeed;
    return true;
  }

  // --- scenes -------------------------------------------------------------------

  private setScene(n: number): void {
    if (n < 0 || n >= 0x10) return;
    this.scene = n;
    this.state = SCENE_NAMES[n];
    this.events.push({ kind: 'scene', scene: n });
    this.enterScene(n);
  }

  private flag(n: number): void {
    this.events.push({ kind: 'questFlag', flag: n });
  }

  private enterScene(n: number): void {
    switch (n) {
      case SCENE.demoWarp0:
        // 0x0044E504: the players stand in a small circle; the cutscene object.
        this.events.push({ kind: 'place', circle: 'inner', slots: this.players });
        this.sceneTimer = SCENE_FRAMES.demoWarp0;
        break;
      case SCENE.demoWarp1:
        this.sceneTimer = SCENE_FRAMES.demoWarp1;
        break;
      case SCENE.zako:
        // FUN_0044e5b4.cpp (0x0044E4A4): sound 0x369 and the player restore, then
        // InitializeVoloptSpawnConfig.
        this.events.push({ kind: 'se', id: 0x369 });
        this.spawnRings();
        break;
      case SCENE.appType1:
        this.sceneTimer = 0;
        this.events.push({ kind: 'se', id: 0x368 });
        break;
      case SCENE.type1:
        this.form1 = new DfForm1(this, this.form1Row(), this.angle / BAMS);
        this.formSwaps++;
        this.sceneTimer = 0;
        break;
      case SCENE.appType2:
        // 0x0044E2F4: form 1 goes, its flag.
        this.form1 = null;
        this.formSwaps++;
        this.flag(0x33);
        this.sceneTimer = SCENE_FRAMES.appType2;
        break;
      case SCENE.dieType2:
        this.flag(0x35);
        this.form2 = null;
        this.formSwaps++;
        this.sceneTimer = SCENE_FRAMES.dieType2;
        break;
      case SCENE.getRing:
        this.sceneTimer = SCENE_FRAMES.getRing;
        break;
      case SCENE.demoWarp2:
        this.events.push({ kind: 'bgm', track: 2 });
        this.sceneTimer = SCENE_FRAMES.demoWarp2;
        break;
      case SCENE.demoWarp3:
        this.events.push({ kind: 'place', circle: 'outer', slots: this.players });
        this.sceneTimer = SCENE_FRAMES.demoWarp3;
        break;
      case SCENE.dieType3:
        this.flag(0x37);
        this.form3 = null;
        this.formSwaps++;
        this.sceneTimer = SCENE_FRAMES.dieType3;
        break;
      case SCENE.olEnding:
        this.sceneTimer = SCENE_FRAMES.olEnding;
        break;
      default:
        break;
    }
  }

  private form1Row(): Form1Row {
    const r = this.rows.df1;
    const f = Math.round(r.f1);
    return {
      hp: r.hp,
      atp: r.atp,
      moveFrames: clampRange(f, 1, 60, 25) * 30,
      rafoie: r.i1,
      rabarta: r.i2,
      tenchu: r.i3,
      spitMax: this.rows.darvantFalz.i1 < 2 ? 1 : Math.min(6, this.rows.darvantFalz.i1),
    };
  }

  private form2Row(): Form2Row {
    const r = this.rows.df2;
    const b = this.rows.df1;
    return {
      hp: r.hp,
      atp: r.atp,
      moveFrames: clampRange(Math.round(r.f1), 1, 25, 4) * 30,
      stopState: 8 + clampRange(r.i1, 1, 4, 1),
      restaLevel: r.i2 >= 0 && r.i2 <= 14 ? r.i2 : 0,
      rafoie: b.i1,
      rabarta: b.i2,
      tenchu: b.i3,
    };
  }

  private form3Row(): Form3Row {
    const r = this.rows.df3;
    return { hp: r.hp, atp: r.atp, lMagic: r.i1, megid: r.i2, orbs: r.i3 >= 1 && r.i3 <= 8 ? r.i3 : 4 };
  }

  // InitializeVoloptSpawnConfig (0x0044C430): rings of 5, 15, 25, 35.
  private spawnRings(): void {
    const scale = this.ultimate ? DARVANT.ultimateScale : 1;
    let radius = DARVANT.ringRadius * scale;
    const step = DARVANT.ringStep * scale;
    for (const n of DARVANT.ringCounts) {
      const slice = Math.trunc(0x10000 / n);
      for (let i = 0; i < n; i++) {
        const d = this.newDarvant('ring', this.cx + sinB(i * slice) * radius, DARVANT.centerY, this.cz + cosB(i * slice) * radius);
        if (!d) return;
        d.clock = d.entity & 3;
      }
      radius += step;
    }
  }

  // The ZAKO scene is done when the dead are row 53 iparam1 (1..19, else 2) times the party.
  private zakoDone(): boolean {
    const per = clampRange(this.rows.darvant.i1, 1, 19, 2);
    return per * this.players <= this.kills;
  }

  private leadScene(): void {
    switch (this.scene) {
      case SCENE.editor:
        this.setScene(SCENE.waitCasket);
        break;
      case SCENE.waitCasket:
        // 0x0044D490: any player entity within sqrt(900) of the casket.
        for (const t of this.targets) {
          const dx = CASKET.x - t.x;
          const dz = CASKET.z - t.z;
          if (dx * dx + dz * dz <= CASKET.radiusSq) {
            this.send(SCENE.demoWarp0, 0xffffffff);
            break;
          }
        }
        break;
      case SCENE.zako:
        if (this.zakoDone()) this.send(SCENE.appType1, 0xffffffff);
        break;
      case SCENE.type1:
        if (!this.form1 || this.form1.st === F1.dead || this.form1.st === F1.waitKill) this.send(SCENE.appType2, 0xffffffff);
        break;
      case SCENE.type2:
        if (!this.form2 || this.form2.st === F2.dead || this.form2.st === F2.waitKill) this.send(SCENE.dieType2, 0xffffffff);
        break;
      case SCENE.type3:
        if (!this.form3 || this.form3.st === F3.dead || this.form3.st === F3.waitKill) this.send(SCENE.dieType3, 0xffffffff);
        break;
      default:
        break;
    }
  }

  // A follower waits for the leader's scene change in the scenes whose lead
  // procedure decides (ZAKO, TYPE1, TYPE2, TYPE3); after STALL_TICKS ticks it
  // decides itself (ASSUMED failsafe, see darkfalzcommon.ts). The scene
  // machine's other waits are timers every client runs.
  private formSwaps = 0;
  private stall = 0;
  private stalled(): boolean {
    const s = this.scene;
    if (s !== SCENE.editor && s !== SCENE.waitCasket && s !== SCENE.zako && s !== SCENE.type1 && s !== SCENE.type2 && s !== SCENE.type3) {
      this.stall = 0;
      return false;
    }
    if (++this.stall < STALL_TICKS) return false;
    this.stall = 0;
    return true;
  }

  private allScene(): void {
    switch (this.scene) {
      case SCENE.demoWarp0:
        if (--this.sceneTimer < 0) this.setScene(SCENE.demoWarp1);
        break;
      case SCENE.demoWarp1:
        if (--this.sceneTimer <= 0) this.setScene(SCENE.zako);
        break;
      case SCENE.appType1: {
        const t = this.sceneTimer;
        if (t === SCENE_FRAMES.appType1Music) this.events.push({ kind: 'bgm', track: 1 });
        if (t > 0x145) {
          this.flag(0x32);
          this.setScene(SCENE.type1);
        } else this.sceneTimer = t + 1;
        break;
      }
      case SCENE.appType2:
        if (--this.sceneTimer < 0) {
          // 0x0044D7A8: form 2 is made, flag 0x34.
          this.form2 = new DfForm2(this, this.form2Row());
          this.formSwaps++;
          this.flag(0x34);
          this.setScene(SCENE.type2);
        }
        break;
      case SCENE.dieType2:
        // Normal has no third form: it goes straight to the ring.
        if (--this.sceneTimer < 0) this.setScene(this.difficulty === 0 ? SCENE.getRing : SCENE.demoWarp2);
        break;
      case SCENE.getRing:
        if (--this.sceneTimer < 0) this.setScene(SCENE.olEnding);
        break;
      case SCENE.demoWarp2:
        if (--this.sceneTimer <= 0) this.setScene(SCENE.demoWarp3);
        break;
      case SCENE.demoWarp3:
        if (--this.sceneTimer <= 0) {
          // 0x0044DA1C: flag 0x36 and form 3 at the middle of its arena.
          this.flag(0x36);
          f3Spot(F3.middle, this.tmp);
          this.form3 = new DfForm3(this, this.form3Row(), this.tmp[0], this.tmp[2]);
          this.formSwaps++;
          this.setScene(SCENE.type3);
        }
        break;
      case SCENE.dieType3:
        if (--this.sceneTimer < 0) this.setScene(SCENE.olEnding);
        break;
      case SCENE.olEnding:
        if (--this.sceneTimer < 0 && !this.killedSent) {
          // mark_falz_as_dead_and_request_drop (0x0044C230): on_enemy_killed with
          // the position changed to (20, 0, 20) (Normal) or (10226, y, 96).
          this.killedSent = true;
          this.events.push({ kind: 'killed', x: this.difficulty === 0 ? 20 : 10226, z: this.difficulty === 0 ? 20 : 96 });
          this.finished = true;
        }
        break;
      default:
        break;
    }
  }

  // The sound every 300..600 frames while the fight is on (scenes 4..8).
  private sceneSound(): void {
    if (this.scene > 3 && this.scene < 9 && --this.soundTimer < 0) {
      this.events.push({ kind: 'se', id: this.rand() >= 0.5 ? 0x35e : 0x35d });
      this.soundTimer = Math.round(this.rand() * 300 + 300);
    }
  }

  // --- the tick -----------------------------------------------------------------

  private collect(targets: readonly AiTarget[]): void {
    this.targets = targets;
    let n = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead) continue;
      let e = this.aliveList[n];
      if (!e) e = this.aliveList[n] = { clientId: 0, x: 0, z: 0 };
      e.clientId = t.clientId;
      e.x = t.x;
      e.z = t.z;
      n++;
    }
    this.aliveList.length = n;
    this.aliveCount = n;
  }

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.out;
    out.motion = null;
    out.shots = undefined;
    out.hit = null;
    if (this.finished) return this.finish(out);
    this.collect(targets);
    if (this.isLeader() || this.stalled()) this.leadScene();
    this.allScene();
    this.sceneSound();
    this.tickDarvants();
    if (this.form1) this.form1.tick();
    if (this.form2) this.form2.tick();
    if (this.form3) this.form3.tick();
    // The renderer snaps the drawn pose when this changes (smoothrender.ts): a form
    // appearing or going, or a jump of a form.
    this.warps = this.formSwaps + (this.form1?.warps ?? 0) + (this.form2?.warps ?? 0) + (this.form3?.warps ?? 0);
    if (this.shots.length) {
      out.shots = this.shots.splice(0);
    }
    return this.finish(out);
  }

  // --- the Darvants ---------------------------------------------------------------

  // The die hook (0x0045F224): once, the control counts it.
  killDarvant(d: Darvant): void {
    if (d.st === DARVANT.dead) return;
    this.kills++;
    d.st = DARVANT.dead;
    d.timer = 0;
    d.dead = true;
    this.events.push({ kind: 'died', entity: d.entity });
  }

  private tickDarvants(): void {
    const keepZako = this.scene === SCENE.zako;
    const keepSpit = this.scene === SCENE.type1;
    // The beam's ones live while the scene is TYPE2 (0x00460938: scene 8, else they die).
    const keepBeam = this.scene === SCENE.type2;
    for (let i = 0; i < this.darvants.length; i++) {
      const d = this.darvants[i];
      if (d.gone) continue;
      if (d.st !== DARVANT.dead) {
        if (d.hp <= 0) this.killDarvant(d);
        else if (d.kind === 'ring' ? !keepZako : d.kind === 'spit' ? !keepSpit : !keepBeam) this.killDarvant(d);
      }
      this.stepDarvant(d);
    }
  }

  private stepDarvant(d: Darvant): void {
    const row = d.kind === 'spit' ? this.rows.darvantFalz : this.rows.darvant;
    d.clock++;
    switch (d.st) {
      case DARVANT.rise:
        // State 0 (0x0045F628): up a third of a unit a frame; the beam's ones
        // (0x00460B84) up 10/9 a frame to the top.
        d.y += d.kind === 'beam' ? DARVANT.beamRise : DARVANT.riseStep;
        if (d.y >= DARVANT.top) {
          d.y = DARVANT.top;
          d.st = DARVANT.hover;
          d.timer = DARVANT.lookEvery;
        }
        return;
      case DARVANT.hover: {
        // State 1 (0x0045F6B4): drift home; every 60 frames look for a player.
        // The beam's ones hold where they stand (ASSUMED, see DARVANT).
        if (d.kind === 'beam') break;
        this.drift(d, d.homeX, d.homeZ, 0.5);
        if (--d.timer < 0) {
          let best = -1;
          let bd: number = DARVANT.look;
          for (let i = 0; i < this.aliveCount; i++) {
            const p = this.aliveList[i];
            const dist = Math.hypot(p.x - d.x, p.z - d.z);
            if (dist < bd) {
              bd = dist;
              best = p.clientId;
            }
          }
          if (best >= 0) {
            d.target = best;
            d.timer = DARVANT.chaseFrames;
            d.st = DARVANT.chase;
          } else d.timer = DARVANT.lookEvery;
        }
        break;
      }
      case DARVANT.chase: {
        // State 2 (0x0045F8FC): a point on a circle of 8 about the player.
        const p = this.playerPos(d.target);
        if (!p) {
          d.timer = DARVANT.lookEvery;
          d.st = DARVANT.hover;
          break;
        }
        const tx = p.x + sinB(d.entity << 13) * DARVANT.ring;
        const tz = p.z + cosB(d.entity << 13) * DARVANT.ring;
        this.drift(d, tx, tz, d.speed);
        if (--d.timer < 0) {
          d.timer = DARVANT.lookEvery;
          d.st = DARVANT.hover;
        }
        break;
      }
      case DARVANT.spit: {
        // ASSUMED: straight at the player it was thrown at, and on at the same velocity.
        d.x += d.vx;
        d.z += d.vz;
        if (--d.timer < 0) this.killDarvant(d);
        return;
      }
      default:
        // State 3 (0x0045FA94): sink a third a frame; gone below -13.
        d.y += -DARVANT.riseStep;
        if (d.y < DARVANT.sinkLimit) d.gone = true;
        return;
    }
    // The aura of states 1 and 2 (and the spat ones): every 16th frame the
    // nearest player within 8 takes the ATP.
    if (d.st !== DARVANT.rise && (d.clock & (DARVANT.auraEvery - 1)) === 0) {
      let best = -1;
      let bd: number = d.kind === 'spit' ? DARVANT.spitReach : DARVANT.auraReach;
      for (let i = 0; i < this.aliveCount; i++) {
        const p = this.aliveList[i];
        const dist = Math.hypot(p.x - d.x, p.z - d.z);
        if (dist < bd) {
          bd = dist;
          best = p.clientId;
        }
      }
      if (best >= 0) {
        this.events.push({ kind: 'hit', clientId: best, power: row.atp, fixed: false, x: d.x, z: d.z, what: 'Darvant' });
        if (d.kind === 'spit') this.killDarvant(d);
      }
    }
  }

  // Accelerate toward a point a little each frame and cap the speed.
  private drift(d: Darvant, tx: number, tz: number, cap: number): void {
    d.vx += (tx > d.x ? 1 : -1) * DARVANT.accel;
    d.vz += (tz > d.z ? 1 : -1) * DARVANT.accel;
    const l = Math.hypot(d.vx, d.vz);
    const max = Math.max(0.05, Math.min(cap, d.speed));
    if (l > max) {
      d.vx = (d.vx / l) * max;
      d.vz = (d.vz / l) * max;
    }
    d.x += d.vx;
    d.z += d.vz;
  }

  // --- hits on the fight's entities ---------------------------------------------------

  // The entity at the offset from the control's id (null: none there).
  part(entity: number): DfEntity | null {
    if (entity === DF_ID.form1) return this.form1;
    if (entity === DF_ID.form2) return this.form2;
    if (entity === DF_ID.form3) return this.form3;
    return this.byId.get(entity) ?? null;
  }

  // A strike (ours or a 6x0A copy). Returns the damage taken.
  damagePart(entity: number, amount: number, byLocal: boolean): number {
    const e = this.part(entity);
    return e ? e.damage(amount, byLocal) : 0;
  }

  damageTaken(entity: number, total: number): void {
    this.part(entity)?.setDamageTaken(total);
  }

  // The point a strike from (px, pz) reaches on an entity.
  reachOf(entity: number, px: number, pz: number, out: Vec3): boolean {
    if (entity === DF_ID.form1 && this.form1) {
      this.form1.reach(px, pz, out);
      return true;
    }
    if (entity === DF_ID.form2 && this.form2) {
      this.form2.reach(out);
      return true;
    }
    if (entity === DF_ID.form3 && this.form3) {
      this.form3.reach(out);
      return true;
    }
    const d = this.byId.get(entity);
    if (d && !d.gone) {
      out[0] = d.x;
      out[1] = d.y;
      out[2] = d.z;
      return true;
    }
    return false;
  }

  // Where the ring of 16 slots of the second arena puts the local player.
  get ringSlots(): number {
    return this.players;
  }

  // Free every pool (the floor was left).
  override kill(): void {
    this.finished = true;
  }
}

// The brain of the invisible enemy render/combat.ts keeps for a hit target (so
// the player's strikes, the lock-on and the other clients' 6x0A find it by
// entity id). The control owns everything; this answers the owner's questions.
export class DarkFalzPartAi {
  state = 'part';
  readonly motion = null;
  readonly superArmor = true;
  readonly entity: number;
  readonly owner: DarkFalzAi;
  private readonly frame: AiFrame = { motion: null, x: 0, z: 0, angle: 0, hit: null };
  constructor(entity: number, owner: DarkFalzAi) {
    this.entity = entity;
    this.owner = owner;
  }
  get part(): DfEntity | null {
    return this.owner.part(this.entity);
  }
  get untargetable(): boolean {
    const p = this.part;
    return !p || !p.targetable;
  }
  get invulnerable(): boolean {
    return this.untargetable;
  }
  get warps(): number {
    return this.part?.warps ?? 0;
  }
  tick(): AiFrame {
    const p = this.part;
    if (p) {
      this.frame.x = p.x;
      this.frame.z = p.z;
    }
    return this.frame;
  }
  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  kill(): void {}
}

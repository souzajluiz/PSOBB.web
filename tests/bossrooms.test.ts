// Boss rooms: the boss warp's gather flow (render/bosswarp.ts, 6x6A), the
// boss music phases (audio/bossbgm.ts) and the Episode 1 bosses' children
// (formats/enemymodels.ts).
//
// Run: node tests/bossrooms.test.ts
import { bossBgm, bossPhaseOf } from '../client/src/audio/bossbgm.ts';
import {
  DE_ROL_LE_STING_FRAME,
  DE_ROL_LE_STING_SOUND,
  deRolLeStingFloorTarget,
  deRolLeStingRingTarget,
  enemyModelFor,
  type EnemyModelContext,
} from '../client/src/formats/enemymodels.ts';
import type { EnemySet } from '../client/src/formats/setdata.ts';
import { BossWarp, GATHER_FRAMES, WARP_FRAMES, type BossWarpHost, type BossWarpState } from '../client/src/render/bosswarp.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);

// A warp with the local player inside and a scriptable party.
function host(warp: BossWarp, opts: { inRadius: () => boolean; gathered: () => boolean; leader?: boolean ; party?: number }) {
  const sent: BossWarpState[] = [];
  const windows: Array<number | null> = [];
  let warped = 0;
  const sounds: number[] = [];
  const h: BossWarpHost = {
    inRadius: opts.inRadius,
    gathered: opts.gathered,
    isLeader: () => opts.leader !== false,
    partySize: () => opts.party ?? 4,
    windows: (text) => windows.push(text),
    send: (state) => {
      sent.push(state);
      warp.receive(state);
    },
    warp: () => warped++,
    sound: (id) => sounds.push(id),
    log: () => {},
  };
  return { h, sent, windows, sounds, warped: () => warped };
}

// 1. A lone leader: step in, accept, the party is complete at once, warp.
{
  const w = new BossWarp();
  const t = host(w, { inRadius: () => true, gathered: () => true });
  w.frame(t.h); // state 0 substate 0 -> 1
  w.frame(t.h); // opens the windows
  eq(t.windows.at(-1), 0x54, 'confirmation text (unitxt 11:0x54)');
  w.answer(true);
  w.frame(t.h);
  eq(t.sent[0], 1, '6x6A state 1 (gather) on Yes');
  eq(w.state, 1, 'state after Yes');
  w.frame(t.h); // gather substate 0: timer and sound effect
  eq(w.timer, GATHER_FRAMES, 'gather timer');
  eq(t.sounds[0], 6, 'gather sound effect');

  w.frame(t.h); // gather substate 1: the notice, then the leader starts the warp
  eq(t.windows.at(-1), 0x55, 'notice text while the warp runs (unitxt 11:0x55)');
  eq(t.sent[1], 2, '6x6A state 2 (warp) once everyone is inside');
  eq(w.state, 2, 'state after the gather');
  w.frame(t.h); // warp substate 0
  eq(w.timer, WARP_FRAMES, 'warp timer');
  w.frame(t.h);
  eq(t.warped(), 1, 'the local player warped');
}

// 2. One player never comes: the leader warps when the 300-frame timer runs out.
{
  const w = new BossWarp();
  const t = host(w, { inRadius: () => true, gathered: () => false });
  for (let i = 0; i < 3; i++) w.frame(t.h);
  w.answer(true);
  w.frame(t.h);
  eq(w.state, 1, 'state 1 after Yes');
  w.frame(t.h); // substate 0 arms the timer
  let frames = 0;
  while (w.state === 1 && frames < GATHER_FRAMES + 10) {
    w.frame(t.h);
    frames++;
  }
  eq(frames, GATHER_FRAMES, 'the gather timed out after 300 frames');
  eq(w.state, 2, 'state 2 after the timeout');
}

// 3. "No" closes the windows and does not send anything.
{
  const w = new BossWarp();
  const t = host(w, { inRadius: () => true, gathered: () => false });
  w.frame(t.h);
  w.frame(t.h);
  w.answer(false);
  w.frame(t.h);
  eq(t.sent.length, 0, 'nothing sent on No');
  w.frame(t.h); // substate 3 closes the windows
  eq(t.windows.at(-1), null, 'windows closed on No');
  eq(w.state, 0, 'still idle after No');
}

// 4. A player who is not the leader waits for the leader's 6x6A.
{
  const w = new BossWarp();
  const t = host(w, { inRadius: () => true, gathered: () => true, leader: false });
  w.frame(t.h);
  w.frame(t.h);
  w.answer(true);
  w.frame(t.h);
  eq(t.sent[0], 1, 'a non-leader still reports its Yes');
  for (let i = 0; i < 400; i++) w.frame(t.h);
  eq(w.state, 1, 'a non-leader never starts the warp itself');
  w.receive(2); // the leader's 6x6A
  w.frame(t.h);
  w.frame(t.h);
  eq(t.warped(), 1, "warped by the leader's 6x6A");
}

// 5. Boss music: every boss area has its tracks, and the phases come from the
//    boss action subcommands the leader broadcasts.
{
  const names = (area: number, episode = 1, variant = 0) => bossBgm(area, episode, variant)?.phases.map((p) => (p.kind === 'adx' ? p.name : `sl${p.index}`));
  eq(names(0x0b)?.join(), 'dragon.adx', 'Dragon');
  eq(names(0x0c)?.join(), 'delo.adx', 'De Rol Le');
  eq(names(0x0d)?.join(), 'sl3,vol_opt1.adx,vol_opt2.adx', 'Vol Opt');
  eq(names(0x0e)?.join(), 'sl4,dark1.adx,dark2.adx', 'Dark Falz');
  eq(names(0x1e, 2)?.join(), 'gryphon.adx', 'Gal Gryphon');
  eq(names(0x1f, 2)?.join(), 'HALL.adx,proto1.adx,proto2.adx', 'Olga Flow');
  eq(names(0x20, 2)?.join(), 'delo2.adx', 'Barba Ray');
  eq(names(0x21, 2)?.join(), 'dragon2.adx', 'Gol Dragon');
  eq(names(0x2c, 3)?.join(), 'slbgm_boss09.ogg', 'Saint-Milion');
  eq(names(0x2c, 3, 1)?.join(), 'slbgm_boss09b.ogg', 'Shambertin');
  eq(bossBgm(0x01, 1), null, 'Forest has no boss track');
  eq(bossBgm(0x0b, 2), null, 'area 0x0b is not a boss floor in Episode 2');

  const sub = (id: number, size: number, ...rest: number[]) => {
    const body = new Uint8Array(size * 4);
    body[0] = id;
    body[1] = size;
    const dv = new DataView(body.buffer);
    rest.forEach((v, i) => dv.setUint16(4 + i * 2, v, true));
    return body;
  };
  // 6x15 action 0..2 = Vol Opt phase 1, 3..7 = phase 2.
  eq(bossPhaseOf(0x0d, 0x15, sub(0x15, 3, 0)), 1, '6x15 action 0');
  eq(bossPhaseOf(0x0d, 0x15, sub(0x15, 3, 2)), 1, '6x15 action 2');
  eq(bossPhaseOf(0x0d, 0x15, sub(0x15, 3, 3)), 2, '6x15 action 3');
  eq(bossPhaseOf(0x0d, 0x15, sub(0x15, 3, 7)), 2, '6x15 action 7');
  eq(bossPhaseOf(0x0d, 0x15, sub(0x15, 3, 8)), null, '6x15 out-of-range action');
  eq(bossPhaseOf(0x0c, 0x15, sub(0x15, 3, 0)), null, '6x15 on another floor');
  // 6x19 carries the Dark Falz form; 0xFFFF means "no change".
  eq(bossPhaseOf(0x0e, 0x19, sub(0x19, 4, 2)), 1, '6x19 form 2');
  eq(bossPhaseOf(0x0e, 0x19, sub(0x19, 4, 3)), 2, '6x19 form 3');
  eq(bossPhaseOf(0x0e, 0x19, sub(0x19, 4, 0xffff)), null, '6x19 no change');
  // Olga Flow sends one subcommand per form.
  eq(bossPhaseOf(0x1f, 0xa4, sub(0xa4, 5)), 1, '6xA4 form 1');
  eq(bossPhaseOf(0x1f, 0xa5, sub(0xa5, 5)), 2, '6xA5 form 2');
  eq(bossPhaseOf(0x1f, 0x15, sub(0x15, 3, 0)), null, '6x15 in the Seabed boss room');
}


// 6. A lone player always answers the question: the leader's "everyone is
//    inside" shortcut of state 0 needs a party of two or more here.
{
  const w = new BossWarp();
  const t = host(w, { inRadius: () => true, gathered: () => true, party: 1 });
  for (let i = 0; i < 10; i++) w.frame(t.h);
  eq(t.sent.length, 0, 'a lone player is not warped before answering');
  eq(w.state, 0, 'still waiting for the answer');
  w.answer(true);
  w.frame(t.h);
  eq(t.sent[0], 1, 'the lone player gathers after answering');
  w.frame(t.h);
  w.frame(t.h);
  eq(w.state, 2, 'and the warp starts from state 1');
}

// Episode 1 bosses' children (formats/enemymodels.ts).
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  const boss = (type: number, difficulty: number, area: number) =>
    enemyModelFor({ type, params: [0, 0, 0, 0, 0, 0, 0] } as unknown as EnemySet, { area, episode: 1, difficulty, event: 0 } satisfies EnemyModelContext);
  // Vol Opt phase 1 (area 0x0d): 6 pillars, 24 monitors, the lightning rod
  // (not in Ultimate, g_VoloptDifficultyMode) and the hidden core.
  const vo = boss(0xc2, 0, 0x0d)!;
  const rod = vo.parts.find((p) => p.name === 'lightning rod');
  eq(vo.parts.length, 6 + 24 + 2, 'Vol Opt: pillars + monitors + rod + core');
  eq(rod?.model, 16, 'Vol Opt rod: model entry 16 (+0x108)');
  eq(rod?.motion?.index, 6, 'Vol Opt rod: table 0x009a4f00 slot 0 = motion 6');
  eq(rod?.motion?.speed, 0.7, 'Vol Opt rod: 0.7 frames per tick');
  eq(rod?.offset?.join(), '0,80,0', 'Vol Opt rod: (0, 80, 0) from the arena origin');
  eq(rod?.place, 'world', 'Vol Opt rod: placed from the arena origin');
  const core = vo.parts.find((p) => p.name === 'core');
  eq(core?.model, 24, 'Vol Opt core: model entry 24 (+0x188, me5_y_all)');
  eq(core?.motion?.index, 14, 'Vol Opt core: table 0x009a4e40 slot 0 = motion 14');
  eq(core?.hidden, true, 'Vol Opt core: drawn only inside a monitor');
  const voUlt = boss(0xc2, 3, 0x0d)!;
  eq(voUlt.parts.some((p) => p.name === 'lightning rod'), false, 'Vol Opt Ultimate: no lightning rod');
  eq(voUlt.parts.length, 6 + 24 + 1, 'Vol Opt Ultimate: pillars + monitors + core');
  const pillar1 = vo.parts.find((p) => p.name === 'pillar 1')!;
  check(Math.abs(pillar1.offset![0] - 38) < 0.01 && Math.abs(pillar1.offset![2] - 76 * Math.sin(Math.PI / 3)) < 0.01, 'Vol Opt pillar 1: round(60 degrees in BAMS) on the 76.0 ring');

  // De Rol Le: body, tentacle, 5 + 3 stings, all but the body hidden.
  const drl = boss(0xc1, 0, 0x0c)!;
  eq(drl.parts.length, 1 + 1 + 5 + 3, 'De Rol Le: body + tentacle + 8 stings');
  eq(drl.parts.filter((p) => p.model === 3 && p.hidden && p.texlistOf === 2).length, 8, 'De Rol Le: 8 hidden stings (model 3, body textures)');
  eq(drl.parts.filter((p) => !p.hidden).length, 1, 'De Rol Le: only the body at spawn');
  eq(DE_ROL_LE_STING_FRAME, 18, 'De Rol Le: stings leave at frame 18.0');
  eq(DE_ROL_LE_STING_SOUND, 0x32a, 'De Rol Le: sting sound 0x32a');
  eq(deRolLeStingFloorTarget(0).target.join(), '0,1,0', 'sting 0: arena centre, 1.0 up');
  eq(deRolLeStingFloorTarget(1).target.join(), '45,1,30', 'sting 1: (45, 30)');
  eq(deRolLeStingFloorTarget(4).target.join(), '-45,1,-30', 'sting 4: (-45, -30)');
  eq(deRolLeStingFloorTarget(2, (x, y, z) => (eq(y, 20, 'the probe starts 20.0 above the point'), x + z - 20)).target.join(), '45,-4,-30', 'sting 2: on the probed floor');
  const r0 = deRolLeStingRingTarget(0, [100, 5, -50]);
  check(near(r0.target[0], 100) && near(r0.target[1], 22) && near(r0.target[2], -30), `ring sting 0: 20.0 in +z, 17.0 up (${r0.target.join()})`);
  eq(r0.yaw, 0x8000, 'ring sting 0: yaw 0x8000');
  eq(r0.pitch, 0x4000, 'ring sting 0: pitch 0x4000');
  const r1 = deRolLeStingRingTarget(1, [0, 0, 0]);
  check(near(r1.target[0], 20 * Math.sin((0x5555 / 0x10000) * Math.PI * 2)) && near(r1.target[2], 20 * Math.cos((0x5555 / 0x10000) * Math.PI * 2)), 'ring sting 1: angle 0x5555');
  eq(r1.yaw, 0x6800, 'ring sting 1: yaw 0x6800');
  eq(deRolLeStingRingTarget(2, [0, 0, 0]).yaw, 0x9800, 'ring sting 2: yaw 0x9800');

  // Dark Falz: form 1 drawn, the later forms and Rico hidden.
  const df = boss(0xc8, 0, 0x0e)!;
  eq(df.parts.filter((p) => !p.hidden).length, 6, 'Dark Falz: the six form-1 entries at spawn');
  // The Dragon has no drawn child.
  eq(boss(0xc0, 0, 0x0b)!.parts.length, 1, 'Dragon: body only');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

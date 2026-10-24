// Pillar traps and Vol Opt's seal door (render/traps.ts), from PsoBB.exe:
//  1. TOTrapAncient02: parameters, rise 7 + 10.15, the hold (6x2C) on the
//     local player only, the hold time, the release (6x2D), the sink, idle;
//  2. TOTrapAncient02R: switch flag gate, technique and level, sink;
//  3. TODoorVoShip: the seal bits from quest flags 0x2c..0x2f, the lamp
//     order, the alpha swing;
//  4. TOTrapSeabed01 (0x0228, the Seabed capture trap): the cloak flag from
//     param5, the trap vision bit (0x10000) and the same-room check of
//     IsPlayerVisibleToPartTrap, the sticky reveal, the view distance and the
//     draw modes of render_capturetrap;
//  5. the trap vision source (class flag 0x10) and the reveal as gamefield feeds it;
//  6. the capture trap's trigger (idle, 15 in XZ), the spring (njm frames, the attack at
//     its end, 6x2C with frames 0xffff for the local client), the hold's SE and the release event.
// Run: node tests/traps.test.ts
import {
  CAPTURE_RADIUS,
  type CapturePlayer,
  CaptureTrap,
  captureSound,
  captureSpeed,
  captureTrapCloaked,
  HOLD_UNTIL_RELEASED,
  holdCountdown,
  captureReticleShown,
  captureTrapDraw,
  hasTrapVision,
  PillarTrap,
  RISE_1,
  RISE_2,
  SealDoor,
  TRAP_CAPTURE,
  TRAP_HOLD,
  parseHoldPacket,
  TRAP_TECH,
  TRAP_VISION_FLAG,
  trapSe,
  trapVisionSeen,
  withinViewDistance,
  type TrapEvent,
  type TrapPlayer,
  type VisionPlayer,
} from '../client/src/render/traps.ts';
import { isAndroid } from '../client/src/combat/progression.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};

const run = (t: PillarTrap, n: number, players: TrapPlayer[], self = 0, area = 6, sw = () => false) => {
  const out: TrapEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...t.frame(players, self, area, sw));
  return out;
};

// 1. Hold trap.
{
  const t = new PillarTrap({ type: TRAP_HOLD, x: 0, z: 0, params: [20, 0, 0, 10, 0, 0], difficulty: 0 });
  check(t.radius === 40 && t.holdTime === 40, `radius param1 * 0.5 + 30 = ${t.radius}, hold param4 + 30 = ${t.holdTime}`);
  const far: TrapPlayer[] = [{ clientId: 0, x: 50, z: 0, radius: 5 }];
  check(run(t, 10, far).length === 0 && t.state === 0, 'idle while nobody is within the radius');
  const near: TrapPlayer[] = [{ clientId: 0, x: 10, z: 0, radius: 5 }];
  const ev = run(t, 1, near);
  check(t.state === 2 && t.sub === 0 && ev.some((e) => e.kind === 'sound' && e.id === 0x46b) === false, 'a player inside -> state 2');
  const rise = run(t, 1, near);
  check(rise.some((e) => e.kind === 'sound' && e.id === 0x46b), 'the Mines SE 0x46b when it springs');
  run(t, 7, near);
  check(t.sub === 1 && t.rise1 === RISE_1, `first segment up to ${t.rise1}`);
  run(t, 11, near); // 1 .. 10, then 11 >= 10.15 stops at 10.15
  check(t.sub === 2 && t.rise2 === RISE_2, `second segment up to ${t.rise2.toFixed(2)}`);
  const hold = run(t, 1, near);
  const h = hold.find((e) => e.kind === 'hold');
  check(!!h && h.kind === 'hold' && h.frames === 40 && h.x === 0 && h.z === 0 && h.radius2 === 35 * 35, `6x2C: ${JSON.stringify(h)}`);
  check(t.state === 3 && t.sub === 2, 'state 3 (hold)');
  const held = run(t, 40, near);
  check(!held.some((e) => e.kind === 'release') && t.sub === 2, 'held for the hold time');
  const rel = run(t, 1, near);
  check(rel.some((e) => e.kind === 'release') && t.sub === 3, '6x2D when the hold time runs out, then the sink');
  run(t, 30, far); // with the player gone (it would spring again at once)
  check(t.state === 0 && t.rise1 === 0 && t.rise2 === 0, 'sunk back to idle');
  // Another player: the trap springs but only the local player gets a hold.
  const u = new PillarTrap({ type: TRAP_HOLD, x: 0, z: 0, params: [0, 0, 0, 0, 0, 0], difficulty: 0 });
  const other = run(u, 30, [{ clientId: 2, x: 5, z: 0, radius: 5 }], 0);
  check(!other.some((e) => e.kind === 'hold') && u.state === 3, 'a remote player in range: no 6x2C from us');
  // Out of the inner radius (radius - player radius) at the strike: no hold, sink.
  const v = new PillarTrap({ type: TRAP_HOLD, x: 0, z: 0, params: [0, 0, 0, 0, 0, 0], difficulty: 0 });
  const edge = run(v, 30, [{ clientId: 0, x: 27, z: 0, radius: 5 }]);
  check(!edge.some((e) => e.kind === 'hold') && (v.sub === 3 || v.sub === 4 || v.state === 0), 'inside the radius but outside radius - 5: no hold');
}

// 2. Technique trap.
{
  const t = new PillarTrap({ type: TRAP_TECH, x: 0, z: 0, params: [0, 0, 3, 0, 5, 3], difficulty: 2 });
  check(t.tech === 'megid' && t.level === 8 && t.switchFlag === 5, `param6 3 = ${t.tech}, level round(1 + 2 * 2 + 3) = ${t.level}, switch ${t.switchFlag}`);
  const p: TrapPlayer[] = [{ clientId: 1, x: 3, z: 0, radius: 5 }];
  run(t, 5, p, 0, 8, () => false);
  check(t.state === 0, 'waits for its switch flag');
  const ev = run(t, 30, p, 0, 8, () => true);
  const tech = ev.find((e) => e.kind === 'tech');
  check(!!tech && tech.kind === 'tech' && tech.clientId === 1 && tech.tech === 'megid' && tech.level === 8, 'fires at the target (any player; the target resolves it)');
  check(ev.some((e) => e.kind === 'sound' && e.id === 0x489), 'Ruins SE 0x489');
  const ult = new PillarTrap({ type: TRAP_TECH, x: 0, z: 0, params: [0, 0, 40, 0, -1, 9], difficulty: 3 });
  check(ult.level === 0x1d && ult.tech === 'gifoie' && ult.switchFlag === -1, 'Ultimate level clamps at 29, param6 clamps to 4 (Gifoie), no switch');
  const nor = new PillarTrap({ type: TRAP_TECH, x: 0, z: 0, params: [0, 0, 40, 0, 0x100, 0], difficulty: 0 });
  check(nor.level === 0x0e && nor.tech === 'foie' && nor.switchFlag === -1, 'other difficulties clamp at 14');
  check(trapSe(3) === 0x456 && trapSe(0x15) === 0x4b5 && trapSe(1) === null, 'area SE table');
}

// 3. Seal door.
{
  const flags = new Set<number>();
  const q = (f: number) => flags.has(f);
  const d = new SealDoor(q);
  check(d.sealed && d.lamps().join() === 'true,true,true', 'three seals, three lamps');
  d.frame(q);
  check(Math.abs(d.alpha + 0.05) < 1e-6, `alpha falls by 0.05 (${d.alpha.toFixed(3)})`);
  for (let i = 0; i < 25; i++) d.frame(q);
  check(d.alpha > -1 && (d.bits & 0x10) !== 0, `at -1 it turns (alpha ${d.alpha.toFixed(3)})`);
  flags.add(0x2d);
  d.frame(q);
  check(d.lamps().join() === 'false,true,true', 'flag 0x2d puts out the first lamp (bit 4)');
  flags.add(0x2c);
  d.frame(q);
  check(d.lamps().join() === 'false,false,true' && d.sealed, 'flag 0x2c the second (bit 2)');
  flags.add(0x2f);
  d.frame(q);
  check(!d.sealed, 'flag 0x2f opens the seal');
  const e = new SealDoor((f) => f === 0x2e);
  check(e.lamps().join() === 'true,true,false', 'the ctor already reads the flags (0x2e: bit 8)');
}

// 4. Seabed capture trap (0x0228) and trap vision.
{
  check(TRAP_CAPTURE === 0x0228 && CAPTURE_RADIUS === 15, 'TOTrapSeabed01 id 0x0228, radius 15');
  check(captureTrapCloaked([0, 0, 0, 0, 1, 0]) && captureTrapCloaked([0, 0, 0, 0, 2.9, 0]), 'param5 above 0 cloaks');
  check(!captureTrapCloaked([0, 0, 0, 0, 0, 0]) && !captureTrapCloaked([0, 0, 0, 0, -1, 0]), 'param5 0 or below: not cloaked');
  check(!captureTrapCloaked([]) && !captureTrapCloaked([0, 0, 0, 0, 0.5, 0]), 'missing param5 is not cloaked; 0.5 truncates to 0');
  check(hasTrapVision(0x10000) && !hasTrapVision(0x20000) && !hasTrapVision(0xffff), 'the trap vision bit is 0x10000 only');

  const room = 7;
  const seeing: (VisionPlayer | null)[] = [null, { room: 3, flags: 0 }, { room, flags: 0x10000 }, null];
  check(trapVisionSeen(room, seeing), 'a player in the trap room with the bit reveals it');
  check(!trapVisionSeen(8, seeing), 'a player with the bit in another room does not');
  check(!trapVisionSeen(room, [{ room, flags: 0x20000 }]), 'other flags do not');
  check(!trapVisionSeen(room, [null, null, null, null, { room, flags: 0x10000 }]), 'only the four player slots count');

  const ct = new CaptureTrap([0, 0, 0, 0, 1, 0]);
  check(ct.cloaked && ct.radius === 15 && ct.state === 0, 'a new cloaked capture trap is idle');
  const inp = (slots: (VisionPlayer | null)[], r: number, players: CapturePlayer[] = []) => ({ slots, room: r, players, selfId: 0, springFrames: 4 });
  ct.frame(inp([{ room, flags: 0 }], room));
  check(ct.state === 0 && !ct.revealed, 'no trap vision: stays idle');
  ct.frame(inp(seeing, room));
  check(ct.revealed && ct.state === 1, 'trap vision in the room: state 1');
  ct.frame(inp([], room));
  check(ct.revealed, 'the reveal is sticky (nothing sets state 0 again)');

  check(withinViewDistance(0) && withinViewDistance(-400) && !withinViewDistance(-400.5) && !withinViewDistance(1), 'view distance 400 in front of the camera');

  // The draw does not read the reveal: a cloaked trap draws the same before and after.
  const before = captureTrapDraw(true, true, true, false);
  check(before === 'cloak' && captureTrapDraw(true, true, true, false) === before, 'cloaked, advanced effects on: the cloak pass');
  check(captureTrapDraw(true, false, true, false) === 'hidden', 'cloaked, advanced effects off: not drawn while idle or revealed');
  check(captureTrapDraw(false, false, true, false) === 'plain', 'not cloaked: the plain model');
  check(captureTrapDraw(true, false, true, true) === 'plain', 'sprung (state 2+): the active draw has no cloak check');
  check(captureTrapDraw(true, true, false, false) === 'hidden', 'out of the view distance: hidden');
}

// 5. Trap vision source (the class flag 0x10 -> unknown_flags_2 0x10000) and the reveal of a
// cloaked capture trap, as gamefield.ts feeds them.
{
  // Androids (HUcast 2, RAcast 4, RAcaseal 5, HUcaseal 9) carry class flag 0x10; the others do not.
  check([2, 4, 5, 9].every((c) => isAndroid(c)) && [0, 1, 3, 6, 7, 8, 10, 11].every((c) => !isAndroid(c)), 'android classes carry the class flag 0x10');
  const androidFlags = isAndroid(4) ? 0x10000 : 0;
  const ct = new CaptureTrap([0, 0, 0, 0, 1, 0]);
  const room = 3;
  ct.frame({ slots: [null, null, { room, flags: androidFlags }, null], room, players: [], selfId: 0, springFrames: 4 });
  check(ct.revealed, 'an android in the trap room reveals a cloaked capture trap');
  check(captureTrapDraw(ct.cloaked, true, true, false) === 'cloak', 'the revealed trap still draws as the cloak (the draw does not read the reveal)');
  const human = new CaptureTrap([0, 0, 0, 0, 1, 0]);
  human.frame({ slots: [{ room, flags: isAndroid(0) ? 0x10000 : 0 }], room, players: [], selfId: 0, springFrames: 4 });
  check(!human.revealed, 'a human in the room does not reveal it');
}

// 6. Seabed capture trap, the trigger, the spring and the hold (EnemyAIUpdateState_0063a034 and the
// handlers 0x0063a3d8 / 0x0063e7a4 / 0x0063e444 / 0x0063e72c).
{
  const none: (VisionPlayer | null)[] = [null, null, null, null];
  const at = (x: number, z: number, clientId = 0, radius = 5): CapturePlayer => ({ clientId, x, z, radius });
  const run = (ct: CaptureTrap, players: CapturePlayer[], springFrames: number, selfId = 0) => ct.frame({ slots: none, room: 0, players, selfId, springFrames });
  check(captureSpeed(0) === Math.fround(0.1) && captureSpeed(NaN) === Math.fround(0.1) && captureSpeed(1) === 1 && captureSpeed(50) === 10, 'speed: param1 clamped to 0.1..10');
  check(captureSound(23) === 0x4da && captureSound(27) === 0x4da && captureSound(28) === 0x4fe && captureSound(29) === 0x4fe && captureSound(22) === null, 'SE by area');

  // Trigger: the idle's nearest player in XZ under 15 -> spring, the same tick (state 0 and 1 both run the idle).
  const near = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
  run(near, [at(0, 14.9, 1)], 4);
  check(near.state === 2, 'a player 14.9 away in XZ springs the trap in the same tick');
  const edge = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
  run(edge, [at(15, 0, 1)], 4);
  check(edge.state === 0, 'exactly 15 is not in range (strict)');
  const high = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
  run(high, [{ clientId: 1, x: 3, z: 4, radius: 5 }], 4);
  check(high.state === 2, 'the XZ distance (5) is in range whatever the height');
  const seen = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
  seen.frame({ slots: [null, null, { room: 0, flags: 0x10000 }, null], room: 0, players: [], selfId: 0, springFrames: 4 });
  check(seen.state === 1 && run(seen, [], 4).length === 0 && seen.state === 1, 'trap vision alone (no player in range) keeps state 1');

  // Spring: anim += speed per tick; past frames-1 (3 for a 4-frame motion) it clamps, state 3, the attack.
  const hit = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 10, y: 0, z: 20 });
  run(hit, [at(10, 20 + 14, 1)], 4); // 14 away: springs
  check(hit.state === 2 && hit.anim === 0, 'springs at frame 0');
  for (let i = 0; i < 3; i++) run(hit, [at(10, 20 + 14, 1)], 4);
  check(hit.state === 2 && hit.anim === 3, 'speed 1: frame 3 after 3 more ticks, still springing');
  // The attack: reach = 15 - 5 = 10; a player at 14 is out of the reach (no hold), the player at 8 is in.
  const ev = run(hit, [at(10, 20 + 14, 0)], 4);
  check(hit.state === 3 && hit.anim === 3 && ev.length === 0, 'the spring ends at frame 3, state 3: a 14-away player is out of the 10 reach (no hold, no SE)');
  const fired = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 10, y: 0, z: 20 });
  run(fired, [at(10, 20 + 14, 1)], 4);
  for (let i = 0; i < 3; i++) run(fired, [at(10, 20 + 8, 0)], 4);
  const shot = run(fired, [at(10, 20 + 8, 0)], 4);
  const hold = shot.find((e) => e.kind === 'hold');
  check(fired.state === 3 && hold !== undefined, 'a player 8 away (under the reach of 10) is held when the spring ends');
  if (hold?.kind === 'hold') check(hold.clientId === 0 && hold.frames === HOLD_UNTIL_RELEASED && hold.frames === 0xffff && hold.x === 10 && hold.z === 20 && hold.radius2 === 100, '6x2C: the local client, frames 0xffff, the trap x / z, radius^2 = 10^2');
  const other = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 10, y: 0, z: 20 });
  run(other, [at(10, 34, 1)], 4, 0);
  for (let i = 0; i < 3; i++) run(other, [at(10, 28, 1)], 4, 0);
  const oshot = run(other, [at(10, 28, 1)], 4, 0);
  check(!oshot.some((e) => e.kind === 'hold') && oshot.some((e) => e.kind === 'sound'), 'another client held: no 6x2C here, the SE still plays');

  // The spring with no motion (0 frames) never ends.
  const still = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
  run(still, [at(0, 1, 1)], 0);
  for (let i = 0; i < 100; i++) run(still, [at(0, 1, 1)], 0);
  check(still.state === 2, 'no known motion: the spring does not end');

  // Speed 2: the same 4-frame motion ends after 2 ticks (anim 2, 4 > 3 -> clamp to 3).
  const fast = new CaptureTrap([2, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
  run(fast, [at(0, 1, 1)], 4);
  run(fast, [at(0, 1, 1)], 4);
  run(fast, [at(0, 1, 1)], 4);
  check(fast.state === 3 && fast.anim === 3, 'speed 2 reaches the last frame in 2 ticks (clamped)');

  // Hold: the counter 1 -> 0 plays the SE, then nothing (the hit path is not ported).
  const hold3 = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
  hold3.frame({ slots: none, room: 0, players: [at(0, 1, 1)], selfId: 0, springFrames: 1 });
  hold3.frame({ slots: none, room: 0, players: [at(0, 1, 1)], selfId: 0, springFrames: 1 });
  check(hold3.state === 3, 'springs and ends at once with one frame');
  const h1 = run(hold3, [], 1);
  const h2 = run(hold3, [], 1);
  const h3 = run(hold3, [], 1);
  check(h1.length === 1 && h1[0].kind === 'sound' && h2.length === 0 && h3.length === 0 && hold3.state === 3, 'hold: the SE once, then no event; the state never clears');

  // No sound for areas outside the groups; the release is 6x2D on the given client.
  const quiet = new CaptureTrap([1, 0, 0, 0, 0, 0], 3, { x: 0, y: 0, z: 0 });
  quiet.frame({ slots: none, room: 0, players: [at(0, 1, 1)], selfId: 0, springFrames: 1 });
  quiet.frame({ slots: none, room: 0, players: [at(0, 1, 1)], selfId: 0, springFrames: 1 });
  check(quiet.sound === null && quiet.state === 3, 'an area without the SE: the hold still runs silently');
  check(near.release(0).kind === 'release' && near.release(3).kind === 'release' && (near.release(3) as { clientId: number }).clientId === 3, 'release: a release event for the client');
}

// 7. The release: the trap's on-interact (0x63ed78) runs when another entity touches it; the held
// player cannot release itself (the +0x50 gate 0x63a00c). Incoming 6x2C / 6x2D (parseHoldPacket).
{
  const none: (VisionPlayer | null)[] = [null, null, null, null];
  const at = (x: number, z: number, clientId: number): CapturePlayer => ({ clientId, x, z, radius: 5 });
  // Hold the player (client 0, the local one) at 8 from the trap at the origin.
  const holdOn = (target: number, extra: CapturePlayer[] = []) => {
    const ct = new CaptureTrap([1, 0, 0, 0, 0, 0], 28, { x: 0, y: 0, z: 0 });
    ct.frame({ slots: none, room: 0, players: [at(0, 14, target), ...extra], selfId: 0, springFrames: 1 });
    ct.frame({ slots: none, room: 0, players: [at(0, 8, target), ...extra], selfId: 0, springFrames: 1 });
    return ct;
  };
  const rel = (evs: TrapEvent[]) => evs.filter((e) => e.kind === 'release');

  const ct = holdOn(0);
  check(ct.state === 3 && ct.captured === 0, 'the spring holds client 0 (the target is recorded)');
  check(rel(ct.frame({ slots: none, room: 0, players: [at(0, 8, 0)], selfId: 0, springFrames: 1 })).length === 0, 'the held player alone near the trap does not release it');
  const touched = rel(ct.frame({ slots: none, room: 0, players: [at(0, 8, 0), at(0, 18, 1)], selfId: 0, springFrames: 1 }));
  check(touched.length === 1 && touched[0].kind === 'release' && touched[0].clientId === 0, 'a teammate 18 away (under 14 + 5) releases the held client 0');
  check(ct.captured === null, 'the release clears the record');
  check(rel(ct.frame({ slots: none, room: 0, players: [at(0, 8, 0), at(0, 18, 1)], selfId: 0, springFrames: 1 })).length === 0, 'no second release');

  const far = holdOn(0);
  check(rel(far.frame({ slots: none, room: 0, players: [at(0, 8, 0), at(0, 20, 1)], selfId: 0, springFrames: 1 })).length === 0, 'a teammate 20 away does not touch the trap');

  // Another client held: this client's trap run releases it when this client's player touches the trap.
  const remote = holdOn(2, [at(0, 18, 3)]);
  check(remote.captured === 2 && remote.state === 3, 'the spring holds client 2 (a remote player) on this run too');
  const remoteRel = rel(remote.frame({ slots: none, room: 0, players: [at(0, 8, 2), at(0, 18, 3)], selfId: 0, springFrames: 1 }));
  check(remoteRel.length === 1 && remoteRel[0].kind === 'release' && remoteRel[0].clientId === 2, 'a touch by client 3 releases client 2 (the event names the held client)');
  check(remote.release(2).kind === 'release', 'release() names the client it is given');

  // The 6x2C / 6x2D bodies as the wire has them: u8 sub, u8 size, u16 client id, u16 frames.
  const pkt = (sub: number, id: number, frames = 0) => {
    const b = new Uint8Array(sub === 0x2c ? 0x14 : 4);
    const dv = new DataView(b.buffer);
    b[0] = sub;
    b[1] = b.length / 4;
    dv.setUint16(2, id, true);
    if (sub === 0x2c) dv.setUint16(4, frames, true);
    return b;
  };
  check(parseHoldPacket(0x2d, pkt(0x2d, 5))?.clientId === 5 && parseHoldPacket(0x2d, pkt(0x2d, 5))?.frames === 0, 'a received 6x2D names the client (no frames)');
  check(parseHoldPacket(0x2c, pkt(0x2c, 1, 0xffff))?.frames === 0xffff, 'a received 6x2C carries the frames at 4');
  check(parseHoldPacket(0x2a, pkt(0x2d, 5)) === null && parseHoldPacket(0x2d, new Uint8Array(2)) === null, 'other subcommands and short bodies are not hold packets');
}

// 8. The timed hold: the counter (param4 clamped 1..60, x 30 ticks) ends it through the trap's own hit path
// (the on-interact), so a solo player is released without a teammate. The 6x2C's 0xffff has no self countdown.
{
  const none: (VisionPlayer | null)[] = [null, null, null, null];
  const at = (x: number, z: number, clientId: number): CapturePlayer => ({ clientId, x, z, radius: 5 });
  // Spring a trap with param4 = p4 on the held client `held` (8 away); returns the trap at state 3.
  const held = (p4: number, held: number) => {
    const ct = new CaptureTrap([1, 0, 0, p4, 0, 0], 28, { x: 0, y: 0, z: 0 });
    ct.frame({ slots: none, room: 0, players: [at(0, 14, held)], selfId: 0, springFrames: 1 });
    ct.frame({ slots: none, room: 0, players: [at(0, 8, held)], selfId: 0, springFrames: 1 });
    return ct;
  };
  // Ticks until the first release (nobody else in the field), with the events of every tick.
  const untilRelease = (ct: CaptureTrap, players: CapturePlayer[]) => {
    const all: TrapEvent[] = [];
    for (let n = 1; n <= 5000; n++) {
      const evs = ct.frame({ slots: none, room: 0, players, selfId: 0, springFrames: 1 });
      all.push(...evs);
      if (evs.some((e) => e.kind === 'release')) return { n, evs: all };
    }
    return { n: -1, evs: all };
  };
  const solo = held(1, 0);
  const r1 = untilRelease(solo, [at(0, 8, 0)]);
  check(r1.n === 31, 'param4 1: the solo hold ends on tick 31 (30 counter ticks + the first below 0)');
  check(r1.evs.some((e) => e.kind === 'release' && e.clientId === 0), 'the release names the held client (0)');
  check(solo.captured === null && untilRelease(solo, [at(0, 8, 0)]).n === -1, 'the record is cleared: no second release');
  check(r1.evs.filter((e) => e.kind === 'sound').length === 1, 'the SE starts once for the hold');

  check(untilRelease(held(0, 0), [at(0, 8, 0)]).n === 31, 'param4 0 is clamped to 1 (30 ticks)');
  check(untilRelease(held(60, 0), [at(0, 8, 0)]).n === 1801, 'param4 60: 60 x 30 counter ticks + 1');
  check(untilRelease(held(99, 0), [at(0, 8, 0)]).n === 1801, 'param4 above 60 is clamped to 60');
  check(untilRelease(held(1, 2), [at(0, 8, 2)]).evs.some((e) => e.kind === 'release' && e.clientId === 2), 'a remote held client is released by this run too (its own client sends the 6x2D)');

  // No one held (the spring found nobody at its end): no release at all.
  const nobody = new CaptureTrap([1, 0, 0, 1, 0, 0], 28, { x: 0, y: 0, z: 0 });
  nobody.frame({ slots: none, room: 0, players: [at(0, 14, 0)], selfId: 0, springFrames: 1 });
  nobody.frame({ slots: none, room: 0, players: [at(0, 40, 0)], selfId: 0, springFrames: 1 });
  check(nobody.state === 3 && untilRelease(nobody, []).n === -1, 'no target at the spring end: nothing is held or released');

  // 6x2C 0xffff is no self countdown; any other frames count down as they are.
  check(holdCountdown(0xffff) === Infinity && holdCountdown(90) === 90, 'holdCountdown: 0xffff has no timer, other frames count');

  // The state-1 cursor (DerollePartObjectEnableReticle_0063a3bc): shown only in state 1 and in view (ASSUMED gate).
  check(captureReticleShown(1, true), 'reticle: state 1 in view shows the cursor');
  check(!captureReticleShown(0, true) && !captureReticleShown(2, true) && !captureReticleShown(3, true), 'reticle: idle (0) and sprung (2, 3) do not show it');
  check(!captureReticleShown(1, false), 'reticle: state 1 out of view is hidden');
  // A revealed trap (state 1) with a player in range springs and stops showing the cursor.
  const reticleTrap = new CaptureTrap([1, 0, 0, 1, 0, 0], 28, { x: 0, y: 0, z: 0 });
  reticleTrap.frame({ slots: [{ room: 0, flags: TRAP_VISION_FLAG }, null, null, null], room: 0, players: [at(0, 40, 0)], selfId: 0, springFrames: 1 });
  check(reticleTrap.state === 1 && captureReticleShown(reticleTrap.state, true), 'reticle: a revealed trap with nobody in range shows the cursor');
  reticleTrap.frame({ slots: none, room: 0, players: [at(0, 10, 0)], selfId: 0, springFrames: 1 });
  check(reticleTrap.state === 2 && !captureReticleShown(reticleTrap.state, true), 'reticle: a player in range springs the trap and hides the cursor');
}

console.log(failures ? `${failures} failures` : 'traps: all checks passed');
process.exit(failures ? 1 : 0);

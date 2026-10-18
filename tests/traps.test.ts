// Pillar traps and Vol Opt's seal door (render/traps.ts), from PsoBB.exe:
//  1. TOTrapAncient02: parameters, rise 7 + 10.15, the hold (6x2C) on the
//     local player only, the hold time, the release (6x2D), the sink, idle;
//  2. TOTrapAncient02R: switch flag gate, technique and level, sink;
//  3. TODoorVoShip: the seal bits from quest flags 0x2c..0x2f, the lamp
//     order, the alpha swing.
// Run: node tests/traps.test.ts
import { PillarTrap, RISE_1, RISE_2, SealDoor, TRAP_HOLD, TRAP_TECH, trapSe, type TrapEvent, type TrapPlayer } from '../client/src/render/traps.ts';

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

console.log(failures ? `${failures} failures` : 'traps: all checks passed');
process.exit(failures ? 1 : 0);

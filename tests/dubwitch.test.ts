// The Dubwitch (combat/dubwitch.ts): hidden until a Dubchic of its section is
// dead or lying down, the rise (1), the lift (2), the hover (3) that never
// ends, the bobbing formula, and the Dubchic side of its link (markLinkedDead:
// the next death is final). The kill cascade itself is in render/combat.ts.
// Run: node tests/dubwitch.test.ts
import { DUBWITCH, DubwitchAi } from '../client/src/combat/dubwitch.ts';
import { DUBCHIC, DubchicAi } from '../client/src/combat/enemyfsmmines.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);
const mv = (f: number[], i: number[]) => ({ fparam1: f[0] ?? 0, fparam2: f[1] ?? 0, fparam3: f[2] ?? 0, fparam4: f[3] ?? 0, fparam5: f[4] ?? 0, fparam6: f[5] ?? 0, iparam: i });
const atk = { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 12, angle: 0x2000, distanceY: 0 };

// 1. Set data: the Dubwitch's hp is its ctor's 300.
eq(DUBWITCH.hp, 300, 'the Dubwitch has 300 HP (ctor 0x00618ae4)');

// 2. Hidden until a linked Dubchic is dead: it bobs at the float height.
{
  const d = new DubwitchAi({ x: 0, z: 0, angle: 0 });
  eq([d.state, d.untargetable, d.hidden], ['hidden', true, true], 'the Dubwitch starts hidden (is_invisible)');
  const f = d.tick([]);
  near(f.lift ?? -1, Math.sin(2184 * ((Math.PI * 2) / 0x10000)) + 20, 'it bobs: sin(2184 BAMS) + 20');
  for (let k = 0; k < 200; k++) d.tick([]);
  eq(d.state, 'hidden', 'no linked Dubchic dead: it stays hidden');
  check(d.untargetable, 'a hidden Dubwitch cannot be hit');
}

// 3. The rise, the lift and the hover (visible, forever).
{
  const d = new DubwitchAi({ x: 0, z: 0, angle: 0 });
  d.linkedDead = true;
  d.tick([]);
  eq(d.state, 'rise', 'a linked Dubchic dead: state 1 from the next tick');
  let n = 0;
  while (d.state === 'rise' && n++ < 200) d.tick([]);
  check(n >= 30 && n <= 32, `the rise lasts about 1 / 30 s of base time (${n} ticks)`);
  eq(d.state, 'lift', 'then the lift (state 2)');
  check(d.untargetable, 'still hidden while lifting');
  n = 0;
  while (d.state === 'lift' && n++ < 200) d.tick([]);
  check(n >= 30 && n <= 32, `the lift lasts about 1 / 30 s (${n} ticks)`);
  eq([d.state, d.untargetable, d.hidden], ['hover', false, false], 'hovering: visible and hittable');
  for (let k = 0; k < 500; k++) d.tick([]);
  eq(d.state, 'hover', 'nothing leaves the hover (update_dubwitch has no exit from 3)');
}

// 4. A sink (state 4) and the drop (state 5) bring it back to hidden; death.
{
  const d = new DubwitchAi({ x: 0, z: 0, angle: 0 });
  d.linkedDead = true;
  d.state = 'sink';
  let n = 0;
  while (d.state === 'sink' && n++ < 200) d.tick([]);
  eq(d.state, 'drop', 'a sink ends in the drop');
  n = 0;
  while (d.state === 'drop' && n++ < 200) d.tick([]);
  eq([d.state, d.untargetable], ['hidden', true], 'the drop ends hidden again');
  d.kill();
  eq(d.state, 'dead', 'kill: state 6');
  eq(d.tick([]).lift, undefined, 'a dead Dubwitch has no bobbing frame');
}

// 5. The Dubchic side: markLinkedDead makes its next death final; lying counts.
{
  const m = mv([0.8, 0, 0.6, 1.2, 0.7], [90, 45, 90, 225, 0, 0]);
  const plain = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 0, gillchic: false, ultimate: false, movement: m, attack: atk });
  eq([plain.lying, plain.revive()], [false, true], 'an unlinked Dubchic gets up after a death');
  eq(plain.lying, true, 'it is lying while it gets up (dead for the Dubwitch)');
  const linked = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 0, gillchic: false, ultimate: false, movement: m, attack: atk });
  linked.markLinkedDead();
  eq(linked.revive(), false, 'a linked Dubchic does not get up (its death is final)');
  eq(linked.deaths, 1, 'the death is counted');
  eq(DUBCHIC.maxRevives, 5, 'the unlinked limit is unchanged');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('dubwitch: all checks passed');

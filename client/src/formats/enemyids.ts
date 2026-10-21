// Enemy entity ids. Every e.dat entry becomes one or more enemy slots (the
// set entry plus its children: Mothmants of a Monest, Pofuilly copies, boss
// parts, ...); slots are numbered across all floors of the game, and an
// enemy's entity id is 0x1000 + its slot (6x0A, 6x76 headers). The child
// counts are a port of newserv's SuperMap::add_enemy_and_children
// (src/Map.cc, MIT license); only the counts are needed here.

import type { EnemySet } from './setdata.ts';

// Number of slots taken by one set entry (1 + children). `area` is the
// floor's area id (only type 0x00E0 depends on it).
export function enemySlotCount(e: Pick<EnemySet, 'type' | 'numChildren'>, area: number): number {
  const nc = e.numChildren;
  switch (e.type) {
    case 0x0042: // TObjEneBm3FlyNest: Monest + 30 Mothmants by default
      return 1 + (nc || 30);
    case 0x0064: // TObjEneSlime: (num_children or 4) + 1 Pofuilly
      return (nc || 4) + 1;
    case 0x0065: // TObjEnePanarms: Pan Arms, Hidoom, Migium
    case 0x00a1: // TObjEneRe4Sorcerer: Chaos Sorcerer + two bits
      return 3;
    case 0x0082: // TObjEneMe3ShinowaReal
    case 0x00a7: // TObjEneBalClawBody
    case 0x00d4: // TObjEneMe3StelthReal
      return 1 + (nc || 4);
    case 0x0084: // TObjEneMe1CanadinLeader: Canane + 8 Canadines
      return 1 + (nc || 8);
    case 0x00c1: // TBoss2DeRolLe: 1 + 10 body + 9 mines
      return 20;
    case 0x00c2: // TBoss3Volopt: 1 + 6 + 24 + 2 + 1 + 1 + 1
      return 36;
    case 0x00c8: // TBoss4DarkFalz: 1 + 0x1FD Darvants + 3
      return 0x201;
    case 0x00ca: // TBoss6PlotFalz: 1 + 0x200
      return 0x201;
    case 0x00cb: // TBoss7DeRolLeC: 1 + 10 + 36 + 1
      return 48;
    case 0x00cc: // TBoss8Dragon: Gol Dragon + 5
      return 1 + (nc || 5);
    case 0x00e0: // TObjEneEpsilonBody (area 0x23 only, exe table 0x009fba60): 4 Epsigards
      return area === 0x23 ? 1 + (nc || 4) : 1 + nc;
    case 0x0119: // Saint-Milion / Shambertin: 1 + 8 + 16
      return 25;
    default:
      return 1 + nc;
  }
}

// First slot of every entry of a floor's e.dat (relative to the floor), and
// the floor's slot count.
export function enemySlots(sets: ReadonlyArray<Pick<EnemySet, 'type' | 'numChildren'>>, area: number): { first: number[]; total: number } {
  const first: number[] = [];
  let n = 0;
  for (const e of sets) {
    first.push(n);
    n += enemySlotCount(e, area);
  }
  return { first, total: n };
}

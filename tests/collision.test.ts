// Parses every map c.rel in the user's client data/scene folder and checks the
// collision queries against the player spawn points (TObjPlayerSet) from the
// matching map_*o.dat in data.gsl.
// Run: node web/tests/collision.test.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseMapCRel } from '../client/src/formats/crel.ts';
import { parseMapNRel } from '../client/src/formats/nrel.ts';
import { parseObjectSets, playerSpawns, roomToWorld } from '../client/src/formats/objset.ts';
import { CollisionWorld, STEP_UP } from '../client/src/render/collision.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const SCENE = join(DATA, 'scene');
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

// 1. Every c.rel parses into sane geometry.
const worlds = new Map<string, CollisionWorld>();
let meshes = 0, faces = 0;
for (const f of readdirSync(SCENE).filter((f) => /^map_.*c\.rel$/.test(f))) {
  try {
    const c = parseMapCRel(new Uint8Array(readFileSync(join(SCENE, f))));
    if (c.meshes.length === 0) throw new Error('no meshes');
    for (const m of c.meshes) {
      if (![...m.center, m.radius].every(Number.isFinite) || m.radius <= 0) throw new Error('bad mesh bounds');
      if (!m.vertices.every(Number.isFinite)) throw new Error('non-finite vertex');
      const nv = m.vertices.length / 3;
      for (const fc of m.faces) {
        if (fc.a >= nv || fc.b >= nv || fc.c >= nv) throw new Error('face index out of range');
        if (Math.abs(Math.hypot(...fc.normal) - 1) > 0.01) throw new Error('normal not unit length');
        if (![...fc.center, fc.radius].every(Number.isFinite)) throw new Error('bad face bounds');
      }
      faces += m.faces.length;
    }
    meshes += c.meshes.length;
    worlds.set(f.slice(4, -'c.rel'.length), new CollisionWorld(c));
  } catch (e) {
    fail(`${f}: ${(e as Error).message}`);
  }
}
console.log(`c.rel: ${worlds.size} maps parsed, ${meshes} meshes, ${faces} faces`);

// 2. Ground exists at the player spawn points of every map whose o.dat matches a c.rel by name.
const gslPath = join(DATA, 'data.gsl');
if (!existsSync(gslPath)) {
  console.log('data.gsl not found, skipping spawn checks');
} else {
  const gsl = new GSLArchive(new Uint8Array(readFileSync(gslPath)));
  let checked = 0, lobbySpawns = 0;
  for (const [area, world] of worlds) {
    const odat = `map_${area}o.dat`;
    if (!gsl.has(odat)) continue;
    const nrelPath = join(SCENE, `map_${area}n.rel`);
    const rooms = existsSync(nrelPath) ? parseMapNRel(new Uint8Array(readFileSync(nrelPath))).sections : [];
    const spawns = playerSpawns(parseObjectSets(gsl.get(odat)));
    // boss06 (Episode 2 boss arena, floor 13): the c.rel has no floor under the spawn points
    // around the origin; presumably the players stand on an object there, which c.rel does not hold.
    if (area === 'boss06') continue;
    if (/^lobby_\d\d$/.test(area)) {
      const ids = spawns.map((s) => s.clientId).sort((a, b) => a - b).join(',');
      if (ids !== '0,1,2,3,4,5,6,7,8,9,10,11') fail(`${odat}: expected spawns for client ids 0..11, got ${ids}`);
      lobbySpawns += spawns.length;
    }
    for (const s of spawns) {
      const [x, y, z] = roomToWorld(s.position, rooms.find((r) => r.id === s.room));
      const g = world.groundHeight(x, z, y + STEP_UP);
      checked++;
      if (g === null) fail(`${area}: no ground under spawn ${s.clientId} (source ${s.source}) at ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`);
      else if (Math.abs(g - y) > 25) fail(`${area}: ground ${g.toFixed(1)} far from spawn ${s.clientId} y ${y.toFixed(1)}`);
    }
  }
  console.log(`spawns: ${checked} player sets checked (${lobbySpawns} in lobbies)`);
  if (lobbySpawns < 120) fail(`expected 10 lobbies x 12 spawns, got ${lobbySpawns}`);
}

// 3. Movement: walking from a lobby spawn never leaves the floor and walls stop it.
const lobby = worlds.get('lobby_01');
if (lobby) {
  let p = { x: 0, y: lobby.groundHeight(0, 135, 30)!, z: 135 };
  let stopped = false;
  for (let i = 0; i < 400; i++) {
    const r = lobby.move(p.x, p.y, p.z, 0, 4);
    if (r.blocked && r.x === p.x && r.z === p.z) stopped = true;
    p = r;
    if (lobby.groundHeight(p.x, p.z, p.y + STEP_UP) === null) fail(`lobby_01: walked off the floor at ${p.x},${p.z}`);
  }
  if (!stopped) fail('lobby_01: walking +Z from spawn 0 never hit a wall');
  console.log(`lobby_01: walk +Z from spawn 0 stopped at z=${p.z.toFixed(1)}`);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

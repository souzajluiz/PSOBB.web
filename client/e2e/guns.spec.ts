// Live check of the gun work (combat/gunbullet.ts, combat/attack.ts Mechgun
// bursts, render/combat.ts startAttack / resolveHit / gunShot / landGunBullet)
// against a local newserv.
//
// The webgun account (webgun / webgun) needs these items in its inventory:
// Handgun (kind 6), Rifle (7), Shot (9), a regular Mechgun (8) and Samba Maracas
// (0x48, a 3-burst item). The Samba was added offline once with bridge/admin-chars.mjs
// (applyCharacterPatch inventory.add; the file was backed up first to
// vendor/newserv/system/players/_admin-backups). The spec equips each weapon in the
// game (GameItems.equip, 6x25) and equips the original Mechgun again at the end.
//
// For each weapon, in Forest 1 (a solo party): the player stands 60 units behind
// an enemy, facing it, and attacks three times. The hooks wrapped on the page record
// the 6x43 (sendAttack), the 6x46 (sendAttackTargets), each gun shot (gunShot: the
// pellets it makes as trails) and each bullet's arrival (landGunBullet, with the
// enemy's HP change). Checks: the swings chain as steps 0, 1, 2; the bursts per swing
// (one 6x46 and one shot per burst); the pellets per shot (5 for the Shot); for the gun
// kinds, the HP drops only at a bullet's arrival and bullets arrive and damage. The first
// press is the keyboard's; the next two are armed and sent from the hit of the swing before
// them (dispatched on the canvas, see installHooks). 0 page errors and 0 failed requests.
// A screenshot of the first shot's bullets in flight per gun: the shot's bullets are held at the
// middle of their flight (installHooks: __gunFreezeNext / __gunFrozen) for the screenshot, then released.
// The files go to GUN_SHOT_DIR when set, else to the test's output folder.
//
// Samba Maracas (kind 0x48) is a gun too (combat/gunbullet.ts GUN_KINDS, ASSUMED from its inner
// ctor 0x005fc2fc: the Handgun's speed and particle callback): its three bursts fire three shots
// of bullets, and its damage lands at the arrivals like the other guns.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webgun';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webgun';

const FLOOR = 1; // Forest 1
const ROOM = 2;
const WAVE = 1;
const DISTANCE = 60; // units from the player to the target
// Key holds. A key still down when the next press comes is no new press (the game reads edges),
// so the first press is a short tap, released before the swing's hit.
const TAP_MS = 120;
const HOLD_MS = 50; // the in-page presses of the chain (installHooks): a few frames, released before the next one

// Weapon kinds (ItemPMT data1[1]), the bursts per swing and the pellets per shot each must show.
const WEAPONS = [
  { name: 'Handgun', kind: 6, bursts: 1, pellets: 1 },
  { name: 'Rifle', kind: 7, bursts: 1, pellets: 1 },
  { name: 'Shot', kind: 9, bursts: 1, pellets: 5 },
  { name: 'Mechgun', kind: 8, bursts: 1, pellets: 1 },
  { name: 'Samba Maracas', kind: 0x48, bursts: 3, pellets: 1 },
] as const;
const GUN_KINDS = new Set([6, 7, 8, 9, 0x48]); // combat/gunbullet.ts GUN_KINDS

type Entry = { t: 'swing' | 'hit' | 'targets' | 'shot' | 'land'; step?: number; pellets?: number; dhp?: number; hp: number };
type Swing = { step: number; hits: number; shots: number; pellets: number; targets: number; lands: number; dhp: number };

// Wraps the send and combat hooks of the page; the log lives on window.__gun.
async function installHooks(page: Page): Promise<void> {
  await page.evaluate((hold: number) => {
    const g = (window as any).classicGame;
    const game = g.game;
    const c = g.view.combat;
    const log: Entry[] = [];
    const sumHp = () => [...c.enemies.values()].reduce((s: number, e: any) => s + (e.dead ? 0 : e.stats.hp), 0);
    (window as any).__gun = { log };
    // The enemies' hits are not under test, but a hit reaction blocks the palette (combat.frame:
    // `blocked` while damage.busy) and would drop a press in a window: the reaction is cleared
    // (and the HP topped up) every 20 ms, so a flinch never takes a swing's press.
    setInterval(() => {
      if (c.damage.state !== 'dead' && c.damage.state !== 'revivable') {
        c.damage.maxHp = 100000;
        c.damage.hp = c.damage.maxHp;
        c.damage.state = 'alive';
      }
    }, 20);
    const origSend = game.sendAttack.bind(game);
    game.sendAttack = (step: number, angle: number, type: number) => {
      log.push({ t: 'swing', step, hp: sumHp() });
      return origSend(step, angle, type);
    };
    const origTargets = game.sendAttackTargets.bind(game);
    game.sendAttackTargets = (targets: unknown[]) => {
      log.push({ t: 'targets', hp: sumHp() });
      return origTargets(targets);
    };
    const origShot = c.gunShot;
    c.gunShot = function (this: any, ...args: any[]) {
      const before = this.tracers?.live?.length ?? 0;
      const r = origShot.apply(this, args as any);
      const after = this.tracers?.live?.length ?? 0;
      log.push({ t: 'shot', pellets: after - before, hp: sumHp() });
      // Test hook for the flight screenshot: the bullets of this shot are held at the middle of
      // their flight (their tick and frame are stopped) until the screenshot is taken.
      const tr = this.tracers;
      if ((window as any).__gunFreezeNext && tr) {
        (window as any).__gunFreezeNext = false;
        for (const t of tr.live.slice(before)) t.ticks = Math.ceil(t.total / 2);
        tr.frame(0);
        tr.tick = () => {};
        tr.frame = () => {};
        (window as any).__gunFrozen = true;
      }
      return r;
    };
    // A press armed by arm() is sent at the swing's next hit (the last burst of a Mechgun):
    // the key is dispatched on the canvas right after the hit, while the swing's window is open.
    const origResolve = c.resolveHit;
    c.resolveHit = function (this: any, ...args: any[]) {
      const a = this.attack;
      log.push({ t: 'hit', hp: sumHp() });
      if ((window as any).__gunArm && a && a.hits + 1 >= a.bursts) {
        (window as any).__gunArm = false;
        // The chain's presses: while the swing's window is open and the next step is not queued,
        // a short key press is sent every 60 ms (a press that the game drops is sent again). Once
        // step 2 is queued the chain runs on by itself; the pump stops with the last swing.
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        const pump = () => {
          if (!a.active || a.step >= 2) return;
          if ((a.flags & 2) && !(a.flags & 4) && a.queued === null) {
            canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
            setTimeout(() => canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })), hold);
          }
          setTimeout(pump, 60);
        };
        setTimeout(pump, 0);
      }
      return origResolve.apply(this, args);
    };
    const origLand = c.landGunBullet;
    c.landGunBullet = function (this: any, b: any) {
      const hp0 = b.entity.stats.hp;
      const r = origLand.call(this, b);
      log.push({ t: 'land', dhp: hp0 - b.entity.stats.hp, hp: sumHp() });
      return r;
    };
  }, HOLD_MS);
}

// Equips the weapon of `kind` in the game (the item's 6x25 through GameItems.equip).
async function equipKind(page: Page, kind: number): Promise<number> {
  return page.evaluate((k) => {
    const items = (window as any).classicGame.view.items;
    const inv = items.character.inventory as Array<{ flags: number; data: { id: number; data1: number[] } }>;
    const it = inv.find((i) => i.data.data1[0] === 0 && i.data.data1[1] === k);
    if (!it) return -1;
    if (!(it.flags & 8)) items.equip(it.data.id);
    return it.data.id;
  }, kind);
}

// The kind of the equipped weapon, read from the local inventory.
const equippedKind = (page: Page) =>
  peek(page, (w) => {
    const inv = w.classicGame.view.items.character.inventory as Array<{ flags: number; data: { data1: number[] } }>;
    return inv.find((i) => (i.flags & 8) !== 0 && i.data.data1[0] === 0)?.data.data1[1] ?? -1;
  });

// Puts the player DISTANCE units behind a visible living enemy (the nearest one with a clear line
// and in the same room), facing it. Clears the player's HP and reaction (see below). Returns the
// number of living enemies.
async function placeBehindNearest(page: Page): Promise<number> {
  return page.evaluate(
    ([distance]) => {
      const g = (window as any).classicGame;
      const v = g.view;
      const c = v.combat;
      const self = g.game.selfId;
      const from = c.view.playerPositions().get(self);
      const alive = [...c.enemies.values()].filter((e: any) => !e.dead && e.instance.root.visible && !e.ai?.invulnerable);
      if (!from || !alive.length) return 0;
      alive.sort((a: any, b: any) => {
        const pa = a.instance.root.position;
        const pb = b.instance.root.position;
        return Math.hypot(pa.x - from.x, pa.z - from.z) - Math.hypot(pb.x - from.x, pb.z - from.z);
      });
      // The nearest enemy whose line from the hand is clear of the map's walls (a gun's shot stops
      // at a wall, combat.gunShot); the nearest one when none is.
      const place = (e: any) => {
        const ep = e.instance.root.position;
        const a = Math.atan2(ep.x - from.x, ep.z - from.z);
        const at = { x: ep.x - distance * Math.sin(a), y: ep.y, z: ep.z - distance * Math.cos(a) };
        const clear = !c.opts.wallBlocks?.({ x: at.x, y: at.y + 20, z: at.z }, { x: ep.x, y: ep.y + 22, z: ep.z });
        // Enemies of other rooms are not drawn from here (the room's wave is hidden): stay in the target's room.
        const sameRoom = v.roomAt({ x: at.x, y: ep.y, z: at.z }) === v.roomAt({ x: ep.x, y: ep.y, z: ep.z });
        // The reticle from the placed point: the cone is the game's heading (set to a here).
        g.game.self.angle = a;
        const reach = c.weaponTargets(0, { x: at.x, y: ep.y, z: at.z }).length > 0;
        return { a, at, clear: clear && sameRoom, reach };
      };
      const picks = alive.slice(0, 10).map((e: any) => ({ e, ...place(e) }));
      const pick = picks.find((p: any) => p.clear && p.reach) ?? picks.find((p: any) => p.clear) ?? picks[0];
      const { a, at } = pick;
      const y = pick.e.instance.root.position.y;
      v.placePlayer(self, at.x, y, at.z, a);
      // The weapon's cone is read from the game's heading (combat.weaponTargets), not the view's.
      g.game.self.angle = a;
      return alive.length;
    },
    [DISTANCE] as const,
  );
}

// Places the player until a target is in reach (up to 5 tries: an enemy that walks can leave the
// reticle). Returns the living enemies.
async function placeInReach(page: Page): Promise<number> {
  let enemies = 0;
  for (let i = 0; i < 5; i++) {
    enemies = await placeBehindNearest(page);
    await page.waitForTimeout(120); // a few frames: the view moves the player on the next frame
    // The first target in reach with a clear line from the hand (gunShot's start and aim), so the shot
    // makes a bullet: a wall on the line stops it (no arrival).
    const reach = await page.evaluate(() => {
      const g = (window as any).classicGame;
      const c = g.view.combat;
      const from = c.view.playerPositions().get(g.game.selfId);
      const t = from ? c.weaponTargets(0, from)[0] : undefined;
      if (!t) return 0;
      const p = t.instance.root.position;
      const blocked = c.opts.wallBlocks?.({ x: from.x, y: from.y + 20, z: from.z }, { x: p.x, y: p.y + 22, z: p.z });
      return blocked ? 0 : 1;
    });
    if (reach > 0) break;
  }
  return enemies;
}

// One key press from the keyboard (a Playwright key event: the browser's own input), held `ms`.
async function press(page: Page, ms: number): Promise<void> {
  await page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.focus());
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(ms);
  await page.keyboard.up('ArrowDown');
}

// The chain's presses must land in a swing's window. A gun's window opens at its hit and is short
// (COMBO_WINDOW of the classes 6, 7 and 9 is 3 to 10 ticks after the motion ends, PsoBB.exe
// DAT_00969078), and the keyboard reached the game about 200 ms late in headless Chrome. So
// arm() lets installHooks send them: from the next hit on, the canvas gets a key press each 60 ms
// while the window is open, until the chain's last step is queued (see installHooks).
async function arm(page: Page): Promise<void> {
  await page.evaluate(() => ((window as any).__gunArm = true));
}

// The flight screenshot's file: GUN_SHOT_DIR when set (created), else the test's output folder.
function flightShot(info: TestInfo, weapon: string): string {
  const file = `${weapon.replace(/\s+/g, '-').toLowerCase()}-flight.png`;
  const dir = process.env.GUN_SHOT_DIR;
  if (!dir) return info.outputPath(file);
  mkdirSync(dir, { recursive: true });
  return join(dir, file);
}

const swingCount = (page: Page) => page.evaluate(() => (window as any).__gun.log.filter((e: Entry) => e.t === 'swing').length as number);

const idle = (page: Page) => page.evaluate(() => !((window as any).classicGame.view.combat.attack?.active ?? false));

// Splits the log into the swings (each from its 6x43 to the next one).
function bySwing(log: Entry[]): Swing[] {
  const out: Swing[] = [];
  let cur: Swing | null = null;
  for (const e of log) {
    if (e.t === 'swing') {
      cur = { step: e.step ?? -1, hits: 0, shots: 0, pellets: 0, targets: 0, lands: 0, dhp: 0 };
      out.push(cur);
    } else if (!cur) continue;
    else if (e.t === 'hit') cur.hits += 1; // one strike of the swing (a burst of a Mechgun)
    else if (e.t === 'targets') cur.targets += 1;
    else if (e.t === 'shot') {
      cur.shots += 1;
      cur.pellets += e.pellets ?? 0;
    } else if (e.t === 'land') {
      cur.lands += 1;
      cur.dhp += e.dhp ?? 0;
    }
  }
  return out;
}

test('guns: the swings, bursts, pellets and bullet arrivals of the five weapons in Forest 1', async ({ page }, info: TestInfo) => {
  test.setTimeout(900_000);
  const logs = consoleLog(page);
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`failed ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const name = `gun${Date.now() % 100000}`;
  const report: string[] = [];

  await test.step('log in, reach the lobby, create a solo party and enter it', async () => {
    await logIn(page, USER, PASSWORD);
    await reachLobby(page);
    await openPartyMenu(page);
    await key(page, 'ArrowDown'); // Create a PARTY
    await key(page, 'Enter');
    await key(page, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
    await key(page, 'Enter'); // Party Name
    await page.keyboard.type(name, { delay: 30 });
    await key(page, 'Enter');
    // Difficulty (row 3) -> entry 0 (Normal: a new character plays the first difficulty only).
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 3);
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party.create.step)).toBe('difficulty');
    await key(page, 'Enter');
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration
    await key(page, 'Enter');
    await key(page, 'Enter');
    await expectInGame(page, logs, name);
  });

  await test.step('Forest 1, the wave of room 2 is built', async () => {
    await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), FLOOR);
    await expect
      .poll(() => peek(page, (w) => (w.classicGame ? `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}` : '')), { timeout: 60_000 })
      .toBe(`${FLOOR}:false`);
    await page.evaluate(([f, r, w]) => (window as any).classicGame.view.constructEnemies(f, r, w), [FLOOR, ROOM, WAVE] as const);
    await expect.poll(() => peek(page, (w) => w.classicGame.view.combat.enemies.size), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    await installHooks(page);
  });

  let gunDamage = 0;
  for (const w of WEAPONS) {
    await test.step(`${w.name} (kind ${w.kind}): three swings with real presses`, async () => {
      // One retry when the set-up found no target at the first hit (the placement, not the port:
      // the enemies move and the reticle needs one in reach); a second miss fails the check.
      for (let attempt = 0; ; attempt++) {
      const id = await equipKind(page, w.kind);
      expect(id, `${w.name} in the inventory`).toBeGreaterThan(0);
      await expect.poll(() => equippedKind(page), { timeout: 20_000 }).toBe(w.kind);
      await page.waitForTimeout(500);

      await page.evaluate(() => (window as any).__gun.log.splice(0));
      const before = await swingCount(page);
      expect(await placeInReach(page), 'living enemies in Forest 1').toBeGreaterThan(0);

      // Swing 1: the first press (the keyboard) starts step 0. The chain's presses are armed: they
      // queue steps 1 and 2 in the windows of the swings before them.
      await page.evaluate((g: boolean) => ((window as any).__gunFreezeNext = g), GUN_KINDS.has(w.kind));
      await arm(page);
      await press(page, TAP_MS);
      await expect.poll(() => swingCount(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(before + 1);
      // A screenshot of the first shot's bullets in flight (gun kinds), held mid-flight by installHooks.
      // It runs beside the chain: a screenshot takes seconds in headless Chrome, and the window must not
      // wait for it. The bullets are released after it.
      const flight = GUN_KINDS.has(w.kind)
        ? page
            .waitForFunction(() => (window as any).__gunFrozen === true, undefined, { timeout: 8000, polling: 5 })
            .catch(() => undefined)
            .then(() => page.screenshot({ path: flightShot(info, w.name) }))
            .then(() =>
              page.evaluate(() => {
                const tr = (window as any).classicGame.view.combat.tracers;
                delete tr.tick;
                delete tr.frame;
                (window as any).__gunFrozen = false;
              }),
            )
        : null;

      // Swing 2: the armed press of swing 1 queued it (its hit opened the window). The enemies
      // walk: they are put back in the cone before swing 2's hit.
      await expect.poll(() => swingCount(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 2);
      await placeInReach(page);
      await expect.poll(() => swingCount(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 3);
      await flight;
      await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
      await page.waitForTimeout(2500); // the last bullets land

      const log = await page.evaluate(() => (window as any).__gun.log as Entry[]);
      const swings = bySwing(log);
      // Damage only at a bullet's arrival: the HP changes only at a 'land' entry.
      let stray = 0;
      for (let i = 1; i < log.length; i++) if (log[i].hp < log[i - 1].hp && log[i].t !== 'land') stray++;
      const landed = swings.reduce((s, x) => s + x.lands, 0);
      const dmg = swings.reduce((s, x) => s + x.dhp, 0);
      // A set-up miss: no target at the first hit, or (a gun) no bullet made: a wall on the line or
      // an enemy that moved out of it. Retried once.
      // A swing with no 6x46 (no target in reach when its hit came) is a set-up miss too: an enemy walked
      // out of the cone. The assertions below are unchanged.
      const setupMiss = swings.length < 3 || swings.some((s) => s.targets === 0) || (GUN_KINDS.has(w.kind) && landed === 0);
      if (attempt === 0 && setupMiss) {
        console.log(`${w.name}: no target or bullet in reach (set-up); trying the placement again`);
        continue;
      }
      const line =
        `${w.name}: steps ${JSON.stringify(swings.map((s) => s.step))}; bursts ${JSON.stringify(swings.map((s) => s.hits))}; ` +
        `shots per swing ${JSON.stringify(swings.map((s) => s.shots))}, pellets ${JSON.stringify(swings.map((s) => s.pellets))}, ` +
        `6x46 ${JSON.stringify(swings.map((s) => s.targets))}; arrivals ${landed}, damage ${dmg.toFixed(1)}, HP drops outside an arrival ${stray}`;
      console.log(line);
      report.push(line);

      expect(swings.map((s) => s.step), `${w.name}: the chain of steps`).toEqual([0, 1, 2]);
      for (const s of swings) {
        // The bursts: one strike each, whatever the targets; a 6x46 goes with each burst that has one in reach.
        expect(s.hits, `${w.name}: bursts of step ${s.step}`).toBe(w.bursts);
        expect(s.targets, `${w.name}: 6x46 per burst, step ${s.step}`).toBe(w.bursts);
        expect(s.shots, `${w.name}: shots (bursts) of step ${s.step}`).toBe(w.bursts);
        expect(s.pellets, `${w.name}: pellets of step ${s.step}`).toBe(w.bursts * w.pellets);
      }
      expect(stray, `${w.name}: HP drops outside a bullet's arrival`).toBe(0);
      expect(landed, `${w.name}: bullets that arrived`).toBeGreaterThan(0);
      gunDamage += dmg; // a roll can miss: the damage is checked over all the guns
      break;
      }
    });
  }
  expect(gunDamage, 'damage at the bullets\' arrivals, over the guns').toBeGreaterThan(0);

  await test.step('back to the lobby, the original Mechgun equipped again', async () => {
    await equipKind(page, 8);
    await leaveToLobby(page);
  });

  console.log(report.join('\n'));
  const errors = logs.filter((l) => l.startsWith('pageerror'));
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});

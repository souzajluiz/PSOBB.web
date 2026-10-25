# Handoff: where to resume

## 2026-10-25: Mechgun and Rifle traced (DEVLOG 2026-10-25)

- Done: the Mechgun (kind 8) makes three bursts per swing (`mechguns_constructor` writes
  attacks_per_step 3, objdump 0x005f4767; it was 1 before). Each burst is two
  `begin_gun_bullet_attack` calls (`do_mechguns_attack` 0x005f4620): the second is a bullet
  only when the first made none (`pelletAllowed`). The Rifle's group_idx 12 gets the hook's
  second muzzle. The 2026-10-22 "Mechgun / Rifle not traced" item is closed for those two.
- Open: the Mechgun's second start (+0x24c at height 35): the port uses the same node point
  (ASSUMED; the damage is unchanged, the second trail is at the same point); the Mechgun's
  +0x25c spin and +0x258 are not read; the Rifle's `ConstructWeaponGroup32` side object
  (group_idx 8..11 and 13) is not drawn. The class 6..9 kinds not traced (0x42 / 0x45 / 0x65 /
  0x6d and the rest of the class-3 list) are unchanged from 2026-10-23.
- Not run: `client/e2e/guns.spec.ts` (Mechgun now 3 bursts, 2 pellets), Chrome. Two unit tests
  (`combat.test.ts`, `weaponorigin.test.ts`) need `vendor/newserv`, which this worktree lacks.

## 2026-10-23: open after the day's merges

- `goldragon-smoke.spec.ts` fails at "a key attack hits the Gol Dragon" (0 hits). It
  fails the same way on 1a61ee0 (before the Gol Dragon copies merge), so it is not a
  regression of that merge; cause not found yet.
- `guns.spec.ts`: the Samba Maracas step still flakes (fewer bursts when the enemy
  walks out of range); passes on a rerun.
- Egg shot (Handgun group 8 / Samba / 0x1c): colour ramp, size, texture slot 35 and
  blend all match the exe; the "small purple ball" look is not explained yet (spawn
  offset sign, sprite size vs the exe's focal length; see DEVLOG).

## 2026-10-22: what was done (details in the DEVLOG entries of that date)

- Done: Dark Falz casket e2e and DEMO_WARP0 tower object; Dark Falz live camera pivots
  (not wired: forms lack the exe pose); Saint-Milion laser e2e + area SE banks now load;
  Battle Mode traps (ba_initial_floor warps); Episode 2 floors smoke (all 17 load).
- Guns: attacks face the primary target; bullets fly (gun_bullet.xj) and hit at arrival
  (movement miss, wall block); per-weapon speed (19 / Handgun 11 for group_idx 8 / Shot 15 /
  Samba 11 / 0x1c 11); Mechgun bursts = attacks_per_step (1, or 3 for Samba / Psychogun /
  Guld Milla / Mille Marteaux); guns e2e. Which kinds shoot: the exe's gate (PerformItemAttack
  flags, see DEVLOG 2026-10-23); 0x8b is not a bullet. Open (Mechgun and Rifle: DEVLOG 2026-10-25): the
  class 6..9 kinds with no gun callback are not traced; side-on bullet check.
- Remote players: one 6x40 / 6x42 per leg + dead reckoning (stutter on phones). Not
  measured on a real phone.
- Phones (portrait): tall stage for title, login (HTML form), character select / create
  (name form), Connecting, ship / block select, lobby and field (HUD anchored to the
  edges, vertical FOV kept). Phone e2e specs: phone-login, phone-charselect, phone-field.
- Server: bridge/server.mjs looks files up ignoring case. Lobby logs `[lobby]` +
  `psoLobbyDebug()` for the production "players don't see each other" report (not
  reproduced locally; waiting for a production console log).
- Episode 2 bosses: Barba Ray ported (brain, 10 parts as hit targets, Pig Ray minions;
  body moves: swim, arc, followers, side entries, corner transitions 3..0x0e and
  0x28..0x39, the drop 0x0d, the volopt 0x0f/0x10, the beam 0x17, the shot 0x19/0x1a and
  dispatch 0 (2026-10-24), the jump 0x11/0x12 with the leader's keyboard (2026-10-25).
  Still open: 0x18 (the player attack), dispatch 1 (the intro) and 2 (the input mode), and
  the 0x0d drop's .bss constants (static init says a47aa0 = 0.195, the port has 0.0; DEVLOG
  2026-10-25; map in docs/bosses/barbaray-map.md, pass 9). Gol Dragon has its brain
  (combat/goldragon.ts). Gal Gryphon has its brain (combat/galgryphonai.ts and the states
  files; its death goes through the brain since 2026-10-24). Olga Flow has a partial brain,
  form 1 (combat/olgaflowai.ts, 2026-10-24; map in docs/bosses/olgaflow-map.md; the sword wave hits and the
  arcs / turn since 2026-10-24, combat/olgaflowhits.ts; the stab's hit is in since 2026-10-24, the lancer since
  2026-10-25; the tail hit is still open: its anchor +0x640..+0x654 has no writer in the Olga code).
- tools/ghidra/decomp.sh now works from git worktrees.

Rewritten 2026-10-21 at the end of the day (the user: "pare tudo e documente pra
continuar amanha"). Everything is committed and pushed to `main`; no agents run, no
worktrees are left.

## Start here tomorrow (2026-10-21 leftovers, in order)

1. **Dark Falz cutscene in Chrome: DONE 2026-10-24** (DEVLOG "2026-10-24: Dark Falz casket in Chrome"; `e2e/darkfalz-casket.spec.ts` passes). Older text: the casket trigger is a position test (exe
   0x0044d490: any player within 30 units of (-9860, -240) on x / z starts DEMO_WARP0;
   the port matches). Extend `client/e2e/boss-smoke.spec.ts` (Dark Falz step): after
   warpTo(14) call `classicGame.view.placePlayer(selfId, -9860, y, -240, 0)` (or walk),
   then watch `combat.bossCameraView()` and take screenshots. This was being run when the
   day ended; it was reverted, untested.
2. **Dark Falz camera, the five live scenes** (APP TYPE2, DIE TYPE2 / TYPE3, GET RING,
   DEMO_WARP2): their pivots / yaws come from live entities ([0x00A44D5C..64]+0x38 / +0x60)
   and brain +0x3A4 / +0x3B0 (formula at 0x0044E1A3..CC not read). `cameraSourceOf`
   returns null for them. See DEVLOG "Dark Falz camera: scene pivots" (end of file).
3. **Saint-Milion laser in Chrome: DONE** (DEVLOG "2026-10-22: Saint-Milion laser in
   Chrome"). `ep4-battle-smoke.spec.ts` passes: the laser shot and its 0x6f8 loop are seen.
   Cause of the old failure: the spec sent 6xDC with `sendEpisode4BossAction` (network
   only); the exe runs it on the sender too (checked_call_packet0x60_subcommand 0x008003e0),
   and newserv does not echo to the sender. The brain already does that. Real port bug
   fixed: the area SE bank (boss09.pac for 0x2c) was never loaded (`CombatView.enterFloor`).
   Branch `worktree-agent-a4641173c3f901521`, not pushed.
4. **Battle Mode traps in Chrome: DONE** (DEVLOG "2026-10-22: Battle Mode traps in Chrome").
   `client/e2e/battle-traps.spec.ts` passes: the Battle party, b88001 from the guild counter,
   a trap from the palette (6x83 type 0 count 5), the owner's trap (6x80 what 2), HP 96 -> 16.
   Real port bug fixed: `ba_initial_floor` never moved the player, so no battle quest started
   (`battleFloor` was not wired, `quest/run.ts`). The account `webbattle` is a copy of webtest's
   save with a trap in palette slot 2 (see `client/e2e/README.md`). Not checked: the trap's look
   on screen, the arming and fuse frames (ASSUMED), a second player.
5. **REA with Ghidra**: the user's rule is to reverse-engineer with the REA skill and its
   Ghidra provider. REA cannot start Ghidra on this Mac until the Command Line Tools are
   updated (`sudo softwareupdate -i "Command Line Tools for Xcode-16.4"` in Terminal, by
   the user), then restart Claude Code. Until then use `tools/ghidra/decomp.sh <addr>`
   (project in `~/Downloads/psobb-master/reverse/ghidra`, read-only, shared by agents).
6. Smaller leftovers of the day (each in its DEVLOG entry): particle tint 0x100 (no copy
   of the owner's tint into the particle found; the port keeps the multiply), Saint-Milion
   laser aim (no writer of +0x44 / +0x38 in the exe; 0x8000 / 620 stay ASSUMED), the
   Savage Wolf / Yowie death side (velocity at the kill), the Held weapon's -1 texture ids.

## State of `main`

- Local `main` == `origin/main`. No open branches, no agents running.
- E2E: `boss-smoke.spec.ts` passes (Forest 1, the Dragon's entrance with particles, the
  Dark Falz arena; 0 page errors, 0 failed requests). `ep4-battle-smoke.spec.ts` passes on
  its branch (item 3 above; not yet on `main`).
- `client`: `npx tsc --noEmit -p .` is clean with the stricter flags
  (`noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`).
- All `tests/*.test.ts` pass. The newserv-backed ones need
  `NEWSERV=$PWD/vendor/newserv` (Node 24: `~/.nvm/versions/node/v24.18.0/bin`).
- The repository is private: branch protection does not apply on the free plan, so
  the flow is commit and push straight to `main` (the user's standing order: push
  automatically).

## Production

- Docker image: newserv comes from `ghcr.io/fuzziqersoftware/newserv:sha-ce2273a`
  (no compile). `/` serves only `classic.html`; the relay sends ETag / Cache-Control.
- Env `PSOBB_DATA_URL` (Google Drive zip of the client folder) is fetched into the
  volume `/data/psobb-client`; the data root is the folder with `data.gsl`.
- Needs a redeploy in Dokploy to pick up the latest `main`: loader, phone keyboard,
  phone fit / rotation, render batching, caching headers, data fetch fixes.
- Published address checked on 2026-10-19:
  `https://dopamina-psobb-quniis-6a0356-187-127-41-10.sslip.io`.

## To do next (in order)

1. **Player movement, remaining** (local tick machine and remote follower are in, see DEVLOG 2026-10-20; the two-client check of the field follower is done, 2026-10-22: `e2e/two-client-move.spec.ts`, 9.3 -> 4.8 units mean lag, zero-move frames 24 -> 17 %; left: the whole-frame hitch comparison alone vs with the other player (lobby and field), the lobby under the same throttle, a real phone; the slowed / guard speed and the animation tie are in the field since 2026-10-21, see DEVLOG "player slow / guard speed and animation tie in the field"). Original text:
   **Player movement, second half** (the user: "o deslocamento nao esta fiel").
   Done: walk 1.0 / run 1.5 units per tick (`render/playermove.ts`, 30 / 45 units a
   second). Open, all in the DEVLOG entry "player movement" with the exe addresses:
   - the tick function: poll (stand `0x0069b728`, walk `0x0069bbd0`, run
     `0x006a15a0`) then arrival check (`0x006a1790`) then update (`0x00689174`);
     a poll acts only on arrival (flag 4 of player+0x6c4); legs of about 8 ticks
     walking / 5 running, a direction change applies at a leg's end;
   - heading per tick (`0x007a8cd0`: a quarter of the way, half over 0x3000) and the
     velocity direction (`0x007a8c9c`), turn in place by 0x800 per tick;
   - walk to run after 6 ticks above 0.75 (keyboard too), keyboard axis ramp 32 per
     poll up to 128 (`0x0070a60c`), the 6x40 / 6x42 loop-back (`0x008003e0`);
   - drive the local player from it with `TickSmoother` (render/smoothrender.ts),
     remote players following 6x40 / 6x42 targets the same way, wall slide. (The
     animation-speed tie to the leg speed is done in the field, 2026-10-21: the slow
     outside the hubs and the guard stance; not ported: the light-hit / evade guard
     set 0x006a29f4 and the vtable gate of 0x0052ac5c.)
   Check the feel of 30 / 45 units a second first (it assumes 30 ticks a second); if
   it is wrong the fix is the constants in `playermove.ts`.
2. **Episode 2 enemy FSMs: all ported** (2026-10-20, `combat/enemyfsmep2*.ts`, one file per
   group, DEVLOG entries "Episode 2 FSMs: ..."). Checked in Chrome 2026-10-22 (DEVLOG "Episode 2
   floors in Chrome", `client/e2e/ep2-floors-smoke.spec.ts`, passes): floors 1..15 load, every
   placed enemy gets a model, FSM states change on 12 floors, no page error, no hang; the two
   quest-only floors (Seaside Night 0x22, Tower 0x23) miss their object sets (`map_jungle0{6,7}_00o.dat`,
   in no data source here), so they load with no enemies. Open:
   - the Episode 2 bosses: Barba Ray, Gol Dragon and Gal Gryphon have brains (wired in
     render/combat.ts; the Gryphon's death through its brain was added 2026-10-24, DEVLOG).
     Olga Flow (`TBoss6PlotFalz`, 0x1f) has a partial brain, form 1 only (2026-10-24,
     combat/olgaflowai.ts, map docs/bosses/olgaflow-map.md sections 13 and 14): the hub, the attack
     choice, the sword chains, the HP / death, the sword wave's hit (combat/olgaflowhits.ts, render
     olgaSwordWave), the stab's hit (pass 5, map section 15; its gate constants and range are ASSUMED), the arcs and the turn are ported. Left: the tail's hit (its
     anchor has no writer in the Olga code), the lancer's push-out and orbit (the hit is in, 2026-10-25), the mines, the controller's
     sub-states, form 2 (unreached in this build). The sword tip and the attack anchors are ASSUMED;
   - Tower / Epsilon not seen in Chrome (no enemies there);
   - floors 1, 5, 7, 10: 2026-10-24 long watch per wave group (`client/e2e/ep2-floors-watch.spec.ts`,
     DEVLOG "Episode 2 floors 1, 5, 7, 10: long watch"): floor 1 (25 groups) and floor 5 (11) run;
     floor 7 partial (4 of 27), floor 10 not run (the run was stopped). The section-placed Gibbon /
     Merilltas / Sinow groups in `spawn` are chained waves (DEVLOG "Episode 2 watch: the section-placed
     Gibbons / Sinows in `spawn` are chained waves"): never built, because their event runs only after
     the previous wave is dead. The brain leaves spawn on its first tick (test "Gibbon spawn"). OPEN:
     the watch spec must resolve the chain root and kill the predecessor's enemies. Idle after the
     trigger, checked 2026-10-24 (DEVLOG "Episode 2 idle groups 20/1 and 5/3"): floor 5 group 5/3
     (Sinow Berill, 185 units out) is exe-correct idle; floor 1 group 20/1 is NOT: Dimenian (range
     225) and Grass Assassin (400) are in range with a clear ray from the trigger point, so the exe
     would notice. The port's brain notices when handed the target, so the stall is in the wiring
     (spawn -> tick -> `aiTargets`), not located; next: a live log of the 20/1 run (the player's
     marker position and each enemy's `ai.state`). Floors 7 and 10 still to finish;
   - the enemy motion archives ARE in `data.gsl` (the earlier "not on this Mac" note is stale), so
     the animation lengths of groups a / d are still stand-ins in the tests, not from the files
     (checked: every `bm_ene_*` / `bm_boss*` name the port uses is in the GSL); no wall / ground rays;
   - Epsilon: its ids 0x2d2..0x2d5 are sound effects, not particles (the exe passes them
     to play_directional_sound_effect; wired in 2026-10-21 "Epsilon area mapping and
     particle tables"; the particle tables are not needed). Epsilon is area 0x23 only (0x22
     fixed).
3. **Captures to close the classic screens item**: character creation and Input
   UserID need captures of the original client in `client/public/ref/` (not committed)
   to measure SSIM. Title 0.77 and select character 0.92 are measured.
4. **Boss leftovers** (2026-10-24: De Rol Le beam muzzle traced in the exe, DEVLOG "De Rol Le beam muzzle": the emitter is the cast point `player+0x4f0` plus velocity each frame, no model node is copied; the port's muzzle estimate stays ASSUMED. Open: the writer of the cast point and velocity. Checked 2026-10-24 (DEVLOG "De Rol Le beam cast point"): the De Rol constructor (0x42ad4c) only zeroes them; the 0x4a6b4f block is Galgryphon's own constructor, not generic and not De Rol; no non-zero writer in 0x420000..0x43ffff. Next: trace `HandleDerolleAction_0042e824` and the unmapped stores at 0x4492cf, 0x4982xx, 0x5587xx. 2026-10-20 passes done: De Rol Le fin chains + helm / shell debris + the segments as hit
   targets, Vol Opt bars / cage / lid logic, Dragon body and tail hit boxes, Belra's thrown arms, the Saint-Milion
   brain; see their DEVLOG entries). Still open: Saint-Milion's laser aim (the laser's hit, life and sound loop are in, 2026-10-21; no writer of its aim (+0x44) or origin (+0x38) is in the exe on the traced paths, so the sweep 0x8000 and reach 620 stay ASSUMED, and the wall cut and impact particle are not reproduced; see the two DEVLOG entries),
   its cutscene states (they end with their animation: ASSUMED; the exe's exit is `GetGlobalGameState`, the cutscene object, see the 2026-10-24 "Saint-Milion wake" DEVLOG entry, which also checks the wake chain 0 -> 0x19 -> 2 against the exe: exe-correct, the state table matches all 31 rows), camera / sounds / particles;
   Vol Opt's cage, bars and prison (no model in the exe: particles and spheres, 2026-10-21; the lids and the broken monitors are drawn now); the Dragon's remaining effects (the mouth and feet nodes
   and the fire's sounds 0x321 / 0x31f are in, 2026-10-21; the 0x31x ids are SEs, not particles. The state sounds
   are in too (2026-10-24, each at its exe call: 0x315 walk, 0x317 / 0x318 flyUp, 0x318 / 0x31e flyShoot, 0x31a
   collapse entry, 0x31b death, 0x31d tail, 0x325 spiral / burrow / burrow out, 0x326 collapse; the 2026-10-24 pass
   adds 0x318 at frame 5 in the animate helper 0x0041ebc0 (roarAir, dive, flyAcross, flyShoot's turn, emerge; ASSUMED
   for flyShoot and emerge sub 4), 0x318 at frame 2 in land, and 0x320 at the fireball's impact). Not wired: 0x319
   (no call in the exe), 0x314 at 0x0042365d (state 1: no port state, no writer in the Dragon's code). The Dragon's
   particles: the stomp
   dust, the fireball's flight / impact / puff (its table; the trail was misread and is corrected), the land's
   take-off and stomp, the lift, the hover roar and the launch flash are in (2026-10-21, "Dragon particles from
   its data tables" and "Dragon particles: more sites"; the map table particleentrya%d.dat is read now; the
   flame's emitter, the collapse's rings, the death's two, the emerge helper and the flyShoot take-offs are in,
   2026-10-21 "Dragon particles: the unresolved sites"; the dive's impact helper 0x41fa7b, the dive's turn take-off
   0x41ff7a is in, and the take-off 0x4221b0 is flyAcross's (phase 0 of 0x00421ecc, 2026-10-24: moved from flyShoot's
   aim, where it was wrongly filed; 2026-10-21 "Dragon particles: the dive and the take-off callers"); the entrance's sub-states 0x86c / 0x874 and its six sites are in, 2026-10-21 "Dragon particles: the
   entrance", with its flame emitter; two of the six, 0x41b69a and 0x41b6a7, sit in variant 3, which the entry never
   selects, so they are ported but do not fire). Not spawned, and not ported: the take-off helper's callers 0x41c5b1 and 0x41cc87,
   which sit in the phase 0 of sids 0x1a (fly move) and 0x19 (teleport). Those sids are reached only by the pad-driven
   pick (phases 2 and 0xb, gated by the quest opcodes pad_dragon / control_dragon, which no stock quest uses; DEVLOG
   2026-10-21 "Dragon: sids 0x19 and 0x1a are pad-only", test section 31; 2026-10-24 "Dragon: the writers of sids 0x19 and
   0x1a" re-checks every writer: none is in the table pick, so 0x19 / 0x1a stay unported. Their 0x318 calls (0x0041ebc0
   at 0x0041c5aa and 0x0041cc80) and the take-offs wait for the pad path, which the port does not reproduce). 0x00769de3 is the Saint-Milion part's
   write, not the Dragon's. 0x840 at 0x0041ec4c is a flag, not an id. Dark Falz (2026-10-21 camera pass: `combat/darkfalzcamera.ts`
   maps the seven cutscene objects, their mode 5 pushes, records and scene owners; `bossCameraView` steps the per-frame update (2026-10-21 camera paths: the update 0x004D68A0 is ported; the record, the type flags and the motion index are decoded), and `render/gamefield.ts` gets `opts.bossCamera` from the Control. 2026-10-21 camera file pass: the motion file is NOT missing (`bo04opcam.rel` in data.gsl; `formats/cameramotion.ts` parses it, the GSL name lookup is case-blind now), the view composition 0x004D6BC0 is ported (`composeCameraUp`: up from the roll), and the field camera is driven from it for DEMO_WARP0 only, with its yaw ASSUMED 0. Open: the run-time yaws and pivots of the other scenes (GET RING, DEMO_WARP2, DIE TYPE2/3, APP TYPE2), whether the cutscene's eye / target are this object's +0x3C / +0x48 (ASSUMED), the 0x100 channel as the motion's time (ASSUMED), and who calls the vtable slot 10 each frame. Casket trigger (2026-10-21, DEVLOG "Dark Falz casket trigger"): WAIT_CASKET -> DEMO_WARP0 is the position test in the exe's lead procedure 0x0044d490 (any player within sqrt(900) of (-9860, -240), x and z; the dump's name for it is wrong), and the port matches it. Chrome (2026-10-24, `client/e2e/darkfalz-casket.spec.ts`, PASS): placed on the casket point, WAIT_CASKET -> DEMO_WARP0 at 0.3 s, the boss view drives the field camera for the 4 s scene, DEMO_WARP1 next, no hang, no page error (DEVLOG 2026-10-24). Open: the other five scenes' cameras need the live entities. Open too: the cutscene objects' bodies and the Ultimate Rico / ring scene (flag 0x97). Dark Falz Ultimate beam Darvants are in (2026-10-21, DEVLOG "Dark Falz Ultimate beam Darvants"): their hold (the bob, the look / chase, the 260 range), HP and ATP are still ASSUMED / UNCLEAR there.
   De Rol Le (2026-10-21 pass: the segment plates take the hit flash, the beam has its particles 0x126 / 0x177 /
   0x176): still UNCLEAR are the 0x176 point (the port puts it at the beam's end), when the exe makes 0x177 and
   the 0x122 cue; see that DEVLOG entry.
   Seen in Chrome (2026-10-24, DEVLOG "Boss leftovers in Chrome", `client/e2e/saintmilion-arena.spec.ts` and
   `client/e2e/derolle-plates.spec.ts`, PASS): the Saint-Milion tentacle poses and part boxes on the model nodes; De Rol
   Le's plate flashes cyan and fades back to white; the beam's emitter sits on the muzzle. Still open: the 6xDC flow with
   two clients (not run), the emitter following a MOVING muzzle (the body is still while it fires), and the muzzle is a
   brain estimate, not a model node (ASSUMED in combat/derolle.ts).
5. **Phones**: verify on real devices the soft keyboard (iOS / Android), the rotation
   and `screen.orientation.lock`, the adaptive resolution and the batching gain; the
   Forest 1 leaves differ in 1.07% of pixels from the unbatched draw (`?transparent=0`
   restores it).
6. Optional: the quest-loading particle wipes, the floor loading screens. The classic
   page now enters a created / joined party behind the game-entry loading screen (the
   warp) and plays it on the Online tab's field (2026-10-21, `classic/field.ts`).
   The Pioneer 2 NPC talk, the counters (shops, bank, Medical Center, the Hunter's Guild
   quest menu) and the quest runner are in on the classic field (2026-10-21, `classic/townfield.ts`;
   the shops and a quest's start are checked in Chrome (2026-10-21 "classic field: a shop
   and a quest start checked": `e2e/pioneer2-shop.spec.ts`, `e2e/pioneer2-quest.spec.ts`;
   the buy path needs a character with meseta to run again).
   The chat line (Space) and the mouse are in the field (2026-10-21 "classic field: chat
   line and mouse"; not seen in Chrome by hand).
   Leaving a game shows the lobby warp (2026-10-21); the exe's type for a leave is probably
   the floor warp (floor_prev / floor_next), not ported (DEVLOG "loading screen when leaving a game"). The counter's ship / block change and team menus
   are in (2026-10-20, not seen in Chrome: log in, walk to the counter, Transport /
   Team); left in teammenu.ts's header (Master Transfer, Buying Privileges, Flag
   Records, invitations, banned names).

## Lessons from the agents' reviews (apply to every new boss / enemy)

- Names in the dump and in psobb-client-source are often wrong (Vol Opt form 7 is
  Dark Falz; "Sinowbeat" is the Dragon; "GameList" is the title's Connecting
  object). Match by callees, strings and constants, never by name or address.
- Boss work must: feed remote damage into the HP pools on every client, let no state
  hang (test with real motion frame counts), gate the 6x76 / EXP / drop sends as the
  exe does, let the brain own its death, avoid per-frame allocation, and bump the
  brain's `warps` counter on teleports so the smooth renderer snaps.
- `CombatView.enterFloor` has a floor-change race fixed with `enterToken`; keep the
  token checks after every await.
- Disk is tight on this Mac (a few GB free). Agents must not leave Chrome profiles or
  Ghidra projects behind; check `df -h /` before long runs.

## How to run locally

```
(cd vendor/newserv && ./build/newserv)      # game server
(cd bridge && node bridge.mjs)               # WebSocket relay on 8080
(cd client && npx vite)                      # http://127.0.0.1:5173
```

Test account `webtest` / `webtest` (local newserv only). `window.gameView` exposes the
game for Chrome checks (`warpTo(floor)`, `placePlayer`, `selfPose`, `combat`, `field`).

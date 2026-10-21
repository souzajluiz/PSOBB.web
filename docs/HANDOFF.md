# Handoff: where to resume

Written 2026-10-19 at 17:50 (-03), when the work was paused for the day. Everything
below is committed and pushed to `main`; nothing is half-done in the tree.

## State of `main`

- Local `main` == `origin/main`. No open branches, no agents running.
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

1. **Player movement, remaining** (local tick machine and remote follower are in, see DEVLOG 2026-10-20; left: two-client Chrome check; the slowed / guard speed and the animation tie are in the field since 2026-10-21, see DEVLOG "player slow / guard speed and animation tie in the field"). Original text:
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
   group, DEVLOG entries "Episode 2 FSMs: ..."). Left, none checked in Chrome: the Episode 2
   enemy motion archives are not on this Mac, so animation lengths in tests are stand-ins
   for groups a / d (b / c read real counts); no wall / ground rays;
   Epsilon: its ids 0x2d2..0x2d5 are sound effects, not particles (the exe passes them
   to play_directional_sound_effect; wired in 2026-10-21 "Epsilon area mapping and
   particle tables"; the particle tables are not needed). Epsilon is area 0x23 only (0x22
   fixed). Check Seabed / Mines / Tower floors in Chrome.
3. **Captures to close the classic screens item**: character creation and Input
   UserID need captures of the original client in `client/public/ref/` (not committed)
   to measure SSIM. Title 0.77 and select character 0.92 are measured.
4. **Boss leftovers** (2026-10-20 passes done: De Rol Le fin chains + helm / shell debris + the segments as hit
   targets, Vol Opt bars / cage / lid logic, Dragon body and tail hit boxes, Belra's thrown arms, the Saint-Milion
   brain; see their DEVLOG entries). Still open: Saint-Milion's laser aim (the laser's hit, life and sound loop are in, 2026-10-21; no writer of its aim (+0x44) or origin (+0x38) is in the exe on the traced paths, so the sweep 0x8000 and reach 620 stay ASSUMED, and the wall cut and impact particle are not reproduced; see the two DEVLOG entries),
   its cutscene states (they end with their animation), camera / sounds / particles;
   Vol Opt's cage, bars and prison (no model in the exe: particles and spheres, 2026-10-21; the lids and the broken monitors are drawn now); the Dragon's remaining effects (the mouth and feet nodes
   and the fire's sounds 0x321 / 0x31f are in, 2026-10-21; the 0x31x ids are SEs, not particles: the burrow / dive /
   emerge / spiral / rain / walk sounds 0x315, 0x317..0x326 are not wired). The Dragon's particles: the stomp
   dust, the fireball's flight / impact / puff (its table; the trail was misread and is corrected), the land's
   take-off and stomp, the lift, the hover roar and the launch flash are in (2026-10-21, "Dragon particles from
   its data tables" and "Dragon particles: more sites"; the map table particleentrya%d.dat is read now; the
   flame's emitter, the collapse's rings, the death's two, the emerge helper and the flyShoot take-offs are in,
   2026-10-21 "Dragon particles: the unresolved sites"; the dive's impact helper 0x41fa7b, the dive's turn take-off
   0x41ff7a and flyShoot's aim take-off 0x4221b0 are in, 2026-10-21 "Dragon particles: the dive and the take-off
   callers"; the entrance's sub-states 0x86c / 0x874 and its six sites are in, 2026-10-21 "Dragon particles: the
   entrance", with its flame emitter; two of the six, 0x41b69a and 0x41b6a7, sit in variant 3, which the entry never
   selects, so they are ported but do not fire). Not spawned, and not ported: the take-off helper's callers 0x41c5b1 and 0x41cc87,
   which sit in the phase 0 of sids 0x1a (fly move) and 0x19 (teleport). Those sids are reached only by the pad-driven
   pick (phases 2 and 0xb, gated by the quest opcodes pad_dragon / control_dragon, which no stock quest uses; DEVLOG
   2026-10-21 "Dragon: sids 0x19 and 0x1a are pad-only", test section 31). 0x00769de3 is the Saint-Milion part's
   write, not the Dragon's. 0x840 at 0x0041ec4c is a flag, not an id. Dark Falz (2026-10-21 camera pass: `combat/darkfalzcamera.ts`
   maps the seven cutscene objects, their mode 5 pushes, records and scene owners; `bossCameraView` steps the per-frame update (2026-10-21 camera paths: the update 0x004D68A0 is ported; the record, the type flags and the motion index are decoded), and `render/gamefield.ts` gets `opts.bossCamera` from the Control. 2026-10-21 camera file pass: the motion file is NOT missing (`bo04opcam.rel` in data.gsl; `formats/cameramotion.ts` parses it, the GSL name lookup is case-blind now), the view composition 0x004D6BC0 is ported (`composeCameraUp`: up from the roll), and the field camera is driven from it for DEMO_WARP0 only, with its yaw ASSUMED 0. Open: the run-time yaws and pivots of the other scenes (GET RING, DEMO_WARP2, DIE TYPE2/3, APP TYPE2), whether the cutscene's eye / target are this object's +0x3C / +0x48 (ASSUMED), the 0x100 channel as the motion's time (ASSUMED), and who calls the vtable slot 10 each frame. Open too: the cutscene objects' bodies and the Ultimate Rico / ring scene (flag 0x97). Dark Falz Ultimate beam Darvants are in (2026-10-21, DEVLOG "Dark Falz Ultimate beam Darvants"): their hold (the bob, the look / chase, the 260 range), HP and ATP are still ASSUMED / UNCLEAR there.
   De Rol Le (2026-10-21 pass: the segment plates take the hit flash, the beam has its particles 0x126 / 0x177 /
   0x176): still UNCLEAR are the 0x176 point (the port puts it at the beam's end), when the exe makes 0x177 and
   the 0x122 cue; see that DEVLOG entry.
   Nothing of these passes was seen in Chrome (check the Saint-Milion arena: tentacle poses, part boxes on the
   model nodes, the 6xDC flow with two clients; De Rol Le's plates flash cyan and the beam's emitter follows the muzzle).
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

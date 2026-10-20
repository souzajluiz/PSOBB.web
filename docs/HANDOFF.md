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

1. **Player movement, remaining** (local tick machine and remote follower are in, see DEVLOG 2026-10-20; left: two-client Chrome check, slowed / guard animation tie). Original text:
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
     remote players following 6x40 / 6x42 targets the same way, wall slide, the
     animation-speed tie-in.
   Check the feel of 30 / 45 units a second first (it assumes 30 ticks a second); if
   it is wrong the fix is the constants in `playermove.ts`.
2. **Episode 2 enemy FSMs** still open: Gee, Ul / Zol Gibbon, the Mericarol family,
   Gibbles, Gi Gue, Sinow Berill / Spigell, Sinow Zoa / Zele, Deldepth, Delbiter,
   Morfos, Recobox / Recon, Epsilon / Epsigard (Merillia / Meriltas and Dolmolm /
   Dolmdarl are done). Use the Ghidra dump; psobb-client-source has none of them.
3. **Captures to close the classic screens item**: character creation and Input
   UserID need captures of the original client in `client/public/ref/` (not committed)
   to measure SSIM. Title 0.77 and select character 0.92 are measured.
4. **Boss leftovers** (each is listed in the ROADMAP item 2): De Rol Le's chain
   solver 0x0078d9d0 and shell debris; Vol Opt's prison bars / cage; the Dragon's
   hit boxes and models; Dark Falz's cutscene objects, camera and Ultimate scenes;
   Belra's thrown arms, Saint-Milion's 16 spinners.
5. **Phones**: verify on real devices the soft keyboard (iOS / Android), the rotation
   and `screen.orientation.lock`, the adaptive resolution and the batching gain; the
   Forest 1 leaves differ in 1.07% of pixels from the unbatched draw (`?transparent=0`
   restores it).
6. Optional: the quest-loading particle wipes, the lobby / floor loading screens, the
   counter's ship / block change and team menus, a field scene in `classic.html`.

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

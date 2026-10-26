# End-to-end tests (Playwright)

They drive the classic client (`classic.html`) in Chrome against a local
newserv. The page is one canvas, so the tests press keys and read the screens
through the development hooks `classic/main.ts` puts on `window`
(`classicTitle`, `classicSelect`, `classicShip`, `classicLobby`,
`classicGameLoading`, `classicGame`); the shared steps are in `classic.ts`.

Before running:

1. newserv: `cd vendor/newserv && ./build/newserv`
2. the bridge: `cd bridge && node bridge.mjs` (ws://127.0.0.1:8080)
3. the client data under `~/Downloads/psobb-client/data` (served at `/psobb-data/`)

Vite is started by the config when it is not already running. Run with Node 24:

```
cd client && npx playwright test
```

`PW_BASE_URL` points the tests at another dev server, e.g. a worktree's Vite on
its own port: `PW_BASE_URL=http://127.0.0.1:5174 npx playwright test`.

The tests log in with the local test account of `tests/login.live.ts`
(`webtest` / `webtest`; override with `PSO_USER` / `PSO_PASSWORD`). They use the
installed Google Chrome (`channel: 'chrome'`), so no browser download is needed.

- `party-create.spec.ts`: counter -> Organize PARTY -> Create a PARTY ->
  EPISODE 1; checks the Play Mode / Difficulty texts at the exe's indices,
  registers a Normal party, expects the game-entry loading screen, then the
  field (Pioneer 2 loaded, 6F sent, no lobby screen), and leaves through the
  lobby teleporter back to the lobby.
- `party-join.spec.ts`: two browser contexts. A (`webgameb`, override with
  `PSO_USER_A` / `PSO_PASSWORD_A`) creates a party and enters it; B (the test
  account) opens Join a PARTY, picks A's game and enters it; both see two
  players, then both go back to the lobby.
- `two-client-move.spec.ts`: two fresh accounts (`freshUser`, or `PSO_USER_A` / `PSO_USER_B`,
  password = name or `PSO_MOVE_PASSWORD`). Hitch windows of A in the lobby and in Forest 1, alone and
  with B. Then A is slowed (status 0x11): both A's mover and B's copy of A walk and run at half the
  leg speed (run step 0.75). Then A guards near an enemy: B's copy runs at 0.75 of the run and the
  step is 1.125; out of range the plain run comes back. Needs newserv and the bridge; use `--trace off`
  unless debugging. Known flake: a party create can time out waiting for the game join (64).
- `battle-traps.spec.ts`: a Battle party (EPISODE 1, mode Battle, Normal), the Hunter's Guild's
  Battle category (b88001 first). ba_initial_floor moves the player to Temple, whose floor handler
  runs ba_start; then a trap from palette slot 2 (ArrowRight), the 6x83 (type 0, count 5), the
  owner's trap (6x80 what 2) and the HP drop. It needs the account `webbattle` (`PSO_USER` /
  `PSO_PASSWORD`): a copy of webtest's save in `vendor/newserv/system/players/`
  (player_webbattle_0.psochar / .psobank, system_webbattle.psosys) with palette slot 2 set to a
  trap, group 1 = 4 and group 2 = 0x0d, at file offset 0x3f8 (the palette's E7 offset 0x3f0 plus
  the file's 8-byte header).
- `pioneer2-shop.spec.ts`: a fresh account per run (`wsh...`, or `PSO_USER`), made and entered
  through `fresh-field.ts`. Its character is funded offline with 200 meseta before the shop step:
  the page leaves the server, `bridge/admin-chars.mjs` (`applyCharacterPatch`, `writeCharacter`,
  backup under `system/players/_admin-backups`) sets the meseta in `player_<user>_0.psochar`, and
  the account logs in again. The clerk's list is then bought from (the first row the wallet pays,
  one piece; rows dearer than the wallet answer "not enough meseta"), the meseta drops and the bag
  grows (a new kind, or a stack), and the window closes. Each run leaves one account behind.
- `fresh-field.ts`: the shared steps of the fresh-account tests (log in, make slot 0 if empty,
  optional offline funding, reach the lobby, create a PARTY, enter it).
- `drop.spec.ts`: an unequipped item from the bag is dropped on Pioneer 2 with `GameItems.drop`
  (the call behind the item menu's Drop). The game's sends are wrapped on the page: 6x2C (900
  frames, at the player), then 6x2A, then 6x2D, in that order and nothing else. The item is on the
  floor on a search ring (6 * r, r 1..6) from the player, on the ground (+6), with no wall between
  the eye and the spot (`collision.segmentHit`, mask -1); it left the bag; a held W (300 ms) moves
  the player again.
- `ep2-floors-smoke.spec.ts` and `ep2-floors-watch.spec.ts`: a fresh account per run (`wep...`, or `PSO_USER`); the character is made on first login (`logInWithCharacter`). The watch spec reads `EP2_WATCH_FLOORS` (default 1,5,7,10) and `EP2_WATCH_SECONDS`; the smoke spec walks floors 1..17 (floors 16 and 17 have no object set in the data, their two 404s are allowed).
- `challenge-mode.spec.ts`: a fresh account (`wch` prefix, or `PSO_USER`), a Challenge party (EPISODE 1, mode Challenge; Difficulty is not offered) entered as its leader, then the Hunter's Guild clerk (action 1011): the challenge quest dialog opens (A2 list, `counterOpen`). Picking stage 1 and the stage start are not covered yet (see docs/DEVLOG.md 2026-10-26).

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

Quest editor and admin panel (no game server needed):

- `questeditor-real.spec.ts`: the editor on a real newserv quest (vendor `quests/extermination/q101`,
  skipped without it), opened from the file input with its .bin + .dat. An entity is dragged in the
  3D view with the mouse (`scene.screenPointOf` gives the marker's position), undone; a comment is
  applied in the Script tab, and a script that does not assemble is refused with the quest unchanged;
  Test in game says there is no target, then hands the package to a registered handler (name, bin and
  dat sizes). Standalone: Vite on `PW_BASE_URL` (default the checkout's). Run:
  `PW_BASE_URL=http://127.0.0.1:5181 npx playwright test e2e/questeditor-real.spec.ts --trace off`.
- `admin-quests.spec.ts` (`npx playwright test -c playwright.admin.config.ts admin-quests --trace off`):
  its own newserv and panel on random loopback ports, a temporary copy of `system/`. The Quests tab's
  Open in editor on quest 101, Publish to server under a new number in `hidden`, a 409 for the same
  number in another category, Test in game answered by the panel (a toast), and Open in editor again
  for the published quest. The editor is built into the temp folder unless `EDITOR_DIST` names a dist
  built with `vite build --outDir <dir>` (about 40 s; set it to save the build).

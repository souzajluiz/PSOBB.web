# Devlog

## 2026-10-20: Quest editor connected to the admin panel

**What changed:** The Quests tab has "Open in editor" (per quest with BB
files) and "New quest"; the editor has "Publish to server". New
`bridge/admin-quests.mjs` (list / read / validate / write quest files) behind
three admin routes: `GET /quests/files`, `GET /quests/file/<folder>/<name>`,
`POST /quests/publish`. `bridge/server.mjs` now also serves
`/questeditor.html` (the Dockerfile already shipped the build; it also copies
`client/src/formats` now, which the validation imports).

**Why:** the user wants edited quests playable after publishing, without
copying files by hand.

**Decisions:**
- The editor is public (static, no secrets); the quest bytes route and the
  publish route are behind the session. The cookie has `Path=/admin`, which
  the editor's fetches to `/admin/api/...` match, so no postMessage is needed.
- Validation reuses the client parsers through Node type stripping (the
  bridge stays plain `.mjs`): `prsDecompress` got an optional output cap and
  `parseQst` caps sizes (a 5 MB PRS bomb is 422, not memory).
- Names must carry `-bb` (so a GC/DC file cannot be overwritten) and the
  server derives the `.dat` name from the `.bin` name. The category must
  already exist (never created). Backups go outside `system/quests`; a failed
  `reload quests` restores the old files.
- Docker: published quests are mirrored to `/data/newserv/quests-published`
  and copied back by the entrypoint (the image's `system/quests` is not a
  volume), like the config mirror.
- newserv shows the quest number from the file name (`q9001`), not the
  header's (the editor's blank quest has header number 1).

**Verified:** `tests/admin.test.ts` (316 checks incl. traversal, symlinks,
bad names / categories, oversize, PRS bomb, CSRF, no confirm, unauthenticated,
backup, rollback, mirror); `tests/admin.live.ts` (52/52): a real newserv
loaded the quest published through the panel (260 -> 261 quests);
`tests/questeditor.test.ts` (publish request building); tsc clean apart from
the two @capacitor errors. **Not verified:** the editor/panel UI in a browser
(no Chrome check was done), the Docker image build, a player actually
starting the published quest in game.
## 2026-10-20: Admin panel in English, Portuguese and Spanish

**What changed:** `bridge/admin-ui/i18n.js` (new) holds the dictionary and
patterns; `admin.js` imports `tr` / `langSelect` and calls `tr()` only in `h()`
and a few `textContent` sites; a language select is in the top bar and on the
login card; `admin.mjs` serves `/admin/static/i18n.js`. Test:
`tests/admin.i18n.test.ts`. See `docs/ADMIN.md` (Languages).

**Details:**
- Lookup by the exact English string, so the English literals in `admin.js`
  stay and strings added later fall back to English until they get an entry.
- Elements with class `mono` are never translated; that is what keeps the text
  the person must type to confirm (`account <id>`, config key) intact.
- Server error messages are translated in the browser by pattern; the audit log
  is shown as the server wrote it.
## 2026-10-20: Counter: Change SHIP / Change BLOCK and the Team menus

**What changed:** the lobby counter's Transport rows and Team rows now work
(`net/team.ts`, `net/bbsession.ts`, `classic/teammenu.ts`, `classic/counter.ts`,
`classic/lobby.ts`, `classic/main.ts`). Tests: `tests/team.test.ts`,
`tests/teammenu.test.ts` (offline), `tests/shipchange.live.ts`,
`tests/team.live.ts` (against newserv). Nothing of the windows was seen in
Chrome (the Node tests draw them on a stub canvas only).

**Change SHIP / BLOCK (Ephinea `PsoBB.exe`):** `ResetLobbyStateAndReturnToShipSelect`
(0x0079ac9c, row 0) and `ExecuteLobbyJoinPartyAction` (0x0079b208, row 1) close every
counter window, type `[15:6]` ("Select a Ship you'd like to get transported to.")
into the info window, set packet handler 4 to `handle_ship_block_select_packets`,
send `A0` / `A1` (`send_packet0xa0/a1`: 0x20 bytes, body = player tag, guild card,
four zero dwords: the connection's +0x12120 / +0x12124 from the 04 packet) and set
menu id 7 / 8. newserv treats both the same (`on_A0`, "newserv doesn't have
blocks"): `69` for the own id, an empty message box, `B1`, `E7`, then the main
menu `07`. So the same connection and character carry on; `BBSession.changeShip()`
/ `changeBlock()` return the menu and `main.ts` shows the ship select screen again
("Go to lobby" -> `67`). A `19` during the menu phase is followed
(`followRedirect`: connect to its port through the same transport factory, log in
again with phase 4 and the same slot, `session.lobby` is the new Lobby); that path
is not exercised by any test (newserv never sends it there).

**Team menus:** the dump's names for the 0x007979xx..0x007a0bxx functions are
wrong; the state machine was rebuilt from the `g_CurrentLobbyMenuId` numbers, the
`send_packet0xea_subcommand*` builders (0x007f2xxx..0x007f6xxx), the handler table
`pso_protocol_packet_ea_handler` (0x00a0f800) and unitxt group 15 0x57..0x9b. The
full table is in the header of `classic/teammenu.ts`. Data words read from the
exe: `g_TeamMenuListData` 0x009ff50c = (180, 80), width 0x009ff514 = 280, height
180; entries 0xe9 (31, 118), 0xea (572), 0xeb (190, 180), 0xec (260, 120), 0xc8
(96, 333); the 3-row name window is the party creation window's 425 x 188 at
(181, 50) (`g_YesNoMenuData1`, 0x009715d8).

**Left (ROADMAP):** Master Transfer (the exe asks the chosen player with a 6x
message first), Buying Privileges / Team Flag Records windows, inviting a player,
the banned team names, the team chat line, the lobby team flags; the ranking /
master window widths and the 8 visible rows are ASSUMED.
## 2026-10-20: Saint-Milion / Shambertin / Kondrieu: the boss's brain

**What changed:** the Episode 4 boss now fights. `combat/saintmilionboss.ts` (`SaintMilionAi`) is the body's 31-state machine from the table at 0x009f6c60 (read from the exe, `SM_STATES`), `combat/saintmilionents.ts` the 16 tentacle entities (`SpinnerEntity`, `SmField`, `SmClock`), wired in `render/combat.ts` (`tickSaintMilion`, the part / tentacle proxies in the slots body + 1 .. 24, `smChildHit`, the 6x0A receiver, `sub === 0xdc`) and `net/game.ts` (`sendEpisode4BossAction`). `tests/saintmilionboss.test.ts` runs a leader and a follower to the end with the real motion frame counts of `bm_ene_boss09.bml` / `bm_ene_boss09_tentacle.bml`.

**Read from the exe (the dump's names and some address suffixes are wrong: the constructor is 0x0076a8e8, not ..._0076acf0).**
- The class (vtable 0x00b43880) dispatches through 0x00769ecc (vtable +0x164): UpdateState 0x00769f88 before the handler, UpdatePositionAndCollision 0x0076a0b8 after it on phase 0; a state is entered by UpdatePhase 0x0076bbe8 (flags `(+0xf74 & 0xfffff640) | row flags`, kind, animation, hit boxes by row). A state ends on flag 2 (animation end with flag 4, or its handler); the next one is the queued 6xDC state or HandlePhaseCompletion 0x00767d88 and then the row's next.
- 6xDC {action, param} (newserv `G_Episode4BossActions_BB_6xDC`), sent by the leader and run on the sender too: 0 state (queued while +0xf74 & 0x25), 1 time limit (36000 fight frames), 2 a lead tentacle of a spot died (idle frame | spot << 13: every tentacle sinks, state 4 + spot), 3 the next arena (SendStatePacket 0x0076b208), 4 arrived (state 0xc). Receiver table 0x00976928.
- HP: 8 parts (ids body + 1 .. 8) with the stats hp / 4; `g_SaintEmilionStatMultiplier` (0x00a9afe0) counts the ones left to kill. Form 1 revives parts 0 .. 3 every frame (vtable +0x108), so parts 4 .. 7 die; the fourth death raises flag 0x800 of the body, whose death handler (0x00769d7c) swaps in form 2's stats row, empties the counter again and goes to state 0x1a. Form 2 has parts 0 .. 3; its fourth would-be death does not kill (State2 0x800: living parts get MovementData iparam1 hp each frame), state 11 turns that into 0x400, and the next death sends {0, 0x1b}: the ending, the kill 454 frames into state 0x1d (`EnemyOnKilledHandler`: 6x76, drop on the leader with a last attacker, 6xC8), end 0x1e. A part's death while others live sends {0, 0x10} in form 2 (retreat to the next arena).
- Form 2 attack choice (state 15): pause by the phase counter, then the nearest player's distance / angle class picks a row of the weight tables 0x00976980 / 0x009769e0 / 0x00976a40 (`weightedPick`, 0x0077776c) among the states 0x11, 0x15, 0x12, 0x16.
- Tentacles (`saintmilionents.ts`): the 17-action table with its handlers, the animation clock of Player__Animate (end flags 0x10 / 0x20), reversed rows played by hand, z / x steps with the rates 10 / 1.6666666 / 1.6666666 (0x00a9b0e0..e8), the lead's spot placement, the followers going round the players every 30 frames, the flinch every third of the hp (0x0076da04), the death handler that raises State2 `0x80 << spot` and revives with full hp, the strike at frame 26 (an enemy Rabarta of level MovementData iparam1, `enemyFire`), the pop-up cycle, touches by the hit box (try_hit_entity + knockback 3). The animation table lacked row 10 (motion 0 at -1): added.
- State 10 (the swing) sweeps the arc between nodes 4 and 0x17 in the windows 12..32 and 40..56 and bursts at frame 50; the body's 19 hit spheres (0x009f71a0) hurt players while the tentacles are up.

**ASSUMED / not reproduced (all marked in the code):** the cutscene states 0x19 .. 0x1c end when their animation has (the exe waits for a cutscene object); the missiles (state 0x12), lasers (0x13 / 0x14), wave (0x15), storm (0x17), sand sonic and the stomp's effects are events only; contact damage is once per player per 30 frames; the stream of random numbers (SmRng, shared by seed) stands for the per-entity init_rng; the order of the players; the camera, sounds beyond the event ids and every particle. Nothing was seen in Chrome.

## 2026-10-20: De Rol Le: the shell segments are hit targets

The exe's ten DE_ROL_LE_BODY entities (ctor 0x004351c4, vtable 0x00af46e0, ids body + 1 .. body + 10) are now enemies in those slots, like Vol Opt's part proxies. Each has one hit box of radius 50 at its segment (template 0x009a47e4, radius written by 0x00435660), switched off below y -60 (0x00435070); stats row 16 / attack 15 / resist 16; HP 20000 refilled after every hit, so a segment never dies and sends no 6x76, drop or EXP. A hit (0x004354c4, run on every client for every 6x0A) on a whole segment lowers only its own pool (MovementData[15] iparam2) and starts a cyan flash that fades back to white in 20 frames (0x00435334). At 0 the segment breaks (0x004350d4): flag 1, the shell debris, and its plate (body nodes 1 + 2i / 2 + 2i, colour 0) disappears. A hit on a broken segment shows particle 0x127 (15 up, 12 toward the camera) and sends round-half-even(damage x 0.5) to the body pool with SE 0x336 (0x0043416c). It never touches the shell pool, so De Rol Le can die through broken segments alone. The body's shell-broken hits now show particle 0x127 too (0x00433edc). Not reproduced: the plate's hit-flash tint (the body is one skinned mesh) and the hit boxes' high/low flags. ASSUMED: a segment hit does not set the body's last attacker (+0x2d8). `combat/derolle.ts` (DrlSegment, DrlSegmentAi, hitSegment), `render/combat.ts`, `tests/derolle.test.ts` section 21b. Nothing was seen in Chrome.

## 2026-10-20: Episode 2 FSMs: Gibbons, Mericarol family

**What changed:** Ul Gibbon / Zol Gibbon (`TObjEneBm5GibonU`) and Mericarol /
Merikle / Mericus (`TObjEneBm9Mericarol`) have their own brains in
`combat/enemyfsmep2b.ts` (`GibbonAi` + `GibbonGroups`, `MericarolAi`), wired in
`render/combat.ts` (OWN_FSM, confusion-aware search, the `concealed()` radar /
lock-on rule, remote damage, the per-floor Gibbon groups). Neither family is
on the Booma substrate: both are dispatchers on enemy+0x32e like the Caves /
Ruins FSMs. The dump's names for these functions ("Derolle*", "Gibbles*",
"Mericarol*" for the Merillia too) are wrong; every state was matched by its
callees, and the floats come from the executable (`tools/exedata.py`).
psobb-client-source (JP build) has no C for any of them (src/ searched by name).

**Details** (Ephinea `PsoBB.exe`):
- **vtable layout** (SetEnemyAiState_0051f62c calls vtable +0x164 with (state,
  5) then (state, 4)): +0x174 0x0052039c invulnerable (entity 0x4000000 and
  hit box flag 0x2000000), +0x178 clears it, +0x17c / +0x180 hit boxes on /
  off, +0x184 0x00520504 = hide (+0x174 and +0x180, entity flags 0x4040000:
  invulnerable, off the radar and the lock-on), +0x188 0x00520528 = show
  again. Defender vtable +0x50 / +0x5c / +0x68 = should_push_defender /
  try_hit_entity / cause_knockback (0x0052b5f0).
- **Mericarol** (ctor 0x00572cd2, factory 0x00572b84, dispatcher 0x005710b8,
  table 0x009be9a0, record 0x009beaac {225, 0, turn 512}, boxes 0x009be940
  radius 25 / 0x009be96c radius 50; subtype +0x464 0 / 1 / 2 = Mericarol /
  Merikle / Mericus). Set params (0x00572fa8, constants 0x00926ba0..ac):
  param1 + 0.5 the rush chance, max(3 + param2, 1) the rush speed, param3 +
  0.1 the swipe / cloud split; MovementData fparam1 rush power, fparam2
  cloud power, fparam3 / fparam4 the bolt's power / speed, fparam5 the cloud
  radius, fparam6 the cloud's real-or-bluff threshold, iparam3 hunting frames
  before a bolt, iparam4 cloud warning frames, iparam5 swipe hold, iparam6
  the Mericarol bolt's confusion chance. It never walks: hunt (3, 0x00572718)
  turns 512 BAMS a frame, retargets every 20 frames to a player 30 closer,
  loses a target beyond 300, shoots from 50 away (4, 0x00572410: motion
  frame 10, 12 above the target's feet, 150 frames of life, group 0 /
  Gibarta 2 for Merikle / Zonde 3 for Mericus / Megid 5 in Ultimate; a landed
  bolt flags the owner into the recover state 8), swipes (5, 0x00572094:
  frame 8, radius 50, then the pose frozen for iparam5), or sends a Megid
  cloud (9, 0x0057148c: iparam4 warning frames, frame 10, group 5, radius
  fparam5, or a bluff). A flinch in the 20..50 % HP window rolls the rush (6,
  0x00571a60: 10 frames of windup, 200 units at the rush speed hitting each
  player once with entity_hit_by_tech group 0 / fparam1, 0.9 deceleration for
  10 frames), else 5 % the TP drain (7, 0x005717dc: the first live player
  within 100 (0x00a73f20 = 10000, written at 0x00573606) at frame 6, its TP
  set to 0 at frame 25, over at 30; invulnerable). The damage handler
  0x0057358c skips the flinch while flag 0x440 & 0x20 is set (the attack
  states and the charge); 0x00573570 sends a kill to state 0xb. The spawn
  state is hidden (+0x184) for the same 40-frame emergence effect as the
  Merillia's.
- **Gibbons** (ctor 0x00564a64, dispatcher 0x00564ff0, update 0x005687bc,
  table 0x009be3a0, record 0x009be53c {225, 0, turn 1536}, boxes 0x009be2e0
  radius 8 / 0x009be30c radius 12; param6 >= 1 = Zol, the group leader). Set
  params (0x00564e98): param1 the group, param2 < 1 SpotAppear else
  JumpAppear (0x00925ffc), param3 + 0.4 the back-step chance (else the
  charge), param4 + 0.3 the spell chance per 50 units walked, param5 + 0.3
  the spell chance after the back step. Vision 350 (Zol) / 250 (Ul)
  (0x00565eac). Run-time globals written by the static initialiser at
  0x00568f15..: 22500 (aggro, 150), 10000 and 900 (the stalk's 100 and 30).
  States: 0 spawn (reads the leader of its group; a Ul wanders around the
  leader's spawn point), 1 jump in (100 back, 3.5714 a frame), 2 spot in
  (40-frame effect), 3 wait, 5 alert, 6 roar (60 frames), 7 the leader's call
  (alerts the group at frame 60), 8 wander (120 around the home point, speed
  0.3..1, waits 240..360), 9 / 10 run / zigzag (stride bursts of 4.0 / 6.0 at
  motion frame 18, a spell roll every 50 units), 0xb stalk (circles the
  target at 0.7, attacks from behind or within 30), 0xc charge (min(dist,
  40) / 14.667 a frame, bite at motion frame 22 with knockback 7.0, Ultimate
  0.1 slow / paralysis), 0x13 back step (60 in 33 frames, invulnerable until
  the stomp), 0x14 spell (turn 1536 BAMS a frame, frame 15 of the fire motion:
  Ul Foie / Gizonde, Zol Rafoie / Megid, level = the stats row's level), 0xe
  dodge, 0xf enrage (Deband at frame 30, Shifta at 40 on itself), 0x10
  flinch, 0x11 death. A Zol's death gives every Gibbon of its group an
  enrage countdown of trunc(50 * random) + 20 frames (GibblesUpdate). State
  0xd (an arc run) has no caller in the dump and is not ported. Alert, roar,
  call and the spawn states are hidden (+0x184); the damage handler
  0x00568edc sends every hit to state 0x10 and the kill 0x00568ec0 to 0x11.
- **Real motion counts** (measured with `EnemyArchive`): Gibon attack 40,
  back 33, damage 20, dead 30, fire 25, hoe 40, run 30, wait 30, walk 30;
  Mericarol 20 20 31 20 30 30 30 30 (the back step's 33-frame move and the
  stomp at frame 33, the spell at 15 of 25 and the bite at 22 of 40 all fit).
- **ASSUMED:** the bolt's start (12 ahead, 20 up; the exe takes a model
  node) and hit radius (2 + the player's 5, no height test); group 2 / 3 hits
  as a group-0 tech plus a freeze / shock companion with the player-caster
  chances of `enemystatus.ts`; rows 7 / 8 of the Mericarol (loops that the exe
  cuts at the last frame) as one-shots; the swipe hits once; the rush ignores
  walls and the 0x600 flag it ORs into the player; the TP drain reaches only
  the local player (`drainTp`); the Gibbon's table rows 15 / 16 (step 0 in
  the table) run at 1.0; the animation step 1.05 * speed is set once at a
  state's entry (no live speed channel in `AiFrame`); no wall rays or lean
  (+0x480); the Gibbon's spell objects fly like `TechBolt`; the bite and the
  stomp reach (body radius + 5 + 8); the cast's "aligned within 0x100"
  reading of EnemyAI_UpdateRotation_00771858; `buffs` (Shifta / Deband) are
  exposed but nothing applies them to the enemy. Unread: vtable +0x19c /
  +0x1a0 (0x00568b70 / 0x00568bb4, not in the dump), the Mericarol flag
  0x440 & 0x400 (set by a random roll in the ctor, no reader found).

**Checks:** `node tests/enemyfsmep2b.test.ts` (new: constants, every state
with the real motion frame counts, hang fuzz with 1-, real and 90-frame
motions), client `tsc --noEmit` (only the two @capacitor modules).
Not checked in Chrome.
## 2026-10-20: Episode 2 FSMs: Morfos, Recobox, Epsilon

**What changed:** the Seabed Morfos, the Recobox with its Recons and the Tower
Epsilon with its four Epsigards have their own brains in
`combat/enemyfsmep2d.ts`, read from the Ephinea dump, the exe's data
(`tools/exedata.py`) and its disassembly (capstone over the PE, scratch only).
All are dispatchers on enemy+0x32e with the exe's four handler arguments (4
enter, 3 transition check, 0 frame, 5 leave): the check is skipped once after a
state change from outside (vtable +0x160) and runs before the frame. Wired in
`render/combat.ts` (OWN_FSM, the constructors, `spawnRecon`, the Epsilon's
Epsigards in `spawnSplitters`, the Morfos' shield in `applyEnemyHit`, the
children dropped with their parent in `splitterDied`).

**Morfos** (ctor 0x0057a134, vtable 0x00b070c0, dispatcher 0x0057a960, table
0x009bee20, MovementData row 64; newserv's Map.cc documents the set params and
they match InitializeEnemyBounds_0057a208): 0 -> 1 appear (the two effect
objects, 30 and 40 float32 steps of 0.2) -> 3 the wall bulge (0.5 a frame to 12)
-> 4 the walk (aim, turn at iparam1, crawl along the heading by param1 + 0.28
for param2 + 20 per leg, from the second leg the farthest player within 400 in
a +-0xaaa cone; Ultimate never crawls) -> 5 punch (turn at iparam2, arm at
elapsed 8.0, try_hit_entity(1.0) + knockback 5.0, 50 frames) or 6 laser (back to
the target, bolt at 6.0, twice) or 9 spin laser (flee: iparam4 frames at iparam5,
then 3000 a frame until its back faces the player or a full turn, 4 shots, 5 on
Very Hard / Ultimate, armoured); 7 after 61 frames without a target fades out to
2 (hidden at its spawn point, a warp). Hits: 0x0057c6d0 flinches only from
behind (|angle| >= 0x4000) unless armoured, a front hit rolls the shield
(0x0057acb8, rand <= param3 + 0.1 at half HP) and the flee (0x0057ac74, param4
+ 0.1); 0x00579f98 blocks front hits while shielded (`guard`) and drops the
shield on a hit from behind; the flinch end skips the shield roll after that.
The bolt (0x0057d0f4 / 0x0057ce94) flies at fparam1 for 500 with radius
1.5 * speed and group 0 power fparam2.

**Recobox / Recon** (box ctor 0x0058859c, vtable 0x00b07e80, dispatcher
0x00589a2c; Recon ctor 0x0058a2a0, vtable 0x00b08100, dispatcher 0x0058aa78,
jump table 0x0092889c; set params from newserv: param1 hover delta, param2
orbit radius delta, param4 alive at once, param6 floor / ceiling / wall,
clone_count - 1 Recons at most): the box fades in (40 steps), opens (row 1)
when a player is within 500 and at most half its Recons are alive, drops one
Recon every 30 frames while alive < limit and spawned < total (each child index
once), closes when a Recon is in its state 5 or no more can come. The Recon
launches with the box's vector (floor +5, ceiling -5, wall 2 along the heading;
displacement v * |v|^2, 0.95 drag, vertical easing that lands exactly on the
hover height 2 * rand + 45 + param1), looks around (150 frames, then fades
away), orbits its target at 5 * rand + 50 + param2 (angular step 65536 * v / (2
pi r), v = 25 / 27 written by 0x0058c230, bobbing 10 at 0x380 a frame), shoots a
bouncing bomb (turn 0x400, 16 frames, elapsed 10.0; bomb ctor 0x0058c740,
update 0x0058c878: gravity -0.1, drag 0.95, bounce -0.5, armed after the second
contact, blast radius fparam2 with power fparam3, life iparam1 * 30) or slashes
with the saw (chase fparam1, wind-up iparam2, elapsed 7.0 .. 31.0 radius
AttackData.distance_y, power atp, knockback 7.0). At most 2 Recons (4 on
Ultimate) attack one player (0x00589acc); a Recon with no room looks for another
player. The Recons die with their box.

**Epsilon / Epsigard** (Epsilon ctor 0x005585ac, vtable 0x00b04cc0, dispatcher
0x0055a95c, jump table 0x009252ac; Epsigard 0x0055be9c / 0x0055c1c0, vtable
0x00b04f20, dispatcher 0x0055b798; MovementData rows 35 / 36): dormant -> appear
-> stalk (turn param2 + 512, walk param1 + 0.5 within 22.5 degrees, a laser orb
that creeps at fparam2 for iparam1 frames then blasts radius 40 for fparam3) ->
after (param3 + 20) * 30 frames it places the Epsigards (the slots hold its spawn
point), opens, releases them to orbit at radius fparam1 and is vulnerable (it
is invulnerable while bit 2 or 0x40 is set: hits do nothing) -> every iparam3
frames a random row of the 20-row table at 0x00925160 sets those Epsigards
attacking (a shield that grows 10, holds iparam1, shrinks 10 frames, touch
damage fparam4) -> after (param4 + 20) * 30 frames with all four idle it recalls
them, closes and recolours (the element advances: foie, barta, zonde, megid
groups 1, 2, 3, 5) -> stalk again. A hit while open runs the 17-frame flash (state
8). The Epsigards take no damage from weapons or techniques (0x0055be2c /
0x0055be44: only group 20 passes) and follow their Epsilon's death.

**ASSUMED / not reproduced:**
- The map rays everywhere (line of sight, walls, the crawl's wall stop), ground
  heights (the Recon's hover height is used as a lift above the floor; the
  exe uses it as an absolute y; a ceiling box starts 40 above the hover height,
  a wall box at it), the Recon's muzzle (12 in front), the Morfos' muzzle (its
  own position), the Epsigards' collision flag (nothing touches them) and
  their touch radius (36; the exe scales a box with the shield animation).
- `check_entity_animation_elapsed_threshold` (0x007aaa30) is a crossing event
  (threshold < elapsed <= threshold + step); the brain also accepts the end of
  the motion in its place so a short motion cannot hang a state.
- The Epsilon's state 7 has no exit for a player who comes back (sub 2): here
  it returns to state 2. The Epsilon's element weight (0x00925404) is not read
  (uniform). The Morfos is invulnerable while hidden (state 2).
- The motion lengths of bm_ene_morfos / recobox / epsilon are not on this Mac
  (the Ephinea install here has no Episode 2 enemy archives): the tests
  sweep the motion lengths 1 .. 120 instead of using the real counts.
- Techniques / weapon specials of the Epsilon's current element are blocked in
  `EpsilonAi.immuneToTech`, but the owner does not call it; the closed / open
  model swap (model 0 / 1) and the Epsilon's colour fade are not drawn; no
  Chrome check.

**Checks:** `node tests/enemyfsmep2d.test.ts` (new), client `tsc --noEmit`
(only the two missing @capacitor modules). The tests that need
`vendor/newserv` or the item tables fail in a bare worktree as before.

## 2026-10-19: stricter TypeScript

**What changed:** `client/tsconfig.json` now also has `noImplicitReturns`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
`noUnusedParameters`, `exactOptionalPropertyTypes` and `incremental` (build info in
`node_modules/.cache/tsc`, ignored). Errors fixed: 71 (17 `override`, 7 fallthroughs,
~35 unused, 22 `exactOptionalPropertyTypes`, 1 implicit return in `vite.config.ts`),
now 0. Fallthroughs: the four in `classic/chat.ts` repeat the two-line tail of the next
case; the three in `combat/volopt2.ts` became an `if (this.sub === n)` before the
switch (same order of operations, same frame). Dead write-only fields in `combat/`
removed; no value or expression in exe-derived code changed. Optional properties that
carry `undefined` are typed `| undefined`. 21 state/kind switches got
`default: exhaustive(x)` (`src/exhaustive.ts`, no-op at run time) so a new state fails
to compile. `ClientFiles` and `requireDataSource` lost their `!`; `installStageFit`
returns a `dispose()` that removes its window listeners.
**Measured** (`tsc --noEmit --extendedDiagnostics`): before 640 files, 67795 types,
49049 instantiations, 416 MB, 2.82 s; after 641 files, 67947 types, 49178
instantiations, 414 MB, 2.76 s; warm incremental 1.1 s, 275 MB.
**Left alone:** `noUncheckedIndexedAccess` (1738 errors); about 110 `!` that are
`getContext('2d')!`, `Map.get(i)!` and state invariants (a guard would change flow);
`await` in loops (first-match fallbacks, intentionally sequential); branded ids (no
clear mix-up); the numeric command switches in `net/` (not unions); `exhaustive` in
switches of functions that return a value.
**Tests:** 64 of 64 `tests/*.test.ts` pass before and after.
## 2026-10-20: Chrome smoke check of the boss floors after the leftovers pass

Local newserv, Episode 1 Normal, `gameView.warpTo`: Dragon (floor 11, `DragonAi`), De Rol Le (12, `DeRolLeAi`), Vol Opt (13, `VoloptAi` + `VoloptForm2Ai` + parts) all load, run their brains and render (Vol Opt's body seen), no page errors. Not checked: the new drawing (fin chains, debris, Belra's arms, Dragon tail boxes in a fight), Episode 2 floors (their enemy archives are not on this Mac) and the Dark Falz floor.

## 2026-10-20: fix: the player froze against a wall (movement tick machine)

**Bug (reported):** walking forward in the lobby, the player stopped and could not move on. `PlayerMover` only reads input at the end of a leg, and a leg ends when the player is within 2 steps of its point 8.0 ahead; against a wall (or the counter) the collision stopped the move short of that point, so the leg never ended: the state stayed walk / run, releasing the key did nothing and a new direction was ignored.
**Fix:** a move that covers less than a quarter of the step ends the leg (`PlayerMover.tick`, ASSUMED: the exe's wall-touch handler was not traced). `tests/playermove.test.ts` has the wall cases. Chrome: ran into the lobby counter (z 97, still `run`), released: `stand`.
`window.psoLobbyView` is a console aid like `gameView`.

## 2026-10-20: starting a quest from the lobby (Online tab)

**What changed:** the Quests box was only shown inside a game, so nothing could be started from the lobby, and a quest picked there would arrive as an A6/A7 download that was ignored. newserv answers A2 in a lobby with "Quests are not available in lobbies" (`on_A2`, `ReceiveCommands.cc`), so a quest needs a game. The box now shows in the lobby with an episode and a difficulty select and "Start quest (new game)": it creates a game (`Game.create`), enters it and opens the quest menu (A2); the category / quest picks and the 44/13 files then run as in any game (`ui/onlineTab.ts`, `buildQuestPanel`).
**Chrome:** lobby, Start quest (Episode 1, Normal): game created, categories Retrieval / Extermination / Events / Virtual Reality, "Lost HEAT SWORD" loaded and started (floor 0 handler, Ragol warp enabled), no console errors.
**Not done:** the classic page (`classic.html`) cannot play a game yet (no field scene), so no quest start there.

## 2026-10-20: player movement tick machine drives the local player

**What changed:** `PlayerMover` (`render/playermove.ts`) ports the exe's stand / walk / run poll, leg (8.0 ahead), arrival check (dist^2 < (2 x speed)^2), heading smoothing and velocity direction, one step per game tick. `render/lobbyview.ts` drives the local player from it (fixed 30 Hz accumulator, keyboard axes ramped 32 a poll to 128, touch stick axes as they are, map collision per tick) and draws the pose interpolated between ticks. Keyboard sideways-only input turns in place (0x800 a tick) before walking. Tests: `tests/playermove.test.ts` (walk 1.0, run 1.5 after 6 ticks, leg-end stop, turn in place). `tsc` clean.
**Chrome (2026-10-20):** local lobby, held W on the canvas: the player runs forward, stops and returns to idle on release. Not measured: the exact feel of 30 / 45 units a second. newserv closed the connection by idle timeout after about 70 s without input (not from the movement code).
**Remote players:** `followTick` (`render/playermove.ts`) runs the same heading / velocity update toward the 6x40 / 6x42 point at 1.0 / 1.5 a tick; `render/lobbyview.ts` steps it at 30 Hz per marker and draws between ticks (a target over 150 units away is a warp and snaps). Unit-tested; not seen with two clients in Chrome (only the local run, no console errors).
**Animation speed:** already tied to the gait by `LOCOMOTION_FACTOR` (run 1.5); the exe's tie to the slowed / guard speed is not traced.
**Loop-back of 6x40 / 6x42:** not needed here, `PlayerMover` re-enters its leg directly; no packet is looped.
**Still open:** a two-client Chrome check of the remote follower, wall slide for remote players.

## 2026-10-19: player movement values read from PsoBB.exe (partial)

**What changed:** the local player's speeds now come from the exe: walk 1.0 and run
1.5 units per game tick (30 / 45 units a second), was 80 / 120 (an approximation).
`render/playermove.ts` holds the values and pure helpers (speed rules, keyboard ramp,
heading smoothing), `tests/playermove.test.ts` checks them. The full state machine
port is NOT done yet; findings below.

**Exe facts (all PsoBB.exe; JP C has no player movement code):**
- Speeds: walk `0x00a94300` = 1.0 (init `0x0069864c`), run `0x00a94324` = 1.5 (init
  `0x0069b6f4`), leg length `0x00a94320` = 8.0 (the old note "8 units/tick" was the
  leg length). `position += velocity` once per tick (`0x00777724`), no dt factor.
  `0x006978a0`: slowed x0.5 (`0x0093ca20`), flag 8 of `+0x6c4` (guard stance) x0.75
  (`0x0093ca24`), then x `+0x690` if `+0x68c` bit 0.
- Structure (local player, every tick, `0x00689174`): poll (case 2) -> arrival check
  (case 3) -> update (case 1, `unknown_update_player`). States: stand 1, walk 2 (6x40,
  `0x0069bbd0` poll), run 4 (6x42, `0x006a15a0` poll). The poll only acts when
  `+0x6c4` bit 4 (arrived) is set; a leg targets a point 8.0 ahead (`0x0069bb6c`),
  the packet is looped back locally (`0x008003e0`) which re-enters the state and
  clears the flag. Arrival: dist^2 < (2 x speed)^2 before the move (`0x006a1790`).
  So direction changes only apply at leg ends and a released key keeps walking to the
  end of the leg (walk about 8 ticks, run about 5), no slide beyond that.
- Update tick: angle to the target; heading += diff/4 (diff/2 when over 0x3000,
  `0x007a8cd0`); velocity direction = heading + (target - heading)/2 (`0x007a8c9c`).
- Stand poll (`0x0069b728`): stick above 0.1 starts walking at once; keyboard: sideways
  |lr|/128 >= 0.1 turns in place by 0x800 per tick until aligned, forward/back >= 0.1
  starts at once. Walk poll counts ticks above 0.75 (sum of squares / 16384) and runs at
  6 (`0x0093da74`); the counter resets at `0x69bbb2` (walk arrival stop) and in the run
  poll below 0.75.
- Keyboard (`0x0070a60c`): an axis ramps 32 per poll to 128 (64 when auto-walk, `0x0096ed84`),
  released = 0; forward is negative, angle = atan2(lr, fb) + camera angle (`+0x94`).
  `modify_direction` (`0x0068c038`) only randomises the direction when confused.
- ASSUMED: 30 ticks/s (as elsewhere), the loopback of own 6x40/6x42 is accepted.

**Left to do:** port the three polls + leg/heading update as a tick function in
`render/playermove.ts` (the helpers are ready), drive the local player from it with
`TickSmoother`, make remote players follow 6x40/6x42 targets the same way (they run
the same update toward the packet target at 1.5 / 1.0 per tick), wall slide check.

## 2026-10-19: render cost: static batching, texture pools, adaptive resolution, leaks

**What changed:** a phone is limited by draw-call submission and by pixels, not by
triangles (1074 of the 1158 meshes of a Forest 1 frame have under 200 vertices, and
every material group is its own draw call). Four changes, all in `client/src/render/`:
(1) **Static batching** (`batching.ts`): opaque and blended material groups of meshes
that never change after placement are baked into world space and merged per
(material, render order, attribute set, spatial cell of 1500 units) into a few
geometries; the map (`MapViewer.show`) and the field objects that nothing drives
(`ObjectLayer.batchStatic`, called by `gamefield.ts` after the traps) go through it.
Doors, switches, warps, traps, triggers, motions, `.tam` scrolls and texture swaps,
skinned meshes and anything hidden or state driven stay as they were; hideable
objects (boxes, delayed objects) are merged per object under their own root so
`setVisible` still works. Objects that never move have their matrix updates frozen.
(2) **Texture pools** (`texturepool.ts`): the map's textures become layers of array
textures (one per size / wrap / filter) and the merged meshes pick the layer per
vertex, so one draw call covers every texture of a size. Same samples as before (the
layer is constant over a triangle). (3) **Ground index** (`groundindex.ts`):
`groundHeight` no longer ray casts the now large merged meshes, it reads a triangle
grid (animated entries are still ray cast). (4) **Adaptive resolution**
(`resolution.ts`): desktop keeps `min(devicePixelRatio, 2)`; a small touch screen
starts at 1.5 and steps between 1 and 1.5 by the measured frame time (drop under ~42
fps after 45 frames, raise after 240 fast frames, 3 s cooldown). Per-frame allocations
in `lobbyview.ts` / `gamefield.ts` were replaced by scratch objects.

**Leaks found and fixed:** a stale `show()` in `enemyview.ts` / `objectview.ts` (a
newer call or `clear()` took over while models were being built) dropped the models
without disposing them (`dispose.ts`: `disposeTree`, shared by the three places that
repeated it); `texanim.ts` never disposed the material copies and texture clones its
`attach()` made; the wrapped (clamp / mirror) texture clones of `njcmmesh.ts` and
`flooritems.ts` now go with their material; the map viewer disposes its texture pool.

**Before / after** (`tools/perfprobe.mjs`, headless Chrome 155 on SwiftShader, 120
frames after warm-up, 1280x720, dpr 1, one run each, sequential; before = pristine
origin/main, after = this branch; render ms are CPU submission ms of
`renderer.render()`):

| scene | draw calls | textures | render ms | updateMatrixWorld ms |
|---|---|---|---|---|
| Pioneer 2 | 903 -> 421 | 362 -> 87 | 3.52 -> 3.40 | 0.029 -> 0.014 |
| Forest 1 | 1415 -> 510 | 74 -> 27 | 7.61 -> 3.46 | 0.093 -> 0.037 |
| Caves 1 | 1037 -> 287 | 64 -> 24 | 2.73 -> 1.17 | 0.048 -> 0.018 |
| Ruins 1 | 2014 -> 324 | 200 -> 38 | 4.42 -> 1.52 | 0.070 -> 0.024 |
| Forest 1 + objects (109) | 4059 -> 1175 | 125 -> 49 | 12.61 -> 7.37 | 0.195 -> 0.139 |

Triangles are unchanged in every row. Pixel difference of the same camera at animation
frame 0 (`tools/imgdiff.mjs`, mean absolute channel difference of 255 / share of pixels
off by more than 8 / maximum): Pioneer 2 0.0007 / 0.004% / 50; Forest 1 0.1532 /
1.069% / 87; Caves 1 0.0010 / 0.008% / 33; Ruins 1 0 / 0% / 0.

**Blended batching caveat:** three sorts blended meshes back to front by their centre;
a merged blended batch is drawn in placement order at the depth of its own centre, so
overlapping translucent pieces of one texture can blend in another order. That is the
whole Forest 1 difference above, small but not pixel-identical.
`?transparent=0` leaves blended groups unmerged and brings the image back to the
reference (at the cost of their draw calls).

**URL switches** (for comparing, all in `MapViewer` / `resolution.ts`): `?batch=off`
(plain scene graph), `?batch=nopool` (merge but no array textures), `?cell=N` (cell
size), `?transparent=0`, `?dpr=1.25` (the pixel ratio itself, adaptation off),
`?quality=low` (1) / `high` (desktop rule) / `auto` (default). Tests:
`tests/batching.test.ts`, `tests/resolution.test.ts`.

**Measurement limits:** SwiftShader is a CPU rasteriser, so these are submission and
scene-graph costs, not GPU time and not a phone: the effect of fewer draw calls and
fewer texture binds on a real mobile GPU, and of the pixel ratio (which the headless
runs hold at 1), is not measured here. One run per side; the render times of Pioneer 2 are within noise, its gain is
in draw calls and textures. The "before" row of Forest + objects runs on the old tree,
where `batchStatic` does not exist. The field objects are measured through the map
viewer (`--objects`), not a live game: monsters, players, effects and the HUD are not
in the numbers. Memory on a device was not measured (`--churn` prints the geometry / texture count trend across reloads).

## 2026-10-19: caching headers on the production relay

**What changed:** the published site (checked at its sslip.io address) answered
every static file with no cache headers, so each visit downloaded the 68 MB
`data.gsl` (about 25 s) and the 8 MB `common.pac` again, with a black screen
until the title appeared. `bridge/server.mjs` now sends `Content-Length`,
`ETag` and `Last-Modified` and answers `If-None-Match` with 304. `Cache-Control`:
`immutable` for the hashed `/assets/`, `no-cache` (revalidate) for the pages,
one day for the game data and the newserv files. Checked on a local relay: 200
with the headers, 304 on a repeat, the body intact. The loader for the wait on
a first visit is a separate task.
## 2026-10-19: classic page on phones: loader, on-screen keyboard, fit and rotation

**What changed:** three problems of the production page (`classic.html`), all
browser side, no change to the game's virtual coordinates or exe layout.
(1) **Loader.** Nothing showed while `data.gsl` (about 70 MB) downloaded. `#boot`
is now plain HTML / CSS visible from the first paint: PSOBB logo in the title's
dark blue / cyan, a status line pulsing like the exe's "Connecting..", a bar and
"x MB of y MB". `classic/loadprogress.ts` (pure, weighted steps: source, archive,
title, text, open; the bar never goes back) is fed by `HttpSource.onProgress`
(streamed read) and `main.ts`; `classic/loader.ts` draws it and fades out two frames
after the title is drawn. A failure shows the message and a Retry button (reload);
a missing data folder on a browser without a folder picker says so instead of
offering a button that cannot work; the picker button keeps its user gesture.
(2) **Typing on a phone.** The canvas editors (Input UserID rows, character name,
game / party name and password, lobby chat) take key events, so no keyboard
opened. Screens now expose `textInput()`; `ui/softkeyboard.ts` focuses a hidden
`<input>` (16 px, opacity 0, type=password for the password row, autocorrect and
friends off) from the tap / key that starts the editor (`sync()` after
pointerup, click, keydown) and blurs it when the editor ends. Text comes from
`input` events diffed by `input/textproxy.ts` (Backspace for removed chars, keys for
new ones), so IME composition, autocorrect and Android's keydown `Unidentified`
work; Enter / Escape come from keydown or `beforeinput` (insertLineBreak). A key
button appears if the OS closes the keyboard. Desktop never focuses the field.
The title is tappable: Login menu rows (already), Input UserID rows and the exit
question's Yes / No (`tapRow`, `tapYesNo`); the touch pad is hidden on the title
(`Screen.touchPad = false`) because it covered the login windows. The old KEYS
proxy of the web controls moved into the soft keyboard.
(3) **Scale and rotation.** Root cause of the oversized UI: the canvas was
`100vw x 100vh` and the 640x480 stage is stretched over the whole canvas, so a
phone got a 390x844 or 2.16:1 stretch (and `100vh` is the tall viewport that
hides the bottom behind the URL bar). On touch screens (`pointer: coarse`,
`?fit=1/0` overrides) `classic/viewport.ts` now fits the stage and `#world`
in the visual viewport minus safe-area insets: 4:3 fitted to the width in
portrait, 4:3 to 16:9 in landscape, black bars, nothing cropped (`ui/stagefit.ts`,
pure). Desktop keeps the full-window stretch. One place re-measures on resize,
orientationchange, `screen.orientation`, `matchMedia(orientation)` and visual
viewport changes, now and on two frames and after 200 ms (iOS reports the old
size first); while the soft keyboard is up the orientation is kept unless the
width changed. It moves both canvases, the web controls (`psobb:fit`), the key
button and hidden fields, and the rotate hint. The pad layout switches: landscape
as before; portrait with room under the stage puts the stick, arrows and OK /
BACK under it (`padLayout(..., below)`), palette taps stay over the HUD icons.
Portrait shows a dismissable "Rotate your phone for the best view"; after the
fullscreen button, Android Chrome gets `screen.orientation.lock('landscape')`
(try / catch, unlocked on exit; iOS has none). Viewport meta: no user zoom.
**Verified:** `tests/mobileinput.test.ts` (new), `mobilecontrols`, `titlescreen`,
`windowanim`, `gamelist`, `tsc --noEmit`; headless Chrome (390x844 and 844x390,
dpr 3, touch, rotation): loader progress at 2.2 MB of 68.5 MB then fade, stage /
overlay / pad rects match both sizes, a tap on Register UserID then the UserID
row focuses the hidden field and typed text, Backspace and Enter reach the
editor, rotation with an editor open. **Not verified:** real iOS and Android
keyboards, `orientation.lock`, the visual viewport behaviour under a real iOS
keyboard.

## 2026-10-19: PSOBB_DATA_URL: data root by data.gsl, no EXDEV

**What changed:** two problems of the first real deploy of `fetch-data.mjs`.
(1) "none of these client files exist: f256_hyouji.prs": that texture lives
inside `data.gsl`, and the unpacked folder had no `data.gsl` at its root (the zip
held the whole client folder, so the files sat in `psobb-client/data/`).
`findDataRoot` now looks for the folder with `data.gsl` (up to 4 levels, any
case) and makes it the root, so a zip of `data/` or of the whole client folder
both work; the exes next to it are dropped, and a missing `data.gsl` is logged
as a warning. The marker carries a layout version (`layout2`), so a folder
made by the older version is fetched again on the next start.
(2) `EXDEV: cross-device link not permitted`: the working folder was a sibling
(`/data/psobb-client.partial`) of the mounted volume `/data/psobb-client`, and a
rename between the container filesystem and the volume fails. It now works in
`<target>/.partial`, on the same volume (so the volume needs room for the
archive and the unpacked files at once, about 2.5 GB for a 958 MB zip).
`tests/fetchdata.test.ts` covers the whole-client zip and the leftover
`.partial`.

## 2026-10-19: newserv from its official image, no compile

**What changed:** compiling newserv in the image build was too heavy: a
small server cancelled it, and two runs on a GitHub runner failed (a lost
runner at 51 minutes, then GCC's `-Werror=maybe-uninitialized` in phosg at
`-O1`). fuzziqersoftware publishes `ghcr.io/fuzziqersoftware/newserv`, public,
with amd64 and arm64 builds and one `sha-<commit>` tag per commit, including
`sha-ce2273a`, the commit this project pins. The Dockerfile now takes the
binary (`/usr/local/bin/newserv`) and `/newserv/system` from that image (checked
in its layers: `config.example.json`, `blueburst/keys`, `text-sets/bb-v4` and
`maps/bb-v4` are there and the config patterns the sed rewrites still match)
and writes `config.json` in the runtime stage. The compile stages, `BUILD_JOBS`
and the `newserv image` workflow are gone. Not built locally (no Docker here).

## 2026-10-19: newserv image workflow: smaller runner than assumed

**What changed:** the first run of `newserv image` died after 51 minutes with
"The hosted runner lost communication with the server" (CPU / memory
starvation). The workflow assumed the 4-core / 16 GB runner, but a private
repository's `ubuntu-latest` has 2 cores and 7 GB. It now adds 8 GB of swap,
builds with `BUILD_JOBS=2` and has a 180-minute timeout. A try at `-O1` to compile faster failed at once: GCC reports `'float_data' may be used uninitialized [-Werror=maybe-uninitialized]` in phosg's `JSON.cc` and the projects build with `-Werror`, so the Release `-O3` flags stay; DEPLOY.md says the
first run takes an hour or more. Not re-run yet: pushing is on hold.
## 2026-10-19: the Dragon's fight and Sinow Beat's mirage

**What changed:** the Dragon (Episode 1 Caves, area 0x0B) fights back, and the Sinow Beat gets the mirage clones the roadmap listed as missing. `combat/dragon.ts` is the Dragon's brain (`DragonAi`, one entity, no children: it owns its flames, fireballs and area hits as `EnemyShot`s); `render/combat.ts` wires it like De Rol Le (own FSM, built in `enterFloor`, the leader's `6x12` out and in, remote damage into the hp, the kill sends at the exe's gates, `tickDragon` / `dragonEvent` / `onDragonAction`), and `net/game.ts` has `sendDragonAction`. The model is drawn at scale 2.0 now (render `0x004245b0`, `push 0x40000000` x3). `SinowAi` (`combat/enemyfsmmines.ts`) gets the mirage: states cast (0xe), approach (8) and park (0xf), the clones as child enemies (`sinowEvent` / `activateClone` / `spawnSinowClone` in `render/combat.ts`), the evp halving, and its dismissals.

**What the dump and the JP tree say about the names:** everything the dump calls "Sinowbeat*" between `0x00419214` and `0x004258AC` (`HandleEnemySinowbeatInputState_00419b14`, `SinowbeatHandleBreatheFire`, `ProcessEnemySinowbeatTeleport`, `SinowbeatTeleportDataConstructor`, `CreateSinowbeatMesh`, `InitializeSinowbeatPosition`, `SetSinowbeatParticleState`, `SinowbeatSetTeleportPosition` ...) is the Dragon (headers/bosses.h says so: FidDB false positives), and the JP files named in the brief are stubs of it: `FUN_00419ffc` copies `+0x38/+0x40` to `+0x698/+0x69c` (the 6x12's x / z out), `FUN_00419fe8` the reverse from `+0x6a0/+0x6a4` (x / z in), `FUN_00425b49/3c/58` set the sequence cursor `+0x684` to 0x32 / 0 (`DragonSetWeaponId`), `FUN_00427cc0` flags the ground follower, `FUN_004287ac` / `FUN_004266d8` store two floats, `FUN_00449844` is an unrelated scene copy; `FUN_005342b8` is a 1-byte stub. `tools/refsrc.sh` and the names of `headers/bosses.h` are right about the dispatcher but wrong about the state names ("tatk" is not a slam: state 9 is a fall-and-lie, slot 7 is the tail). The real Sinow Beat is `TObjEneMe3ShinowaReal` (create `0x0058d320`, dispatcher `0x0058d93c`), and its "Sinowberill*Ally*" functions (`0x0058f6e4..0x00590474`) are the mirage.

**Dragon, from PsoBB.exe** (addresses in the file header of `combat/dragon.ts`):
- The dispatcher is `dispatch(state, phase)`: 4 enter, 5 leave, 0 the frame, 6 right before the leader sends (the new state's phase 6 fills the packet's x / z), 7 right after one arrived, 8 a leader check before the frame, 9 "pick the next state" (2 / 0xb are the same pick driven by a pad: the debug "dragon control", not reproduced, like the pad-only states 1, 14, 23..28, 30, 31, 36, 37). `OlgaUpdateMainLoop` (`0x00423B7C`): the leader (`+0x3E8 == 0`, recomputed each frame from the party leader) runs the hit clamp, `UpdateDragonAiState`, phase 8, phase 0; a follower the clamp and phase 0.
- Entry: state 0x1d (the entrance: bossop, 170 frames at 0.5; hit boxes off), then state 0 which picks the first action. Sequences (`0x009A3CB0` / `0x009A3CF0` normal A / B, `0x009A3D28` / `0x009A3D78` Ultimate; 0x20 = back to the start, 0x21 = to 0x32; the cursor is stored plus one after the read): A = walk 2, fire 3, tail 4, fly up 5, fly across 6, fireballs 7, land 8 (Ultimate: 2 3 2 3 4 5 6 rain 0x22, 8); B = 5, 6, dive 15, burrow 16, burrow-out 18, burrow 17, 18, 17, 18, emerge 19, 8, 2, 3 (Ultimate: the third burrow is the spiral 0x23).
- hp: the entity's own (stats row 18, no pools). `+0x688` is the clamp: hp never goes under it while the cursor is below 0x32 (it starts at 90 %: the ctor's `max - max/10`, minus 20 % while hp <= it), and when hp reaches it the leader roars (`control_dragon_low_hp_roar` `0x0042093C`: hp = clamp, cursor = 0x32, state 0xd on the ground or 0xb in the air, which lands first); leaving the roar recomputes the clamp (state 0xd phase 5). So the first sequence lasts from 100 % to 90 % and the second one is the rest of the fight, with no clamp; the boss dies only with the cursor at 0x32+, hp < 1 and flag 0x800 clear (the air states set it): state 0x15 on the ground, 0xc (lands, then 0x15) in the air. State 0x15's phase 5 is `EnemyOnKilledHandler_0051F894` + `set_quest_flag(0x17)`; the brain emits `killed` there and the owner runs the 6x76 / drop / 6xC8 gates (`bossKilled`, as for De Rol Le), then the body lies in state 0x16.
- Motion slots (`0x009A3AE0`, slot 19's speed 0 is written to 0.5 by the globals init `0x0042510C`, which also sets the gravities -0.3 / -0.5 / -0.7 / -0.2, the arena radius 350 and the other bss floats). Real frame counts (bm_boss1_dragon.bml): bossop 170, walk 40, nobi 80, fire 27, frin 14, frloop 26, frout 14, tatk 26, lift 80, fly 44, land 80, flyshot 80, tobidasi 50, dead 130, tukomi 44.
- States: walk (stomping steps in frame windows 0-4 / 9-19 / 19-24 / 30+ at 0.8, Ultimate MovementData fparam5; the feet strike at frames 3 and 24; ends 150 ticks in once the target is reached, 300 without; the leader re-sends the target's position every 20th tick); fire (turn 0xA0 a frame, 120 ticks of a flame every 2nd tick at 5 a frame, hits below 30 up, tech power fparam1); tail (animation 7, strikes from the start and at frame 23); fly up (at frame 40 of the lift a ballistic jump peaking at altitude 180: v = sqrt(2 * 0.3 * 180)); fly across (a 60-tick turn then a trapezoid profile to the point 100 across the arena, the centre in the second sequence); fireballs (aims at the healthiest player or the best pair within 100 or a random point 125 out, a 60-tick eased turn, three fireballs at frame 47 at the point and 22.5 degrees to either side, twice); land (from frame 18 falls under -0.2, the stomp 4 ticks after touching down with radius MovementData fparam4); dive (13 up under -0.5 then -0.7 down, horizontal speeds so the arc covers the rim point's distance, the head below the floor -> the crater, down to -400); burrows (60 ticks hidden, up at the 6x12's rim point facing the centre at 0.1 acceleration to 4 * count + 4, the trail hits once per player with tech power fparam3; 0x12 turns 0x600 a frame toward the player's side and runs until 350 out); emerge (100 ticks hidden, a leap from -170 with v 15 and gravity -0.4018 over the arena to the centre, settling at 180); death (frames 57 / 88 / 97 bursts of AttackData row 4, 50 ticks of lying); Ultimate rain (rises to 343, 40 rounds of a fireball every 4 ticks at a player's slot or anywhere in 700); spiral (hidden 60 ticks, then a spiral in from radius 350).
- Powers are MovementData row 17 (`g_DragonAnimationSpeedIndices` 17, 18, 19; the 5 attack rows are 18, 20, 21, 22, 23): fparam1 flames, fparam2 fireballs, fparam3 trail, fparam4 landing radius, fparam5 / fparam6 the Ultimate walk and flight speeds.

**Sync (what the exe does):** only the room leader decides; every `6x12` goes out and runs on the sender first; the receiver sets the target, the cursor and the x / z and enters the state. A client that becomes the leader mid-state raises `horiz_dist` and the burrow / spiral states pick their next step at once (their normal exit waits for the old leader's distance test). The exe has no resync for a follower: a lost packet leaves it in its state.

**Sinow Beat's mirage, from PsoBB.exe:** after a warp away (7) a Beat (param2 < 1) with param1 < 1 casts every other time (flag 0x20000 toggles at the exit of `0x0058E598`); the cast is animation 7 and, with the target in sight, the real body takes place `round-down(5 * rand)` of five and four clones fill the others: the Sinow's child entities (newserv `default_num_children 4`; `SinowberillAllocateAllyEntity` `0x0058F834` gives each the id and enemy index +1 + i), full hp, on the body's place, in state 8 (`0x0058E074`): for 40 frames each takes the point on the circle round the target at min(max(distance +- 3 toward 80), 80), on the line to the target turned by (place - 2) * 0x3333 / 0x28 BAMS a frame (so the five spin round it, the outer ones fastest), then flag 0x10 (evp = evp / 2, `0x0058E570`) and a chase of the nearest within 200. A hit on the body (vtable +0x100, `0x005900B4`) or its death (+0x104, `0x005900A0`) or the 2nd combo's end (`SpawnAlly` `0x0058F784`) sends the clones to state 0xf (the evp back; 10 frames of 0.1, then parked at y -500); a hit on a clone (`0x00590474`) sends only that clone there. A clone's `SpawnAlly` is `SetEnemyAiState(4)`, so it never warps away, and its state 0xe is a stub. Every client runs its own cast (the exe sends nothing for it).

**ASSUMED (neither source has it):** the model-node reads: the mouth (70 ahead, 75 up, 40 under the flight altitude), the feet (35 ahead, 30 aside), the tail's strike place (70 behind, radius 45), the head height of the dive's plunge (an altitude of 25 stands for `+0x418 <= -50`) and the model's own root height (`GetPlayerYPosition`, 0); the radii of the stomps (feet 15, the dive and emerge impacts 60, the death's two and four node places); a flame aims at the target (or 115 ahead of the mouth) instead of following the head node; the wall ray of the steps (the arena rim at 350 stops them) and of the Sinow's move test; the players' hp for the healthiest target (`playerHp`); group 1 / 0x13 (Foie / Barta family with the player's resistance) is the group-0 formula; the Ultimate rain's generator (a seeded LCG, the exe's seed `round(x * K)`, K unknown); state 9's remap table `0x009A3CD0` and the pad states are not used; a follower that has heard nothing for 900 ticks takes the leader's step itself (the De Rol Le rule), the walk toward a target that keeps running ends at 900 ticks, a pad-only state ends after 150, and a clone that lost everyone leaves; the music swaps (`dradeath.adx` in the entrance and at the death, `draroar.adx` at the roars) are logged, not played. The Sinow's clones are not translucent (the exe tints them `0xFFB0B000`) and Ultimate's state 0x10 (param1 >= 1) chases instead.

**Checks:** `tests/dragon.test.ts` (the sequences and the cursor, the trapezoid, the entrance's 340 ticks, a first-sequence loop and a second-sequence loop with the real frame counts and per-state limits, the clamp and the roar, the roar in the air, the death on the ground and in the air with one kill event, underground states invulnerable, the Ultimate rain and spiral, a follower in step that sends nothing, the walk's tracking packets, a takeover mid-burrow, the follower's watchdog, remote damage, the flame / fireball), `tests/sinowbeat.test.ts` (the cast every other warp away, the places, the clones' states, the spin, the dismissals, the Gold and param1 cases, no stalls). In the browser: `gameView.warpTo(11)` (the Dragon room), then hit it past 10 % to hear the roar log; Sinow Beats are in the Mines.
## 2026-10-19: Dark Falz's fight

**What changed:** ROADMAP next-up item 2, Dark Falz (Episode 1, floor 14). `combat/darkfalz.ts` is the control object (TBoss4DarkFalz 0xC8: the 16 scenes, the Darvants, the owner of the forms), `combat/darkfalz1.ts` / `darkfalz2.ts` / `darkfalz3.ts` are the three forms and `combat/darkfalzcommon.ts` the shared types. `render/combat.ts` wires them the way De Rol Le and Vol Opt are wired (`OWN_FSM`, built in `enterFloor`, the leader / follower split of the exe), in separate methods at the end of the Vol Opt section: every form gets a hit proxy in the slot the exe gives it (control + 0x200 / 0x1FF / 0x1FE), every Darvant one in control + 1.., the control's own model is posed as the form that lives. `net/game.ts` gained `sendDarkFalz` (6x19). `audio/bossbgm.ts`: see below.

**Confirmed: the Vol Opt names are Dark Falz's.** The dump's `VoloptForm7*`, `VoloptForm1/2 MinionMapObject`, `VoloptInteractionObject`, `VoloptUpdatePhaseState`, `VoloptPrisonBar*` (the ones after `UpdateVoloptAiState`), `DestroyVoloptForm7`, `RenderVoloptForm7Hazard`, `DeleteVoloptForm7Hazard` and `CreateVoloptMinion` are Dark Falz's, matched by callees, strings and constants: the control's table at `0x009A5940` has the scene names (`EDITOR`, `WAIT_CASKET`, `DEMO_WARP0`.. `OL ENDING`, strings at `0x008FF54C..`), the form tables at `0x009A6000` / `0x009A6280` / `0x009A6520` have `APPEAR`, `WAITNEXT`, `HAKILOOP`, `PAKULOOP`, `TENCHU`, `JISIN`, `MD_STOP1..4`, `CUT..CUT5`, `HORMING`, `LMAGIC`, `DMAGIC`, `CAPTURE`, `BURA`, `LIBERA`, the battle rows are `ep1_Darvant` / `DarvantFalz` / `DarkFalzForm1..3` (53..57), and every one of them tests `map_id2 == 0xE`. The JP files: `FUN_0044e5b4.cpp` is the ZAKO scene's enter (Ephinea `0x0044E4A4`), `FUN_0045f328.c` / `FUN_0045f314.c` the Darvant's death (`0x0045F238` / `0x0045F224`, the vtable `+0x114` die hook), `FUN_0045d52c.cpp` form 3's SetAnim (`0x0045D43C`), `FUN_0045a9e4.c` / `FUN_00457a78.c` / `FUN_00457a6c.c` / `FUN_0045f178.c` the enter functions that load a timer. The dump never defined most of the state functions as functions (`0x004557F4`, `0x0045C48C`, ...), so those were read from the disassembly with `tools/exedata.py` for the tables (`objdump` was only used to read, the Ghidra project was not touched).

**The fight, from the exe** (addresses are in the file headers; entity ids and the packets in PROTOCOL.md "Dark Falz"):
- Control: scene = `+0x384`, the leader runs the scene's lead procedure and every client its all procedure; a scene change is a 6x19 `{phase = scene}` (sender applies it first), a form's order a 6x19 `{phase 0xFFFF, packed action}` that the receiver hands to the form of the scene it is in (5/6 form 1, 7/8/9 form 2, 12/13/14 form 3). EDITOR -> WAIT_CASKET -> (a player within sqrt(900) of (-9860, -240)) DEMO_WARP0 (120 frames, players on a circle of 12.5) -> DEMO_WARP1 (30) -> ZAKO (80 Darvants in rings of 5 / 15 / 25 / 35; ends at row 53 iparam1 x party kills) -> APP TYPE1 (0x146 frames, `dark1.adx` at 0xB9, flag 0x32) -> TYPE1 (form 1) -> APP TYPE2 (300, flags 0x33, 0x34) -> TYPE2 (form 2) -> DIE TYPE2 (280, flag 0x35) -> GET RING on Normal (142) or DEMO_WARP2 (114, `dark2.adx`) -> DEMO_WARP3 (126, flag 0x36, players on a circle of 250 about (10000, 0)) -> TYPE3 -> DIE TYPE3 (302, flag 0x37) -> OL ENDING (454), whose last frame is `mark_falz_as_dead_and_request_drop` (on_enemy_killed at (20, 20) on Normal, (10226, 96) otherwise).
- Darvants (ZAKO class): rise 1/3 a frame from y -13 to 6, hover, look for a player within 150 every 60 frames, chase for 180, sink when dead; in states 1 and 2 every 16th frame the nearest player within 8 takes the Darvant's ATP; the scene ends them (the control's kill count +0x394).
- Form 1 (rows 54 / 57): APPEAR 75, then the leader's orders: HAKILOOP (300, a Darvant every 32 frames, at most row 57 iparam1 capped to 6) or PAKULOOP (150) by how many Darvants are alive (<= 12 - max), HAKIEND (60), MOVESTNDPOS to another of the four spots at 175 (row 54 fparam1 x 30 frames, eased), BEAM_L / BEAM_R (75; Rabarta at iparam2, Rafoie at iparam1, at the cell of the farthest player within 460, alternating) and below half HP TENCHU (150: 64 marks, 9 on the local player, a fixed hit of row 54 iparam3 within 25 at frame 1). Three heads at (135, 25, 0) / (0, 25, 135) / (-135, 25, 0), radius 30.
- Form 2 (row 55): a body on a circle of 300 (330 and lower while it fires), MOVE (row 55 fparam1 x 30 frames), JISIN (75, then TENCHU), BEAM_L / BEAM_R (150: a ball every other tick from frame 38 to 4), TENCHU (150), MD_STOP1..4 (75 / 150 / 225 / 300), MD_RECOVER (below half HP, Resta on itself).
- Form 3 (row 56): APPEAR 147, a chain of CUT states (49: the dash of 7 frames and a slash at frame 40 of six 0x71C sectors swept over six ticks, fixed damage of row 56 ATP), BURA glides (147), GOUP / GODOWN (49, hidden and unhittable at slot 0x11), HORMING (196, row 56 iparam3 volleys of two homing bolts), LMAGIC (147), DMAGIC (98: Megid on every player at row 56 iparam2), CAPTURE below half HP (98) and LIBERA (98). While it holds a player every point of damage it takes also hurts that player (`VoloptForm7ContextOnPlayerHit`).
- HP: each form is an enemy with its own pool (rows 54 / 55 / 56), the die hook (vtable `+0x114`) puts it in DEAD, the control moves on as soon as the form is in DEAD or WAITKILL. Remote damage is the ordinary 6x0A of the entity (`hp = max - damage_taken`) and feeds the same pool on every client. Kill sends: a Darvant killed by damage goes through the standard flow (6x76, 6xC8); the forms send none; the control's last frame is the one `on_enemy_killed` (every client, the drop request by the leader).
- Teleports (a form appearing or going, any jump of more than 60 units in a tick) bump the brain's `warps` so `render/smoothrender.ts` snaps.

**ASSUMED** (neither the dump, the JP C nor the disassembly I read gives it; also marked in the files): the Rabarta / Rafoie / Gizonde objects' reach and the flight of form 2's beam balls (a point running round the ring of 100 at 50 a ball, +-20 sideways); the flight of the homing bolts (4 a frame, steering, life 150, group-0 Gizonde power); what LMAGIC's technique object `0x006E6BF4` is (Gizonde); the flight of the spat Darvants (class `0xAF7EC0`; they dive at a player and die with TYPE1) and the Ultimate Darvants that form 2's beam creates (they die in the update that follows their construction, scene != 4, so they are not made); MD_RECOVER's drain particle does nothing to the player; the hit spheres (form 1's three heads, one point for the other forms, at the player's height); the TENCHU marks' spacing; the party size is read when the control is built; the player exclusion zones of `0x0044C674`; form 1's `EnforceVoloptForm7ArenaBoundaries` (players are not pushed out of the body); the cutscene objects, camera and fades (only their durations are kept); the Rico / ring scene of Ultimate (flag 0x97). A silent leader: a follower that waits in WAITNEXT or in a scene whose lead procedure decides for 600 ticks decides itself (the exe would wait for ever).

**Music:** `bossPhaseOf` took the 6x19 phase for a form number (scene 2 -> phase 1 ...), which started `dark2` at scene 5. The u16 is the control's scene; now scene >= 6 is `dark1.adx` and scene >= 11 `dark2.adx` (the control also plays them itself, at APP TYPE1 frame 0xB9 and at DEMO_WARP2). `tests/bossrooms.test.ts` follows.

**Checks:** `tests/darkfalz.test.ts` (packed actions of the three forms, the scenes' frame counts, the rings, the aura, every form's state sequence over thousands of ticks, TENCHU / beam / slash / capture hits, deaths and their quest flags on every difficulty, the leader and a follower in lockstep and with lagging packets, remote damage, a silent leader, nobody alive). `npx tsc --noEmit -p .`, `tests/{darkfalz,derolle,volopt,bossrooms,combat,enemies,waves,enemysplits,enemyfsm*,smoothrender}.test.ts` pass. Not run in a browser here: floor 14 (`gameView.warpTo(14)`), stand within 30 units of (-9860, -240) and the scenes follow.

## 2026-10-19: prebuilt newserv image on GHCR

**What changed:** the Docker build compiled newserv on the deploy server and
was cancelled on a small one (4 GB free). The Dockerfile now has a
`newserv-artifacts` target (a `scratch` image with only the library, the
binary and the system folder) and an `ARG NEWSERV_IMAGE` that picks where the
runtime copies newserv from: the local compile by default, or a prebuilt image.
`.github/workflows/newserv-image.yml` compiles it on a GitHub runner and pushes
`ghcr.io/<owner>/psobb-newserv:latest` (and a tag of the three pinned refs)
when the refs change or on demand. With `NEWSERV_IMAGE` set, BuildKit skips the
compile stage and the server builds only the client. Steps in DEPLOY.md
(workflow run, `read:packages` token, `docker login ghcr.io`, the build arg).
Not built locally (no Docker here); the first workflow run is the check.

## 2026-10-19: Docker build with fewer parallel jobs

**What changed:** the image build ran `cmake --build -j"$(nproc)"` for phosg,
resource_dasm and newserv. On a small Dokploy server that many C++ jobs ran out
of memory and the build ended "cancelled" at 54% of resource_dasm. The jobs now
come from the `BUILD_JOBS` build arg (default 2); DEPLOY.md explains when to
raise or lower it. Not built here (Docker is not installed on this Mac).
## 2026-10-19: classic party game list, party creation and quest loading screen

**What changed:** ROADMAP next-up item 3, with a correction of its premise.

**The "GameList" and "QuestLoading" names are not what they say.** Looking
the 28 GameList and 7 QuestLoading psobb-client-source files up against the
Ephinea dump (by callees, strings and constants) shows that most of those
names are community guesses:

- `GameListMenuObject` (0x00407bf0; JP `FUN_004080c1` / `0040816f` / `00408152`
  / `00408135` / `00408118` / `004080fb` / `004080de` / `004081ff`, the
  `RenderStatusText` cases 0, 4..10, 0xc) is the title's "Connecting.."
  object that `classic/connecting.ts` already draws. Its status text is the
  unitxt group 0x36 table (Xbox Live errors) at (23, 331), its state machine
  is 0->1->2 (0x96 frames)->3 (confirm / cancel per sub state)->4, and its
  dark panel (`GameListMenuDrawPanel`, (0, 28) 640x84 and (0, 310) 640x136,
  0x8f000000) is never switched on by anything. Now in
  `classic/connectstatus.ts` (pure, tested) and `connecting.ts` uses its
  position and wait.
- `GameListMenuGetState` (`FUN_00409c78`) returns one global,
  `SetGameListMenuEntryText` (`FUN_004153a0`) clears 0x100 bytes and copies
  0x7f characters, `ResetGameListMenuEntryFields` (`FUN_00414b60`) zeroes four
  dwords, `TerminateGameListMenuAll` (`FUN_00405760`) is a call thunk,
  `ProcessGameListMenuUpdate` (`FUN_004149fc`) stores 1.0 / 8.0 / 1.5. None of
  them draws or filters a game list; `CloseGameListMenu` is the generic list
  window close.
- `QuestLoadingScreen` `FUN_0040c1c8` / `FUN_0040c864` are the render gates
  (nothing before the second call), `FUN_0040c884` the dispatch of the grey
  line primitives; `FUN_0040e148` / `0040e15c` / `0040e210` / `0040e248` /
  `004107c4` / `00410910` / `00410d68` / `00410894` are unrelated thunks.

**The real game list** is the lobby menu state machine of
`g_CurrentLobbyMenuId` (0x00797xxx..0x007a0xxx). Reproduced in
`classic/gamelist.ts` (the file header has every address) and hooked to the
lobby counter (`classic/counter.ts`, `classic/lobby.ts`):

- Organize PARTY > Join a PARTY: the 08 request, the "Information Counter"
  list window (18, 53) 605x184, up to 0x40 rows of icon (0x18 when the game
  has a password) / name / episode / mode / difficulty (not for Challenge) /
  "n/max" at the exe's columns (+18, +228, +336, +432, +558), grey rows for
  games the character cannot join, Tab for the 09 / 11 game info (window
  (18, 265)), Enter to join (10) or the password prompt (entry 0xd7, 16
  characters), Backspace closing every menu (`close_lobby_menus`).
- Organize PARTY > Create a PARTY: the EPISODE 1 / 2 / 4 menu (entry 0xc8, the
  info text follows the cursor), then the five-row window ([11:0x60..0x64]:
  Party Name, Password, Play Mode (Normal / Challenge / Battle / One Person),
  Difficulty (Normal..Ultimate, greyed in Challenge), Registration (greyed
  until a name is typed, the cursor goes to it)), sending C1 with
  difficulty 0 for Challenge, battle = mode 2, challenge = mode 1, solo = mode
  3. Cancel in the counter menus now closes all of them (the exe does).
- The exe has no filter (and no sort) on this list; none was added. Entries
  flagged "cannot join" are only greyed and the server answers the join.
- The classic client has no field scene yet, so a game it enters (checked live
  with two clients, `tests/gamelist.live.ts`) is left at once and the lobby is
  shown again.

**Quest loading screen:** `update_loading_screen_widget` (0x00417ccc) builds
one of four screens by `current_loading_screen_type` (lobby burst, quest,
floor prev / next). `classic/questloading.ts` draws the quest one: the 120
scan-line triangles (0xff001a36), the 64 px letterbox, the two 0x77000000
panels, the corner brackets and the letterbox lines with their diagonal jogs
(0xff777777), and the QuestLoadingBar from `UpdateQuestLoadingBar`
(0x007836d2): bar (473, 440) 142x8 with its pulsing colours, the m"ss.t
estimate (nine samples, three-interval mean, 300 frame minimum, re-estimate
every 0x4c frames) and the percentage. `?screen=questloading` shows it with a
simulated download. Not drawn: the particle wipes and the middle particle.

**ASSUMED** (in neither repository): the "Information Counter" title is the
exe's untranslated string; the list windows have no open animation here (the
counter's have none); a list with no rows ignores Enter; the password editor
is not masked; the info window of a game is 342 wide; the percent format
"%3d%" is drawn as "%3d"; the quest screen's black clear and particles; the
widescreen centring (`extra / 2`, like the counter's menus).

**Validation:** `tests/gamelist.test.ts` (122 checks: rows, list cursor and
scrolling, the creation window, password prompt, menu flow with a mock host,
the counter's episode menu, the status text table and state machine, the quest
loading geometry and estimator), `tests/gamelist.live.ts` (newserv: create with
a password, 08 list, 09 info, refused wrong password, joined with the right
one, both back in a lobby), `tsc --noEmit`, and the titlescreen, windowanim,
mobilecontrols, minimap, fieldhud, options, shop, tekker, questboard,
questflow, party and level tests. No capture of the game list or the quest
loading screen exists, so there is no SSIM; not driven in Chrome.
## 2026-10-19: Vol Opt's fight

**What changed:** Vol Opt (Episode 1 Ruins, area 0x0D) fights back. `combat/volopt.ts` is the control object (TBoss3Volopt 0xC2) with the 6 pillars, 24 monitors, lightning rod, core and prison it owns, `combat/volopt2.ts` is the phase 2 body (TBoss3VoloptP02 0xC5). `render/combat.ts` wires them the way De Rol Le is wired: both classes are in `OWN_FSM`, `enterFloor` builds the brains and gives every part an invisible enemy in the slot the exe gives it (control + 1..6 pillars, +7..0x1E monitors, +0x20 prison, +0x21 rod, +0x22 core) so strikes, techniques, the lock-on and the other clients' 6x0A find it; the brain decides what a hit does and owns every death. `net/game.ts` gained the senders for 6x15 / 6x16 / 6x84 / 6x85 / 6x17 / 6x18 and `GameField.noteBossPhase` takes the leader's own music cues. The boss music phases (`audio/bossbgm.ts`) are untouched.

**What the Ghidra dump says about the names:** the JP files and the dump's "VoloptForm7*", "VoloptForm2/1MinionMapObject", "VoloptInteractionObject", "VoloptPrisonBar*" family are not all Vol Opt. Everything from `HandleVoloptDeathCleanup` / `UpdateVoloptAiState` on (they dispatch through `unknown_falz_state_functions`; the Darvant scene, `DistributePlayersInCircle`, the 6x19 handler `HandleVoloptEntityStateTransition` 0x0044CE6C, `map_id2 == 0xE`) is Dark Falz: a mislabelled BML symbol (`g_VoloptBmlData`) is shared. So Vol Opt has no form 7, no minion map objects and no hazards (those belong to the Dark Falz work); its "minions" are the 24 monitors and 6 pillars, its "prison bars" are the bar objects the pillars (ctor 0x004422D4, `VoloptPrisonBarConstructor`) and form 2's laser (`ConstructVoloptPrisonBarEntity`) raise, and its "ending" is form 2's death sequence plus `VoloptDeathHandler`. Of the ~34 JP files that grep to "Volopt" only these are the fight: `FUN_004416fc.cpp` (VoloptMonitorSetHitFlag), `FUN_00441f30.c` (monitor activate), `FUN_00442f94.cpp` (HandleVoloptMonitorPlayerHit, the pillar retract), `FUN_00448430.cpp` (form 2 state 1), `FUN_00448f1c.c` / `FUN_00448f2c.c` (SetVoloptMinionFlag / Clear..., flag 0x8000000), `FUN_004492a0.c` (SinowbeatInitializeTeleportData), `FUN_0043da4c.c` / `FUN_0043ea70.c` (the targeting-slot calls) and the flag-word setters `FUN_0043c514..c584.c`; every one of them agrees with the dump.

**From PsoBB.exe** (addresses in the file headers, entity ids and numbers in PROTOCOL.md "Vol Opt"):
- Control AI states (EnemyProcessAiState, 0x0043C680 table): 0 build, 1 intro (0xD2 + 0x3C frames of fog and camera, then the core stands 0x5A frames, SE 0x33C), 2 phase 1 (`Volopt__ProcessBehaviorState`), 3 the change (`ProcessVoloptState`), 4 phase 2 (`Volopt__ExecuteAttackPhase`), 5 over. Phase 1 ends when the core is dead or every pillar is a wreck, then 0x96 frames of rumble and a fade.
- The leader's phase 1 director (`Player__handlevoloptcommand`): only when no pillar is busy and a player is within 400 of the arena: cursor 0 sends 6x15 action 0 (start wall, 2..4 walls, the start moves back by the count), 1 waits for the core, 2 clears the round, 3 sends 6x16 (the live pillars shuffled, the first `+0x404` = 2, 3 ... 5 of them rise, the first as the red one) twice, then 6x15 action 1 sends the core away; 30 frames between orders. Ultimate sends 6x84 (a technique 0..3).
- The core (states 7 appear, 1 sweep, 9 stand, 10 retreat): it moves `MovementData[33].iparam1` BAMS a tick (120 Normal, 170 Ultimate) from wall*60+110 degrees across the wall; at 134.0 / cos(offset) from the middle (128.0 and y 15 while low), 0x2AAA wide walls; `VoloptGetTargetIndex` names the monitor it is behind (raised: the big one within 0x8DC of the middle). Only the 4 monitors of that wall can be shot (flags 0x4040000 otherwise) and a hit on one passes the attacker's strike to the core (`player_hit_volopt_core`); so does a hit on the red pillar, which also sends the core away. The last wall of a traverse ends in the stand (0x4000 / 0x200 turn ticks + 30 frames, 5 in Ultimate), then `g_VoloptPillarCheckFlag_0x50` tells the director.
- Monitors: HP `MovementData[35].iparam1` (big) / `iparam2`; the big one's fall takes its three small ones, the last small one's fall takes the big one; a fallen wall is skipped by the core. Pillars (states 0 / 2 / 4 / 5 / 9): rise 20 frames hidden, then 15 ticks of +2.9333 and 6 of -0.6667 (`0x00A449E4/E8`, `0x008FE540/44/48`), the extension motion 12, a decoy waits 175 frames and goes down, the red one charges 25 frames, fires (every live player takes an `entity_hit_by_tech` group 3 hit with `MovementData[34].iparam1`: 280 Normal, 2275 Ultimate), waits 120, fires a second time, goes down. A hit makes it flinch (motion 3) and retract unless it is mid-attack; a death is permanent; 6x15 action 2 (sent when a bolt strikes and the rod lies on the floor) stands the rod up and sets every pillar to the glowing state 9 for 150 frames.
- Phase 2 director (normal): missiles 3, laser 4, heal 5, capture 6 and round, skipping an action whose part is at 0 HP, pause 30 + 30 per broken part; Ultimate picks by weight 0.27 / 0.15 / 0.2 / 0.18 / 0.2 (`0x008FDC0C..1C`) and aims at the player with the most HP, every third pick at a random one. The change carries each player to `0x009A4BF0` (-5090 / -4910 / ±90 around (0, -5000)) with 6x17.
- Form 2 (`MovementData[37]`: 9500 HP, `[42]` the four part HPs 1500 / 3600 / 800 / 1500): missiles (60 frames of aim, motion 1 to frame 22, 2 waves of up to 4 homing missiles inside +/-0x1C72, `fparam1` speed, `fparam2` pull, life `round(fparam4)+240`, power `iparam1`), the heal (`iparam4/5` + 10, parts + `iparam4/5`), the laser (3 rounds of 4 turning points, bars where a player stands or after 300 frames), the capture (aim, 45 frames, a cage at `[38].fparam1` for `[38].iparam1` frames; the caught player is held `[37].iparam5 + 450` frames, the prison has `[38]` HP) and the death (60 frames, the death motion held, the kill at frame 47: EXP, drop, 6x76; 16 frames more). The hit boxes are the five of `0x009A53E0`; a strike marks one and the 6-frame reaction (none in Ultimate) splits the damage over the marked parts and sends 6x18 (handler 0x004488D8 read by hand: it stores the four shorts at +0x4B4..).

**Sync (what the exe does):** every client runs every state machine; the room leader's directors speak through 6x15 / 6x16 / 6x84 / 6x17 / 6x85 and apply the order themselves first (`checked_call_packet0x60_subcommand`); the attacker's client sends the 6x0A of each entity and every client feeds its copy (`hp = max - damage_taken`, the packet's dead flag is ignored: the brain owns death); a pillar's bolt sends 6x15 action 2 (the exe: every client's copy; here only the leader's, see the review notes); 6x18 comes from the client whose strike marked a box; the kill sends (6x76 always, the drop request on the leader with a last attacker, 6xC8 per client with the killer flag) run on every client at frame 47 of the death motion, like De Rol Le's.

**ASSUMED (neither source has it):**
- The prison bars' and the cage's update code (`g_VoloptPrisonBar_vtable`, `g_VoloptPrison_vtable` have constructors only): the bars are tracked (`VoloptPillar.bars`) but not drawn and do nothing; the laser deals no damage; the cage is a projectile that takes the first player within 12.
- The sign of the core's sweep along the wall (the exe's rotation convention was not traced), the height the hit tests use (parts are placed at most 38 up), the missiles' launch points, the nearest box as the one a strike touched, the Ultimate arm (state 0xC) beyond its 90 frame timeline, the Ultimate technique objects (a plain bolt), the camera and fade waits (60 frames each for the overlays, 60 for the camera events, `GlobalGameState` flags are not here), the pull-back of players next to a rising pillar / the boss (not applied), and the delays of 6x85 (stored by nobody here).
- Group 3 on a player uses the group 0 formula (`enemyTechHitsPlayer`), no shock roll.
- A monitor that fell is hidden instead of swapped for the broken models (table `0x009A5230`).
- Guards the exe does not have: the director's wait for the core is capped at 900 ticks, and the pillars, the core and the body each have a watchdog that leaves a step after 1500 ticks, because a shorter-than-expected motion would hang the exe's frame waits too.

**Review notes (second pass):**
- The ending is done as `VoloptDeathHandler` does it online: `set_quest_flag(0x2A)` is a 6x75 (`Game.setQuestFlag`) and `unhide_objects_for_volopt_death(0)` is `unhide_object_set_no_packet` for room 0 groups 1 and 3, which is what an event's construct_objects does (`GameView.constructObjects`). Every client runs it when the control reaches state 5 with the body dead (the form 2 death frame also calls it in the exe; it is idempotent).
- Once all six walls are checked the director never sends a traverse again: Player__handlevoloptcommand's cursor 0 tests the six walls' flags and its `else` sets the cursor to 2, and cursor 3 then goes back to 0 (action 1 sends the core away). That is the exe; phase 1 then ends only when the core dies (red pillar hits still reach it) or the pillars are all wrecks.
- Ultimate builds no rod (`g_VoloptDifficultyMode == 0` guards its constructor): no proxy, never targetable.
- 6x15 action 2: the exe lets every client's pillar copy send it, and each receiver runs VoloptPhaseTransition on the rod, which restores its HP, so a late duplicate undoes damage. Deviation: only the leader's copy sends it.
- Ultimate director with all four parts at 0 HP waits the pause (the exe asks again every frame) and no longer allocates; the HP of the local player now counts for the "most HP" target.
- A strike during form 2's 6-frame shake keeps its hit pending and splits at the next reaction (it was dropped).
- Exits that wait for `elapsed >= N` on a once-slot (missile 22, heal 38, laser 33, capture 20, stand 38, death 47, pillar 8) also end when the slot ends or loops (`VoloptAnim.reached`): a motion shorter than N no longer relies on the watchdog (test with 5-frame motions).
- 6x85 is stored like `SetVoloptGlobalOffsets` (Ultimate, action 0) on send and receive (`VoloptAi.delays`).
- A part whose slot is taken is logged, not silently left without a target.
- Kill sends: the Vol Opt body's death calls `on_enemy_killed` then `set_monster_spawn_initdata_as_dead` itself, the same pair as `EnemyOnKilledHandler_0051f894`, on every client, so every client sends 6x76 and 6xC8 as for De Rol Le. newserv copes: the 6x76 handler only ORs flags and re-forwards, and 6xC8 (`on_enemy_exp_request_bb`) gives EXP once per (client, enemy) pair and returns early for a repeat.
- 6x0A for the parts: they are real enemies in newserv's map (`add_enemy_and_children` adds VOL_OPT_PILLAR / MONITOR / AMP / CORE and NONE slots as enemy entries, so `enemy_state_for_index` finds them, and its 6x0A handler even notes that flag 0x800 "does work on Vol Opt (and the various parts)"); they are not set entries, but they are enemy entities in the exe too, whose generic damage path sends 6x0A with the dead flag. Parts are bosses there, so the fast-kill path is skipped.

**Checks:** `tests/volopt.test.ts` (tables, the intro's 0xD2 + 0x3C + 0x5A frames, the director's orders and pauses, a follower sending nothing, the sweep and the exposure, monitors reaching the core once per reaction, a remote hit not striking from here, the wall falling together, the red pillar's two bolts and the bolt hitting every live player, the rod, the red pillar and a decoy hit, six wrecks ending phase 1, the change with its 6x17, the director's cycle and the broken-part skip, missiles / heal / laser / capture / prison, the hit reaction and 6x18, no reaction in Ultimate, the death's kill frame, remote 6x0A, a follower fed the orders ending in the leader's state, Ultimate's technique and weights, five fuzzed fights that all reach the end, and a quiet tick that allocates nothing); `tsc --noEmit`, `derolle`, `bossrooms`, `combat`, `enemies`, `waves`, `enemysplits`, `enemyfsm*`, `fieldbgm`, `smoothrender` pass. Not run in Chrome or against newserv from here.

## 2026-10-19: client data from a Google Drive link (PSOBB_DATA_URL)

**What changed:** the container can fetch the PSOBB `data/` folder itself.
`PSOBB_DATA_URL` is a Google Drive share link (or file id, or any direct URL)
of one `.zip` / `.tar.gz` of `data/`. `docker/fetch-data.mjs` (started in the
background by `docker/entrypoint.sh`, so the site is up at once) downloads it
into `PSOBB_DATA` (`/data/psobb-client`, a volume), follows Drive's
large-file confirmation form, unpacks it with `unzip` / `tar`, drops
`__MACOSX` and a single top-level folder (`data/`), and writes
`.fetched-from`: the same URL on a restart downloads nothing, a new URL
replaces the contents. No login is needed: the link is shared "anyone with
the link", and `/psobb-data/` stays open like before. A failure is logged
(`[fetch-data]`) and the page falls back to asking for a folder. The image
gains `unzip`.

**Validation:** `tests/fetchdata.test.ts` (Drive link forms, the confirmation
page, a real zip with a `data/` folder and `__MACOSX` and a tgz from a local
server, idempotence, URL change, unreachable URL). Not run against Google
Drive itself or in Docker (not available here).

## 2026-10-19: favicon from PsoBB.exe

**What changed:** the pages' favicon is the application icon of `PsoBB.exe`
(group 101, a single 32x32 8-bit "PSO BB" image). `tools/exeicon.py` reads it
from the PE resource tree (RT_GROUP_ICON / RT_ICON) with the standard library
and writes an .ico; `favicon.ico` is in
`client/public/` (served at `/` by the dev server and the production relay)
and in `site/` (the GitHub Pages page). Not upscaled: the exe has no larger
size, so there is no apple-touch icon.

## 2026-10-19: production serves only the classic client

**What changed:** a production build (`npm run build`, the Docker image)
now has only `classic.html` as its entry, and `bridge/server.mjs` serves it at
`/` (and `/classic`, `/classic.html`) and answers 404 for any other `.html`.
The development pages (`index.html`: protocol log, game panel, map viewer;
`models.html`) stay on the Vite dev server. `PSOBB_DEV_PAGES=1` builds them
all for local checks.

**Validation:** built the client and ran `server.mjs` on a spare port: `/`,
`/classic` and `/classic.html` answer 200 with the classic page, its assets
load, and `/index.html`, `/models.html` and unknown `.html` answer 404. Headless
Chrome on `/` shows the title screen.
## 2026-10-19: Touch feel: analog walk / run, second-finger camera, haptics

**What changed (issue #5):** three browser conveniences for the touch pad.
None of them is PsoBB.exe behaviour on keyboard / mouse; the walk / run rule
is the exe's own gamepad code.

1. **Analog walk / run** (`input/analog.ts`, `render/lobbyview.ts`). While the
   stick is held the player view reads its axes instead of W / A / S / D (the
   keys are still sent, for menus). Direction is analog. Walk / run follows
   the exe's pad code: `unknown_handle_shared_inputs` (after
   `QuestItemSpawnHandler_007beca0`) zeroes an axis with -31 < v <= 31
   (`0x0097e628` / `0x0097e624`) and sets movement_input_amount =
   min(1, hypot / 128) (`0x0097e61c`, `0x0097e618`). Standing
   (`0x0069b728`) starts walking at 0.1 (`g_MovementInputThreshold`,
   `0x0093da84`). Walking (`0x0069bbd0`) counts frames above 0.75
   (`0x0093da70`) and runs once the count reaches 6 (`0x0093da74`). Running
   (`0x006a1584`) clears the count and walks again under 0.75. Walking sends
   6x40 (`sendWalk` moved from `Game` up to `Lobby`), running 6x42.
   ASSUMED: the stick's rim is a deflection of 128, the count is cleared on
   stopping, and the walk speed is the run speed / 1.5 (the run motion's
   frame step factor). The keyboard path is unchanged (it still runs at once).
2. **Second-finger camera drag** (`ui/webcontrols.ts`). While the stick is
   held, another touch on the canvas outside the pad's controls turns the
   camera as it drags sideways: a full canvas width is half a turn (ASSUMED,
   by feel). The exe has no key that turns the camera (the Camera key only
   resets it behind the player), so the drag adds to `PlayerCamera.angle`
   directly. The chase rules of `render/playercamera.ts` are unchanged.
   Pushing the stick forward moves along the camera's forward, so the chase
   goal is the dragged angle and nothing pulls it back.
3. **Haptics** (`input/haptics.ts`). `navigator.vibrate` pulses for a pad key
   press, a hit the player lands (`applyEnemyHit`), damage taken (longer,
   `PlayerDamage`'s sendHit event) and a level up (a pattern,
   `displayLevelUp`). These are one-line hooks in `render/combat.ts`. A
   weaker pulse does not cut a stronger one still running. With no vibrate
   (iOS Safari) every call is a no-op and the VIB button is not shown.
   The setting is `localStorage` `psobb.haptics` (in try/catch); `?haptics=0/1`
   overrides it for one page load.

**Tests:** `tests/mobilecontrols.test.ts` checks the dead zone, the amount,
walk vs run and the 6-frame ramp, the drag turn's sign and accumulation, the
dragged angle against `PlayerCamera` standing and running, haptics as a
no-op without vibrate, the toggle and its storage, `?haptics=`, and throwing
storage.

**Check in Chrome:** open the client with `?touch=1` and device emulation
(touch) on. Push the stick a little to walk and to the rim to run (the run
starts after 0.2 s). Hold the stick and drag a second touch on the view to
turn the camera. Desktop Chrome has `navigator.vibrate` (the VIB button
shows) but no motor, so check the pulses on an Android phone.
## 2026-10-19: title / login leftovers from the exe

**What changed:** the last approximations of the title and Login screens are
replaced by the exe's rules. The Exit Game question and its Yes/No list now
have the exe's size and position, and both open with the window animation.
The Login menu's and the Yes/No list's rows are revealed by the opening
wipe. Window titles and the Input UserID rows appear in one go once the
window has opened far enough.

**Details (Ephinea `PsoBB.exe`):**
- List window height (`YesNoListMenu_UpdateRenderHeight_00736390`,
  `yes_no_list_constructor` 0x00735708): per row 6 (`0x009713e4`) + the text
  height, then -6 (`0x009713e0`), +6 with a title, +20 (`0x009713dc`). A
  one-line row is 14 high (`get_text_rendering_sizes_for_list_item`
  0x0072ddf4, `0x00970ea4`). `listWindowHeight(5, true)` = 120, which is the
  Login menu's {220, 120} from `g_MainMenuListItemProperties` (0x00974e10,
  `MenuListItem_InitializeProperties_00712c14`). The size is no longer
  "measured".
- Exit Game (`main_menu_exit_game_sub_list`,
  `ChatShortcutMenuWindow_CreateSubMenuWithYesNo_0073cfec`):
  - "Really OK?" is an untitled one-row list at (400, 350), 150 × 34;
  - the Yes/No list is 104 wide (`0x00971468`) and 54 high, at
    `YesNoListMenu_GetRenderPosition_0073cf10`: the question's right edge
    - 111 (`0x00971d44`) and its bottom edge - 10 (`0x00971d40`), so
    (439, 374);
  - render order 0.5 for the question and 0.45 for the list;
  - psobb-client-source `src/FUN_0073d178.c` (the JP twin of
    `ListWindowObject_IsItemSelectable_0073d114`) confirms that the Yes/No
    list is the pair's +0x24.
- Text wipe:
  - list rows are `AutoClass2` texts drawn by `render_chat_bubbles_and_more`
    (0x0072d9b4, vtable 0x00b40448). Each row is cut at
    `(c - (x / W + y / 21) * 7.5) * 17` px (`0x00970eb0..b8`). x is the
    centred offset (`unknown_set_list_window_size` 0x00736458:
    w * 0.5 - 10 - text width * 0.5), y is row * 20, and W is the window
    width - 20 (`UiTextGeometryUpdate_0071b900` +0x18). `drawMenuWindow`
    takes the window's `WindowAnim` for this. Row 4 of the Login menu starts
    about 14 frames after row 0;
  - title pill texts (`unknown_tekker_result_text`) and the info-counter rows
    of Input UserID (`RenderInfoCounterEntity_0072e930`, vtable 0x00b404f0)
    have no wipe. They are drawn whole once c >= 0, 4 frames after opening at
    window speed 1 (`WindowAnim.textShown`). So Input UserID does not wipe.
- Start Game / Patch Download: both go through table `0x009d04c8` to
  `SaveAndSetMainMenuType_00824860` (the patch_status scene).
- The idle counter (+0x34) is only cleared by the title code (no increment
  in 0x006f4000..0x006ff400), so its gate in `update_main_menus` stays open.

**ASSUMED:**
- the lower render order (0.45) draws in front, so the Yes/No list is drawn
  over the question;
- the Yes/No list ignores keys while it opens, like the Login list here;
- Input UserID's title follows the list title rule (its setter
  `ChatShortcutMenuYesNoWindow_SetTitle_00738364` is not traced);
- the exe narrows the quad of the glyph that crosses the cut, without moving
  its UVs; here that glyph is clipped;
- nothing outside the title code increments the idle counter;
- the login runs under the "Connecting.." object (the patch_status scene's
  own screens are not traced). The password is kept for the page only,
  and Patch Download returns to the title (no patch server). These are
  browser choices;
- a text editor keeps cancel to itself (the IME panel takes the keys).

**SSIM** (`tools/compare.sh` against `client/public/ref`; renders with
`classicCapture` at 2880×1800 from headless Chrome through DevTools):

| Screen | URL | SSIM | PSNR |
| --- | --- | --- | --- |
| Title + Login menu | `?screen=menu&t=30` | 0.766 | 21.0 |
| Title, cursor state of the capture | same, cursor forced to Start Game | 0.771 | 21.3 |
| Login menu region (412×250 at 514,538) | same | 0.739 | 18.7 |
| Logo region (1440×480 at 0,114) | `?screen=menu&t=30` | 0.719 | 20.3 |
| Select character | `?screen=select` | 0.915 | 25.8 |

The whole-frame SSIM is unchanged, because the windows are fully open at the
measured frame. The menu region is 0.739 (0.745 in the previous entry) and
the PSNR is higher. Both come from the capture path: `classicCapture`
renders the stage alone, without the page around it. No capture of character
creation or Input UserID exists, so those two screens are still not measured.

**Checks:** `tests/titlescreen.test.ts` (66 checks; new: the list height
rule against 0x00974e10, the question and Yes/No rects, both windows'
SE 0x572, no Yes/No keys while it opens, `textShown` from frame 4, rows cut
by the wipe and the row lag); `tests/windowanim.test.ts`;
`tests/mobilecontrols.test.ts`; client `tsc --noEmit`.
## 2026-10-19: Smooth rendering between game ticks (issue #5)

**What changed:** a browser convenience, not exe behaviour. The logic still
runs at 30 ticks a second (`GAME_TICKS_PER_SECOND`); no tick logic, timer,
hit test or network send changed. What is drawn changed: anything a tick
moves keeps its pose before and after the last tick, and each display frame
draws it at the tick remainder (`render/smoothrender.ts`). Positions lerp,
Euler angles take the shortest arc.

- How: `MapViewer` runs `renderHooks` right before the draw. Each owner hands
  its tick-moved objects to `viewer.smoother.track(object, clock)`. The
  smoother never writes `position` / `rotation`. It composes the interpolated
  pose into the local matrix with `matrixAutoUpdate` off, and `restore()`
  after the draw turns it back on and rebuilds the world matrices. Logic that
  reads `matrixWorld` between frames (De Rol Le's node captures) sees what it
  saw before. Reused vectors / quaternion / poses: no per-frame allocation
  per object.
- Clocks: `TickClock` records the tick count and remainder of the loop that
  moves the object: combat (enemies, shots, Lily spits, De Rol Le
  tentacles / stings, the lock-on reticle follows the drawn enemy), the game
  field (pillar trap nodes), the NPC layer (wanderers). The player camera
  keeps its previous source / target and `view(pos, heading, alpha)` lerps
  them (LobbyView's camera tick remainder).
- Snaps (prev = current): first sight, hidden -> shown (wave spawns), a move
  outside a tick (warps, 6x24, network snaps), a one-tick move over 100
  units, and a brain's `warps` counter (a write-only render hint on
  `BrainBase`): De Rol Le's corner teleports (dive, sink, resurface), the Pan
  Arms going back under its spawn point, Hidoom / Migium appearing at the
  split, a Pofuilly Slime's return and throw. `PlayerCamera.snap()` also
  snaps the drawn view.
- Already smooth, unchanged: the local player (moves per frame time), remote
  players (6x3E / 6x3F / 6x40 / 6x42 targets chased per frame time), and
  motion frames: `NodeAnimator` / the player animator apply the fractional
  frame (`tickRemainder`) every display frame.
- Not interpolated: particle effects (telepipe, level-up), the NPC talk and
  door unlock cameras.
- `?fps=30` turns it all off (the original's stepped look).

**Tests:** `tests/smoothrender.test.ts` (pose lerp, shortest arc across PI,
every snap rule, ?fps=30, TickSmoother on three.js objects leaving the logic
pose untouched, the camera). tsc is clean; combat, enemies, derolle,
enemysplits, every enemyfsm suite, bossrooms, mobilecontrols, npcs, traps,
controls, collision, waves and warpmenu pass.

## 2026-10-19: De Rol Le review fixes

**What changed:** the review of the De Rol Le fight and its Chrome run found
two soft-locks and several sync issues. Fixes, with the exe's behaviour:

1. Damage from other clients feeds the shell / body pools on every client.
   UpdateDerolle calls the pool handler `ProcessPlayerHealing_00433edc`
   (vtable +0x100 of `0x00af4440`) on leader and followers alike when the hit
   flag 0x200 is set (vtable +0x88, `0x00777ba4`). Each 6x0A now carries one
   hit's damage (`sendEnemy` takes a `damageTaken`).
2. The beam cannot hang: beam_b (body motion 3) has 26 frames, so after sub 2
   holds frame 13, sub 3 plays on to the end. A test runs 0x1a..0x1c with the
   real frame counts.
3. The kill sends follow `EnemyOnKilledHandler_0051f894`. Every client sends
   the 6x76. Only the leader sends the drop request, and only if the boss was
   hit. Each client asks for its own EXP, as the killer only after the last
   hit (ASSUMED: enemy +0x2da is the local player).
4. The big jump's sign matches `0x00431058` (z = z0 - Zpos toward 500.0 at
   `0x008fce3c`); the body overshoots to about 622 and eases back. No change.
5. SE 0x329 during the dive is one sustained voice, as `PlaySFX_008292dc`
   only refreshes a live voice with the same id and owner (`SePlayer.playing`).
6. The damage past the shell on the breaking hit is lost, as in
   `0x00433edc`'s shell branch.
7. Followers: the exe has no resync. ASSUMED fallback: a follower that has
   not heard from the leader for 300 ticks takes the leader's step itself,
   without sending, so the body is always removed after its death.
8. The children keep running through the death as in the exe (they live in
   the body's +0x3e0 tree); 0x1f resets the tentacles, and 0x20 drops the
   shots still in flight.
9. A FLAG_DEAD 6x0A no longer runs the generic death on De Rol Le; its brain
   owns the death.
10. A per-boss `DrlView` caches the spine / attach nodes, the child groups
    and reused point arrays: no per-frame `updateMatrixWorld` or
    `getObjectByName`.

**Tests:** derolle (beam to the end, a 10-minute loop reaching every attack
state, shell overflow, sustained SE, follower fallback), bossrooms, combat
(5946 checks), enemies, waves and every enemyfsm suite pass; tsc is clean.

## 2026-10-19: De Rol Le's fight

**What changed:** De Rol Le now fights, with its FSM reversed from PsoBB.exe.
The body follows the exe's attack sequence around its four path corners. It
throws rocks from its shell segments, rains rocks from the ceiling, sends
its 4 tentacles at a player from the wall, and launches the 5 floor stings
and the 3 ring stings (the spore mines). It also fires the beam. Damage goes
to the shell pool first and then to the body pool. When the body pool runs
out, the boss sinks, plays its death and sends the kill. The leader picks the
states and sends 6x13 / 6x14; the other clients follow them. Code:
`combat/derolle.ts` (new), wired in `render/combat.ts` like the other
own-FSM enemies (OWN_FSM, built in enterFloor). Other changes:
- the body is drawn at scale 2.0 (`EnemyPartSpec.scale`);
- the tentacle and sting parts are world-placed, and there are now 4
  tentacles (`formats/enemymodels.ts`);
- `AiFrame.y` is a new absolute height;
- `EnemyShot.absolute` is new;
- `EnemyInstance.nodes` exposes the part node trees;
- `Game.sendBossAction` sends 6x13 / 6x14.

**Sources:** the Ephinea dump, plus tables read with `tools/exedata.py`.
psobb-client-source's 17 "De Rol Le" files are mostly getters or thunks, or
belong to other objects. Three of them match the functions used here, and
their C agrees with the dump:
- `FUN_00434b30.c` = `DerolleInitializeAttackState_00434a2c` (the sequence
  cursor +0x3dc starts at 0);
- `FUN_00439c54.c` = `0x00439b2c` (tentacle state 2 entry: +0x11c =
  table[i], +0x120 = 0x4000);
- `FUN_00439c94.c` = `0x00439b6c` (tentacle state 0 entry).

The JP table `PTR_DAT_008fb6ec` is Ephinea `0x008fd70c` = {-2048, 2048,
-4864, 4864}, the tentacles' home yaws. The dump's names in this range are
mostly wrong:
- the 4 "DerolleRockProjectile" objects (`0x00437ba4`) are the tentacles;
- "DerollePlayerShellState" is the beam charge (0x1a);
- "DerolleUpdate" is the death state (0x1f).

**Details** (Ephinea `PsoBB.exe`):
- **Dispatcher** `0x00433cc0` (jump table `0x008fcb00`), phases 4 / 0 / 9 /
  8 / 6 / 5. UpdateDerolle `0x00432b4c`:
  - the leader runs the death check (`DerolleIsActionReady`: body pool < 1
    and flag 4 clear) or phase 9, then phases 8 and 0;
  - a follower (+0x3fc == 1) runs phase 0 only and takes the leader's state
    from 6x13 / 6x14;
  - `start_drl_rock_cycle 0x0042ac2c` sends 6x14 with the target for 0x14,
    0x15, 0x19 and 0x1b.
- **Sequences:** `0x009a4380` (normal, 44 entries) and `0x009a4440`
  (Ultimate, 50 entries), read through the pre-incremented cursor +0x3dc.
  - 0x21 / 0x23 / 0x25 roll a random value in [-1, 1] against 0.0, so each
    is 50/50.
  - 0x22, 0x24 and 0x27..0x2b pick a variant by the lane +0x660 (the corner
    the last move went to).
  - 0x2c restarts the cursor at 5.
- **Corners** (bss `0x00a43ba8`, written by `0x004341bc`): (-175, 7, 25),
  (0, 7, 500), (175, 7, 25), and (0, 7, -250), the spawn corner.
- **Motion slots:** table `0x009a45c0` (17 slots: mode, next, motion, speed).
  The brain owns the frame (+0xc0); the body animator is held at it.
- **Corner moves** `0x0042b94c`:
  - two easing records (+0x66c x, +0x68c z), with init `0x00434ac4`, brake
    point `0x00434a3c` and tick `0x0042c9a0`;
  - four mode functions decide which axis eases when and write the motion
    speed (0.3..0.9);
  - helpers `0x0043483c` / `0x004349b4` / `0x00434934` / `0x004348b4`.
- **States:**
  - 1 is the entrance: 55 ticks, then (0, 7, -190), the enter motion, then a
    walk to corner 0 at 3.0 a tick.
  - 4 / 0xa are the side jumps `0x0042c194`.
  - 0xd is the big jump 3 -> 1 `0x00431058`.
  - 0xf is the dive and ceiling run `0x00430a90`: z -1200 to 360, rocks by
    MovementData fparam5 / fparam4.
  - 0x10 / 0x11 are the segment rocks `0x0042ce8c`. Segments 0..4 fire as
    the body's wave passes them, along heading 0x3800 - 0x33 * i. The emitter
    `0x00437604` uses types `0x008fd678`. The rock (`0x00437810`) falls to
    8.7, has a hit box of 3.0, lives 120 ticks, and only hits while
    -75 <= x <= 76. Its hit is group 0 with fparam2.
  - 0x12 / 0x13 are the bite leap `0x0042d304`; landing raises the
    tentacles.
  - 0x14 / 0x15 are the wall `0x0042dd68`: every 180 ticks (Ultimate:
    iparam4) a tentacle reaches for the target with a hold of 120 (iparam5).
    The grab (`0x00434108`) is a try_hit with mult 1.0 and attack row 15,
    radius 8.0.
  - 0x16 / 0x17 are the sink and resurface `0x0042e348`.
  - 0x18 / 0x19 are the stings `0x0042e824`, at frame 18.0.
  - 0x1a / 0x1b / 0x1c / 0x1d are the beam: 30 longer a tick up to 500, with
    a group 0 hit of fparam1 at its end, once per player per beam.
  - 0x1e is the death sink. 0x1f is the death (deldeath.adx at frame 27). It
    ends with the kill at (-55.8, 2.0, 60.29). 0x20 is the removal.
- **HP** (`ProcessPlayerHealing_00433edc`):
  - the entity's HP is refilled after every hit;
  - the shell pool (MovementData[15].iparam3) takes hits until it goes below
    0 (`0x00433fe4`: flags | 0x88, SE 0x32d);
  - then the body pool (iparam1) takes them (SE 0x336).
- **Stings** (`0x004369bc` / `0x004370b4`):
  - kind 0 lob to the floor point at 10 a tick (gravity 0.2) and arm for
    180 + 30 rand ticks;
  - kind 1 home on their ring point (speed 8 down to 3, turn up to 3) and
    shadow it for 240 + 60 rand ticks;
  - both blow up 30 ticks later: radius 50.0 (`0x009a48bc`), group 1 with
    fparam3.
- **Ceiling rocks** (`0x00439c6c` / `0x00439e10`): kinds and offsets are at
  `0x00a44240`, gravity is 0.3 (down to -10), and the hit test goes through
  the player's top. Each rock bounces once.

**ASSUMED:**
- **Rendering:**
  - The segment and tentacle points come from the body's depth-first node
    order (draw indices `0x008fcba0` and 0x1d..0x20); with no nodes, they
    are estimated from the body.
  - The tentacles are drawn as one rotated model each. The chain solver
    (`0x0078d9d0`) is not reproduced, and the sway amplitude K is a guess.
  - The rocks and the beam are drawn as plain spheres and a line; the
    particles and the shell debris are not drawn.
  - The sting blink is drawn as a swell.
- **Movement:**
  - The enter motion's root offset (DerolleAction) is not added at the end of
    the entrance.
  - The ground term of the jumps (`0x00422768`) is 0.
  - A kind-1 sting leaves upward.
- **Hits:**
  - The sting blast's group 1 uses the group-0 formula.
  - The beam's hit radius is 16.
  - The rocks and grabs do no knockback.
  - A player is 17 tall for the ceiling rocks' top test.
  - Every hit on the boss goes to the body handler; the 10 segments are not
    separate targets.
- **Data and sync:**
  - When MovementData is missing, fallback powers and pools are used.
  - Sub-state 4 of the entrance (the boss camera flag) passes at once.
  - The death track is logged, not played.
  - 6x0A carries the body pool as the HP.

**Checks:**
- `node tests/derolle.test.ts` (new): sequences, easing, the entrance and the
  first moves, stings, rocks, ceiling rocks, tentacles, beam, pools, the
  death path, followers, the dive;
- `node tests/bossrooms.test.ts` (4 tentacles, scale 2.0; the boss music
  phases and the 6x triggers unchanged);
- enemies, waves, and `combat` with NEWSERV;
- client `tsc --noEmit`.

A simulated 8-minute fight runs the whole normal loop without leaving the
arena, using the real motion frame counts. No Chrome check here.

## 2026-10-19: Episode 2 FSMs: Merillia / Meriltas and Dolmolm / Dolmdarl

**What changed:** the first Episode 2 enemies have their own brains,
reversed from PsoBB.exe: Merillia / Meriltas (Jungle, Mountain, Seaside)
and Dolmolm / Dolmdarl (Seabed). Both run on the Booma substrate, so
`combat/enemyfsmep2.ts` has one shared base for the generic controller and
the chase / melee handlers, and the two families on top. Wired in
`render/combat.ts` like the Episode 1 FSMs (OWN_FSM, the confusion-aware
search, the HP fraction); flinch / death rows in `combat/enemymotions.ts`.
VR Temple / VR Spaceship spawn the Episode 1 classes, which already run
their brains.

**Details:**
- Controller `update_enemy_control_object` (0x00787a80): while the attack
  flag 0x200000 is clear, find_target (0x0052b888, every 30 frames, nearest
  within the AI record radius) then vtable +0xf0 (no target) / +0xf8 (in
  reach) / +0xf4 (chase). Chase 0x0052afe4 (war cry row 7, then the gait at
  MovementData fparam1 / fparam3), melee 0x0052b5f0 (rows 3 / 4 by
  get_random_float <= 0.5, frame 7 try_hit_entity(1.0) +
  cause_knockback(3.0), 15 frames, vtable +0x19c).
- Merillia: ctor 0x00575e70 (vtable 0x00b066e0, dispatcher 0x005755cc),
  table 0x009bec00, record 0x009beb00 / 0x009beb1c (search 225 / 250, turn
  1024), radius 8 (0x009beb6c); params via SinowberillInitParameters
  _00576194 (run chance param1 - 0.2, pollen chance param3 - 0.2, run frames
  param4 + 300, wake radius max(param5 + 100, 15)); MovementData rows 74 /
  75 (pushes 0x4a / 0x4b in init_merillia_subtypes_global_config). States
  13 (0x005756e8, the 40-frame emergence effect: 0x00576c48 / 0x00576b18),
  12 under (0x00575764), 0 appear (0x005743b0, row 11), 1 (0x00574848,
  burrows without a wander radius), 11 burrow (0x005757e8, row 13), 4 run
  (0x00574e38, fparam6 for param4 + 300 frames), 10 pollen (0x005758dc:
  frame 13, MericarolCreateMegidCloud_005765a8 radius 20, power fparam5,
  then group 0 and group 0x0f via 0x00576920); flinch end 0x0057460c ->
  MericarolHandleRandomBehavior_0057479c below iparam1 % HP. Invulnerable
  (0x4000000) while under / appearing / burrowing.
- Dolmolm: ctor 0x00553c7c (vtable 0x00b04480, dispatcher 0x005528d8),
  init 0x00553fc8 (back-step chance param3 + 0.3, dance chance param4 +
  0.3, 0x0092491c), table 0x009bd9c0, record 0x009bdb1c (225 / 300),
  radius 8; +0xf8 0x005538cc (the dance within fparam5, else the melee),
  +0x19c 0x0055281c (back step), back step 0x00553084 (x4 speed, 50 units,
  0x0092495c / 0x00924958), dance 0x00552c04 (row 12, iparam1 arc,
  HandleHardAttackAction_0069375c for iparam2 * 30 frames, particle 2).
- RE: the dump lacks most Episode 2 handlers, so they were decompiled with
  Ghidra headless from the community .gzf (a scratch project) and read with
  objdump; psobb-client-source (JP build) has no C for these functions
  (searched by their SE ids and constants).
- ASSUMED: the cloud on the Merillia's position (the exe uses a model node),
  one 6x2C per dance (the exe re-imposes it each frame), flat ground for the
  Dolmolm's height test, a player hit radius of 5 for the back step's end.

**Checks:** `node tests/enemyfsmep2.test.ts` (new), enemyfsm / caves /
mines / ruins / combat / enemystatus tests, client `tsc --noEmit`. Not
checked in Chrome (to do: an Episode 2 game in the Online tab, Warp to
Jungle / Seabed).
## 2026-10-19: Vol Opt's seal door shape motion; indirect objects (map_*i.bin)

**What changed:** Ninja shape motions (`.njs`, NSSM chunks) are decoded and
played. Vol Opt's seal door (TODoorVoShip) now draws its door model with the
`.njs` vertex keys at the frame of its node motion, as the exe does, so the
door's 48-vertex part moves through its five keys in a 30-frame loop. For water
and the other indirect objects, `map_*i.bin` is parsed and used the way the
exe's map loader uses it. An indirect entry is drawn only when the table has
its id. The distortion itself turned out to be dead code in the PC client, so
those models stay plain. Code: `formats/njshape.ts`, `render/shapeanim.ts`,
`formats/indirect.ts` (new), `render/njcmmesh.ts`, `render/enemymodel.ts`,
`render/objectview.ts`, `formats/objectmodels.ts`, `render/mapviewer.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **Door draw** (render 0x00622358, vtable 0x00b27fc0): the door calls
  NJCM_SetMinimapRenderStates_008304e0(+0x34 model 1, +0xbc motion 0, +0xd0
  motion 1 = `fe_obj_fuuin_doa.njs`, +0xb0 frame). That is njDrawShapeMotion:
  the shape plays at the node motion's frame. That frame grows by +0xb8 = 1.0
  a tick and wraps at the last frame (update 0x006224a4 -> 0x0061347c). The
  door part is `shape: 1` in its object spec.
- **Shape format** (NJCM_RenderModelRecursive_0084785c,
  NJCM_SetMinimapMeshData_00830508, MinimapMeshContext_InitBuffers_00847830):
  NJS_MOTION with type 0x10 vertices / 0x20 normals, N = inp_fn & 0x3f lists
  per record. Every node without eval flag 0x80 (SHAPE_SKIP) takes the next
  record (NJCM_FinishMeshContext_00830568 / NJCM_RenderMeshContext_00830558),
  whether or not it has a mesh. A key is u32 frame plus a pointer to one
  f32[3] per vertex.
- **Interpolation** (NJCM_BeginMinimapMeshContext_008473ec,
  NJM_InterpolateKeyframes_008474b8): only vertex chunk types 0x22..0x24 and
  0x29..0x2c take positions, and the key array runs on across the node's
  chunks. Types 0x29..0x2c also take normals. NJM_FindKeyframeInterval_0084ae50
  picks the keys: the integer frame (truncated) selects A by binary search, B
  is the next key or, past the last one, the first key. t = (frame - A) /
  (B - A), or frame - A when B is not after A. value = B * t + A * (1 - t).
- **Data**: seven `.njs` in data.gsl (the door, `fs_obj_kurage`, three
  Episode 4 plants, the move / wait bodies of `bm4_ps_ma_body`). All of them
  parse, and their key arrays tile the file for one of their BML's models.
  The door's: 30 frames, type 0x30, the root unshaped, node 1 keys at
  0/7/14/21/29 with 48 vertices (type 0x23 chunk) and no normal keys.
- **Render**: NjcmModelBuilder keeps, on request, the source node and shape
  index of every output vertex (unweighted chunks). ShapeAnimator writes the
  sampled keys through each node's bind-pose matrix into the skinned mesh's
  positions (and normals), and NodeAnimator.onFrame drives it with the same
  frame.
- **i.bin** (load_map_data, "i.bin" 0x0097f268 at 0x0080b74d, then
  ReverseTamEndianness_0080a60c): "ind0", u32 BE count, 8-byte rows of u16 BE
  id, stage, b3, indinfo index. MapGeometry_InitializeMeshTrees_0080a650
  gives each 0x200 entry whose id has a row an IndTexObject
  (IndTexObject_Constructor_00504b58), stored in the record's empty mesh slot.
  The record also gets +8 = {0,1,2}[stage] (0x0097f11c), +0x0E = b3 and
  +0x0F = the indinfo index.
- **Draw gate**: map_nrel_process_chunk_static_meshes draws a static 0x200
  entry without 0x80 / 0x400 only when that slot is set (0x80 draws plainly,
  0x400 only calls the no-op GameCube hook). The animated loops of
  render_map_geometry_ need the slot for every 0x200 entry. Without an i.bin,
  no slot is set.
- **Why there is no distortion**: ConfigureIndTexStageForMesh_00504c04 would
  put an IndTex generator's 64x64 du/dv texture (`indirect.dat`: 12 XVR
  textures whose low 5 bits become V8U8 du = dv; `indinfo.dat`: 64 rows of
  mode / amplitudes / scroll / texture) on stage 0, with BUMPENVMAT00 / 01 =
  1.0 and pixel shader 0. It only looks for generators in
  g_IndTexActiveList_00a72b10, and nothing adds one: the list and its count
  0x00a72b0c are only cleared (0x005036c8, ResetIndirectTexState_00504cd0),
  and the call in the IndTexObject constructor (0x00504bc4) has an empty
  body. The JP build matches (objdump of psobb-client-source's PsoBB.exe:
  constructor at 0x00504baa calls the empty 0x00504bd0, list 0x00a70690 /
  count 0x00a7068c only read or cleared). The JP decompilation has none of
  these functions yet.

**Checks:** `tests/njshape.test.ts` (key picking, all seven `.njs`, the door
layout, and the built door's vertices following the keys at frames 7 and
18.5) and `tests/indirect.test.ts` (all 17 `i.bin`, the draw rule, and 16 maps
/ 571 drawn indirect entries that all keep their row, so nothing that was
drawn before is hidden). formats, motions, traps, enemies and waves tests;
client `tsc --noEmit`. No Chrome check (not requested here).

**Assumed:** the web client samples the shape at its smoothed frame between
ticks, while the exe draws at the tick's frame. Weighted (NF) vertices are left
unshaped, because none of the seven files shapes one that we draw.
CheckFrustumIntersectionResult_0078b208() < 3, the condition for loading
`i.bin`, is taken as always true. Animated indirect entries with 0x400 stay
hidden as before (the animated loop has no 0x400 branch, but no map has
one).
## 2026-10-19: title and login screens follow the exe

**What changed:** the classic title is now the exe's title scene instead of a
static menu. It fades in from black, takes keys only after the fade, shows
"PRESS ENTER KEY" until Enter opens the "Login" menu, and fades out before
the next scene. The Login menu has the exe's rows, greying and initial
cursor. Register UserID opens the Input UserID window over it, with inline
text editors. Start Game connects under the "Connecting.." object, and an
error waits for Enter. The logic is pure (`classic/titleflow.ts`) and tested.
`TITLE_TUNING` is gone.

**Details (Ephinea `PsoBB.exe`):**
- Title constructor (`construct_mainmenu_stuff`, the DEVLOG's `FUN_006f8130`):
  - the menu child ("Sinowberill" entity, update `0x006fed04`) starts with
    flag 4, so it is not updated;
  - a fade-in object (`SinowbeatConstructor_007889b0`) starts at 255 and
    adds -8 per frame (`0x0097a724`) until <= 0. That takes 32 frames. Its
    callback `DisableMainGameMenu_006fb7e4` clears flag 4.
- Menu child state 0 (`0x006fede0`):
  - Alt+Backspace exits the game;
  - Enter with no window creates the Login menu (`0x007617e8`);
  - the cancel slot (`0xd`) destroys the window, whatever sub-window is up;
  - window flags: 1 = Start Game / Patch Download (SE `0x420`, state 2),
    4 = Exit Game (fade-out with the exit callback, state 3), 8 = closed.
- "PRESS ENTER KEY":
  - alpha (`+0x28`) = (sin(3° · (counter % 120)) + 1) / 2, with constants
    `0x0096e424..30` (2, 1, 360, 65536 BAMS);
  - it starts at 0, so the text appears with the first update after the
    fade;
  - it is drawn in state 0 only (`PrepareUIRenderState_006ff0d4`), and so
    stays under the open window.
- Fade-out: in state 2, `MainGameMenu_ProcessLoadingState_006f8464` creates
  `LoadingScreenObject_Constructor_00788938`. It counts 0 → 255 by +8
  (`0x0097a730`, max `0x0097a72c`), which also takes 32 frames. Both fades
  draw a black 640×480 quad at z -10 (`DrawUIElementTriangleFan_00788820`).
- Login menu (`create_main_menu_list_items`):
  - position (210, 300). It is 330 when `SinowberillInit_006fb914` loaded
    `TitleEP4.prs`, which happens when `get_game_version()` sees an
    "Episode4" AccountCtrl registry value. `?ep4` selects that variant;
    the default `title.prs` is what the psobb.io captures show;
  - rows 41/3..6 and the account line "[%s]" (`0x00974ebc`) or 41/7 "Empty"
    (flags 9, `0xffffcc33`);
  - Start Game is greyed (`0xff909090`, row flag `0x10`,
    `ListWindowObject_SetItemHighlight_0073662c`) until both fields are set;
  - the cursor starts on Register UserID when either field is empty;
  - the user name is stored lower case (`0x00761d94` state 4).
- Exit Game asks 41/12 "Really OK?" at (400, 350), width 150
  (`0x00974e3c`), with the cursor on No.
- Input UserID (`0x00762224`, update `0x0076253c`):
  - window (140, 330, 360, 100);
  - the editors (`TKeyboardControl`) sit on the value column at (316, 346)
    and (316, 366). The row's own value is blanked while editing;
  - the user name loses its spaces and is at most 16 characters
    (`0x00762d2c`). The password is at most 16 (`0x00762d00`) and is drawn
    as '*' (editor flag `0x2000`);
  - the mask after an entry is up to 31 '*', and 8 after a cancelled edit;
  - Confirm is greyed until both fields are set; then the cursor moves to
    it (`0x00762b14`);
  - the caret is a 5×14 block (`0x00970fd4`/`d0`), green `0x8000ff00` /
    `0x4000ff00` (`0x00970f68`), switching on frame bit `0x10`
    (`TextInputCursor_Render_007307a8`).
- "Connecting..":
  - state 3 shows the status text at (23, 331) and waits for confirm or
    cancel (`GameListMenuObjectStateMachine`);
  - the text position and the group `0x36` lookups are confirmed in
    psobb-client-source `src/FUN_004080fb.c`, `FUN_00408118.c` and
    `FUN_00408152.c`;
  - the exe's texts are Xbox Live leftovers, so the bridge's error message
    is shown instead.
  - The title and login functions themselves (0x006f…, 0x0076…) are not in
    psobb-client-source's `src/` yet, so those values come from the Ephinea
    dump and `tools/exedata.py`.
- The circle's widescreen compensation is `stage.aspectFix`. The hand-tuned
  1/1.2 was that value at 16:10.
- The psobb.io capture shows "Empty" with the cursor on an enabled Start
  Game. The stock exe cannot reach that state, so psobb.io's launcher
  changes the login. Here the exe wins.
- Dev aids:
  - `?screen=menu` and `?screen=input` open the windows;
  - `?screen=connecterror` shows the error state;
  - `?t=<seconds>` freezes the animation clock
    (`Stage.freezeTime`) for capture comparisons.

**Approximated:**
- the Yes/No window's placement under the question (the offsets at
  `0x0073cf10` are not traced);
- no text wipe on the Login/Input windows (only `WindowAnim` alpha and
  scale);
- the password is kept for the page only, not in storage as the registry
  does;
- Patch Download returns to the title;
- the login connection is assumed to run under the same "Connecting.."
  object as the game server;
- the title's idle counter (`+0x34` against a limit of 1200 or 800 frames at
  `+0x38`, `update_main_menus`) is not used.

**SSIM:** measured with `tools/compare.sh` against the psobb.io captures.
Renders come from headless Chrome through DevTools (1440×900 @2x, web
controls hidden).

| Screen | URL | SSIM | PSNR |
| --- | --- | --- | --- |
| Title + Login menu | `?screen=menu&t=30` (frame 900, circle angle 0) | 0.766 | 19.7 |
| Title, cursor state of the capture | same, cursor forced to Start Game | 0.771 | 20.0 |
| Login menu region (412×250 at 514,538) | same | 0.745 | 17.5 |
| Logo region (1440×480 at 0,114) | `?screen=menu&t=30` | 0.719 | 19.0 |
| Select character | `?screen=select`, 10 s | 0.915 | 24.5 |

- A frame sweep of the title (t = 0..60 s) stays between 0.750 and 0.766,
  so the remaining gap is not timing. It is the font rasterisation and the
  light beam / circle glow.
- No capture of character creation (DEVLOG's "capture 04") or of Input
  UserID is on disk, so those two screens are not measured.

**Checks:** `tests/titlescreen.test.ts` (56 checks: fades, press alpha,
fade-in gating, menu rows / greying / cursor, editors, masks, the full
Register → Start Game → fade-out flow, Exit Game);
`tests/windowanim.test.ts`; client `tsc --noEmit`.
## 2026-10-19: Pan Arms / slime split fixes (review and Chrome)

**What changed:** fixes from the review of the splitters and from Chrome.
Pan Arms now leaves the ground the way the exe does. Hidoom and Migium are
drawn once they split. Splitter children no longer send a 6x76 of their own.

**Details:**
- Buried Pan Arms (update `0x0058106c`, init `0x00583d48`): the iparam2
  timer counts down. While it lasts, a player within iparam1 raises Pan Arms
  facing that player. When it runs out, Pan Arms rises anyway (iparam2 0:
  the first frame). Going back under also returns it to its spawn point.
  `combat` logs "emerges".
- `PanHalfAi` reports `hidden` on every frame, so a split half is drawn.
- `untargetable` getters (Pan Arms buried / emerging / split, a hidden half,
  a puddle slime, the control) feed `concealed()`. These enemies are left
  out of the radar, lock-on, weapon / technique targets and confused targets.
- Pan Arms splits only when both halves were built; otherwise the floor
  log says so.
- If the first slime cannot be built, the control's done path runs: 6x76 and
  removal.
- Child kills: a half's death (`0x00587720`) and a slime's (`0x00598648`)
  only call `on_enemy_killed` (`0x00787534`: EXP and the drop request). The
  6x76 (`set_monster_spawn_initdata_as_dead`, `0x008113e4`) comes from Pan
  Arms (`0x00583a80`, or `0x005822e4` when both halves die) and from the
  slime control (`0x005956d4`). So `killEnemy` no longer sends 6x76 for
  halves and slimes.
- HP, checked in the dump: a half gets `(HP + 1) / 2` truncated
  (`0x00587a04`). The merge sets HP to the plain sum of the halves
  (`0x00582ab8` / `0x005822e4`), with no clamp to Pan Arms's max.
- Multiplayer: a split builds the copy locally (`0x00597914` -> `0x00595bc8`
  -> `0x00595d74`) and sends no subcommand. Each client's control watches
  its own slots. This client sends the control's 6x76 only for its own kill.
- `render/waves.ts` `killedSetEntry` (moved out of `gamefield.ts`): a
  child-slot 6x76 is ignored only for sets whose children die on their own,
  each sending its own 6x76: Monest / Mothmant (`MothmanProcessState_0051950c`
  calls it), slimes, Pan Arms, Bulclaw. Boss parts and forms (De Rol Le, Vol
  Opt, Dark Falz, ...) keep the old rule (any slot clears the entry): not
  every one of their set-dead calls was traced to its slot.

**Checks:** `tests/enemysplits.test.ts` (the timer rule, no split without
halves, a drawn half), `tests/waves.test.ts` (the 6x76 guard), every other
unit test; client `tsc --noEmit`.

## 2026-10-19: Pan Arms and Pofuilly Slime splits

**What changed:** the two Caves enemies that split now fight. Pan Arms
rises from the ground and walks side to side. It fires shockwaves and bolt
volleys. At a third of its HP, or after three walks, it splits into Hidoom and
Migium. The halves attack on their own and later walk back together to merge.
A Pofuilly Slime crawls as a puddle, rises next to a player, spits or reaches
with an arm, and melts away after every hit. A special attack or Gibarta /
Rabarta throws out a copy, up to four slimes per set.

**Details:**
- `combat/enemysplits.ts` (new): `PanArmsAi`, `PanHalfAi`, `PanArmsShot`,
  `SlimeAi`, `SlimeSpit`, `SlimeArm`, `SlimeControl`, from a headless
  decompile of the Ephinea exe: Pan Arms ctor `0x00582ef4` / states
  `0x009bf2e0`, the halves `0x00586bf8` / `0x009bf580`, the slime
  `0x00596000` / `0x009bfc00` and its control `0x005959fc`, the split hooks
  `0x00597914` (a hit of attack type 2) and `0x005987c8` (technique group 2).
  Motion tables `0x009bf220`, `0x009bf440`, `0x009bf4e0` and `0x009bfc80`
  and the slime constants come from `tools/exedata.py`. Neither family is in
  psobb-client-source, so nothing could be checked against the matching C.
- `render/combat.ts`: on each floor, Hidoom and Migium are spawned hidden into
  Pan Arms + 1 / + 2 (models 1 / 2 of its BML), and the first slime into its
  control's slot + 1. While Pan Arms is split, its HP is the sum of the
  halves' HP. If both halves die, Pan Arms sends only 6x76 (no drop, no EXP).
  A merged kill drops the hidden halves. The slime split is hooked after
  `specialHit` and in `techHitEnemy` (Gibarta / Rabarta). It only happens
  when the hit landed (the slime's hit counter went up). The control sends
  the set's 6x76 when its last slime dies. Migium's Jellen / Zalure reach
  the player through `applySelfBuff`. Hidden splitters are skipped by
  lock-on, weapon and technique targeting, confused enemies and the radar.
- `render/gamefield.ts` `killEntity`: a 6x76 on a child slot (a Claw, a half,
  a split slime, a Mothmant) no longer marks the whole set entry dead and
  hides its model; only the entry's first slot does.
- ASSUMED: the slime's puddle morphs (7 / 8) are drawn as no body, and the
  flags `0xa000528` mean untargetable. Also ASSUMED: the emerge / burrow
  morph lengths, the thrown hop, the arm's hit as a plain melee hit, and the
  halves' front death motion. Only the local client splits a slime (another
  client's 6x0A does not carry the attack type).

**Checks:** `tests/enemysplits.test.ts` (new); every other unit test passes
(newserv-backed ones run against the main checkout's vendor/). Client
`tsc --noEmit` passes. Not checked in Chrome.

## 2026-10-19: Quest Board review fixes

**What changed:** fixes from the review of the Quest Board window. An item's
thread that shows a `list` or the board text while the main menu is open now
gets its keys. One Enter moves on only what was waiting. Only the board text
is drawn above the field HUD.

**Details:**
- While the item's thread runs, the board (locked, state 4: cancel ignored as
  in the exe) hands every key to the quest overlay (`QuestUi.menuKey`,
  through `GameView.questKey` / `FieldHud` `questKey`). The overlay's lists
  take the arrows / Enter / cancel. The board text takes Enter on both VMs. A
  balloon or `window_msg` does not take Enter while the menu is open: both
  runners check `is_menu_open` first in `window_msg__message__chat_box`, so
  it moves on once Home closes the menu. That is the way out.
- `QuestUi.onAdvance` now says what waited (`{ message, board }`). Town
  dismisses only that kind, on both VMs.
- The board text has its own canvas at `QUEST_LAYER`. Balloons, windows and
  lists stay on the overlay canvas under the HUD as before. The board text is
  a list window created while the Quest Board window is up, so it is drawn
  over it.
- Checked in the exe: `opcode_disp_msg_qb` itself sets
  `quest_thread_yield_reason = disp_msg_qb__add_msg` (not only `add_msg`), so
  its wait stays.
- `opcode_close_msg_qb` and `ResetQuestDialogState_006b0ba4` only close the
  windows. A thread in that yield keeps waiting for the decide key (the
  runners read the key alone), so the VM does not release it there. Enter
  still reaches it: the overlay's board wait follows `vm.boardWaiting` each
  tick, not the window. With the text closed, a later `add_msg` speaks as a
  `message` (`opcode_add_msg`).

**Checks:** `tests/questboard.test.ts` (keys forwarded while locked, the
wait surviving a reset), quests, questflow, fieldhud, minimap tests; client
`tsc --noEmit`.

## 2026-10-19: Episode 1 bosses' children from the exe

**What changed:** Vol Opt's lightning rod plays its own motion
(`fs_obj_hiraishin_a`) instead of its bind pose and is no longer built in
Ultimate; Vol Opt's core and De Rol Le's eight stings (5 + 3, was one "mine")
are built hidden as the exe creates them; De Rol Le's sting attack placement
(launch frame, the five floor points, the ring around the target) is decoded
into tested pure functions. There is still no boss fight state machine in the
repo, so nothing moves the children yet: at spawn the exe parks every one of
them (hidden here). Code: `formats/enemymodels.ts`, `tests/bossrooms.test.ts`.

**Details:**
- Vol Opt lightning rod: ctor `0x00440ad8` (only while
  `g_VoloptDifficultyMode` = `is_ultimate_mode()` is 0) at
  (`g_VoloptForm2Config`, 80.0, `g_VoloptForm2ConfigValue`) = (0, 80, 0); stat
  init `0x004413a4`: model `+0x108` = entry 16, motion table `0x009a4f00`
  slot 0 = motion 6 at 0.7.
- Vol Opt core (id base+0x22, init `0x00440458`): model `+0x188` = entry 24
  (`me5_y_all`), table `0x009a4e40` slot 0 = motion 14 (`wait_me5_y_all`),
  0.7; flag `0x10000` of `+0x390` makes `RenderVoloptModel` squash it to 0.05
  in z inside the monitor the fight picks, so it has no spawn place.
- De Rol Le ctor `0x0042ad4c`: 10 segment children (`0x004351c4`, no model,
  slots at `+0x548` parked at 10000.0), 5 kind-0 stings (`0x004369bc`) and 3
  kind-1 stings (`0x004370b4`), all model 3 with the body's texture list
  (`DerolleInitialize_00437368`), plus 4 ceiling rocks (`0x00437ba4`).
  1 + 10 + 8 = newserv's 0x13 ids.
- Sting attack (`HandleDerolleAction_0042e824` action 0): past frame 18.0 the
  boss throws from `+0x4d8` and plays sound `0x32a`. Motion 0x18 sends the 5
  kind-0 stings (`0x00436a50`) to `0x008fcc88` = (0,0,0), (±45, 0, ±30),
  copied by the static init `0x004343c4` through `0x00782bb0` (floor probe
  from 20.0 above, mask `0x16ef`), 1.0 above the floor. Other motions send the
  3 kind-1 stings (`0x00437190`) to the target + (sin, cos)(i·`0x5555`)·20.0,
  17.0 up (`0x00a43db4`, set at `0x004372ee`), pitch `0x4000`, yaw
  `0x8000` / `0x6800` / `0x9800`; `0x00436e08` follows the target.
- Dark Falz form 3 (`0x0045e4f0` → `0x0045e5a0`) starts at `0x00a458fc` =
  (10000, −10, 0) (static init at `0x0045ec81`): off the arena until the fight
  moves it. The Dragon (`0x00419214`) creates no drawn child (hitbox list
  `0x004269f8`, ground follower `0x00427984`).

**Checks:** `node tests/bossrooms.test.ts` (Vol Opt rod / core / Ultimate set,
De Rol Le stings and their placement, Dark Falz and Dragon part counts),
`node tests/enemies.test.ts` (every enemy built, 139 models),
`node tests/combat.test.ts`, `tests/enemyfsm*.test.ts`, client
`tsc --noEmit`.

## 2026-10-19: Touch pad clear of the HUD, fullscreen / shortcut fixes

**What changed:** the touch pad no longer covers the game's HUD. The action
palette's own slot icons are now its attack buttons (tap the left / middle /
right icon = that slot's key, the Ctrl tab = palette change); the arrow
diamond and OK / BACK sit left of the palette, the stick takes the lower left
below the party window, and MENU / CHAT / fullscreen / mute line the top edge
between the status window and the radar. The overlay covers exactly the
canvas box (the Online tab's hint paragraph moved out of `#game-view`).
Code: `input/padlayout.ts` (new, pure), `ui/webcontrols.ts`,
`ui/webcontrols.css`, `ui/fullscreen.ts`, `input/virtualpad.ts`,
`index.html`, `ui/style.css`.

**Details:**
- `padLayout(width, height, insets)` works in the field HUD's space: scale =
  height / 480, `extra` = virtual width beyond 640, right-half windows shifted
  by it (classic/ingame.ts anchorX), with the exe's rectangles: palette
  (484, 368) 150x107 and its slot / Ctrl-tab offsets (classic/palette.ts),
  status (28, 37) 228x76 and party (30, 116) windows (classic/hud.ts), radar
  (480, 64) 128x128 (classic/minimap.ts), message window (373, 203) 255x120.
  The overlay takes the canvas's offsetLeft / offsetTop / client size like
  the HUD canvases, so the palette targets line up with the drawn icons.
- Fullscreen: a request with no answer (prefixed `webkitRequestFullscreen`
  returns nothing and may refuse silently) falls back to the CSS mode after
  1.5 s; toggling while a request is pending cancels it; a late
  `fullscreenchange` undoes the fallback. The controller removes its document
  listeners on dispose.
- Shortcuts: Alt+Enter only toggles fullscreen while the game view is on
  screen (or to leave it); the keyup of a swallowed Enter / M is swallowed even
  when Alt is released first; a plain Alt keydown is echoed at the window so
  the audio modules' first-keydown unlock still runs.
- While the pad is shown the canvas gets `touch-action: none` (a page pan
  sent pointercancel to the stick).
- On-screen keyboard proxy: text is read only when IME composition ends
  (Android keyboards).

**Checks:** `node tests/mobilecontrols.test.ts` (layout clear of every HUD
window at six canvas sizes, palette targets inside the palette, safe-area
insets, shortcut matching incl. Alt+F1..F12, swallowed keyup, IME guard,
fullscreen timeout / cancel / late enter), `controls`, `fieldhud`, `sound`,
`minimap` tests, client `tsc --noEmit`, `vite build`. Chrome: pending on the
main thread.

## 2026-10-19: Quest Board window from the main menu

**What changed:** the quest board opens the way the exe opens it: field main
menu > Item Pack > Quest Board (menu id 0xF of the Item Pack table
`0x009f2f80`, enabled only while a quest runs: `g_QuestStarted`, the view's
running quest). The temporary B key and its DOM list are gone. The window is
`classic/questboard.ts` (`ChallengePlayerListWindow_Constructor_00754294` and
its list window `create_quest_board_hud_menu`), opened and closed by
`classic/fieldmenu.ts` like the Area Map, drawn on the field HUD canvas.
`disp_msg_qb` / `add_msg` on the board text now wait for the decide key, as
in the exe, and a board item's thread runs on the exe's second runner.

**Details:**
- `handle_player_menu_select` 0xF builds the owner object, which sets HUD
  flag 0x10 (the status window closes, `STATUS_HIDING_FLAGS`); its destructor
  (`ChallengePlayerListWindow_Destructor_007541f8`) clears it. The list window:
  GUI 0x73 = (13, 256), template `0x009f4684` = 434 x 184, flags 3 (SE 0x572 /
  0x573), title unitxt 11/0x3E, elements `0x009f4520` relative to the content
  (window + 10, `UiTextGeometryUpdate_0071b900`): the quest name centred on x
  204, y 6 (`0x00973f84` -0.5, `0x00973f88` 204); the selected item's name
  right-aligned on x 379, y 53 (`QuestListWindow_SetSelectedText_00754954`,
  `0x00973f78`); six 56 x 56 images of f256_hyouji texture 2 texel (151, 0)
  at x 33, 97, 161, 225, 289, 386, y 91, shown when the slot's register
  (r74 + slot, `get_quest_board_slot_enabled_007544d0`: != 0, not == 1) is set
  at open. They grow from their centre with the opening wipe
  (`unknown_render_sdjz_hud_icons`: reveal / (w * 3.5), capped at 0.5).
- Selection (+0x61): the next set slot, +1 with 7 wrapping to 1 over slots
  0..6 (r80 counts for the selection but has no image); re-run every frame
  while the selected slot is not set. No set slot at open = bit 4: no name,
  no decide. Keys (`QuestListWindowUpdate_0075472c`): Left / Right SE 0x56F,
  -1 / +1 over 0..5 wrapping to set slots; decide SE 0x570
  (`QuestListWindow_ConfirmSelection_00754998`); cancel SE 0x585
  (`GuildCardListWindow_Cancel_0074943c`).
- Owner states (`ChallengePlayerListWindow_Process_00754380`): cancel hands
  the keys back to the menu (same entry) and the window closes with its
  animation; decide starts the item's label with `CreateQuestThread_006bcdec`
  (QuestThread3, `quest_run_thread_2`) and the board takes no keys until that
  thread ends. Enter meanwhile goes to the VM (`dismissBoard`).
- Drawing (`GuildCardSearchWindow_Render_007549c8`): frame, title, then while
  the counter c >= 0 the cursor (`ChatShortcutMenuWindow_RenderButtonBackground
  _0075afb8`: four 12 x 12 corners of texture 2 from texel (223, 0), pulled in
  by (frame & 15) * 0.3) and an 0xFF7E00 line strip from the slot (+28, +7:
  `0x00973f64` / `0x00973f60`) to the name's x, y + 20 (`0x00973f5c`) and
  along under it, both fading in over 6 frames (`0x00973f6c`); then the
  elements, texts under the wipe.
- Board text: `opcode_disp_msg_qb` / `opcode_add_msg` set yield reason
  `disp_msg_qb__add_msg` (5), which waits for the decide key in both runners
  (q146 "Maximum Attack 4th Stage -1C-" shows "You currently cleared..." then
  "<r118> enemies." on its "Number of kills" item; before, it closed at once).
  In `quest_run_thread_2` the thread also ends, with the dialogs reset
  (`ResetQuestDialogState_006b0ba4`), once the player's UI no longer blocks
  input (`IsPlayerSlotUIBlockingInput_00716ba0`; here: the main menu closed).
  The text window stays on the quest overlay canvas, now above the field HUD
  (`QUEST_LAYER`), so it is drawn over the board.
- Left out / approximated: key 0x12's thread abort in the board-text wait
  (which key it is was not traced), the title's slide once open
  (`UIElement_AddFloatToOffset_00761388`), the board text window's width (sized
  to its text as before), the keyboard menu mode 6; a slot with no handler
  starts no thread (the exe would run its stale entry); where the exe would
  spin forever looking for a set slot, the selection stays.

**Checks:** `tests/questboard.test.ts` (menu rule, slots by register, keys,
SE ids, owner states, HUD flag 0x10, the menu path and its way back, q146's
board text wait and the runner 2 abort); quests, questflow, fieldhud, minimap,
options and windowanim tests; client `tsc --noEmit`.

## 2026-10-19: Fullscreen, mute and touch controls

**What changed:** three browser conveniences that are not in PsoBB.exe and do
not change how the game behaves. A small bar in the top-right corner of the
game view (Online tab lobby / game canvas, and the classic client) has a
fullscreen and a mute button. On touch screens an on-screen pad covers the
view: a floating stick on the left and, on the right, the arrow diamond (Up =
camera, Left / Down / Right = action palette slots; the same keys move menu
cursors), OK (Enter), BACK (Backspace), PAL (Ctrl), MENU (Home) and CHAT.
Code: `ui/webcontrols.ts` + `ui/webcontrols.css` (DOM overlay, shortcuts,
key feed), `input/virtualpad.ts` (pure pad logic), `ui/fullscreen.ts`
(fullscreen state machine), `audio/mute.ts` (master mute), wired from
`main.ts` and `classic/main.ts`; `audio/bgm.ts` and `audio/se.ts` connect
their output gain to the master mute node instead of `ctx.destination`.

**Details:**
- Shortcuts are read in the window capture phase and stopped there, so the
  game never sees them: Alt+Enter = fullscreen (F1..F12 are game keys, F11
  is the browser's), Alt+M = mute (a bare M would be typed into the canvas
  text inputs: login, character name, lobby chat).
- Fullscreen uses the Fullscreen API on the game view's container (the
  canvas plus its HUD overlays, not the side panels), with the webkit-prefixed
  calls. Where the API is missing (iPhone Safari) or the request is refused,
  the container fills the viewport with CSS instead. The renderer resizes
  through MapViewer's ResizeObserver (setSize, camera aspect,
  updateProjectionMatrix); the HUD overlays already re-read the canvas box and
  offset every frame, so their 640x480 mapping follows. Esc leaves through the
  `fullscreenchange` event.
- Mute ramps a master gain node on each AudioContext to 0 (contexts keep
  running, so BGM loop points are untouched) and is stored in localStorage
  (`psobb.muted`, every access in try/catch). Default: muted under the Vite
  dev server (`import.meta.env.DEV`), sound on in production builds; a stored
  choice wins over that default and `?sound=1` / `?sound=0` force it for one
  page load. The gain node is created with the resolved value before any
  source connects, so nothing blips at start. It is separate from the Options
  window, which has no volume settings because the exe has none.
- The pad feeds synthesized `KeyboardEvent`s (key and code from the default
  key config, `input/keyconfig.ts`) to the canvas the views listen on, so the
  held-key sets and keydown handlers are unchanged. Movement in this client is
  digital (W/A/S/D), so the stick is quantised to 8 directions with a 25%
  dead zone; there is no walk / run split. Held arrow buttons auto-repeat
  like a keyboard (400 ms, then every 80 ms, `repeat: true`). Each control
  tracks its own pointer (multi-touch), the overlay has `touch-action: none`,
  respects the safe-area insets (`viewport-fit=cover`) and releases every key
  on window blur. A tap on the stick zone is passed to the canvas as a click.
- Chat: on the Online tab the button leaves fullscreen if needed and focuses
  the chat field (opening the on-screen keyboard). In the classic client it
  presses Space (the lobby's chat line) and focuses a hidden proxy field whose
  typed text is forwarded as key presses; KEYS opens the proxy alone (login,
  character name).
- The pad shows on `(pointer: coarse)` or touch-capable browsers, and on the
  first touch; `?touch=1` / `?touch=0` force it.

**Checks:** `node tests/mobilecontrols.test.ts` (stick to keys, dead zone,
repeat, tap, keyboard proxy, mute persistence and default resolution,
fullscreen state machine), `controls`, `fieldhud`, `sound`, `options` tests,
client `tsc --noEmit`, `vite build`. Chrome desktop and mobile emulation:
pending on the main thread.

## 2026-10-19: No set-data markers in a game

**What changed:** the yellow / colored octahedra the map viewer draws for set
entries without a model no longer show in a game. In Pioneer 2 they sat in
front of the shop clerks and the nurse: those entries are TShopGenerator,
TObjLuker and TObjTradeCollision, logic-only objects the client never draws.
`render/gameview.ts` keeps the markers hidden unless the page is opened with
`?markers` (development aid); the Map viewer tab is unchanged.

**Checks:** Chrome, Pioneer 2 at the Medical Center counter: no markers, the
counter still opens.

## 2026-10-19: Pioneer 2 Medical Center counter

**What changed:** talking to the Medical Center nurse (`bb_p2_menu` 1) opens
the counter in the field HUD like the shops: the welcome line with the Money
window, then either "Well, you're completely fine now." or the 10-meseta offer
with Yes / No. Yes plays the treatment SE, sends `6x31`, `6x32` and `6xC5`,
refills HP and TP, clears the status effects and the technique effects and
takes 10 meseta; No says "be careful". Without 10 meseta it says "Not enough
Meseta...". A remote player's `6x31` puts their party window back at max HP.
Code: `classic/shop.ts` (`MedicalCounter`, `COUNTER_MENUS[1]`, a
Backspace-accepting wait in `CounterBase.read`), `combat/status.ts`
(`medicalNeeds`), `net/items.ts` (`useMedicalCenter`, `MEDICAL_COST`),
`render/combat.ts` (`medicalNeeds`, `medicalTreatment`), `render/gameview.ts`
(wiring), `combat/partyhp.ts` (`6x31`), `quest/town.ts` (comment).

**Details** (Ephinea `PsoBB.exe`):
- **Entry**: `p2_special_npc_menus` (0x009cf100) entry 1 = on_menu_open
  CreateMedicalCenterDialog_006d6c10 -> MedicalCenterDialog_Constructor_006cec20
  (vtable 0x00b3bf10), is-open GetMedicalCenterMenuState_006d6c04. The dump
  names many neighbours "MedicalCenter*" wrongly (0x006cafb8 is the Hunter's
  Guild); the addresses are what matter.
- **States** (update vtable +0x24 = 0x006ce9a4, jump table 0x0096bb18 on
  +0x20): 0 init (0x006ce7e4) -> 1 MedicalcenterDialog_EnterState2_006cef18
  (clerk window at GUI 0x2e, 80 high, line 0x1f, Money window) -> 2 0x006cebcc
  once the line is read: SinowberillChallengePlayer_GetStatusFlags_0068bfe0 == 0
  -> 6 (0x006cea8c, line 0x21), else 7 (0x006cea30, line 0x20 + Yes / No at
  GUI 0x2d) -> 3 (0x006ceb4c): Yes -> 4, No / Backspace -> 5 (0x006ceaa4, line
  0x24); 4 = HandleSeabedTuriganeChallengeAction_006ceabc: meseta < 10 -> line
  0x0f; else SE 0x41f, dispatch_action_0x31 / 0x32 (0x00688f70 / 0x00688fa0),
  SinowberillChallengePlayer_UpdateAudio_00688fd0 (particle + SE 0x41f at the
  player), subtract_inventory_meseta(10), 6xC5 (0x0069208c), line 0x22; 5 / 6
  -> 8 (0x006ce9fc): once read, line 0x22 -> 10 (vtable +0x2c, 0x006ce564):
  closes on Enter or Backspace (MedicalCenterDialog_CheckMenuInput_006dc8fc).
  Lines are unitxt_shop group 0.
- **Cost**: a flat 10 (the `cmp eax, 0xa` at 0x006ceacb and `push 0xa` at
  0x006ceb1a); no level dependency. newserv `on_medical_center_bb` removes 10
  meseta on 6xC5.
- **Needs** (0x0068bfe0): bit 1 HP < max HP (+0x334 / +0x2bc), bit 2 TP < max
  TP (+0x336 / +0x2be), bit 4 flags +0x30 & 0x3f, Jellen (+0x274 == 0xb) or
  Zalure (+0x280 == 0xc).
- **Commands**: all three are `{sub, 1, client id}` via 60. Subcommand table
  0x00a0fba0: 6x31 -> 0x00690360 -> Player_DisableMovement_0068fd74 =
  PlayerRestoreHealthAndTP_0068fda4 (hp = max, tp = max), player vtable +0xe4
  = Enemy_ClearStatusEffectsAndForces_0077962c (both status slots, both
  technique slots), flags & 0xfffff1ff; it runs locally too
  (checked_call_packet0x60_subcommand). 6x32 -> 0x006903a0 revives players in
  state 3 (none on the local side). 6xC5 has no client handler.

**Verified:** `tests/medical.test.ts` (fee, needs bits, every flow by keys,
6x31 / 6x32 / 6xC5 bytes and order, remote 6x31 on the party HP),
`tests/shop.test.ts`, `tests/tekker.test.ts`, `tests/fieldhud.test.ts`,
`tests/status.test.ts`, `tests/party.test.ts`, `tests/npcs.test.ts` (the area
script reaches menu 1), client typecheck. Not checked in Chrome in this
change.

**Left out / assumed:** the camera move to the nurse
(move_camera_to_p2_special_npc), the treatment particle
(SpawnParticleEffectForEntity_006a3720), the challenge-mode branch
(0x00695388 / 0x006953f0 / 0x00695420); the two SE 0x41f plays share a slot,
so one is played. The giveaway counter (`bb_p2_menu` 8,
MedicalCenterDialog_Constructor_006ca84c) is the quest item exchange counter
(quest data +0x42c tables, unitxt_shop 0x4e..0x57, server answers): not cheap,
left for later.

## 2026-10-19: Options window from the exe

**What changed:** Main menu > Options (id 6) now opens the exe's Options
window, both in the field and in the classic lobby. It has the ten rows the
client lists, with labels from unitxt. Deciding a row opens its settings
window with the current value marked. The chosen value goes into the
session's option word (character `+0x4EC`), and when the window closes the
client sends the word to the server with `01ED`.
- Message Speed is the speed of the list windows' animation
  (`classic/windowanim.ts`).
- Cursor Position switches the main menu's cursor memory per level.
- Brightness is applied as the exe's gamma offset and kept in localStorage
  (the registry in the exe).
- The exe has no sound or BGM volume option here.

Code: `classic/options.ts` (new), `classic/mainmenu.ts` (cursor memory),
`classic/fieldmenu.ts`, `classic/lobby.ts`, `classic/main.ts`,
`render/fieldhud.ts`, `render/gameview.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **Window:** handle_player_menu_select case options_menu →
  ChallengePlayerListWindow_Initialize_007536f4 (vtable 0x00b42598, states in
  ChallengePlayerListWindow_Process_007538ec).
  - The option list (create_list_items_for_menu_options) is a titled list
    window (CreateListWindowObject_0073566c) at entry 0x16 = (13, 256),
    195 wide (`UpdateScrollPosition_00736138(195.0)`), titled 11/0x3D
    "Options", with items centred.
  - Rows (value: label): 0 Map Direction 11/0x79, 1 Function Key Setting
    0/6, 2 Keyboard Controls 0/9, 3 Mouse Controls 0/10, 4 Pad Button Config
    0/0x11 (greyed with no pad, `AddListItem_00735ee0`), 5 Keyboard Config
    0/0, 6 Cursor Position 11/0x7B, 7 Message Speed 11/0x7C, 9 Auto
    Disconnect 11/0x81, 10 Brightness 11/0x82. Value 8 (Vibration) has a
    settings case but no row.
- **Settings window** (ChallengePlayerListWindow_CreateSettingsMenu_00753d84):
  the Ship Select list window class (CreatePlayerListObject_00714ac8 →
  0x00736988, vtable 0x00b3f4f0) at entry 0x17 = (210, 256), 302 × 148
  (0x00973f18), titled with the row label.
  - Cursor and chosen value (+0x88 / +0x94) start on the current setting
    (`ChatShortcutMenuListWindow_Update_00714e5c`).
  - Each item draws icon +0x1D of `f256_hyouji` texture 1 (0x00970b40):
    0x14 on the chosen value, 0x15 on the others (ListWindowObject_SetText
    _0072c548, ResetListItems_007379e4). The item x is −18 (0xc1900000) and
    three 18 px icon slots precede the text (BaseEntity_Render_0072ae74), so
    the icon sits where Ship Select's text starts and the text is 18 px right.
  - Keys (ChatShortcutMenuYesNoWindow_Update_00714ba8): up / down wrap
    (SE 0x56F); Decide makes the cursor the chosen value (SE 0x570, flags 6);
    Cancel closes unchanged (SE 0x585).
- **Option word** (ApplySelectedSetting_00753c70 →
  SessionData_SetCharacterOptionBitfield_007be17c, `word & mask | value`):
  map direction 0x1 (Fixed / Non-fixed), function keys 0x2000000 (Menu /
  Chat Shortcuts), keyboard controls 0x1000000 (ON / OFF), mouse 0x700000
  >> 20 (OFF / DRAG / HOLD), cursor position 0x4 (Saved / Non-Saved),
  message speed 0x300 >> 8 (Slow / Normal / Fast / Very Fast), auto
  disconnect 0x1C00 >> 10 (15..60 minutes). Without session data the
  getters return 0, except the message speed (1, `_007be1d0`).
- **Brightness:** SetExternalSettingsFlag (0..4, above 3 → 4). On close,
  UpdateExternalSettings adds `{32, 16, 0, −16, −32}[i] << 8` (0x009006e0)
  to the 16-bit gamma ramp (UpdateGammaRamp_00837818), and
  ResetExternalSettings writes the registry. Here it is an SVG
  `feComponentTransfer` intercept on every canvas (a `canvas` style rule), assuming an identity ramp; a stored value that is not 0..4 falls back to Normal.
- **Save:** ChallengePlayerListWindow_Destructor_00753624 calls
  send_packet0xed_subcommand1 when a row was decided (+0x24). That sends
  `0C 00 ED 01 00 00 00 00` + u32 option_flags. newserv on_ED_BB 0x01ED
  stores it in the character file.
- **Cursor memory:** the main menu keeps {cursor, id, table} per level
  (+0x28 + level × 8, PlayerMenuWindow_SetItemState_00732910, written when an
  entry is chosen or a sub-menu is cancelled). When the menu or a sub-menu
  opens (ChallengeMenuObject_UpdateMenuIndexFromCharacterOption_007332f8),
  "Non-Saved" (bit 4) starts on the first entry. Otherwise
  PlayerMenuWindow_CheckItemState_00732514 restores the kept cursor when the
  level shows the same table.

**Left out:** Keyboard Config and Pad Button Config (the key config window,
the pad "Custom / Return to default" list and its 0xED subcommand 5) only
mark the window as changed. Map direction, function keys, keyboard / mouse
controls and auto disconnect are stored and saved, but nothing in the web
client reads them yet. The player status window takes the message speed when
the floor is attached.

**Checks:** `tests/options.test.ts` (new: rows, labels against newserv's
bb-v4 unitxt, bit packing, `01ED` payload, settings keys, brightness offsets,
cursor memory); `tests/windowanim.test.ts`, `tests/fieldhud.test.ts`,
`tests/sound.test.ts` and the client typecheck pass.

## 2026-10-19: Radar minimap and the Area Map window

**What changed:** the field HUD has the radar in the top-right corner and
Item Pack > Area Map opens the full map. The rooms come from the floor's
`map_*r.rel` and appear (fading in) as the player discovers them; the
discovered rooms are kept per floor for the whole game. The radar shows the
player markers in the slot colours, the other players on the floor, the live
enemies as orange discs and the compass; it turns with the camera when the
character's option bit 0 is set. The Area Map window (610 x 188 at (13, 256),
titled with the area name) shows the full map in its 448 x 128 strip: the
arrows pan, Shift / Ctrl zoom, the left mouse button drags, and while it is
up the status window closes (HUD flag bit 1). Code: `formats/minimap.ts`,
`classic/minimap.ts`, `classic/areamap.ts` (new), `render/minimap.ts` (new),
`classic/fieldmenu.ts` (menu id 0xC), `classic/hud.ts` (status window flags),
`render/fieldhud.ts`, `render/playerhud.ts`, `render/gameview.ts`,
`render/combat.ts` (enemy positions), `formats/njcm.ts` (`parseNjcmModel`).

**Details** (Ephinea `PsoBB.exe`):
- **Data** (load_minimap_data): asset prefix + `r.rel`; root {rooms, njtl,
  count}; room 0x28 bytes {i16 section, u16 flags (1 undiscovered, 2 held by
  a TObjRaderCol, 4 alternate mesh), xyz, BAMS rotation, alpha, discovery
  radius, mesh container} with an NJS_CNK_MODEL of flat plates. The flags of
  a floor are saved when it unloads (uninit_minimap_data,
  floor_minimap_room_flags) and restored on the next visit; the first visit
  marks every room undiscovered.
- **Object** (Minimap_CreateObject_00804d94): minimap_type 0, camera slots
  at 0x00aafb00 (eye height 2000 = 0x00a11460, look (0, -1, 0), yaw 0x8000),
  a 60-frame wait (+0x90), room alpha cap 0.8 (+0x1a0), height step 80
  (0x00a11444, x1.2 a frame toward 2000 / 3500 / 1200 by zoom mode).
- **Update** (unknown_minimap_update): markers (unknown_minimap_update
  _players: colours 0x0097eaa0 red / green / yellow / blue, size 22.0 or
  15.4), the radar centre and yaw (update_minimap_center_rotation: 0x8000, 0
  on De Rol Le, 0x8000 - camera y_rotation when turning), discovery (XZ
  distance from room + mesh centre under the radius), the compass pulse
  (+0x888 BAMS a frame, alpha (sin + 1) * 64 + 127).
- **Render** (unknown_render_minimap): hidden while the menu is open unless
  the map is the full map; background alpha 64 (0x00a11418); viewport table
  0x00a11324: radar (544, 128) 128 x 128, full map (256, 352) 448 x 128;
  projection = the default perspective (0x3555, 57.5 degrees) scaled by the
  screen over the viewport (set_d3d_projection_matrix), so 4.57 units per
  pixel at height 2000; rooms in colour {1, 0.3, 0.3, 0.3} (0x00a11450) at
  their alpha (+0.08 a frame, 0x0097ec9c); icons within 300 units (90000,
  0x0097ecf8), shape 1 = obj_f_enemy disc x8, colour 0xffffa24c; markers =
  obj_f_player of obj_f_enemy.bml; compass sprites of RaderMapFrame.xvm at
  0x00a11390 / 0x00a11398 (MinimapRenderIcon_00804b24,
  RenderMinimapIcon_00819f7c): texture 1 (the pulse, own alpha) with
  unknown_set_blending_save = src alpha / 1 - src alpha, texture 0 (the
  needle, opaque on black) with unknown_renderstate_blend_save = src alpha /
  ONE, i.e. additive (blend codes 8 / 6 / 10 of
  d3d8Dev_SetRenderState_Src_Dest_Blend), which leaves its black ground out.
- **Area Map** (ChallengeMenuListWindow_*, 0x00743e00..0x007447c8): GUI
  position 0x5c, template 0x009f3c64; UpdateSelectionColor_007441a8 starts
  the full map once the window is open (centred on the player,
  Minimap_GetPlayerPosition2D_008054fc) and sets HUD flag bit 1, which
  closes the status window (HandleCancel_0071a838); HandleInput_00744230:
  speeds +-6 (0x00973278 / 0x00973274) from the arrows (z / x) and Shift /
  Ctrl (height; unitxt group 11 0x145 / 0x146), x -= vx, z -= vz (clamped
  to +-6000, the Wilds -3000..9000 / -9000..3000, none on Vol Opt, Dark
  Falz, Olga Flow, Tower: Minimap_ClampPlayerPosition_008058b4, table
  0x0097f040 type 8), height 1200..3500, speeds x0.8 (0x00973270); the left
  button (mask 4) grabs the map, pan = grab - 3.0 * mouse move (0x0097327c);
  only that press inside the window and its drag are kept from the view's
  own mouse handlers. Ctrl is also Action Palette Change, but
  HandlePlayerPaletteToggle_00694f0c returns while the menu is open.
  The destructor clears HUD flag bit 1 and minimap_type: a floor change
  closes the window for good (it does not restart the full map).
  Arrows from HUD texture 0 at (16, 346), (484, 346), (249, 272), (249,
  420) (RenderPhaseInfo_007445e4).
- **TObjRaderCol** (0x17, radar_collision_constructor /
  MapObjectRadarCollisionUpdateHandler_00663250): radius param1, room
  param4; holds the room (flag 2) on its first frame, reveals it when the
  local player comes within the radius after 3 frames.

**Performance:** the floor's rooms are one merged geometry (alpha per
vertex); the WebGL renderer has no antialias and no preserved buffer: each
render is copied into a 2D cache canvas in the same task, and a frame whose
camera, rooms, markers and icons did not change reuses the cache.

**Checks:** `tests/minimap.test.ts` (map_forest01r.rel: 17 rooms, room data,
triangles; fovy and units per pixel; pan clamps; discovery, fade, the
TObjRaderCol hold, per-floor persistence; icons; the Area Map window's
opening, pan / zoom speeds, drag and close; the status window closing on
flag bit 1; Item Pack > Area Map through the menu keys; closing it on a
floor change; saved flags per floor and file; a null rooms pointer);
`tests/fieldhud.test.ts`, `tests/windowanim.test.ts`, `tests/status.test.ts`,
`tests/formats.test.ts`; `tsc --noEmit`. Not checked in Chrome by this
change (the main thread runs the browser check).

**Assumed:** `SharedInputState_IsKeyPressed` is the held state (the speeds
grow while a key is down); the icon / marker colour replaces the models'
material colours, as the ground colour does for the rooms; the help texts are
placed from the window's position and fade in over the first 6 frames of the
full map, with the arrows; the radar is hidden while a warp menu, a counter
or an NPC talk has the input. Left out: TObjRaderHideCol, TObjRaderIcon and
the other objects' icons (doors, boxes, bosses), battle-mode team colours,
zoom modes 1 / 2 (nothing sets them in Blue Burst), the Challenge "Area n"
title. The saved room flags are keyed by floor and minimap file (the
client keys them by floor only; a quest can load another layout), and a saved
array whose length does not match is dropped.

**Compass needle on the overlay:** the exe draws texture 0 additively
(src alpha, dest ONE) on an opaque black ground. On the transparent 2D
overlay over the WebGL view a `'lighter'` composite adds the black's alpha
too and left a black square, so the loader now turns that texture's
brightness into alpha (`additiveAsAlpha` in `render/minimap.ts`) and the
needle is drawn with the normal blend. Checked in Chrome on Forest 1.

## 2026-10-18: Pillar traps (TOTrapAncient02 / 02R) and Vol Opt's seal door lamps

**What changed:** the pillar traps run their state machines: when a player
comes within the radius the pillar rises in two segments, then
TOTrapAncient02 holds the local player (`6x2C`, released with `6x2D` when the
hold time ends) and TOTrapAncient02R casts its technique at the target, then
both sink back. The model's nodes move as the exe draws them (root, child,
spinning part) and the area's trap SE plays. Vol Opt's seal door
(TODoorVoShip) now follows quest flags `0x2c`..`0x2f`: one lamp goes out per
flag, the lamps pulse, and `0x2f` removes the door and its collision. Code:
`render/traps.ts` (new), `render/gamefield.ts`, `render/fieldobjects.ts`,
`render/objectview.ts`, `render/combat.ts`, `net/game.ts` (`6x2D`).

**Details** (Ephinea `PsoBB.exe`):
- **Objects**: TOTrapAncient02 (0x0154, create 0x0063bfd4, ctor
  InitializeDerolleEnemyBase_0063c638, vtable 0x00b2d7c0) and 02R (0x0167,
  create 0x0063b4e8, ctor 0x0063b5b4, vtable 0x00b2d940). Radius param1 *
  0.5 + 30 (0x00934128 / 0x00934168, 0x00934160), hold time param4 + 30; 02R:
  switch flag param5 (0..0xFF), technique param6 (0 Foie, 1 Zonde, 2 Grants,
  3 Megid, 4 Gifoie), level round(1 + 2 * difficulty + param3) clamped to
  14 (29 in Ultimate) (0x0063bf48). Free-play maps only place 02R (VR Temple,
  Jungle, Seabed); 02 is quest-only.
- **States** (EnemyAIUpdateState_0063a034 through vtable +0x144..+0x158):
  idle 0x0063a3d8 / 0x0063be8c (02R waits for its switch flag): the nearest
  player whose XZ distance (0x007a9180) is under the radius -> spring.
  Spring 0x0063c990 / ProcessEnemyAttackState_0063b930: +0x34c to 7, +0x350
  to 10.15 (0x0093413c), then with r = radius -/+ the player's radius: 02 sends
  the local player's 6x2C (SnowBerillSendAttackPacket_006937c8: frames =
  the hold counter, particle 0, the trap's x / z, r^2), 02R casts; nobody ->
  sink. Hold 0x0063c7f4 / ProcessPlayerStunState_0063b828: the counter runs
  down, then sink, and 02 sends 6x2D (DisablePlayerMovement_00685514).
  UpdateTreeObject_0063cbe4: +0x354 += 0x888, SE 0x456 / 0x46b / 0x489 /
  0x4b5 (Caves / Mines / Ruins / Spaceship).
- **Render** (RenderSeabedPillarMapObject_0063c2bc / _0063c43c): root node +
  0x34c, its child + 0x350, the child's second child turns by +0x354.
- **Seal door** (ctor InitializeLabodoorMapObject_00622648, update
  0x006224a4, render 0x00622358): seal bits 0x0e; quest flag 0x2c clears 2,
  0x2d 4, 0x2e 8, 0x2f all and the box (ctor and every frame); the lamp
  root's children in order are bits 4, 2, 8; the color alpha +0xdc swings by
  0.05 (0x0093152c) between -1 and 0 under bit 0x10.

**Verified:** `tests/traps.test.ts`. In Chrome (Episode 2, VR Temple Alpha):
six 02R traps built with their params (radius 80 / 105, Foie level 3, one on
switch flag 40); with the player placed next to one it rose (root -7 -> 0,
child 6.3 -> 16.5, the top part spinning) and its Foie hit the player for 42.
Vol Opt (Episode 1): after constructing the door's group, setting 0x2d, 0x2c
and 0x2f put out lamps 1 and 2 and then removed the door and its obstacle
(the flags were cleared again afterwards). Screenshots were not available
(the tab's renderer did not answer capture requests).

**Assumed:** EnemyGetNearestTargetInRange_007714cc is the nearest player in
range (its body is not in the dump); the 02R's room check is left out; its
technique lands at once with the group-0 formula, MST 0 and techPower (Zonde:
level * 20 + 240), Megid with megidChance (the exe launches projectiles); the
trap SE plays once when the trap springs (the exe calls it every frame of
states 1..3); trap vision (state 1's marker, the cloaked render) is not
drawn; the seal lamps' color as a brightness of 1 + alpha; the door's .njs
shape motion is still left out; the 02 hold was only unit tested (no
free-play map places one).

## 2026-10-18: Full join sync: 6x6B / 6x6C / 6x6E / 6x6F sent and applied

**What changed:** when a player joins a game we lead, the web client now
sends everything the exe's leader sends, in its order: `6x6D`, `6x6B` (saved
enemy states), `6x6C` (saved object states), `6x6E` (object / enemy set
flags, wave event flags, switch flags), `6x6F` (quest flags), `6x71`, then
`6x70`. When we join, the received tables are applied: dead enemy set entries
do not spawn, wave events keep their state, switch flags and constructed
delayed objects come back, broken boxes stay broken, and `6x6F` overwrites
only the exe's list of quest flags. newserv accepts the counts (it checks them
against every floor's map, enemy children included). Code:
`net/joinsync.ts` (new), `net/game.ts`, `net/items.ts`,
`render/gamefield.ts`, `render/gameview.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **Order**: unknown_player_join_party (the 65 handler, before 0x0079cb0c):
  SendPacket0x6D_Subcommand0x6D_0079cc64, `6x6B`, `6x6C`,
  send_packet0x6d_subcommand0x6e (= BuildAndSendPacket0x6E_0079cd2c),
  send_packet0x60_subcommand0x6f (= SendQuestGlobalFlags_0079ce28),
  send_packet0x60_subcommand0x71; then `6x70`.
- **Header**: PacketCompressor_Compress_007a47dc writes the decompressed and
  compressed sizes at +8 / +0x0C and returns compressed + 8; the size field is
  ((that + 3) & ~3) + 8.
- **6x6B / 6x6C**: g_SavedEnemyStatusData (entity_index_count x 0x0C: flags,
  drop id, damage, buffs) and g_SavedBoxStatusData (g_EntityIndexCounter_Quest
  x 4: flags, drop id). reset_box_enemy_rare_status sets the drop ids
  (objects 0x100 + i, enemies 0xCA0 + i). They follow the sent 6x0A
  (prepare_send_packet0x60_subcommand0xa) and the received one
  (action_hit_enemy: Ultimate keeps the low 6 bits), 6x0B
  (handle_packet0x60_0xb_box_break: flags at +4) and 6x5F
  (handle_packet0x60_subcommand0x5f: drop id 0xFFFF). The joiner copies them
  (HandleLobbyPartyStateUpdate_0079fba4, HandleLobbyBoxStatusUpdate_0079fc30);
  enemies zero their own flags and damage on construction
  (reset_enemy_damage_taken), so dead enemies come from the set flags.
- **6x6E**: CollectMapObjectAndMonsterFlags_008123f0 ({0x10, objects,
  objects * 2 + 0x10, enemy sets} + flags & 0xFFFD of every object and enemy
  set entry of all floors), AggregateMapEventIds_0080d32c (every floor's wave
  event flags & 0xFFFD, file order), CopyFloorSwitchesBitmap_00816fac (0x240
  bytes, MSB first). The compressor gets `total size` bytes from the buffer
  start, so the 8-byte head pushes the last 8 switch bytes out (newserv notes
  the same bug). HandleLobbyMonsterMapStateUpdate_0079fd30 applies them
  (copy_monster_object_init_flags, copy_map_event_flags, copy_floor_switches,
  set_active_map_events). Set flag 8 = dead enemy; object flags 0x01 / 0x10 =
  constructed delayed object (floor loader 0x008129b0).
- **6x6F**: {6F, 82, 0, 0x200 bytes of g_QuestGlobalFlags (0x00a95680), u32 1};
  HandleLobbyQuestFlagsUpdate_0079feb4 -> SetQuestGlobalFlags_006bb55c copies
  only the 282 flags of the list at 0x00969c60 in every difficulty (the whole
  table when the u32 is not 1). The flag table is now the full 4-difficulty
  one; `questFlags` is the current difficulty's view of it.
- **Layout**: render/gameview.ts `syncLayout()` walks floors 0..0x11 (objects,
  enemy set entries and slots, wave event ids, with each floor's bases);
  render/gamefield.ts exports its FloorWaves, switch sets and constructed keys
  into the tables before the leader sends, and imports them on the joiner when
  a floor's wave state is first built. 6x76 for a floor not loaded yet is kept
  until the floor is known (it was dropped before), and 6x76 for a loaded
  floor other than the current one now uses that floor's slot base.

**Verified:** `tests/joinsync.test.ts` (tables, builders, round trips, the
truncation, the apply list); `tests/joinsync.live.ts` against newserv (A
leads, kills an enemy, breaks a box, sets a switch and a quest flag; B joins
and gets 2092 enemy states, 2038 object states, 1220 set flags, 349 event
flags; newserv logs "Importing ... from sync command" without count errors and
A stays connected). In Chrome: the web client as leader on Forest 1 (6x76 +
switch 7) and a node joiner: newserv accepted all three commands, the joiner
got the dead set entry and switch 7. The web client as joiner of a node
leader that killed all 67 Forest 1 set entries and set switch 7: 6x6B / 6x6C /
6x6E arrived (2222 / 2016 / 1250 / 349), and on warping to Forest 1 all 67 set
entries were dead, no enemy was visible and switch 7 was on.

**Assumed:** g_QuestGlobalFlags starts as the save file's quest_flags
(+0x4F4); the joiner's last 8 switch bytes (uninitialised heap in the exe) are
zero; object set flags are only tracked for delayed objects (0x10 when their
room/group was constructed; an object of the group already built by distance
would have 2 and is sent as 0); the drop number / floor item part of 6x6D is
still zero; 6x9C's status bits are not written into the saved enemy table.

## 2026-10-18: Ruins enemies: Bulclaw / Claw, Dark Belra, Dark / Death Gunner, Chaos Bringer, Chaos Sorcerer, Delsaber; confused enemies; Del Lily's Megid

**What changed:** the Ruins families run their own state machines
(`combat/enemyfsmruins.ts`, projectiles in `combat/enemyshots.ts`, driven by
`render/combat.ts`). A Bulclaw chases and swings (10 % poison); after two
swings or 60 s it splits into a Bulk (model 0, 1/5 of its HP) and 4 Claws in
its CLAW child slots; the Bulk flees, calls the section's Claws back, absorbs
them (their HP added) and becomes a Bulclaw again, or self-destructs on its
last attacker at low HP. The Dark Belra walks in 20-unit segments, throws its
arms (piercing, AttackData entry 19), punches (paralysis), gets dizzy when
circled, and spins and throws when confused. Dark Gunners run under their
control object: fan out, drop, dash, two-shot volleys, a rotating Death
Gunner whose hit while shooting stuns the group, and a flat shield off weapon
damage. The Chaos Bringer appears at its spawn point, charges (confusion),
swings, and after 5 hits drains 25 % TP and fires its laser (stronger with
more TP drained). The Chaos Sorcerer warps around its target and casts
attack A / attack B / Resta from its bits. The Delsaber leaps from 150, runs
its three-hit combo, guards against a swing in front of it while its shield
lasts and slashes to refill it when broken. Confused enemies target the
other enemies too and hit them; Del Lilies (and every Lily in Ultimate) cast
Megid. Code: `combat/enemyfsmruins.ts` (new), `combat/enemyshots.ts`,
`combat/enemyai.ts`, `combat/enemymotions.ts`, `render/combat.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **Bulclaw / Bulk** (factory 0x00533f90, vtable 0x00b01b40, update
  0x00531d9c, checks 0x00533b80, states 0x00531ee4, table 0x009bc680):
  BulclawHandleClawAction_00532960(form) switches form, rt (0x28 / 0x27) and
  the model index +0x370 (model 1 bcbody / model 0 bal_body); speed 0.5556
  (written at 0x00534208), attack approach 0.7, turn 1024, search 250 on
  Stagger(30); chase bands 60 / 40 / 120 / 100 (0x009229d4..e0); the swing
  (0x00532d44) hits at frame 10 (try_hit 1.0, knockback 3, 0.1 poison roll
  0x00922a28) and counts hit or miss; split (0x0053235c) at +0x3dc > 1800 or
  > 1 swing: hp / 5 the first time and the Claws (0x00535554 / 0x00535630) on
  a 13 ring at 45 + 90 i degrees, later the absorbed Claws back and the HP
  shared / (n + 1); flee (0x0053215c) 90 away re-picked on Stagger(90);
  merge (0x005323ec) up to 4 Claws, 600 frames to arrive within 15, HP added
  without a clamp, animation 11; self-destruct (0x005334d0) when a flinch
  ends at <= iparam1 % (10 by default); idle is super armor; the Bulclaw's
  death kills the absorbed Claws.
- **Claw** (0x005354d4, update 0x005345dc, states 0x00534994, table
  0x009bc7c0): bands 40 / 20 / 100 / 80, the bite at frame 8 (knockback 3),
  starting at once (+0x3c8 is only written by the merge state), 120 frames
  backing off at 0.6, appear / merge / absorbed (hidden, untargetable).
- **Dark Belra** (0x00536bfc -> 0x005394ec, states 0x005372dc, table
  0x009bcaa0): search 400, walk 0.28 in 20-unit segments with the farthest
  player inside +-0xaaa scanned after 2 segments past 80; Ultimate stands and
  scans every frame; the arm (0x005398b0 / 0x00539c7c): 10 a frame for 300,
  radius scale * 5.4 (scale 1 -> 2 by 0.15), each player once, entry 19,
  Ultimate 0.1 confusion; the punch (0x005379ec) within 30 at frame 16,
  knockback 5, paralysis <= 1/3 (Ultimate 0.1); the dizzy spin (0x00537844)
  after level * 180 degrees of turning, 150 * level frames; confused
  (0x005375f4): +0x280 a frame to 0x3800, then the throw; flinch only on a
  hit >= max HP / 5 (0x00538dcc); idle and appearing invulnerable.
- **Dark Gunner** (0x00545e54, update 0x00543e8c, dispatcher 0x005443c4,
  table 0x009bcf60) and its control (0x00543ab8, update 0x00543494): group =
  same param1 and section, by param2; control states 0..6 (fan of 0x1555,
  90 / 210 / 120 / 420 frames, the leader rotation = Death Gunner, rt 0x23);
  dormant drop, dash at fparam1 slowing 0.2 to 0.5 for fparam2, the volley
  (0x005449a8: iparam1 charge, 2 lasers at the nearest player within 200,
  0x00546610: fparam4 in 3D, radius speed * 0.75, life 500 / speed, power
  iparam4, knockback 3), stun iparam2 (0x00544518), the Death Gunner hit while
  shooting stuns the group (0x0054615c -> 0x00543c88); the shield = iparam3
  off weapon damage, dropped while shooting, stunned, frozen or paralysed.
- **Chaos Bringer** (0x0053a454, dispatcher 0x0053a998, table 0x009bccc0):
  hidden / appear (50 fade frames invulnerable, 1.2 for 20 frames) / lost /
  chase (turn 0x300, fparam2, swing inside iparam5 within 0x1800, charge from
  iparam6 with < 2 charges) / charge (0x0053b9fc: wind-up turning 0x280, run
  at fparam1 along the frozen direction, group-0 tech iparam3 + 0.3333
  confusion, brake 0.95) / pause iparam2 / swing (0x0053b64c: frames 10.8
  (Ultimate 7.8) .. 13, push 3) / laser (0x0053ac24: frame 12 TP drain 0.25,
  the farthest player within 300, the 10-a-frame 26-frame piercing laser,
  iparam4 * 1.5 / * 2 past 70 / 151 TP, Ultimate 3 shots); 5 counted hits
  (0x0053c7d8) bring the laser.
- **Chaos Sorcerer** (0x0059d8b8, dispatcher 0x0059b718, table 0x009bfe80):
  lurk (Rangers within 400, others 250), placement 50 / 30 / 80 / 160 with
  +0x2aaa per placement, 50-frame warps, 60 frames before casting, the attack
  (0x0059c844: within 100, 90-frame charge, release at frame 11: Gizonde,
  Rafoie in Episode 2, Grants in Ultimate; then Gibarta / Megid) and the heal
  (0x0059bd94: below max / 4, Ultimate below max) at levels iparam1..3 from
  the bit anchors (+-15, 18 up, 0x0059c770); super armor whenever hittable.
- **Delsaber** (0x0055018c, vtable 0x00b03fa0, the generic controller
  0x00787a80, table 0x009bd5e0, record 0x009bd6dc): shield round(param1 +
  100); waits hidden for a target within 200; walk fparam3 / fparam4; the
  attack choice 0x00550ac8 (broken -> slash [2], far >= 150 -> jump within
  r + 150 and 0xaaa, else the combo [0]); combo hits 16 / 37 / 54 with the
  1.25 lunge, knockback = damage; the jump (0x0054eae4) at (d - 15) *
  0.0583333 from frame 11 to the landing hit at 23 with [1]; the guard
  (0x00550db4 / 0x0054e878): a swinging player within 30 in front facing
  it, invulnerable to frame 28, the shield drained by (ATP + spread + weapon
  ATP - DFP) * 0.2 (int16); the slash refills it; front / back flinch rows.
- **Dimenian**: the Booma handlers with its own record 0x009bd740 (225 /
  250 / 300, turn 1024), radii 7 / 7 / 8 (0x009bd7a0) and its flinch at 1.0
  (was 1.5).
- **Confusion**: unknown_booma_enemy_find_target 0x0052b888 searches every
  entity while confused; EnemyUpdateTarget_0052ccd8 -> 0x0052cd2c takes the
  closer of the nearest player and enemy but nothing without a player in
  range; the hit is try_hit_entity 0x007732b8 on the enemy.
- **Del Lily's Megid** (0x00528c38): a Del Lily or any Ultimate Lily casts
  create_megid1 at constrain_tech_level(iparam1): power 27 + 3 L (42 + 2 L
  past 14), speed 2 + trunc(L / 5) * 2; death when rand < (power - EDK) / 100.

**Assumed:** the Bulk's flee point straight away from the player, the Claw's
appear length (30), self-destruct gives no drop or EXP; the Belra's hand
offset and its regrow length (30), the arm's push drawn as knockback 3; the
gunner fan pointing at the player, the control's position at its gunners'
middle; the Bringer's contact radius 7 and laser height; the technique bolts
(enemyshots.ts TechBolt) flying straight at 4 a frame, their damage through
the group-0 formula, the enemy Resta as MST / 2 + power; the Delsaber's
waypoint = its target, the appear (30) and shrink (10) lengths, a remote
player's guard drain 0; the player's EDK 0 for Megid; a confused enemy's hit
on an enemy resolved by every client.
**Left out:** the Sorcerer's bits as separate hittable entities (BEE_R /
BEE_L slots: their flinch, 900-frame respawn) and its healing of other
enemies, Gibarta's freeze; the Bringer's Ultimate weapon unequip and push
object; the Delsaber's job-mask preference; the walls / line of sight of all
of these; the dark-portal spawn effects; Gibbles / Goran confusion paths.

**Tests:** `tests/enemyfsmruins.test.ts` (new): Dimenian record and radii;
Bulclaw swings, poison, split, ring, flee, merge / absorb, self-destruct;
Claw bite and back-off; Belra appear, walk speed, throw, flinch threshold,
arm pierce / entry 19 / Ultimate confusion, punch paralysis, confused spin;
Gunner dormant shield, control cycle, volleys, laser effect, Death Gunner
super armor and stun; Bringer appear, charge contact and confusion, hit
count -> laser, TP drain, laser power; Sorcerer lurk, placement, warp,
Gizonde, Ranger range; Delsaber shield, wake, jump, guard drain and break;
updateTarget's confused rule; Del Lily Megid level; the Bulclaw's 4 CLAW
slots.

**Checked in Chrome** (WebHunter, HP raised, enemies made visible and the
player placed from the console): Ruins 1: a Bulclaw went chase > attack >
split (260 -> 52 HP, model 1 -> 0, 4 Claws spawned in its slots, they bit
and backed off) > flee; with the player far away it merged (merge, the 4
Claws absorbed, 852 HP) and became a Bulclaw (model 1) again; a Dark Belra
went appear > chase > dizzy > throw (the arm hit for 136) > punch
(paralysis); a Delsaber leapt, ran combos and guarded the local player's
swings (shield 103 draining, "is invulnerable" on the hits); a Chaos
Sorcerer cycled lurk > appear > attack > vanish > ... > heal and its
techniques hit for 81 / 90. Ruins 2: a Dark Gunner group dropped, dashed,
rotated the Death Gunner and fired volleys (50 a laser on Normal); hitting
the Death Gunner while shooting stunned the group for 120 frames; a Chaos
Bringer appeared, charged twice (hit for 84, confused), after 5 hits drained
TP and fired its laser, then swung; a confused La Dimenian targeted and hit
another La Dimenian until the confusion wore off. No console errors.

## 2026-10-18: Mines enemies: Dubchic / Gillchic, Garanz, Sinow Beat / Gold, Canadine / Canane

**What changed:** the Mines families run their own state machines
(`combat/enemyfsmmines.ts`, projectiles in `combat/enemyshots.ts`, driven by
`render/combat.ts`). Dubchics and Gillchics walk, punch twice and fire a
laser volley; a Dubchic gets up again after its first four deaths. The
Garanz walks, lays ground mines and fires homing missile barrages that grow
with its damage phase. Sinow Beat / Gold drop from the ceiling, warp next to
the player and strike, run a two-hit combo and warp away (the Gold casts
after it). Canadines rise, fire lasers or dive and zap, and orbit; a Canane
spawns its ring of 8 into its CANADINE_GROUP slots, releases the out- and
in-fighters in turn, frees them when the ring thins out, and its death makes
the ring self-destruct. MovementData iparams are now read signed
(`formats/battleparams.ts`). Code: `combat/enemyfsmmines.ts` (new),
`combat/enemyshots.ts`, `combat/enemymotions.ts`, `render/combat.ts`,
`formats/battleparams.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **Dubchic / Gillchic** (ctor 0x00556600, selector 0x005562ec, dispatcher
  0x00554a0c, table 0x009bdbe0, record 0x009bdd40 {150, turn 1024}): aggro
  170 / 220 by round(param1) parity, a search every 30 frames, re-acquire
  within aggro + 50; walk 0.37037 / 0.57037 (revived: fparam3); within
  distance_x while it has walked less than 80 the melee (hits at motion
  frames 20 / 28, revived 34 / 54, try_hit 1.0, knockback 3.0; the Gillchic
  slows with roll <= 1/6, 0x00924c24, group 17); past 80 a 0.35 roll fires
  round(param1) lasers (2 when 0) at a player within 150: charge iparam2
  frames from motion frame 2, 15 frames apart; the laser (0x005570f0 /
  0x00556fa0) flies 7 a frame for 150 units, radius 7, group 0 with
  iparam4; death (0x00555234): a Dubchic lies iparam1 frames and stands up
  with full HP and the revived flag, invulnerable meanwhile; a Gillchic and
  the 5th death are final.
- **Garanz** (ctor 0x0056f8f4, selector 0x0056eb08, dispatcher 0x0056d8f4,
  table 0x009be740): up to 4 players within 300 sorted by distance (padded
  with the farthest); phase 0 walks fparam1 units at fparam2 toward
  sorted[1], phase 1 / 2 (HP <= 1/3 / 1/4, hit handler 0x0056f1d8) walk 120
  laying a mine every 20 (0x00926824); then the barrage (super armor 0x40000:
  turn to within 0xe37, animation 2, frame 28): 4 / 8 / 16 missiles at the
  heading +-0x800, pitched 22.5 / 45 degrees, speed fparam4, homing from age
  14 with steer fparam5, life iparam2 + 150, blast 6, group 0 iparam3
  (0x00570810 / 0x005709e0); mines (0x0056e9f8 / 0x00570128) thrown back at
  0.5 with gravity 0.10889, crawl 0.8 for 50 after a random +-120 degree
  turn, armed after 15 frames, contact 3, blast 5, 150 frames, iparam4;
  iparam1 frames after the barrage it decides again.
- **Sinow Beat / Gold** (0x0058d320, dispatcher 0x0058d93c, table 0x009bf8a0,
  MovementData rows 6 / 0x10): wait (search 200, 30 frames), ceiling drop
  (no flinch), chase at fparam1 turning 0x500; within 25 and +-0x1e00 the
  combo (0x0058e8f0: lunge fparam3 on frames 0..5, hits at 9 / 19, the
  second confuses with roll < 0.1666, hold iparam3 at frame 25); 100..150
  away the warp-strike (0x0058eb18: hidden from frame 14 to 23 moving
  (d - 20) / 12.857 a frame, hit at 25, slide 0.85); every 2nd combo the
  warp away (0x0058e598: 80 units over 11.25 ticks, hidden 15..24); the
  Gold then casts (0x0058dde4, iparam1 / iparam2); lost target 90 frames ->
  back to its spawn point; never flinches in Ultimate (0x005900c8).
- **Canadine / Canane** (0x0053e770 / 0x00541494 / 0x005419fc, init
  0x005424d8, dispatcher 0x0053eee4, table 0x009bce00): heights high 45
  (Canane 55), low 15, dive 15 + 5 r, easing 0.5 a frame; standalone ones
  and the Canane search 200; param1 0 = in-fighter; laser (0x00540574:
  approach 0.5 to 70, open, aim iparam1, hold iparam2, the shot 0x00542cbc
  at 20 a frame, wait iparam3, iparam4 shots); zap dive (0x0053fe00: track
  40 frames, dash 4 frames at 10.607 turned +-45 degrees, approach at
  fparam1 to 18 below height 20, zap at frame 25 with try_hit 1.0 /
  knockback 3.0 and a 0.05 shock roll on androids, 3 zaps); orbit
  (0x0053fa3c: 31 + 8 frames, 4 times, radius 70); the ring (0x00541188:
  40 around, ceil(8 / iparam6) out-fighters), the Canane's stages
  (0x00541da4) with blink patterns 0x009bcf20 at 2 frames a character, the
  child-death rule (0x00541c10: <= 4 alive frees, <= 2 leave), the ring's
  self-destruct (0x0053f6fc: 150 frames chasing at 0.68, then the blast).
- Enemy MovementData iparams are signed (the Garanz's -30 life adjust).

**Assumed:** the Dubchic's muzzle height 12, "should_push_defender" as the
AttackData reach and arc, its revived 6x0A without the dead flag and its HP
refilled when it falls, slot 19's walk speed 0.7; the Garanz's launcher
height 20 and the missiles' pitch pairing; the runtime speeds of the
Sinow's warp rows (0.7 / 0.8, so the hidden moves cover d - 20 / 80) and of
the combo (1.0), a vanished Sinow cannot be hit; the Canadine's eye fade
(1 / 0.06 frames), its laser / blast record {kind 3, value, 0, 3.0, 1} as
try_hit_entity(1.0) with knockback 3.0 and radius 3, the laser flying level
to the point it was fired at, the leader always allowing the attack, the
Canane's own release after the in-fighters, and members that leave (state
11 / after the blast) disappear without EXP.
**Left out:** the Dubwitch link (0x00555974 sets the Dubchic's permanent
death flag through an untraced caller), the Dubchic's knockdown and limbs;
the Garanz's armor shedding; the Sinow's mirage clones (states 8 / 14 / 15,
the 4 child slots), the Gold's technique effect, the Ultimate charge (16);
the Canadine flinch fall / bounce, its blink drawing, the drop over the
laser's last 20 units, and the ring's later cycles.

**Tests:** `tests/enemyfsmmines.test.ts` (new): Dubchic aggro parity, walk
speeds, the two melee hits and the Gillchic's slow, the laser volley, range
and effect, the revive count and the invulnerable lie-down; Garanz walk
length, barrage counts per phase, the mine walk, mine fuse / contact, the
missile homing; Sinow drop, warp-strike timing and stop, the combo's hits and
confusion, the warp away, Ultimate super armor; Canadine rise, laser volley,
zaps, the ring slots and out-fighter count, the release order, the
free / leave rules, the CANANE + 8 CANADINE_GROUP slots.

**Checked in Chrome** (WebHunter, HP raised and placement from the
console): Mine 1: a Gillchic went idle > walk > laser > melee and its hits
slowed the player; a Sinow Beat went wait > drop > lost > warp (hidden
samples during warps) > chase > combo > away, its combo confused the
player; a Canadine (in-fighter) rose to 45, zapped and orbited; the Canane
spawned E-322..E-329 (CANADINE_GROUP), released its two out-fighters (laser,
back to the ring) and then the in-fighters (zap); killing it made all 8
self-destruct and leave. Mine 2: a Garanz walked, fired barrages (12 shots
in flight), at 30% HP switched to phase 1 and laid mines; its missiles and
mines hit for 49 / 64 (technique hits); a Dubchic killed with one hit fell
("it will get up"), was invulnerable while down and stood up with 200/200
HP; a Sinow Gold went combo > away > tech. No console errors.

## 2026-10-18: Caves enemies: Grass Assassin, Nano Dragon, Shark record, enemy shots

**What changed:** two more Caves families run their own state machines
(`combat/enemyfsmcaves.ts`): the Grass Assassin chases, slashes, spits its
web (a 6x2C hold that roots the player for 180 frames) and, once enraged,
dashes; the Nano Dragon wanders, circles, alternates its homing volley and
its fire breath, and takes off / flies / lands. The Evil / Pal / Guil Shark
keeps the Booma handlers it really uses, now with its own AI record. New
shared pieces: enemy projectiles (`combat/enemyshots.ts`, drawn and resolved
by `render/combat.ts`), enemy technique hits on the player, the player hold
(`net/game.ts` sendImposeHold), super armor / invulnerable flags on a brain,
and knockback scaled by the damage. Code: `combat/enemyfsmcaves.ts` (new),
`combat/enemyshots.ts` (new), `combat/enemyai.ts`, `combat/enemyfsm.ts`
(helpers exported), `combat/enemymotions.ts`, `render/combat.ts`,
`net/game.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **Enemy technique hits** (entity_hit_by_tech 0x00773afc): an enemy
  attacker's base is MST * 0.5 (0x00978278) + power; group 0 (jump table
  0x00977ea0 -> 0x00774cc7) multiplies it by 0.2 (0x00978250), truncated, no
  resistance and no evasion roll.
- **Shark** (shark_constructor, SetBoomaSubtype_00512f94): the Booma
  dispatcher 0x0052b78c with the record 0x009bb200 + subtype * 0x1c: search
  225 / 250 / 300, turn 1024 (0x009bb200 was cited for the Hildebear before;
  it is the Shark's). Flinch row 6 of 0x009bb300 runs at 1.0.
- **Grass Assassin** (ctor 0x005249c8, dispatcher 0x005224d0, table
  0x009bbaa0, record 0x009bbb64 {400, 0.75, 256}): target every 30 frames;
  attack pick 0x0052515c (enraged -> dash; else AttackData[0] slash, then
  [1] web unless the target is held; range (10 + distance_x)^2 inside the
  arc); chase 0x00523cb4 creeps at 0.75 * 0.125 until facing, then runs; the
  slash 0x005238e8 (roll <= 0.5 picks motion 4 or 2, hit at frame 14,
  knockback = the damage); the dash 0x00523024 (x2 speeds, length max(100,
  d + 30 + 10), invulnerable crouch, each player hit once with knockback 2 *
  damage, 150-frame cap, 90-frame rest); the web 0x00522af4 / 0x00522fb4 /
  HandleHardAttackAction_0069375c (6x2C: 180 frames, particle 1, the
  player's x / z, radius^2 0); enrage after a flinch below fparam1 of its HP.
- **Nano Dragon** (ctor 0x0057f6b0, dispatcher 0x0057d734, table
  0x009befc0, record 0x009bf0d0 {150, 0.46296, 768}): walk 0.46296 * 0.6,
  drawn 15 + height; idle wander ((r + 1) * param2 * 0.4 from the spawn
  point, 150 frames walking / 90 standing); combat circles 384 BAMS a frame;
  a player within 400 inside 0xaaa: volley / breath alternately (only the
  breath below 1/4 HP); the volley shoots one homing shot per player (up to
  12, +-0x2000) at frame 20: fparam3 speed, steer fparam4 (x2 within 150)
  growing by fparam5, 90 frames, iparam2; the breath at frame 20 flies at
  fparam2, pierces, 500 units, iparam1; take-off rises 2.2 a frame from
  frame 22 to 50, flies at fparam1, turns 1536, descends 2.3 a frame;
  after a flinch that cost more than a quarter of its HP it breathes back.

**Assumed:** the Grass Assassin's set fparam1 / fparam2 are the entry's
param1 / param2 (inferred copy order), the dash "touch" as the bodies
overlapping (10 + 5), and the hold blocks all movement (radius 0); the Nano
Dragon's take-off takes the first of its three ray directions (no map rays),
its combat wander heads for the target, its landing row starts at height
40, the shots fly over flat ground and hit within their radius + 5, the
breath and shots aim 10 above the player's feet, the mouth is 10 up, enemy
technique hits do not knock back, shots are drawn as coloured balls.
**Left out:** the Grass Assassin's emerge from the ground and the Ultimate
web branch; the Nano Dragon's fly-in spawn, power-up on a kill (0xc) and
its fall when killed in the air; the Pan Arms / Hidoom / Migium split and
merge (the body's states are traced: shuffle 0x00581278, split at 1/3 HP
into the HIDOOM / MIGIUM slots +1 / +2 with half the HP each, rejoin after
900 frames; the arms' attack objects 0x005880c0 and the children's attack
states are not), the Pofuilly Slime's split (its spawner hands out the
never-used slots on a 3rd combo hit or a Barta hit), Del Lily's Megid.

**Tests:** `tests/enemyfsmcaves.test.ts` (new): the Shark records and
flinch row, the Grass Assassin's search, web hold, slash roll and damage
knockback, enrage -> dash and its invulnerable crouch, the ambush mode; the
Nano Dragon's 30-frame search, walk speed, volley / breath alternation and
the low-HP breath, take-off to 50 and landing, the piercing breath's range,
the homing shot.

**Checked in Chrome** (WebHunter, Cave 1, HP raised and placement from the
console): a Grass Assassin went idle > chase > web (`web hold for 180
frames`, movement blocked, `hold released`) > slash; forced enraged it went
crouch (invulnerable) > dash > rest. A Nano Dragon (its wave forced
visible) went combat > volley > combat > breath, its shots and breath hit
for 24 / 34 (technique hits); with the player 20 away it took off (lift
65 = 15 + 50) and landed back in idle. The sharks got search 225 / 250 /
300. No console errors.

## 2026-10-18: Window open / close animation and the opening wipe

**What changed:** windows now open and close like the client's list
windows: they fade in over the first 7.5 counter steps, their elements (bars,
texts, numbers) are revealed by the opening wipe, and a closing window
stretches wide and flat about its centre for 4 frames. The status window and
the party members' windows run it fully (wipe per element); the field menu's
leaf windows (Item Pack, Equip, MAG, Technique) fade in and close with it.
The speed follows the character's window speed option (option_flags +0x4ec,
bits 0x300). Code: `classic/windowanim.ts` (new), `classic/hud.ts`,
`classic/fieldmenu.ts`, `classic/stage.ts` (windowFrames), `render/fieldhud.ts`,
`render/playerhud.ts`, `render/combat.ts`.

**Details** (Ephinea `PsoBB.exe`):
- State: flags +0x2c (1 open, 2 animating, 4 close held, 0x20 silent), open
  counter +0x5c, closing counter +0x22. Open
  (UpdateListItemState_00712714 / MenuListItem_Initialize_00712c44): counter
  0 (0x1000000 when the speed table 0x0097e4cc = {34, 51, 68, 0} gives 0),
  flags |= 3, SE 0x572 unless silent. Close (play_sfx_for_closing_list_menu):
  bit 4 while opening, else closing + SE 0x573.
- unknown_closing_window per frame: counter += speed + 1
  (GetCharacterOptionsBitfield_007be1d0, 1 without session data); open once
  counter >= 7.5 (0x0096f754); closing ends when +0x22 reaches 4.5
  (0x0096f758); a held close / reopen runs after.
- Drawing: c = round(counter - 7.5) (0x0096f68c, x87 halves to even);
  c < 0 gives the quads alpha (c + 7.5) / 7.5 (UIElement_SetTextColor
  _0071bc8c, 0x00970098 / 0x00970094); each element shows (c - (x / W +
  y / 21) * 7.5) * 17 px (ScrollbarObject_Render_0072a2c4, render_chat_bubbles
  _and_more; 0x00970adc..ae4, 0x00970eb0..eb8); closing scales x by
  1 + 0.5111 k and y by 1 - 0.2222 k about the centre (UIElement_SetScale
  _0071bcec, 0x00970084..90, font_resizing_effect).

**Assumed:** the status window opens when the HUD is created; texts are
clipped at the revealed width (the client squeezes the partly shown glyph);
a number's wipe starts at its left edge; the field menu runs one animation
per leaf about the bounds of its frames, silent, without the element wipe
(its frames and texts share one draw path), and windows a leaf opens later
(Purpose, Amount) are not animated on their own. The window shine
(UpdateAnimationStateMachine_00712834, RenderAnimationFrame_007129a8) is
left out.

**Tests:** `tests/windowanim.test.ts` (new): open timing per speed, c's
rounding and the alpha, the wipe formula and pace, the 5-frame close and its
scales, a close held during the opening, the option bits, the party windows
fading in and closing.

**Checked in Chrome** (WebHunter, Forest 1, window speed 0 from the save):
the status window frozen at counter 18 showed "HP 48 /" half revealed and no
bars yet; a party member removed from `game.players` closed its window
stretched wide and flat (frozen at k = 2); Home -> Equip faded the leaf's
windows in (alpha 0.47 at counter 3) and Backspace closed them with the same
stretch while the main menu came back. No console errors.

## 2026-10-18: The message window's scrolling, timing and frame

**What changed:** the player's message window (level-up lines, server text)
now works like the client's: a ring of 16 lines, no frame, text clipped to
the content rectangle, lines expire after 0xb4 frames and scroll out of the
top, new lines scroll the window when they pass the bottom; B0 server text
messages go into it. Code: `classic/hud.ts` (MessageLines rewritten,
wrapMessage), `render/playerhud.ts` (notice), `net/lobby.ts` (B0 ->
`serverText`), `render/combat.ts`.

**Details** (Ephinea `PsoBB.exe`):
- CreateChatShortcutMenuYesNoListWindow_0073b3a0 at GUI 0x22 = (373, 203),
  size {255, 120} (0x0096ffd8), 0x10 lines (SetListWindowRenderParameters
  _0073b1e8, template 0x009f3268, flags 3, element list 0x009f3244: one
  system-font text per line); ChatShortcutMenuYesNoListWindow_UpdateRender
  _0073b470 draws only the text (no frame); content inset 10, clipped.
- ListWindowObject_AppendItem_0073ae4c (flags 0xe from
  DisplayChallengeResultToPlayer_00718350 / handle_b0_packet): a reused slot
  drops its line and moves everything up by height + 6 (0x00971c8c); the line
  goes at the write cursor, cursor += height + 6; past scroll + 120 the
  target becomes cursor + 20 - 120 (0x00971c7c); flag 4 starts a 0xb4-frame
  timer (+0x8c).
- ListWindowObject_UpdateScrollAndHighlight_0073abb0 per frame: scroll +=
  max(0.15 * rest, 15), snapping when the rest is smaller (UpdateScroll
  _0073adcc, 0x00971c94 / 0x00971c90); lines wholly above the scroll are
  dropped (0x00971c9c); UpdateItemHighlight_0073b208 counts timers down and
  every expired line, oldest first, pulls the target to its y + height + 1
  (0x00971c68).

**Assumed:** a line is 14 high per text row with 6 between wrapped rows,
wrapped at 235 px; flag 8 (a line waiting for the previous one to be typed
out) is not modelled. The pickup texts the client writes with flag 0x200
(DisplayExperienceText_00691578, FormatAndDisplayFloatingText_006916dc) look
like debug output and are left out.

**Tests:** `tests/level.test.ts`: 20 px per line, the 7th line's target, the
15-px minimum step and the snap, dropping and rebasing, expiry after 0xb4
frames, the ring of 16, wrapping.

**Checked in Chrome** (WebHunter, Forest 1): a B0 command fed to
`game.handle` and seven more lines from the console: the window scrolled,
the oldest lines left at the top, five lines stayed visible inside the
clipped area at the right of the view, and all of them scrolled away about
six seconds later.

## 2026-10-18: Level-up light and particle

**What changed:** a level change (6x30, own or another player's) on a field
now runs the client's DisplayLevelUpMessage: the level-up SE for the local
player, the "Level Up" / "Level Down" text, the particle burst 0x23
(level_up02) that follows the player, and the 10-frame level-up light on the
player's model; the player's name tag shows the new level. Code:
`render/levelupfx.ts` (new), `render/combat.ts`, `render/lobbyview.ts`
(refreshNameTag, playerLitMaterials).

**Details** (Ephinea `PsoBB.exe`):
- UpdatePlayerStatsAndLevelMessage_006928e4 calls DisplayLevelUpMessage
  _00692aa4 only on a field (is_player_in_unsafe_map): SE 0x58d when player
  +0x32c == 1 (PlayDirectionalSoundBasedOnAction_00692bf4), the text
  (CreateJapaneseCharacterEntity_00789758, 0x3c frames),
  SpawnChallengeEntity_00697c14 -> ChallengeEntityObject_Constructor_00697c88
  -> create_particle_effect_3(&player->weapon_position, 0x23, 0x10) with the
  slot as motion index. create_particle_effect_3 sets +0x34 = 1, so
  update_particle_effect spawns max(rate, 1) particles once and ends; flag
  0x10 keeps each particle at its offset from the entity (the particle update
  around FindEntityById_007b4d18).
- The light: BaseGameObject_Constructor_006eb52c (vtable 0x00b3dd18) with
  colour {a 1, r 1, g 0.8, b 0.63} (0x00aab48c), direction (0, -1, 0), 10
  frames, step 0.2, targets diffuse / ambient 1.0, then
  UpdateLightDefinition_00794984(slot, 1.0, 0.5).
  update_lighting_of_particle_effect_on_player (0x006eb714): half =
  round(10 * 0.5) (0x0096dacc); frames < half lerp the intensities from the
  area's primary light (g_PrimaryLightEntry_00a9d460) to the targets by
  i / half in the level-up colour, later frames lerp back by (i - half) /
  half while the colour moves 10% per frame back to the entity's own; the
  object ends after frame 10. Colours are {a, r, g, b}
  (SetD3DLightProperties_00794a44 reads +4 / +8 / +0xc).

**Assumed:** the web renderer has one scene light, so the player's light is
drawn by scaling its Lambert materials by (a + d * c * 0.5) / (a0 + d0 *
0.5) (a mean N.L of 0.5) and the direction is left out; the particle spawns
at the player's position (the weapon position is not tracked); the name tag
is the web client's own label (the exe has none in this form). The level-up
SE / text now also need a field, like the exe.

**Tests:** `tests/level.test.ts`: the light's frames (area light at 0, 4/5
at frame 4, the targets at 5, back at 10, 11 frames), the colour and its
10% return, the material scale.

**Checked in Chrome** (WebHunter, Forest 1, a 6x30 for the own client with
the same level pushed through the combat handler): "Level Up" over the head,
the particle entry 0x23 "level_up02" loaded (rate 10, life 10..16) and 10
additive sprites drawn at the player's feet, the model's materials tinted
warm (0xfff9f0) and restored after the light; refreshNameTag turned
"WebHunter  Lv2" into "Lv3" and back. No console errors.

## 2026-10-18: Party members' windows

**What changed:** the field HUD now shows the other players' small windows
under the status window (colour badge, name, level, HP bar), stacked and
sliding into place like the client's, with the hit shake (also on the local
status window) and the other players' HP kept from their subcommands. Code:
`classic/hud.ts` (PartyWindow / PartyWindows / WindowShake),
`combat/partyhp.ts` (new), `render/playerhud.ts`, `render/combat.ts`,
`net/lobby.ts` / `net/game.ts` (HP stat, HP materials and name colour of
64 / 65 entries and 6x70).

**Details** (Ephinea `PsoBB.exe`):
- **Windows:** QuickmenuobjectConstructor_00716354 makes three
  (CreateQuestListEntry_0073ea0c) on any map but the lobby, for client slots
  (own + 1 + i) & 3; base ChallengeMenuListWindow_Constructor_00742174,
  vtable 0x00b41250, GUI position 0xbc = (30, 116), template 0x009f335c =
  {114, 46, elements 0x009f32a0, flags 0xb28}. Render 0x0073eb60: texture 13
  texels (0, 180)-(114, 226); elements: badge (7, 7) 34x29 at (34 * slot,
  202) of texture 0, name (45, 40), level number right edge (100, 19), HP bar
  (44, 7) 57 wide (status window colours and hold / slide rules), "Lv" (48,
  19); status icons at GUI 0xbd = (117, 7).
- **Stacking:** QuickMenuObject_UpdatePlayerListStates_00716858: y from 116,
  55 apart (0x0096fe78) for the present players; a changed y moves the window
  over 15 frames (+0x50 = 0xf, render += (source - render) / n,
  UpdateRenderTransition_00710ee4); an absent player's window closes.
- **Shake:** QuickMenuStatusBarUpdateHP_007422c4 sets +0x60 = 4 when HP went
  down; QuickMenuUpdateListItemFloatingOffset_007429b0 offsets the render
  position by rand / 32768 * 5 at angle rand / 32768 * 65536 for 4 frames.
- **Remote HP:** 6x4B / 6x4C current_hp (action_get_hit_flinch 0x0069aa2c,
  ClampEntityHP_00770b58), 6x2F type 0 set / 1 add / 2 full
  (HandlePlayerHPModification_006933c0, ignored when dead), 6x30 new stats and
  hp = max_hp1 on a field (UpdatePlayerStatsAndLevelMessage_006928e4), 6x4D
  dead (name red, QuickMenuUpdatePlayerInfo_00742454), 6x70 current_hp +
  materials + stats; max HP with the local formula (maxHpFor).

**Assumed:** remote max HP leaves out equipment bonuses (as the local one);
a player seen through a 64 / 65 entry starts full; a 6x4F revive gives max HP
/ 2 (PlayerRestoreHealthAndTP_0068fddc); 6x9A what 0 / 3 subtracts / adds HP
on the player whose client id is the entity index (handler 0x00779df4 not
decoded); the window's other hide conditions (warp / quest states of
UpdatePlayerListStates) and the photon-blast badge positions are left out;
windows appear and close at once (the open / close animation is a later
entry). Remote players' status icons are not tracked.

**Tests:** `tests/party.test.ts` (new): slots, stacking and the 15-frame move,
the layout (background, badge, bar, "Lv", level, name), the shake, and the
6x4B / 6x2F / 6x9A / 6x4D / 6x4F / 6x70 HP rules.

**Checked in Chrome** (WebHunter in a new game, Pioneer 2): two party members
injected into `game.players` from the console (no second account), then 6x4B
/ 6x2F / 6x4D pushed through the combat subcommand handler: the two windows
stood under the status window at y 116 / 171 with their badges, names and
levels; the hit held the red gap and faded the bar to the low colour, 6x2F
type 2 refilled it, 6x4D turned the name red with an empty bar.

## 2026-10-18: Photon blasts

**What changed:** the MAG's photon blast gauge now charges from damage dealt
and taken and shows in the status window's ring; a palette slot holding a
photon blast (group 1 = 5) fires the MAG's blast in that slot, sends `6x49`,
`6x37`, `6x39` / `6x3A`, and the six basic blasts have their exe power
formulas: Farlla / Estlla / Golla / Pilla hit the enemies in range, Leilla
heals, Mylla & Youlla casts Anti, Deband and Shifta. Code:
`combat/photonblast.ts`, `render/combat.ts`, `net/game.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **Gain:** dealt (unknown_melee_attack_2, 0x006997a0) trunc(damage) /
  ((level + 1) * 15) (0x0093daa4 / 0x0093daa0, at least 0); taken
  (try_hit_entity on a local player) calculate_pb_gain_from_hit (0x0069b4f0)
  of trunc(damage * 20). try_set_pb_charge (0x0069b550, vtable +0x134): local
  player, alive, MAG equipped, on a field; set_pb_charge (0x006a7e84) caps at
  100 (0x00966680) and sends `6x39` (0x006a7ec4); subtract_pb_charge sends
  `6x3A` (0x006a7f48). The special attack adds nothing.
- **Firing:** palette group 1 = 5 -> CanPlayerCastTechInCurrentState_0069a8c0
  (no 0x20006 flags, ready flag +0x524 & 2, not already firing);
  handle_input_state_use_photon_blast: 0x708 invulnerable frames, `6x49`
  {pb number, target count, round(gauge), targets} of 3 + n dwords; its
  receiver 0x0069a6b4; `6x37` {round(gauge)} at the motion's release
  (SendPhotonBlastCompletionPacket_0069f93c).
- **Power** (HandlePhotonBlastDamage_0067fa2c / ApplyPhotonBlastEffects_
  0067ef10, constants 0x0093bcf4..0x0093bd14, base powers 0x009cb4e0 +
  type * 0x2c = 500 / 350 / 1200 / 500 / 150 / 0): Farlla synchro * (ATP +
  equipment ATP) * 0.025 + IQ * 2.5 + 500; Estlla EVP * synchro * 0.15 +
  IQ * 15 + 350; Golla synchro * (ATP + equipment ATP) * 0.075 + IQ * 7.5 +
  1200; Pilla ATA * synchro * 0.075 + IQ * 7.5 + 500; Leilla IQ * 0.5 + 150;
  Mylla & Youlla min(IQ * 0.1, 20); then * gauge total * blasts joined *
  0.01 (0x0093bc90). 0..3 hit with entity_hit_by_tech group 4 (power *
  (100 - ELT) * 0.002); Leilla group 6 (Resta); Mylla & Youlla Anti
  (Reverser on the dead), Deband, Shifta.

**Assumed:** the palette's group 2 is the MAG slot (0 center, 1 right, 2
left) and is sent as the pb number; the target list is the enemies within
150 units (the table's third float), up to 10, and none for Leilla / Mylla &
Youlla; the blast goes off 30 frames after `6x49` with the cast motion; the
gauge empties when it goes off; Leilla's heal uses Resta's MST * 0.5 + power
and Anti's level is trunc(power); the non-empty palette page condition of
try_set_pb_charge is always met; only solo blasts (no joining or donating,
remote players' blasts are not drawn). Left out: the blast objects, camera
and particles, the shared 400-point gauge (add_pb_charge), the effect on
other players' clients.

**Tests:** `tests/photonblast.test.ts` (new): gain dealt / taken and the
level clamp, the gauge cap with its `6x39` / `6x3A`, every blast's power,
the group 4 damage, and the `6x49` / `6x37` / `6x39` / `6x3A` bytes.

**Checked in Chrome** (WebHunter, Forest 1, test HP from the console): being
hit by Boomas (18 damage at level 2) charged the gauge 11.7 per hit and it
reached 100 ("photon blast ready", `6x39` reached newserv); the status
window's ring showed 100. With Farlla put in the MAG's center slot from the
console (the character's MAG had none yet) and a palette slot set to
{5, 0}, the palette key sent `6x49` with 2 targets, both Boomas took 83
(power 520.5 with synchro 10), then `6x37` and `6x3A` went out and the gauge
was 0. No console errors.

## 2026-10-18: Weapon specials

**What changed:** the palette's special attack now uses the equipped
weapon's special. `combat/specials.ts` decodes the special from the
weapon's data1[4] and ItemPMT's special table and runs HandleSpecialAttack's
formulas; `render/combat.ts` does the hit check, the miss retry, applies the
outcome (steals, costs, status, extra damage, kills) and sends `6x9A`,
`6xC6`, `6xC7` and `6x2F`. A weapon without a special no longer starts a
special attack, and a paralyzed or shocked player cannot attack.

**Details** (Ephinea `PsoBB.exe`):
- **Special:** data1[4] & 0x3f indexes ItemPMT's special table
  (GetPmtItemPair_005e4cdc); ApplyPmtItemStatsToEntity_005e7a20 copies
  {type, amount} to player +0x116 / +0x118. CheckPlayerAttackPermission_006994d4
  needs a special byte (or item flags 0x400020) for attack type 2;
  is_player_allowed_to_attack (0x00699510) refuses any attack with character
  flags 0x20006.
- **Hit** (unknown_melee_attack_2, 0x006997a0): accuracy 0.5 * combo step
  (0.1, 0x0093dae0, for an unidentified weapon); a hit calls the enemy's
  HandleSpecialAttack (0x007753b4). A miss shows MISS for types 4, 5, 6, 9,
  10, 13; the others roll again with 0.5 * combo step and deal a plain
  strike (multiplier 0.5).
- **HandleSpecialAttack:** reduction 0.5 for swords / daggers / partisans,
  0.33 for slicers / mechguns / shots (0x00978220 / 0x0097821c); Ultimate
  android +30 power except fire / thunder / instant kill. HP steal
  min(power * HP * 0.01, (difficulty + 1) * 30), TP steal min(power * max TP
  * 0.01, (difficulty + 1) * 25), both then a strike at 0.6 and `6x9A`
  what 3 / 4; EXP steal a strike at 0.6 then `6xC6`; Charge (200 meseta,
  `6xC7`), Spirit (20% TP, needs 10), Berserk (25% HP, `6x2F`) strike at
  3.0; freeze via freeze_activation_check (0x007771a0: min(c, 0.4), 0.2 in
  Ultimate) and paralysis / confusion with c = (power - ESP) * 0.01 *
  reduction; fire / thunder (100 - EFR / ETH) * 0.002 * (level / (5 - power)
  + (1 + power) * 20) * 5, thunder's shock 1/15 (0.025 Ultimate,
  0x007770d0); instant kill (power - EDK) * 0.01 * reduction, not on boss
  maps; HP divide (1 - power * 0.01) * HP on a roll below 0.5. Values are
  truncated (fistp with the control word | 0xc00).

**Assumed:** an unidentified weapon's special still applies after its 0.1
hit check (ApplyPmtItemStatsToEntity masks only 0x3f); the V50x boosts are
1.0 / 0.0 (no units tracked); the two parts of a steal show as one number;
the equipped weapon is read from the session's character file (the join
snapshot went stale after an equip, a bug fixed here). Left out: the weapons
with their own special routines (the item vtable's extraspecial attack:
Lavis Blade, Twin Psychogun, Sigh of a God, ...), the special effect
particles and sounds.

**Tests:** `tests/specials.test.ts` (new): permission, reduction, the retry
rule, every type's formula / chance / cost, the android bonus, boss maps,
and newserv's special table rows (Burning, Hell, Demon's).

**Checked in Chrome** (WebHunter, Forest 1, sabers made with `$item`, the
first rolls forced low from the console): Arrest paralyzed a Booma (80%),
Blizzard froze one (40%), Fill drained 11 HP (13% of 92), Burning did 101
fire damage (level 2, EFR 0), Tempest did 101 and its shock was refused on a
native Booma, Chaos confused one (76%), Berserk cost 25% HP for a 3x strike,
Demon's took 57 of 77 HP, Hell killed one (83%); with real rolls Arrest
missed, retried as a plain strike or showed MISS. No console errors.

## 2026-10-18: Status effects on enemies

**What changed:** enemies can now be paralyzed, frozen, shocked and
confused. `combat/enemystatus.ts` holds an enemy's two status slots, the
immunities by enemy kind, the durations, the EVP multipliers and the lock;
`render/combat.ts` ticks them, stops a locked enemy (no AI, no flinch, the
motion held), rolls Gibarta / Rabarta's freeze and the Zonde family's shock,
and carries the status bits in `6x0A` (`6x9C` in Ultimate) both ways. The
weapon specials that inflict them are the next entry.

**Details** (Ephinea `PsoBB.exe`):
- **Infliction**, the enemy branches of the shared entity functions:
  maybe_paralyze_entity (0x007789c8) skips machines (+0x2e8 & 4), EVP -0.15
  (0x00978100), 0xd2 frames; confuse_entity (0x00778be8) skips mini-bosses
  (+0x2e8 & 0x10), 300 frames; freeze_entity (0x00778cc0) no refreeze while
  frozen, EVP -0.3 (0x0097810c), 0x96 frames; shock_entity (0x00778e40)
  takes only on machines, EVP -0.15 (0x0097811c), 300 frames. poison_entity
  and slow_entity only take on entities below 0x1000 / 0x1001: never an
  enemy.
- **Enemy kind** (+0x2e8): the constructors and set_enemy_attribute_to_*
  (Forest native, Caves A.beast, Mines machine, Ruins dark; Gibbles, Gi Gue,
  Mericarol, Dorphon with the mini-boss bit).
- **Lock:** update_enemy_control_object (0x00787a80) runs vtable +0xa0
  (confusion tick), then +0x98 (paralysis), +0xa8 (shock), +0xa4 (freeze)
  and stops at the first that returns 1; then the enemy only refreshes its
  reticle and minimap icon, skipping the AI and the damage reaction. A
  confused enemy keeps acting.
- **Sync:** send_packet0x60_subcommand0xa (0x00787710) sends the whole flag
  word; in Ultimate the low six bits are cleared and the new ones go first as
  `6x9C` (0x007877bc). action_hit_enemy (0x007877e8) -> restore_enemy_status
  calls the entry of every newly set bit (not in Ultimate);
  handle_packet0x60_subcommand0x9c (0x007878f4) does it in Ultimate.
- **Technique rolls** (entity_hit_by_tech, jump table 0x00977ea0): group 2
  (Gibarta / Rabarta, 0x0077494a) c = (max(0, p - 250) * 0.025 + 5) * 0.025
  on the hit's power argument, min 0.4, 0.2 in Ultimate above 0.2; group 3
  (Zonde family, 0x00774760) 1/15, 0.025 in Ultimate. Barta (group 0x13)
  has no roll.

**Assumed:** the motion holds while locked; the kinds of the Dimenian
family, Claw / Bulclaw / Bulk and the Rappies (runtime rappy_attributes)
follow their area; the immunity bits +0x11c and the flags 0x8000 /
0x1000000 are 0 on every enemy; the look of the effects (a tinted pulse
instead of particles 0x26 / 0x21 / 0x24 and the ice object). Left out: what
a confused enemy does differently.

**Tests:** `tests/enemystatus.test.ts` (new): kinds, immunities, durations,
EVP, the lock and its chain order, `6x0A` / `6x9C` bits both ways, the
technique rolls.

**Checked in Chrome** (WebHunter, Forest 1, an Arrest Saber made with
`$item`, rolls forced low from the console): a Booma was paralyzed (210
frames), its motion held and it did not act; the outgoing `6x0A` carried
flags 0x20900202 (paralysis bit); after ~7 s "paralysis wore off" and it
walked again. A Blizzard Saber froze another Booma (40%), a Tempest Saber's
shock was refused on a native Booma. No console errors.

## 2026-10-18: Poison Lily, Savage Wolf, Rag Rappy and Monest behaviour

**What changed:** four Forest / Caves families now run their own state
machines instead of the generic walking FSM (`combat/enemyfsm.ts`, driven by
`render/combat.ts`; `render/enemyview.ts` can build a model at run time). The
Poison Lily tracks, spits poison and bites, and screams (paralysis) after a
flinch; the wolves stalk, leap in an arc and hop back; a killed Rag Rappy
lies down, gets up and runs off; a Monest spawns Mothmants into its own
MOTHMANT entity slots.

**Details** (Ephinea `PsoBB.exe`):
- **Poison Lily** (LilyAI_Update_00527e74, table 0x009bc280): idle searches
  250; tracking turns at 512 BAMS (0x009bc33c), refreshes its target every 20
  frames, goes back to idle past 300 (0x00922044), bites closer than 50
  (0x00922040) inside AttackData's angle, else spits once its frame count
  passes 100 (0x0092203c). The spit (0x00529e68, update 0x0052a08c) leaves the
  mouth 12 up at frame 12, flies 4.0 a frame (0x009221c4), falls 0.1 a frame
  more from frame 18, lives 150 frames, radius 2.0, and hits with
  {group 0x0f, 2.0} (0x009bc384): poison, no damage; a hit sets the Lily's
  flag 2 (0x00529c78) and it switches to the satisfied row. The bite lands at
  frame 10 (try_hit_entity 1.0, knockback 3.0) and holds 3 + 20 frames.
  After a flinch: roll < 0.3 (0x00922084) screams; at frame 6 it locks the
  first player within 100 (10000 squared) and at frame 25 hits it with group
  0x10 (0x00922070): paralysis.
- **Savage / Barbarous Wolf** (stalk 0x0051cdfc, leap 0x0051c810, hop back
  0x0051c264, table 0x009bb860): the stalk circles at a radius easing 0.2 a
  frame toward a random 50..80; after 45 frames it leaps when closer than 30
  (0xa72e04 = 900), when the target faces it (below cos 0x6aaa) or with roll
  < 0.5 every 451 frames. The leap aims with d = min(distance, 40), steps
  d / 13.333 a frame, rises 20 - 20 (t - 15)^2 / 15^2 for 30 motion frames
  (0xa72dfc = 15), slows by 0.8 after, hits at frame 20 with knockback 7.0
  and ends in the hop back (1.8 a frame, turned 0x1800 by the entity parity).
- **Rag Rappy** (update_rappy, PlayerProcessVulnerableState_00525c90): a dead
  Rappy counts frames and gets up when nobody is within 120 or after 900
  frames, spins a random amount every frame through animation 9 (motion 7),
  then runs (animation 4, motion 3) at its record speed * 3.5 (0x00921be8),
  turning 90 degrees when a player within 300 is within 0xaaa of its heading
  (after 15 frames), and is deleted when its next step finds no ground.
- **Monest** (monest_constructor, MothmanManageSpawnLogic_00519ad0,
  spawn_mothmant_from_monest): total = initdata_param3 (max 30), batches of
  2 every 120 frames, never more than 6 alive; the spawn state (animation 5,
  motion 7) spawns at motion frame 15, 25 above the Monest (0x00920e68).
  The first child's entity index is the Monest's + 1 (+0x3cc), +1 per spawn,
  which is the MOTHMANT slot newserv's expandEnemySets gives it, so a killed
  Mothmant's 6x0A / EXP request uses the right index.

**Assumed:** the leap's motion speed (written at run time) is
30 / 13.333 = 2.25 so the leap covers d; the stalk step 0.7 and the far
logic as a straight approach; the Lily's satisfied state lasts 60 frames; the
spit ends at the ground; the player's projectile radius 5; the Rappy runs at
the MovementData engaged speed (fparam1 = 8 would make 28 a frame) and is
also removed after 600 frames of running; the Monest wakes when a player is
within 225; Mothmants fly 15 above the ground and use the generic FSM; the
spit is drawn as a small green ball. Left out: the wolf's side dash and the
Barbarous Wolf's howl (Zalure / Jellen), the Lily's low-HP spin, Ultimate /
Del Lily's Megid, the Rappy's own chase states, the Mothmant's own FSM.

**Tests:** `tests/enemyfsm.test.ts` (new): Lily search / track / spit timing
/ bite / scream / satisfied, the spit's flight, the wolf's leap arc and its
stalk -> leap -> hop -> stalk cycle, the Rappy's get-up timing and run speed,
the Monest schedule and its MOTHMANT slots.

**Checked in Chrome** (WebForce, with test HP and placement from the
console): in Cave 1 a Poison Lily tracked, spat after ~3 s and the spit
poisoned the player (then the satisfied row); a flinch with a forced low roll
made it scream and the player was paralyzed (`E-118 (POISON_LILY):
paralysis`). In Forest 1 a Savage Wolf went stalk -> leap (lift up to 19.2)
-> hop -> stalk and its leap hit; a killed Rag Rappy got up 2.4 s after its
death motion and ran ~200 units before it was removed; a Monest (E-15)
spawned Mothmants E-16, E-17 ... in pairs, they attacked, and killing E-16
was accepted by newserv (EXP granted). No console errors.

## 2026-10-18: Status effects on the player

**What changed:** the local player can now be poisoned, paralyzed, frozen,
shocked, slowed and confused. `combat/status.ts` holds the two status slots,
the infliction rules, the ticks and the cures; `render/combat.ts` runs it on a
field, shows the icons in the status window, locks the player while frozen or
paralyzed, slows the attack motions, sends `6x0C` / `6x0D`, and Anti now
really cures. Antidote / Antiparalysis can be used from the Item Pack and the
Inventory panel while the player has that effect (`net/items.ts`).

**Details** (Ephinea `PsoBB.exe`, player vtable 0x00b39460):
- **Slots:** slot 0 (+0x25c type, +0x260 EVP multiplier, +0x264 counter)
  holds poison (0x0f) or paralysis (0x10); slot 1 (+0x268 / +0x26c / +0x270)
  freeze (2), shock (3), slow (0x11) or confusion (0x12). The types are
  entity_hit_by_tech groups (0x0f..0x12 call vtable +0xb8..+0xc4, the freeze
  roll +0xc8, Zonde +0xcc); the flags are the low six bits of +0x30.
- **Infliction:** poison_entity (0x007788ec) and maybe_paralyze_entity
  (0x007789c8) do nothing on an android (+0x2e8 & 4; 0x006951a0 sets it to 4
  for class flag 0x10). Poison starts its counter at 45; a player's paralysis
  has no EVP change and no timer; slow 0xd2 frames, confusion 300, freeze 0x96
  with EVP -0.3 (0x0097810c) and no refreeze while frozen, shock 300.
- **Poison damage** (poison_effect_tick): every 45 frames
  trunc(HP * 0.0066666668) (0x00978188, fistp in truncation mode), at least
  1, plus [0, 2, 5, 10] by difficulty (0x00978180, indexed by 0x00a9cd68);
  an HP below 1 is put back to 1. Poison and a player's paralysis never wear
  off on their own; slot 1 counts down and clears.
- **Sync:** 0x006894d4 compares the flags with +0x3d8 every frame and sends
  `6x0C {type, 0.0}` through vtable +0x140 (0x0068ff70) when a slot gains an
  effect, `6x0D {slot}` (0x006895d4) when it empties.
- **Cures:** Anti = Player_ClearStatusEffect (0x00779868) by level. Antidote
  (03 06 00) and Antiparalysis (03 06 01): the tool's use entry 0x005dee9c
  (vtable 0x00b0e5e0 +0xa8) calls vtable +0xdc (0x00779574, poison only) /
  +0xe0 (0x007795ac, paralysis only); 0x0068be94 refuses the item without
  that flag.
- **Effects:** a frozen player sits in input state 0x13 (no input); slow
  multiplies the motion step by 0.5 (0x0093c710); the HUD icons are
  get_monster_status of +0x25c and +0x268 before the technique slots.
- **Enemies:** in Ultimate only, a landed Savage Wolf hit slows and a
  Barbarous Wolf hit paralyzes with roll <= 0.1 (0x00921304,
  SavageWolfProcessStateAttack_0051c810), a Mothmant hit poisons with
  roll < 0.05 (0x00920c0c, state function 0x0051784c). The Poison Lily's
  spit is the next entry.

**Assumed:** paralysis locks movement, attacks and techniques like the
freeze (no test of the paralyzed bit was found in the player's input
states); dying ends every effect. Left out: confusion's steering
(should_do_confused_movement), the freeze button mash (+0x3e0), the
particles and sounds of the pulses, status effects on enemies.

**Tests:** `tests/status.test.ts` (new): poison damage table and period,
paralysis never ending, every slot-1 duration with its 6x0C / 6x0D pair, the
freeze EVP and refreeze rule, slow, android immunity, Anti levels,
Antidote / Antiparalysis, icons, 6x0C / 6x0D parsing and the Ultimate rolls.

**Checked in Chrome** (WebForce, Forest 1, inflicted with a console call):
poison took 1 HP every ~1.5 s (28 -> 24 in 6 s), the poison icon showed next
to the status window, `6x0C 0x0f` went out; Anti Lv7 cleared it and sent
`6x0D 0`. A paralyzed player did not move while W was held, could not cast,
and walked again after Anti Lv3 (`6x0C 0x10`, `6x0D 0`). No console errors.

## 2026-10-18: NPC talk cameras

**What changed:** talking to an NPC now moves the camera the way the client
does: five NPCs get a camera mover that frames them from a fixed spot, the
others turn the player camera to the side, and some NPCs no longer turn to
the player. Code: `formats/npcmodels.ts` (tables), `render/npcview.ts`,
`render/lobbyview.ts` (`talkCameraTurn`, `cameraView`), `render/gamefield.ts`,
`render/gameview.ts`, `quest/town.ts`.

**Details** (Ephinea `PsoBB.exe`, EnemyObjectUpdate_0060648c):
- **State 0:** for the actions 0x3e9, 0x3ea, 0x3ee..0x3f3, 0x3f9, 0x419,
  0x41a, 0x41b, 0x41f, 0x427..0x42d and 1099 the NPC does not turn: the
  player is turned to face it (6x3E) and the talk starts at once.
- **State 1, camera movers:** actions 1001 (Principal), 1002 (secretary),
  1050, 1051 and 1055 (Lab) call camera_mover_constructor with type 7, 9,
  0x12, 0x13 and 0x14. NpcCamera_Construct_004d6074 starts from the current
  camera source / target; its update 0x004d5f88 eases both toward the row of
  0x00909260 (0x18 bytes per type: source, target in world coordinates) with
  unknown_vec3_lerp (0x004d63b0, `lerpPoint`) and a factor of 0.725
  (0x3f39999a), and hands them to SetDefaultNPCCameraView_004d33c0. State 3
  flags the mover for deletion and the player camera comes back.
- **State 1, default:** UpdateDefaultNPCCameraOrientation_004d83f4 sets the
  camera angle (+0x30) to the player's heading + or - 0x6000, the one nearer
  the current angle first; CheckCameraRaycastCollision_004d847c (two 0x100
  rays) makes it try the other, and both blocked leaves the angle alone.

**Assumed:** the rays of the side view go to the player camera's desired
source at the new angle (the exe uses the camera's +0xdc..+0xe4 offset);
the view changes at once because the player's turn for the talk already
snaps the camera. Left out: what the camera's talk flag +0x100 does to the
player camera (field of view eased to 0x22d8, a target offset in
CalculateCameraTargetPosition_004d86f4).

**Tests:** `tests/npcs.test.ts` section 8: the five mover actions belong to
the Principal (0x1b), the secretary (0x20) and the Lab NPCs 0xd1, 0xd2, 0xf8,
every mover view looks at its NPC, and the ease settles.

**Checked in Chrome** (WebHunter, Pioneer 2): talking to Principal Tyrell
(started with `startTalk`) moves the camera to (-4.8, 11.7, -2015.1) and
frames him while his balloon shows; after the dialogue the player camera is
back. Talking to the TObjNpcExpertBase of action 1003 turns the NPC to the
player and the camera to heading + 0x6000 (side view); after the talk the NPC
turns back to its spawn angle 0xb000. No console errors.

## 2026-10-18: Lobby object collision

**What changed:** the four TObjLobbyMain objects of every lobby now stop the
player, like the client's object hitboxes do. Code: `render/lobbyview.ts`
(`lobbyMainBody`, added to `CollisionWorld.bodies` when the lobby loads).

**Details** (Ephinea `PsoBB.exe`):
- The constructors of every object type in the lobby `o.dat` files (rows of
  the object factory 0x00a06be0) were checked for
  InitEnemyCollisionBoxes_007b9a88 / ConstructEntityHitbox_007b9ccc. Only
  TObjLobbyMain (0x0182, create 0x00672254, constructor 0x006722d0) has one:
  the round box 0x009c9778, center at the object, radius 32, flags 0x10003.
  TObjInfoCol, TObjWarpLobby, the pigeons, butterflies, pumpkins, stained
  glass, curtain, aquarium, particles and fish have none; the counters are
  part of the map collision.
- The player meets object hitboxes in MericarolProcessCollision_007b7e9c
  (the player-vs-object pass) with the same step response as the NPCs
  (EnemyHandleCollisionStepUp_007b7704): a move into a box within 90 degrees
  of the heading is refused. The player's hitbox radius is 5 for every class
  (see the entry below), so the player stops 37 units from the center.

**Assumed:** the player-vs-object pass runs in the lobby as in a game (the
player's +0x32c mode there was not traced). Left out: TObjLobbyMain's model
(the seasonal decoration of `bm_obj_lobby_main.bml`), and round hitboxes of
field objects other than the doors.

**Tests:** `tests/collision.test.ts` section 4: in all 10 lobbies, walking
straight at a TObjLobbyMain stops 37 units from it.

**Checked in Chrome** (WebHunter, lobby 1): the four bodies load at
(+-176, -139) and (+-175, 211); walking at the one at (-178, -139) from 70
units stops the player 38 units away, at the edge of its octagonal pad.

## 2026-10-18: Walking townspeople and NPC collision

**What changed:** the Pioneer 2 and Lab NPCs whose set entry has param6 = 1
now walk around their spawn point, the others turn back to their spawn angle
after a talk, and every shown NPC has a round hitbox that the player cannot
walk into. Code: `render/npcwander.ts` (pure state machine),
`render/npcview.ts`, `render/collision.ts` (`bodies`, `bodyBlocks`),
`render/gameview.ts`.

**Details** (Ephinea `PsoBB.exe`; every humanoid NPC vtable has the same
slots, e.g. 0x00b1ece0):
- **Modes** (+0x32e, dispatched by EnemyObjectUpdateAnimation_00606e34 to
  vtable +0x154..+0x160): 0 nothing, 1 0x006061ec turn back to the spawn
  angle, 2 0x00606280 wander, 3 EnemyObjectUpdate_0060648c talk. vtable +0xf4
  (0x00607284) picks 2 when param6 (+0x370, clamped to 0..1 by set_params
  0x00606a34) is 1, else 1. The talk start (vtable +0x2c, 0x006072e0) sets
  mode 3 and the walk motion, which plays while the NPC turns to the player;
  the talk's end sets mode 0.
- **Motion** (vtable +0x168, 0x0060c834): row 1 of the motion table (walk,
  1.4 frames a tick) or row 0 (idle, 0.9).
- **Wander** (mode 2, sub-state +0x330):
  - 0: a random BAMS angle (0x007751b0 random float x 65536), the point
    param1 (+0x35c) from the spawn point (+0x50) in that direction; taken when
    its squared XZ distance to the NPC is above 100 (0x0092f13c), aimed at with
    SorcererAcquireTarget_00771c8c (ground under it, no wall on the way, else
    the old target stays), walk motion;
  - 1: turn to the target by 0x400 a tick (0x00772358), move 0.5 a tick
    (0x009c3eb4, written by 0x006073ec) along the new angle with the wall slide
    (0x00771934 / 0x00771994); stop (idle) once within 0.5 + 5 of the target
    or after touching a character (hitbox flags 0x380000);
  - 3: wait 121 ticks (+0x2b0 up to 0x78), then 0 again.
- **Hitboxes:** the NPC box 0x009c3ecc is round (unk2 0), radius 5, center
  (0, 10, 0); the player's (SinowberillChallengePlayer_InitializeSpawnData
  _00695f28, box at player +0x758) is round with radius 5.0 for every class
  (only its height comes from the class stats), so `PLAYER_RADIUS` = 5 was
  right. CheckTwoHitboxCollision_007b5e40 tests round boxes with
  CheckSphereOverlap_0083dbd4 at y = 0 (XZ distance < r1 + r2).
- **Response** (EnemyHandleCollisionStepUp_007b7704): when the mover moved
  and the other center is within 90 degrees of its angle, a player goes back
  to its previous position; an NPC sidesteps 0.25 (0x0097e390) at right
  angles to the other center from its previous position.

**Assumed:** the AI dispatcher calls vtable +0xf4 every tick in mode 0; +0x50
is the set entry position; the player's heading is the direction it moves;
the wall slide is `CollisionWorld.move`; `Math.random` stands in for the
entity's random generator; hidden NPCs neither move nor collide; an NPC
answers only the first body it overlaps in a tick. Left out: the footstep
sound of the walk (vtable +0x170 on frames 1 and 15).

**Tests:** `tests/npcs.test.ts` section 7 (mode selection, the wander circle,
the 121-tick wait, the turn back in 18 ticks, a player stopping a wanderer,
`bodyBlocks`, the seven Pioneer 2 wanderers on the real collision for 3000
ticks, and a player stopped 10 units from an NPC).

**Checked in Chrome** (WebHunter, game in Pioneer 2): the seven wanderers
switch between walking (mode 2 sub 1, walk motion) and waiting, moving
several units in 6 seconds and staying near their circles; walking at a
soldier and a male NPC stops the player 11.5 / 10.5 units from them, 3.2
with the bodies removed. No console errors.

## 2026-10-18: Remaining field objects, construct_objects and the door unlock camera

**What changed:** the jungle rocks, the Ruins / Seabed trap pillars and Vol
Opt's ship door now have models; the lobby door and shop generators are
counted as drawing nothing. Objects of a group other than 0 wait for
`construct_objects`, and a Forest door with an odd param6 shows its unlock
camera. Code: `formats/objectmodels.ts`, `render/fieldobjects.ts`,
`render/gamefield.ts`, `render/gameview.ts`, `quest/run.ts`.

**Details** (Ephinea `PsoBB.exe`):
- **TORockJungleS01 / M01 / L01** (0x206 / 0x207 / 0x208, created by
  0x00635040 / 0x0063540c / 0x006358b8): models 0, 2 and 4 of
  `bm_o_rock_jungle.bml`. The loader 0x00635b6c picks the textures by map:
  `o_rock_jungle_04` in the Mountain, `_05` at the Seaside, `_123`
  elsewhere. Collision boxes 0x009c63a0 / 0x009c63cc / 0x009c63f8.
- **TOTrapAncient02 / 02R** (0x154 / 0x167, constructors 0x0063c638 /
  0x0063b5b4): model 0 with its own texture list. The loader 0x0063c08c
  (switch 0x00933ff4) uses `ruins_pillar` in the VR Temple,
  `seabed_pillar` in the Episode 2 outdoor maps, Seabed and towers,
  `torabasami` elsewhere. The trap's behavior is not done; the model stands
  in its bind pose.
- **TODoorVoShip** (0x130, constructor 0x00622648, render 0x00622358):
  model 1 (texture list 1, motion 0 held at its last frame) and model 0,
  box 0x009c5574. The seal lamps hidden by quest flags 0x2c-0x2f, their
  pulse and the `.njs` shape motion are left out.
- **Draw nothing:** TObjCityDoor_Lobby (0x54) renders through the empty
  0x0061cdb0 and does nothing online; TShopGenerator (0x40, vtable
  0x00b3c780) also renders through 0x0061cdb0.
- **construct_objects:** the floor loader 0x008129b0 skips objects whose
  group is not 0 (unless synced flags 0x11 say they exist). The event action
  / quest opcode `construct_delayed_object` (0x8A), at 0x00810ae8, creates
  the floor's objects of that room and group (flags without 2 or 8) and
  sets flags 0x12. Until then they are hidden and take no part in warps,
  doors, switches, triggers or boxes. The constructed groups are kept per
  floor across visits. A boss floor's exit warp is one of these (group 1).
- **Door unlock camera** (TObjDoor 0x80, update 0x00656eb4):
  - the constructor 0x006573d4 stores clamp(param6 % 2, 0, 1) at +0xbc
    (so -1 gives 0) and 0x50 at +0xc0;
  - when the switch flag unlocks the door, +0xbc = 1 sends it to state 1
    instead of 2: `SetDefaultNpcCamera(9)` and
    `SetDefaultNPCCameraView_004d33c0` with the source at param1..3
    (+0x68..+0x70) and the target at the door (+0x38);
  - +0xc0 counts down; at 0 `InitializeDefaultNPC()` hands the view back
    and the door goes to state 2. The laser keeps playing while the count
    is above 0x3c, and the render 0x00656a50 keeps the locked look while it
    is 0x3c or more.

**Assumed:** param1..3 are world coordinates; the unlock view is placed
directly (the NPC camera's own easing is not reproduced) and does not hold
the player's controls.

**Tests:** `tests/warpmenu.test.ts` (unlock camera states and timing, param6
parity, delayed objects, the Dragon floor's exit warp is delayed);
`tests/waves.test.ts` builds every new model without missing textures.

**Checked in Chrome** (WebHunter, Episode 2 game):
- Jungle North: 10 jungle rocks built and drawn with their textures;
- VR Temple Alpha (6) and Seabed Upper (10): the trap pillars built with
  textures;
- Barba Ray: the exit warp (0x280, room 1 group 1) stays hidden with no
  warp until `construct_objects 1/1`, then appears and registers as an area
  warp to floor 0. No console errors.
- No free-play Forest door has an odd param6, so the unlock camera only
  shows in quests; it is covered by unit tests.

## 2026-10-18: Camera easing, target lead and wall checks

**What changed:** the player camera no longer jumps to its computed
position. It eases toward it the way the exe's camera controller does, the
target leads the running player, and walls stop the camera.
`render/playercamera.ts` holds the camera; `render/lobbyview.ts` passes it
the floor's collision and the field of view.

**Details** (Ephinea `PsoBB.exe`):
- **One frame** of the player camera (`UpdateUnknownPlayerCamera_004d7698`,
  vtable 0x00afca90):
  - `UpdateCameraTargetWithCollision_004d88e8` (vtable +0x28) sets the
    source lerp factor +0x58 to 0.67 (0x3f2b851f) and the camera mode +0x38
    to 5 (collision + lerp);
  - `adjust_camera_for_boss_maps_and_handle_zoom` (+0x2c) reloads the zoom
    row and sets the turn goal +0x10c to heading + 0x8000;
  - `ProcessCameraChaseState_004d7a1c` turns the angle +0x30;
  - the desired source (angle) and target (heading, plus 18.0 (0x00909750)
    times the player's last move) are computed.
- **Chase states** (+0xf8):
  - state 0 waits for a move of 0.5 units or more and goes to state 1;
  - state 1 turns with `SmoothCameraAngle_004d6370`. Speed 5 x 127 BAMS,
    or speed 2 while the camera is 23 or more from its target in XZ (529,
    0x009096e4). It goes back to state 0 on a frame without a move, after
    turning;
  - state 2 (speed 3 after 250 idle frames, +0xf4) is never reached:
    nothing in the exe increments +0xf4 (it is only ever written 0).
- **Sight check** (`CalculateCameraTargetWithCollision_004d235c`):
  - casts a mask-0x100 ray from the camera source to a probe at the
    target's height, 13 (0x00908fc0) x |move| from the player toward the
    camera;
  - a move under 1.0 while the camera looks along the player's axis (|dot|
    > 0.25) makes the distance 0;
  - a hit snaps the chasing angle behind the player. When the camera is
    within 20 (400, 0x009096e0) of the player, it turns at speed 0x16c
    instead, with a source lerp of 0.05.
- **Controller** (`UpdateDefaultNPCCameraState_004d3abc`):
  - `set_global_camera_source_and_target` copies the desired points and the
    two factors: source +0x58, target +0x5c = 0.289 (0x3e93f7cf, from
    `MapObjectSubEntity_BaseConstructor_004d1f68`);
  - `unknown_handle_camera_collision_with_geometry` casts a mask-0x901 ray
    from the last safe source to the desired one. A hit keeps a safe source
    1 unit before the wall and raises +0x174;
  - `lerp_camera_position` moves each point toward its goal by
    0.16 (0x00909524) x distance x factor, or by 12 (0x00909520) once that
    step reaches 5.0 (0x00909510) (`unknown_vec3_lerp`, checked in the
    disassembly at 0x004d63b0);
  - `handle_camera_source_colliding_with_map_geometry`, while +0x174 is
    up, puts the source on the first wall between the target and the
    source.
- **Field of view:** +0x54 is 0x36c1 (base constructor), eased toward
  0x36c1, and goes to the projection at 0x0082ebc8 with the same math as
  `njPerspectiveFovy`: 59.1 degrees instead of the viewer's 60.
- **Left out:** the lock-on hold of state 1 (player +0x45c, target within
  70); guard / freeze / death; the Pioneer 2 target height offset (eased to
  0 there); the shake; the NPC and boss cameras; the 0x22d8 field of view
  of mode +0x100.
- **ASSUMED:**
  - the camera facing used by the sight check is the horizontal direction
    from source to target;
  - spawns and warps show the camera at once (the controller's copy of the
    desired points);
  - `CollisionWorld.segmentHit` stands for
    `cast_ray_at_map_collision_geometry`.

**Checks:**
- `tests/controls.test.ts` covers:
  - the target lead;
  - the two lerp factors and the 12-unit step;
  - the first-frame snap and the easing after a run;
  - state 0 -> 1 -> 0 and the far step;
  - the sight ray snapping the angle;
  - the source stopping on a wall it would cross.
- In Chrome (WebHunter, Pioneer 2), sampled every 100 ms while holding W:
  - the source lagged up to ~74 units behind the player (45.4 at rest);
  - the target stayed ahead of the player;
  - the chase state went 1 while running and 0 after the stop;
  - after the stop, the source eased back to 45.5 behind and the target to
    5 in front;
  - the wall clamp was not exercised live.

## 2026-10-18: Floor item presentation from the exe

**What changed:** floor items are placed, turned and drawn as the exe does
it, the pickup plays its sound, and the local drop goes to the spot the
exe's search finds. Changes are in `render/flooritems.ts`
(`floorItemHeight`, `findDropSpot`, the pickup SE) and `net/items.ts`
(`FloorItem.y`, `onPickedUp`, `dropSpot`, the 6x2A amount).

**Details** (Ephinea `PsoBB.exe`):
- **There is no arc.** The 6x5F / 6x5D handlers
  (`handle_player_dropping_item_from_stack`) build the item and call
  `create_item_box_on_ground` (0x005c4874). It does four things:
  - places the item at its source position. y is 0 for 6x5F / 6x5D / 6x6D,
    because the constructor zeroes it; 6x2A carries its own y;
  - gives it a random Y angle (`rand() / 32768 * 65536` BAMS, 0x0092bb74 /
    0x0092bb78);
  - calls `set_item_y_floating` (0x005c49a4), which moves the origin to the
    ground found under y + 300 (0x0092bb70) plus 6 (0x0092bb6c). If there
    is no ground, y stays as it was. The origin is not seated by the model's
    bounding box;
  - spawns the particle 0x9B when the floor is already loaded.
- **Each frame** (`UpdateGroundItem_005c4010`) the angle grows by 0x200
  BAMS. Nothing makes the item fall or bob.
- **Drawing:** `render_item_box` (0x005c37c4) draws the model with fog off.
- **Pickup:** 6x59 calls `HandlePlayerPickupSuccess_005c4c1c` for every
  picker on our floor. It spawns the particle 0x9B and plays SE 0x571 at the
  picker (`play_sound_effect_at_player`). Here the SE plays when the picker
  is within 300 of us, the range at which 3D sounds are dropped.
- **Nothing on a drop:** none of the drop paths plays a sound, and no unitxt
  line or message window reports a find or a pickup.
- **Local drop** (0x0068d878 -> `HandleItemAcquisition_006a43b8`, from the
  disassembly):
  - the search runs over rings 1..5 around the player;
  - ring r has radius 6r (0x0093db68) and 4r spots, starting from the
    player's facing, at centre + (sin a, cos a) x radius;
  - the first spot with ground wins;
  - 6x2A then carries that x / y / z, and the stack count as its amount
    (0x005d29b0).
- **Left out:**
  - the 0x9B "w_itemget" particle (a type-1 effect; `classic/particles.ts`
    only runs type 0);
  - 3D attenuation of SE 0x571;
  - the spot search's line-of-sight test (0x0077fffc) and the 6x2C hold
    (900 frames) sent before a drop;
  - the pending-pickup lock (+0x94, 900 frames).
- **ASSUMED:**
  - a spot's ground is probed from the player's height + 6;
  - a failed search keeps the player's position;
  - the web player's angle uses the exe's (sin, cos) facing.

**Checks:**
- `tests/drops.test.ts` covers:
  - the height rule (probe heights, offset, no ground);
  - the spot search (in front, ring 2, none);
  - 6x2A carrying the stack count and the spot;
  - the 6x59 pickup hook.
- In Chrome against newserv (WebForce, Forest 1):
  - **Drop:** the player stood at (528.8, 34.95, -5.39) facing 3.02 rad.
    Dropping the Monofluid x4 placed it 6 units in front, at (529.53,
    40.90, -11.34): ground 34.90 + 6, at a random angle;
  - **Pickup:** picking it up called the pickup hook for picker 0, removed
    the item, and gave Monofluid x4 back;
  - **`$item 030200`:** the item came as 6x5D with no height and was placed
    at 40.95 (ground under 300, plus 6);
  - newserv kept the connection;
  - the SE itself was not heard (no audio in the test browser).

## 2026-10-18: MAG feeding

**What changed:** Item Pack > MAG opens the MAG window: the mags, "Give
Items", the items a MAG eats, and the feed, which sends `6x28` and applies
the client's own feed to the mag (stats, synchro, IQ, level, evolution,
photon blast). `net/magfeed.ts` (rules), `GameItems.feedMag` /
`feedTimer` / `tickMags` in `net/items.ts`, `classic/magmenu.ts` (window),
wired in `classic/fieldmenu.ts`, `render/fieldhud.ts` and
`render/gameview.ts` (ItemPMT, ItemMagEdit.prs from the stream file, SE
0x580).

**Details** (Ephinea `PsoBB.exe`; the dump calls this window
ChallengePlayerListWindow*):
- **Window** (menu id 0x17 -> `0x007525bc`, states `0x007526c8`):
  - MAG list: entry 7 (13, 256), 206 x 184, title [0x3C];
  - the mag's window: entry 9 (395, 256);
  - Select: entry 8 (221, 256), 172 wide, title [0x30]. It holds "Give
    Items" [0x78], off once the feed count reaches 2.0 (0x00973e64), and
    "Photon Blast" [0x77], off without one;
  - Item List: entry 0xD (13, 317), 308 x 124, title [0x37]. It lists the
    tools whose PMT item flags have bit 4 (`CheckItemEquipConditions_005d5f40`,
    `0x0074b6f4`).
  - After a feed, the stat levels rise one step every 30 frames
    (0x00973e6c) with SE 0x96. A new photon blast shows "[0x77] <name>"
    (unitxt group 9) for 90 frames (0x00973e68). Then the window returns
    to Select.
- **Feed** (`Player_UpdateStateAndSync_0068dcc8`): `6x28 {mag id, item
  id}`, then one of the item removed. The local 6x28 (`action_feed_mag` ->
  `ExecuteMagFeed_005da00c`) does the rest:
  - the row is the tool's PMT index in the mag's feed table
    (`pmt_get_mag_feed_item`);
  - `mag_feed`: each stat goes up, or goes down only by less than its part
    within the level, while the level is below 200; at level 200 a stat
    stops at x.99. IQ is clamped to 0..200 and synchro to 0..120. The
    level is the sum of the four stats / 100;
  - `ProcessMagEvolution_005da254`, using the ItemMagEdit stage (root
    +0x14):
    - levels 10..34: stage 0 by class;
    - levels 35..49: stage 1 (`mag_evolution_alignment` checked against the
      exe);
    - level 50 and up, on multiples of 5: the special evolution, else stage
      2. These two branch tables come from newserv's port;
  - a new mag type adds its photon blast.
- **Feed timer:** the first feed starts it at 0x189c frames
  (`get_mag_feed_timer`; its other value 0x1fa4 depends on a stub that
  returns 0). Each later feed adds 1 to the count. The timer runs down 1
  per frame and clears the count at 0. That allows three feeds, then
  "Give Items" goes grey until the timer ends.
- newserv applies the same feed to its copy (`apply_mag_feed_result`) and
  removes the item on BB.
- **ASSUMED:** the content of the mag's window (Level / Synchro / IQ
  [0xC0..0xC2] and DEF / POW / DEX / MIND with a bar). The exe's stat
  elements are not decoded.
- **Left out:**
  - the Photon Blast choice (`ListWindowObject_Initialize_0075330c`);
  - the 0x9B particle at the mag;
  - taking the weapon off when it no longer fits
    (`Player_ValidateAndUnequipWeapon_0068dd44`);
  - other players' 6x28 (their mags are not modelled).

**Checks:**
- `tests/magfeed.test.ts` covers:
  - the 6x28 bytes and which items a MAG eats;
  - the feed against newserv's table rows, the fall and level-200 rules,
    and the clamps;
  - the level-10 evolutions with their photon blast, and the stage rule;
  - photon blast slots, the timer, the ItemMagEdit table;
  - GameItems.feedMag and the window's flow.
- In Chrome against newserv (WebForce, Forest 1; window opened with
  `hud.menu.open(0x17)`, keys sent to the canvas):
  - the Mag (Lv 5, 25%) listed Monomate x4 and Monofluid x4;
  - one Monomate made it DEF 5.05, POW 0.40, DEX 0.05, synchro 28%, IQ 3,
    and left Monomate x3;
  - after three Monomates it reached Lv 6 (DEF 5.15, POW 1.20), the count
    was 2 and "Give Items" was grey;
  - the timer counted down at 30 per second, and newserv kept the
    connection.

## 2026-10-18: Particle quads by effect_nt renderer (telepipe streaks)

**What changed:** particles are now sized and turned the way their
effect_nt renderer draws them. The telepipe's streaks (0xB2 gate_yurayura)
were wide horizontal bars; they are thin vertical streaks rising from the
pipe. `classic/particles.ts` (`NT_LAYOUT`, `particleQuad`), used by
`render/telepipe.ts` and the "Connecting.." screen.

**Details** (Ephinea `PsoBB.exe`):
- `ParticleEffectSingleParticle_Update_0050e698`: a streak (tex_flags & 4)
  sets width_scale = opt1 (+0x64) x |velocity|, height_scale = opt2 (+0x68)
  x |velocity| and an angle from the projected step; a sprite uses its size.
  The particle goes to `particle_renderers[slot]` (slot + 0x36 with
  tex_flags & 0x20).
- The slot is the texture's place in effect_nt.xvm (`find_effect_nt_index`
  over `effect_nt_texture_ids`, filled in file order by
  `load_effect_nt_data`).
- `effect_nt_metadata` (0x00a101c0, 0x28 bytes per slot; base confirmed by
  `unk_create_particle_renderers` 0x008016be) gives the half size (+0x14 /
  +0x18) and the renderer type (+0x24) of each of the 54 slots.
- `render_particle_renderer3`: an axis-aligned quad of half size proj x
  width x width_scale by proj x height x height_scale, angle unused;
  `render_particle_renderer4`: the same quad turned by the angle, width
  along the step.
- 0xB2's texture (GBIX 700420) is slot 24: half size 16, renderer 3. With
  opt1 0.0399 and opt2 1 the streak is about 1 unit wide and 24 tall per
  1.5 units of speed, upright. The old code turned every streak (renderer
  4) with the width along the step, which laid it on its side.
- **ASSUMED:** the same scale on both screen axes (the exe's x factor is
  FOV / g_CameraFOVMultiplier, y is FOV).

**Checks:**
- `tests/telepipe.test.ts`: the 0xB2 quad (renderer 3, thin and tall, not
  turned), a renderer-4 streak, a sprite's half size, the table.
- In Chrome against newserv (WebForce, Forest 1): Ryuker via
  `gameView.telepipes.open()`; the 0xB2 sprites measured about 1.5-2.3 wide
  by 38-57 tall, rotation 0, and the pipe shows upright streaks.

## 2026-10-17: Ryuker and telepipes

**What changed:** Ryuker and the Telepipe item open a pipe on a field floor;
using it takes the player to Pioneer 2, where the owner's pipe (TObjLuker)
takes anyone back, and the owner's trip closes it. Other players' pipes come
with `6x68` (and `6x70` for a joiner). `net/telepipe.ts` (state, commands,
rules), `render/telepipe.ts` (pipes in the world, using them), wired into
`render/gameview.ts`, `render/combat.ts`, `render/fieldhud.ts` and
`net/items.ts`.

**Details** (Ephinea `PsoBB.exe`; the dump names this code Challenge* /
Sinowberill*):
- **State:** each player object holds a TelepipeState at +0x904 (owner,
  floor, room, x / y / z, angle), filled by `set_saved_telepipe_information`;
  open while its floor is not 0 (0x006e839c).
- **6x68** (`SendTelepipeStatePacket_006e90b8`, 0x1C via 60); the handler
  (`ProcessTelepipeTeleportRequest_006e9410`, subcommand table 0x00a100xx)
  stores it unless it names the pipe already known (same floor, within 0.2
  on the ground plane, 0x0096d920) and shows it when the owner is on our
  floor. A floor that loads shows every pipe on it (0x006e9548).
- **Opening** (`unknown_cast_tech` case ryuker, caster's client only;
  `use_telepipe` calls the same): allowed by
  `SinowberillChallengePlayer_UpdateTelepipeState_00688b4c` (not battle or
  challenge, not a boss map: type 0x0B in the table at 0x0097f040, not a
  safe map); the item is greyed out otherwise (ValidateItemForEquip). State
  0 of the pipe (`ChallengeEntity_Update_006e88d0`) skips a pipe of ours
  already standing there, else `CreateChallengeEnemyEntity_006e8ca4` puts
  the particles on the ground (particleentry 0xB1, 0xB2 and 0xB0 1.8
  higher; colour override by owner, 0x0096d928) and sends 6x68.
- **Using the field pipe:** state 1 waits for its trigger (vtable 0x00b3dae0
  +0x2c sets +0xB0); then the flash 0xB3, `6x2C {10 frames}`
  (SendChallengeEntityPacket_006854a8), SE 0xA1, 10 frames, and the warp to
  floor 0.
- **The Pioneer 2 pipe** (TObjLuker 0x41, param4 owner,
  `SinowberillMapObjectUpdateHandler_0066e3bc`): shows the owner's open pipe;
  within 10 units a window at 0x35 (267, 130) names the area; the key of
  binding 0xC (the left arrow by default) uses it the same way, then warps
  to the pipe's floor; the owner's own trip closes it (0x006e8388) and sends
  6x68.
- **Arrival** (`GetTeleportTargetDataForPlayer_006e9630`): Pioneer 2 at the
  spot of the client id (0x0096d8a0 Episodes 1 / 4, 0x0096d8d0 Episode 2),
  angle 0x4000; the field at the pipe's position and angle.
- **ASSUMED:** the field pipe is used with the Pioneer 2 pipe's key and 10
  units (the trigger is reached through the targeting system, not
  modelled); the pipe appears when the cast is released (the Ryuker effect
  object's timing, 0x006a3df0, is not recovered); the colour override
  scales the entry's colour; the flash spawns once; the area name comes from
  the client's own table rather than unitxt; the window size.
- **Left out:** the type-1 particle 0xB0 (gate_circle), the light made 15
  above the pipe (0x00503450), the loop sound 0xA0. The streak particles
  (0xB2) use the sizes of `classic/particles.ts` (half sizes of 16 x
  opt x |step|), which make wide bars.

**Checks:**
- `tests/telepipe.test.ts`: 6x68 / 6x2C bytes, the store's 6x68 rule,
  closing, where a pipe may open, arrival spots, the 6x70 field, the
  Telepipe item's rule and use.
- In Chrome against newserv (WebForce, Ryuker from `$edit tech ryuker 1`):
  in Forest 1, Ryuker (cast through `castTechnique`) opened a pipe (6x68
  sent, particles shown); the left arrow at it warped to Pioneer 2 at
  (-312, 0, -113) facing 90 degrees; the TObjLuker of owner 0 showed the pipe
  and the "Forest 1" window within 10 units; the left arrow there warped
  back to the pipe's spot in Forest 1 and closed the pipe (floor 0). A
  Telepipe made with `$item` and picked up opened a pipe and was used up.
  newserv kept the connection through all of it. Another player's pipe was
  not tried live (one account).

## 2026-10-17: Tekker

**What changed:** the tekker (bb_p2_menu 6, JUDGMENT) identifies unknown
weapons: `classic/shop.ts` `TekkerCounter`, run by the field HUD like the
shops, with `6xB8` / `6xB9` / `6xBA` in `net/items.ts`. Counter lines with
"\tP" now show page by page.

**Details** (Ephinea `PsoBB.exe`; the dump names these MedicalCenter* /
Dialogbase*, the addresses are what matters):
- **Counter** (`p2_special_npc_menus` entry 6: create 0x006d6e1c ->
  0x006ce490, vtable 0x00b3be28, states 0x006ce528): greeting [1] in the
  clerk window with Money, Enter, then the appraisal window; it closes once
  the last line is read (0x006ce564).
- **Text:** unitxt_shop group `0x0096c6ec[section id]` = 4 + section id
  (`unknown_get_shop_unitxt_3`, title via 0x006dbe14); the section id is the
  one that picks the tekker's model (0x00a9c4d8).
- **Appraisal window** (0x006d93e4, vtable 0x00b3ca60, states 0x006d945c,
  jump table 0x0096c3e8):
  - 0: the items that are not identified (item vfunc +0x84 = 0x005d2fb0: a
    weapon with data1[4] & 0x80, not wrapped) titled [0]; none: [2], close;
  - 1 / 2: Enter -> [3] and Yes / No; Yes with more than 99 meseta sends
    `6xB8 {item id}` (0x006ce6b8, via 62), says [6] and starts a 0x5f-frame
    timer; without: [5], close; No: [4], back to the list; Backspace on the
    list: [0xd], close (0x006ce688);
  - 3 (0x006d9d94): when the timer is out and `6xB9` came (0x006ce718: the
    answer counts only for the id sent), the "Result" list with the item
    under a new id of ours, the description at 0x29, [8];
  - 4 (0x006d9b98): Yes pays 100 itself; if `ValidateItemForEquip` passes,
    [0xc] and Yes / No (state 7, 0x006d96d8), else the swap; No: [9] and
    Yes / No (state 6: Yes pays 100, [0xa], Enter; No: back to [8]);
  - the swap: `6x29 {id, 1}` (Player_RemoveItemFromSlot_0068ee54), `6xBA
    {id}` and the item added under the original id
    (Player_AddItemToInventory_0068f48c); equipping takes the weapon slot's
    item off first. Then [0xb] and the list again.
- **newserv** takes the 100 meseta and an item id at `6xB8`, and repeats the
  accepted item as `6xBE` to the sender too. The exe's 6xBE handler
  (0x0068f74c) adds it without looking at the id; the web client skips a
  6xBE whose id it already has, so the inventory stays as newserv's.
- **Left out:** the item picture window at 0x32 (124, 98), 160 x 120
  (`unknown_get_itemkt_image`) and the "Appraise" / "Miniclear" BGM.
- **ASSUMED:** no cursor bar on the Result list (its flags 0x10 / 0x40 /
  0x80 are not decoded); that a line's later pages are only shown when the
  state waits for Enter.

**Checks:**
- `tests/tekker.test.ts`: group, list filter, `6xB8` / `6xBA` bytes, `6xB9`
  parse, accept with and without the equip question, refuse, the fee check,
  leaving, the timer, GameItems' 6xB9 / swap / 6xBE echo.
- In Chrome against newserv (the counter opened with
  `gameView.hud.openCounter('tekker')`, items made with `$item`): WebForce
  identified a ???? Saber into a Drain Saber +2 (no equip question: the
  class check failed) and, in a second game, a ???? Cane into a Draw Cane
  equipped in place of the Cane; a second Cane was refused (paid, stayed
  unknown). Meseta 2000 -> 1900 -> 1700 matched; after logging in again
  the server's inventory had the Drain Saber +2 once and no unknown Saber.

## 2026-10-17: Counter windows over the status window

**What changed:** the shop and bank counter windows and the main menu are
drawn over the HP / TP status window instead of under it (the field HUD's
overlay canvas sits one layer above the status HUD's, `classic/hud.ts`
`STATUS_LAYER` / `MENU_LAYER`).

**Details** (Ephinea `PsoBB.exe`, named dump):
- Every list window, the status window included, is a child of the player's
  UI element array (`ListWindowObject_Constructor_00710d30` ->
  `ListWindowObject_GetUIElementArray_00719930`).
- `base_game_object_constructor` (0x008193cc) appends a child at the tail of
  its parent's list, and the render walk
  (`recursive_game_object_3rd_method_caller`) goes from head to tail. The
  status window is created with the player's HUD when the floor loads
  (`SinowberillChallengeMenuWindow_Constructor_0071a3d0`), so the counter
  and menu windows, created later, are drawn over it.
- Nothing hides the status window for a counter. It closes only on bits 1 /
  0x10 of the HUD flags (`SinowberillChallengeObjectListWindow_HandleCancel_0071a838`).
  The full map sets bit 1 (`ChallengeMenuListWindow_UpdateSelectionColor_007441a8`)
  and the quest board sets bit 0x10 (`ChallengePlayerListWindow_Constructor_00754294`).
  The shop and bank constructors (`WeaponStoreDialog_Constructor_006d6980`
  and the other `p2_special_npc_menus` entries) set neither.

**Checks:** `tests/fieldhud.test.ts` (layer order).

## 2026-10-17: Pioneer 2 shops and bank

**What changed:** the weapon, armor and tool shop clerks and the Check Room
now open their counters (`classic/shop.ts`, hosted by `render/fieldhud.ts`,
opened from `bb_p2_menu` 0 / 2 / 3 / 5 in `quest/town.ts`). Buying, selling,
and depositing / taking meseta and items go through newserv
(`net/items.ts`). The Hunter's Guild lines moved to the clerk window too.

**Details** (Ephinea `PsoBB.exe`; the named dump mislabels most of these
functions, so the addresses are what matters; objdump where the dump fails):
- **Counters.** `p2_special_npc_menus` (0x009cf100, 5 dwords per entry: name,
  on enter, ?, create, is open) maps 0 to `CreateWeaponStoreDialog_006d6b8c`,
  2 to `CreateArmorStoreDialog_006d6c94`, 3 to `CreateItemStoreDialog_006d6d18`
  and 5 to `CreateBankDialog_006d6d98`.
- **Weapon shop states** (`0x006d65fc`, jump table 0x0096c258):
  - 1 (`0x006d6a78`): the clerk window, the greeting [0x27] and "Money";
  - 2 (`0x006d6820`): Buy / Sell ([4] / [6]) at 0x2d; Backspace says
    "Thank you!" [0x2c] and closes once it is read;
  - 3: sends `6xB5` if the list is empty, waits for `6xB6`, opens the buy
    window; 4 opens the sell window; leaving either says [0x1a] and returns
    to Buy / Sell (`LAB_006d4a00`); no item to sell says [0x1b] first.
- **Buy window** (`0x006d4d64`): the list and [0xb]. Enter checks
  (`ShopDialog_ValidateItem_006d5318`): price over meseta [0xf], no room
  [0x19], class [0x12] or requirement [0x11] (shown with Buy / Cancel), else
  Buy / Cancel and, after Buy, "Do you wish to equip it now?" [0x18]. The
  purchase (`ShopDialog_HandleItemSelection_006d4de8`) takes a new item id
  from the client's counter (`increment_item_id_for_player`), pays, sends
  `6xB7 {id, type, index, amount}` and adds the item itself; equip removes
  the slot's item first.
- **Tool buy window** (`0x006d830c`): a spinner up to min(room, meseta /
  price) when that is above 1 (`0x006d87dc`), then Buy / Cancel; the "Item
  Quantity" window shows how many are carried.
- **Sold out** (`0x006dc1f8`): disks, tools 09..0B, units and a fixed set of
  weapons leave the list once bought; everything else can be bought again.
- **Prices** (`get_item_shop_cost` 0x005d24dc, x87 truncation): the buy
  windows recompute every price on the client (`0x006d3a10`, `0x006d54cc`)
  rather than using the `6xB6` data2:
  - weapons: 8 with an unidentified special, 80 if rare; else
    trunc(stars^2 * 1000 + bonus * (grind + ATP max)^2 / (divisor * 100)),
    bonus = 100 per slot plus attributes 1..5;
  - armor / shields: trunc(trunc((DFP + EVP + bonuses)^2 / divisor) +
    (level + 1) * (slots + 1) * 70); units trunc(stars +/- 1 * divisor);
    mags trunc((data1[2] + 1) * divisor); disks (level + 1) * cost;
    tools their cost; constants 1000 / 100 / 70 at 0x0092c4a8..b0.
  - Selling pays cost / 8 per unit (`0x006d600c`), sends `6xC0` via 60 and
    removes the item; a wallet over 999999 refuses ([0x1c]).
- **Bank** (`bank_menu_handler_table` 0x009cec80): `6xBB`, wait for `6xBC`,
  greeting [0x31] with "Money" and "Deposit" (bank meseta, entry 0x2b);
  Deposit / Take; Meseta / Item ([0x33] / [0x32]); meseta via a spinner
  ([0x34] / [0x3f]; [0x47], [0x37], [0x3d], [0x4a] when not possible);
  `6xBD` deposit meseta (0x006c9c2c) and take (0x006c9eac) with the local
  meseta moved by the client. Item deposit ([0x38], 200 items max, [0x3c]
  when full) and take (empty [0x3e], no room [0x4b]): the list titled
  "Check Room" [0x30], a spinner for stacks, Yes / No. Leaving: [0x48] and
  `6xBD` action 3.
- **Windows** (table 0x00971f40): clerk 0x2e (294, 365) 332 x 80 (immediates
  in 0x006d6a78 / 0x006ca124 / 0x006ce004); choices and spinner 0x2d; list
  0x28 (12, 50) 385 x 184; description 0x29 (400, 50) 240 x 184; Money 0x2a
  226 x 27; Item Quantity 0x2c 160 x 27; bank Deposit 0x2b 160 x 27.
- **ASSUMED:** the Guards Shop greeting [0x2b] and that its buy window
  matches the weapon one; that the sell list leaves out equipped items
  (flag 0x80 of `0x006a520c`); the meseta spinner limits; the label / number
  layout of the small counter windows; no line in the bank item windows
  (their decompilation fails); the typing speed.
- **Left out:** the tekker (`6xB8` / `6xBA`, bb_p2_menu 6) stays logged.

**Checks:**
- `tests/shop.test.ts`: prices, sell price, sold-out rule, stack room,
  layout, the `6xB5`..`6xC0` bytes and parsers, key-driven weapon, sell,
  tool and bank flows.
- In Chrome against newserv: the weapon clerk's talk thread (label 800)
  opened the Arms Shop, the armor clerk (810) the Guards Shop and the
  cloakroom (840) the Check Room; the Tools Shop was opened through the same
  `bb_p2_menu` entry (`QuestTown.counter(3)`). Bought a Saber for 615 (newserv charged
  615), sold it for 76, bought 3 Monomates for 150, deposited 101 meseta and
  a Monomate and took the Monomate back; newserv's meseta matched the
  client's at each step and nothing disconnected.

## 2026-10-17: Item Pack > Equip

**What changed:** the field main menu now opens **Item Pack > Equip** (menu
id 9, `classic/equipmenu.ts`).

**Details** (Ephinea `PsoBB.exe`, the named dump and objdump of the update
function `0x0074aba4`, which the dump does not cover):
- **Constructor.** `EquipmentMenu_Constructor_0074aa48` builds three
  windows from the position table `0x00971f40`:
  - the slot list ("Equipment List", group 11 [0x38]) at entry 0, (13, 256),
    308 x 184;
  - the item description at entry 2, (324, 256), 240 x 184;
  - on Enter, the item list ("Item List", [0x37], `0x0074ae04`) at entry 1,
    (13, 317), 308 x 124.
- **Slot rows** (`EquipmentMenu_UpdateSlotDisplay_0074bc00`): weapon, armor,
  one row per unit slot of the equipped armor (its data1[5]), shield, mag.
  - A filled slot is drawn like an Item Pack row.
  - An empty slot shows only its category icon in 0xffaaaaaa: the weapon icon
    by class (hunter sword, ranger gun, force cane), armor 0xB, unit 4,
    shield 0xA, mag 3.
- **Item list.** It shows every inventory item of the slot's kind. Items the
  character cannot equip stay in the list but are disabled
  (`EquipListWindow_Finalize_0074b8c4`).
- **States.**
  - Slot list: Enter opens the item list and shrinks the slot list to the
    chosen row; Backspace returns to the main menu.
  - Item list: Backspace returns to the slot list. Enter runs
    `HandleItemEquipSwap_0074ad94`:
    - if the item is already in that slot, it is removed;
    - otherwise the item leaves its old slot, the slot's current item is
      removed, and the item is equipped into the chosen slot.
- **Network.** `GameItems.equip` takes the chosen slot, so `6x25` carries the
  exact unit slot.
- **Player Status (menu id 0x19)** is not opened. Its window exists
  (`ChatShortcutMenuWindow_Constructor_00756ff4`), but it is in no menu table,
  and no function key or call in the executable passes 0x19 (E8 scan of
  `.text`).

**Checks:**
- `tests/fieldhud.test.ts`: slot rows, unit rows, empty icons, item lists
  per slot, the swap rules, and a key-driven Equip flow in which the ranger
  gun is refused for a HUmar and the Saber is removed.
- In Chrome against newserv (Pioneer 2): Home > Item Pack > Equip shows
  Saber / Frame / empty shield / Mag with the Saber description; Enter >
  Enter removed the Saber (an empty sword icon is left) and Enter > Enter
  equipped it again. The Online tab's panel followed, with no disconnect.

## 2026-10-17: support technique effects

**What changed:** Shifta, Deband, Jellen, Zalure, Anti and Reverser now do
something. `combat/buffs.ts` holds the rules. `render/combat.ts` applies them
when the local player casts, and when another player's `6x48` lands on the
local player or on an enemy. The status window shows the buff icons.

**Details** (Ephinea `PsoBB.exe`, the named dump, `tools/exedata.py` and
objdump):
- **Power.** The support technique objects set power = v_power × level
  (`UpdateSpecialAttackEntityStats_006f0ae4` for Shifta,
  `UpdateTechniqueEntityStats_006f20cc` for Zalure). v_power is 1, so the
  power is the 0-based level. `GetTechniquePower` and its jump above
  level 15 are not used.
- **Amount and duration.** `on_shifta_jellen_received` (`0x007791b8`) and
  `on_deband_zalure_received` (`0x007793c8`), constants at
  `0x009780c8..0x009780f8`:
  - multiplier = (power × 1.3 + 10) × 0.01, negative for Jellen and Zalure:
    Lv1 10 %, Lv15 28.2 %, Lv30 47.7 %;
  - duration = (power × 10 + 40) × 30 frames: 40 s at Lv1, 180 s at Lv15,
    330 s at Lv30.
- **Stacking.** Shifta and Jellen share the attack slot (`+0x274..+0x27c`),
  Deband and Zalure the defense slot (`+0x280..+0x288`). A cast whose
  |multiplier| is smaller than the current one does nothing: it does not
  replace it and does not refresh it. An equal or stronger one replaces the
  type, the multiplier and the duration.
- **Stats.** ATP (`+0x2cc`) and its spread (`+0x2ce`) move by
  round(base × m). DFP (`+0x2d2`) moves the same way. ROUND is fistp, which
  rounds half to even. The equipment ATP (`+0x31c`) is not touched. So:
  - a Shifta'd player's weapon hits use the raised ATP and spread;
  - Deband raises the DFP that an enemy's hit subtracts;
  - Jellen lowers the enemy's ATP and spread when it hits the player;
  - Zalure lowers the enemy's DFP against weapon hits.
  Technique damage does not read DFP.
- **Ticks.** `shifta_jellen_effect_tick` (`0x007782b4`) and
  `deband_zalure_effect_tick` (`0x00778580`) count down once per frame. At 0
  the slot clears and the stat goes back.
- **Who is hit.** `TechniqueObject_UpdateTarget_006e2ac4` and
  `update_anti_tech`:
  - the caster always;
  - the 6x47 list too from level 3 (Anti from level 2).
  `entity_hit_by_tech` applies groups 9..12 on every client that runs the
  object. Only the caster's client calls the enemy's `+0x130`
  (`0x00787578`), which sends a `6x0A` with the unchanged total damage. The
  web client does the same for each Jellen'd or Zalure'd enemy.
- **Remote casts.** Another player's `6x48` runs at the 6x48 level, plus the
  last `6x8D` level_upgrade when the level is 14 (`action_launch_tech`). It
  uses that player's last `6x47` targets:
  - Shifta / Deband / Anti apply to the local player when it is listed;
  - Jellen / Zalure apply to the listed enemies;
  - Reverser revives a dead local player.
- **Anti.** `Player_ClearStatusEffect` (`0x00779868`) cures by level: poison
  always, then shock, paralysis, confusion, slow, Jellen / Zalure, freeze.
  The web client has no status effects yet. Only the Jellen / Zalure part
  (level ≥ 5) clears anything; the rest is logged.
- **Reverser.** `PlayerResetDeadState_0068fdc8` →
  `PlayerRestoreHealthAndTP_0068fddc` revives with max HP / 2 on a field.
  The revive goes through `PlayerDamage.revive` (`6x4F`). The local cast
  targets the nearest party member lying dead within range_h (tracked from
  `6x4D` / `6x4F`).
- **HUD.** `QuickMenuUpdateShiftaStatusIcons_007426d8` shows one 32×28
  sprite per occupied status slot. The icon comes from
  `get_monster_status`: Shifta 6, Jellen 7, Deband 8, Zalure 9. The sprite is
  f256_hyouji texture 1 at the texels of `0x0096fd20`. Its position is GUI
  position `0x1e` = (226, 37) plus the status window's position, plus 16
  per icon (`0x0096fdf0`).
- **Ryuker** stays refused. A telepipe needs `6x68`, the pipe object and
  the round trip to Pioneer 2, which is not cheap.
- **ASSUMED:**
  - Buffs survive a floor change.
  - The status window's render position (`+0x40` / `+0x44`) is its
    position (28, 37), so the first icon is at (254, 74).
  - The Reverser target is the nearest dead party member.
  - The remote cast passes `CheckTechniqueCooldown` (which would drop the
    level to 0).
  - Remote Resta still heals nobody here (it needs the caster's MST).

**Verified:** `node tests/buffs.test.ts` covers:
- the multipliers and durations at Lv1 / 15 / 30;
- the fistp rounding;
- the stronger-holds rule;
- the 1200-frame expiry;
- the ATP / spread / DFP values;
- the weapon damage of a Shifta'd hunter and on a Zalure'd enemy;
- an enemy hit with Jellen and with Deband;
- Anti's list, Reverser's HP, the remote level, `6x8D` and the icon texels.

The techniques, combat, combatdepth, fieldhud and controls tests still pass.

In Chrome I used WebForce (FOnewearl), whose techniques I set with newserv's
`$edit tech <name> <level>` lobby chat command (cheat mode is on by default
in the local config): Shifta / Deband / Jellen / Zalure 15, Anti 7,
Reverser 1. On Forest 1:
- Shifta Lv15 → +28.2 % for 180 s, ATP 10 → 13 in the weapon attacker stats.
- Deband Lv15 → DFP 13 → 17.
- The red and blue status icons appeared right of the status window.
- A temporary console hook, which was not committed, put me next to a
  Booma and froze the AI. Zalure and Jellen Lv15 landed on it: Jellen took
  its ATP 106 → 76; its DFP is 0 on Normal, so Zalure showed no change.
  newserv accepted the `6x0A`s.
- Fed fake remote packets through the subcommand handler:
  - `6x8D` +6 / `6x47` / `6x48` Shifta → a Lv21 Shifta replaced mine
    (+36 %, 240 s);
  - Anti Lv7 → the cure line was logged;
  - Reverser while dead → revived with 14/28 HP.
- Not checked with a real second client.

## 2026-10-17: casting techniques

**What changed:** techniques can be cast from the action palette (a slot with
group 1 = 3, group 2 = the technique) and from Main menu > Technique.
`combat/techniques.ts` holds the data and the rules, `render/combat.ts`
`castTechnique()` runs the cast, and `net/game.ts` builds `6x8D` / `6x47` /
`6x48`.

**Details** (Ephinea `PsoBB.exe`, the named dump and objdump):
- **Data.** The technique table `0x009cf3c0` (19 x 0x2C) is scaled per level
  the way `GetTechniqueData_006ded14` does it. Its 19-case jump table
  (`0x0096cb60`) was decoded from the disassembly. Range, cast time, charge
  and half-angle depend on the level, and the support techniques get a class
  boost (`0x009cc550`).
- **TP cost is truncated, not rounded.** `fistp` runs with the control word
  `| 0xC00`. The Technique menu's cost display changed with it: Foie Lv30
  costs 42 TP, not 43.
- **Power.** `GetTechniquePower_006dec5c`: power + v_power × level. Above
  level 15 it is `add + factor × level` from `0x009cf720`.
- **Damage.** `entity_hit_by_tech`:
  `(MST + power) × (1 + class boost) × (100 − resist) × 0.002`. Fire uses
  EFR, Barta and Gibarta / Rabarta use EIC, the Zonde family uses ETH,
  Grants uses ELT. There is no hit roll and no critical.
- **Megid.** It kills with chance `(power − EDK) × 0.01`.
- **Resta.** It heals `MST × 0.5 + power`.
- **Cast flow.** `SendCastTechPacket_0069a2f0` and the palette dispatch of
  `handle_input_state_cast_tech` send `6x8D` (on every cast, level_upgrade 0
  up to level 15), then `6x47 {tech, min(level, 14), targets}`.
  - The cast motion is field slot 1 (motion set vtable +0x38 →
    `0x007083d4`).
  - The motion is held for `charge` ticks, then released at the frame from
    `GetWeaponModelData` (`0x006ac778`: 13 with a weapon; 8, 17 or 13 bare
    handed).
  - At release (`0x006a0340` area) TP drops by `tp_cost` and `6x48 {u16
    tech, u16 level}` goes out.
  - After that the cast counts down `cast` ticks and waits for the motion to
    end.
  - A hit cancels the cast; no TP is spent then.
- **6x47 targets.** Following `InitializeTechniqueTargetingParams_006e1a48`:
  - one target for Foie, Rafoie, Barta, Gibarta, Zonde, Grants, Megid and
    Reverser;
  - a list for Gizonde and the support techniques;
  - none for Gifoie, Rabarta and Razonde.
- **Hits.** They go out as `6x0A` through the same path as a weapon strike,
  so the kill, drop and EXP flow is shared (`applyEnemyHit`). newserv claims
  the last hit from the `6x0A` 0x200 flag.
- **Not wired yet.** Resta heals only the local player; other players heal
  on their own clients. Shifta, Deband, Jellen, Zalure, Anti and Reverser
  are cast (TP, motion, packets) but log "effect not wired". Ryuker is
  refused (no telepipe).
- **Remote players.** Another player's `6x47` plays their cast motion, and
  their `6x48` shows the effect.
- **ASSUMED:**
  - Targets are the enemies within the technique's `range_h` and half-angle
    `angle_h`, with the lock-on target first. The client's targeting system
    entries (type 3) were not decoded.
  - The object travels `speed` units per tick (Foie: + max(0, level − 4)).
  - Rafoie's blast radius is 20.
  - Equipment tech boosts are 0.
  - The effect is a coloured placeholder disc. The client's own technique
    effects are not drawn.
  - A cast from the Technique menu closes the whole menu.

**Verified:** `node tests/techniques.test.ts` covers TP for Lv1–30, the
per-level fields (spot checks against the decode), power, the damage, heal
and Megid formulas, the bytes of `6x8D` / `6x47` / `6x48`, and the cast
timing. `tests/fieldhud.test.ts` was updated for the truncated TP. In Chrome I
used a new FOnewearl (MST 58, Foie Lv1) on Forest 1. For the hit tests a
temporary console hook, which was not committed, put me next to the nearest
enemies and switched off their AI:
- The palette's right key cast Foie and TP went 87 → 82.
- Foie hit a Savage Wolf for 44, which matches (58 + 110) × 1.3 × 0.2.
- It hit a Gobooma (EFR 25) for 33 per cast, and four casts killed it. newserv
  answered with the drop `6x5F` and +6 EXP.
- Main menu > Technique > Foie cast and closed the menu.
- I did not check remote casts (a second client), Resta (the test character
  only knows Foie), or Lv16+ casts live.


## 2026-10-17: the player turned into a capsule in games

**Symptom:** in a game the player showed the capsule stand-in, and NPCs and
Pioneer 2 objects were missing; the console said `client file not found:
plymotiondata.rlc` (and every other file that lives only in `data.gsl`).

**Cause:** `ClientFiles.index()` set the loose file list before it had loaded
`data.gsl` (71 MB). Reads that started while that load was in flight saw the
list, skipped the wait and looked in a `gsl` that was still null. The game's
many parallel reads (now also waiting on `/newserv-maps/`) hit it every time.

**Fix:** `index()` keeps one shared promise and publishes the list only after
`data.gsl` is open. Checked in Chrome: the player model, 21 NPCs and 8
objects are back in Pioneer 2.

## 2026-10-17: a Docker image for Dokploy

**What changed:** `Dockerfile` (multi-stage: newserv built from source at
pinned commits, the Vite client build, an Ubuntu runtime with Node 24 and
tini), `docker/entrypoint.sh` (starts newserv and the web server, keeps
newserv's `players` / `licenses` / `teams` on the `/data/newserv` volume) and
`bridge/server.mjs`, the production server: the built client plus the
endpoints the dev server had (`/keys`, `/newserv-text`, `/newserv-maps`,
`/psobb-data` from an optional mounted data folder) and the relay at
`/bridge` on the same port. A client build now connects to `/bridge` on its
own origin (`ws`/`wss` by the page's protocol); the dev server still uses
`ws://127.0.0.1:8080`. Steps in `docs/DEPLOY.md`.

**Checks:** `node bridge/server.mjs` against the local newserv: every
endpoint answers, `..` paths get 404, and a WebSocket to `/bridge/?port=12000`
receives newserv's `03` (380 bytes). The client stage was built from a clean
copy (`npm ci` + `npm run build`). The image itself was not built here (no
Docker on this machine).

## 2026-10-17: the original camera, zoom limits and key config

**Camera** (`render/playercamera.ts`, decoded from the player camera
`CreateUnknownPlayerCamera_004d7e70` / `UpdateUnknownPlayerCamera_004d7698`):
five zoom levels (`camera_zoom_level_ARRAY_009ace60`: source height / distance
behind / target height = 18 / 25 / 19.8, 25.43 / 45.42 / 19.8, 26.9 / 53.6 /
16.4, 28.4 / 61.8 / 13.1, 30 / 70 / 9.8, target 5 in front), level 1 at start
(`0x009acedc`), clamped to 0..4 (`set_camera_zoom_level`) and stepped by the
mouse wheel. The farthest the camera gets is 70 behind and 30 up; before it
went from 20 to 600. While the player moves at least 0.5 units a frame
(`0x00909798`) the camera angle turns toward the player's back by at most
5 * 127 BAMS a frame (`ProcessCameraChaseState_004d7a1c`,
`SmoothCameraAngle_004d6370`); the Camera key puts it straight behind. There
is no mouse look in the client, so dragging no longer turns the camera. Left
out: the 18x move lead of the target and the source / target lerp
(`unknown_vec3_lerp`).

**Keys** (`input/keyconfig.ts`): BB's default keyboard config (newserv's
`default-keyboard-config.bin`), read with the key config menu's label table
(`0x0097b500`) and the client's key codes (enum `pso_keycode`, A = 0x10): W /
S / A / D move, Enter decides, Backspace cancels, Home opens the menu, Space
starts chat, End opens symbol chat, the arrows select, Left / Down / Right are
the action palette's left / middle / right slots, Ctrl switches the palette
and Up is the Camera key. Movement no longer runs on the arrows, and attacks
come from what the palette slot holds (`palette_slots[1]` for Left, the dump's
"main slot left pressed"; 0 for Down; 2 for Right) instead of F3-F5 / Z / X /
C. Only attack slots act yet (items and techniques on the palette log a
line). The game keys no longer scroll the page.

**Checks:** `tests/controls.test.ts` (zoom table and clamp, camera source and
target, the chase step and its 0.5 threshold, every binding of newserv's
default config against `KEYS`). In Chrome, Forest 1: ten wheel steps leave the
camera at level 4, 70 units behind the player.

## 2026-10-17: entity ids from the server's own maps

**Bug:** killing some enemies disconnected the client. newserv logged "Flag
update refers to missing enemy" for the `6x76` and then "Error processing
client command: vector" for the `6x60` drop request. The enemy ids were off
by two from Forest 1 on: newserv numbers enemies and objects from its own
set data (`vendor/newserv/system/maps/bb-v4`), and the Ephinea client data
differs from it - its `map_city00_00e.dat` has 23 NPCs where newserv's has 21
(and `map_forest01_03e.dat` differs too), so every floor after Pioneer 2
started two ids later than on the server, and the last enemies of a floor
pointed past the server's list.

**Fix:** the dev server serves newserv's bb-v4 set data at `/newserv-maps/`
(`map_*.dat`, `map_*.evt`, `SetDataTable*.rel`), and the game's
`ClientFiles` (`serverSetData`, `data/clientfiles.ts`) reads those names from
there first, falling back to the client data. A real client has the same
requirement: its maps must be the server's. The map viewer keeps the client
data.

**Checks:** in Chrome against newserv, an Episode 1 game's Forest 1 now
starts at entity `0x1015` (21 Pioneer 2 NPCs); killing its first enemy
(`0x1015`, Barbarous Wolf) and its last (`0x1093`, Booma) logged "set flags
0008 on E-016 / E-094", the drop roll and the EXP on both, with the same
enemy types as the client, and no error or disconnect.

## 2026-10-17: map warps take the player across the floor

**What changed:** the intra-floor warps work now: `TObjMapWarpForest`
(`0x0003`), `TObjCityMapWarp` (`0x0045`, the Principal's office),
`TObjMapWarpAncient` (`0x0141`) and `TObjLaboMapWarp` (`0x02BD`), kind `map` in
`render/fieldobjects.ts`.

- Base constructor `MapObjectBaseInitialize_00668ad8` (radius 10.0, 23.0 for
  the city and Lab ones at `0x0064b0d4` / `0x0064b428`): four landing spots,
  the offsets at `0x009c955c` ((-10, 0, -10), (-15, 0, -15), (-5, 0, -15),
  (-10, 0, -20)) turned by the object's Y angle and added to param1..3. The
  update `0x00669048` always uses the first one (the bug newserv documents:
  everybody lands on the same spot) and param4 as the angle.
- Menu (`+0x34`, `0x00668e20`; city / Lab `0x0064af7c` / `0x0064b2d0`): one
  item at position-table entry `0x35`, sized like an area warp's: unitxt group
  10 index `0x30`, or `0x009363d0[param6]` = 44 The Principal, 45 Pioneer 2,
  16 Lab (param6 < 0 -> 0, > 2 -> 1, `0x0064b038`). A Ruins warp with a
  negative param5 does nothing (`0x006408d8`).
- Decide: `warp_player_from_source_to_dest` (`0x0069b184`) sends **`6x55`**
  `{55, 08, client id, u32 angle, from xyz, to xyz}` (`net/lobby.ts`
  `sendIntraMapWarp`); the local model is placed at once
  (`LobbyView.warpSelf`), and another player's `6x55` places theirs
  (`teleported` event) instead of walking them there.

**Checks:** `tests/warpmenu.test.ts`: 84 of the 103 map warps of the free-play
floors land within 100 units of another warp pad (the pads come in pairs), so
param1..3 are floor coordinates. In Chrome against newserv, Pioneer 2: the
warp at (0, -60) showed "The Principal", Enter moved the player to
(0, 0, -1770), next to the return pad and outside its radius.

## 2026-10-17: Pioneer 2 doors, the Lab's warps and the city beams' speed

**What changed:**

- **Pioneer 2 doors** (`0x0046` shop, `0x0047` Hunter's Guild, `0x0048` Ragol
  warp, `0x0049` medical center): one class
  (`InitializeHuntersGuildDoorEntity_006460d8`) with a data block per type:
  `{step, open distance^2, close distance^2, box radius, box unk1}` at
  `0x00935ac4` (shop: 1, 60, 80, 2, 25), `0x00935a78` (guild: 2, 60, 80, 2,
  24), `0x009c7114` (warp: 0.0 in the image, set to 1.0 by `0x006470b4`; 90,
  120, 50, 6.5) and `0x00935a54` (medical: 1, 60, 80, 4, 25). The state at
  `+0xac` runs closed `0x00645eb0` (a player within the open distance: opening,
  box off), opening `0x00646410` (nobody within the close distance: closing;
  else +step up to the last frame), open `0x00645f5c` and closing `0x00645eec`
  (a player within the open distance reopens it; the box is back on only at
  frame 0): `stepCityDoor` and `CITY_DOORS` in `render/fieldobjects.ts`.
  Models from `bm_obj_city_common.bml`: shop model 11 / motion 10, guild 21 /
  12, warp door 9 + 10 / 8 + 9 (the shutter's halves), medical 20 / 11.
- **City warps**: the updates (`0x0064ab90`, `0x0064ae2c`, `0x0064b118`) add
  4.0 per tick (`0x009363f4`), not the fitted 1.0, and wrap at the last frame
  by subtracting count - 1 (new drive `loop-last`); `TObjCityMapWarp` draws
  its base (model 13) only when param5 is 0. The city loader is in the asset
  list of the Lab too (per-area list table `0x00a05d60`, entry 0x12), so the
  Lab's Ragol teleporter, area warp and map warp now have their models.
- **`TObjLaboMapWarp`** (`0x02BD`, create `0x0064b3ac`): radius 23.0,
  `bm_obj_warp_labo.bml`, render `0x0064b508`: model 1 when param5 is 0, then
  model 0 with motion 0 at +4 per tick, texture list of model 1.

**Checks:** `tests/warpmenu.test.ts` (the city door cycle, no flags; Pioneer
2 now lists its four doors), `tests/waves.test.ts` (the new models build with
no missing textures). In Chrome against newserv, Pioneer 2: the guild door
stayed shut with the player at 100, opened at 40 (frames 16, 34, 52, open at
59), closed again from 90 and its box came back.
## 2026-10-17: the field main menu, the Item Pack, the Technique menu and the action palette

**What changed:** a game now has the classic field HUD, drawn on a 2D canvas
over the 3D view (`render/fieldhud.ts`, created by `GameView`).

- **Main menu** (Home / F12): the lobby's `MainMenu` with the field rules of
  `ValidateMenuItemCondition_00732620` — an entry that is not available is
  replaced by id + 1 and drawn 0x686868 (Technique and Area Map on safe maps,
  Quest Board without a quest, Trade outside Pioneer 2, Team without a team,
  Quit becomes "Disconnect" online); safe maps from `0x0097f1c8` (0, 0xF,
  0x12, 0x2D). While it is open the player gets no keys, the palette hides
  and the view shift of `FUN_00733b2c` applies (`classic/fieldmenu.ts`).
- **Item Pack > Items** (`ChallengePlayer_StateMachine_00750954`,
  `classic/itempack.ts`): Item List at table entry 3 (13, 256) 308 x 184 with
  the "n/30" teal pill (`0x007367d0`), rows of two 18 x 18 icons from
  f256_hyouji.prs texture 1 (table `0x00970b40`), the name (`get_item_name`
  `0x005d2aac` formats) and "×n" right-aligned; colours and icons from
  `ItemEntity_UpdateColoring_0072c045` / `0x0072b9d0` (equipped, untekked,
  unusable class X, S-rank, rare, bonuses); the description window at entry 2
  (324, 256) 240 x 184 (unitxt group 3 by PMT id, `0x005d3078`); Purpose at
  entry 4 (Use / Equip / Remove / Drop / Sort, `0x00751324`); the list
  collapses to the chosen row (`0x0073600c`); the Amount spinner at entry 5
  (`0x00728ac4`: digits of the texturejapanese.xvm font, green arrows of
  texture 0, Up/Down by 10^digit with wrap, Left/Right digit). Use / Equip /
  Remove / Drop / meseta drop call `GameItems` (6x27 / 6x25 / 6x26 / 6x2A /
  6xC3). The list follows the inventory.
- **Technique** (`update_technique_menu`, `classic/techmenu.ts`): Type window
  at entry 0x12, Techniques at 0x13 (lists `0x009f57a8`), names group 5,
  unlearned disabled, learned but not castable here 0xfffd3901; the info window
  at entry 0x14 242 x 161 with "Level:", "Required TP:" (the exe's technique
  table `0x009cf3c0`, tp + v_tp / 100 * level) and the description.
- **Action palette** (`classic/palette.ts`): the window at entry 0x20 (484,
  368) 150 x 107 with the hexagon background of texture 2, the three slots and
  the top icon at the element positions of `0x009f1480`, icons 50 x 43 from
  textures 5 / 6 / 7 by slot type (tables `0x009f15e8`, `0x009f12e0`,
  `0x009f1380`, `0x009f1420`), tool counts from `0x0096f51c`, and the Ctrl tab
  (texture 0 at (46, 0)) that lights for 3 frames when Ctrl switches palettes.
  The data is the character's `PlayerDispDataV4.config` (E7 + 0x3E0): two
  `action_palette` records after the flipped flag.

**Checks:** `tests/fieldhud.test.ts` (palette parsing and icons, menu rules,
row names / icons / colours, Purpose lists, the amount spinner, a key-driven
Item Pack flow ending in use / unequip / drop / meseta drop, technique lists /
TP / info, command bytes). In Chrome against newserv (Pioneer 2, Forest 1):
the palette shows normal / heavy attack and Monomate ×4, Ctrl switches to the
empty second palette; Home opens the menu with Technique and Team grey in
Pioneer 2; Item Pack > Items lists Saber / Frame / Mag (E icons) and the
mates with ×4, the Saber description; dropping 2 Monomates put a stack of 2 on
the floor (6xC3 / 6x5D), Remove / Equip toggled the Frame; in Forest the
Technique menu lists Rafoie.. greyed for the HUmar.

**Left:** casting (6x47 / 6x48), Equip / MAG / Area Map windows, the equipment
detail pages, sort (6xC4), palette saving (07ED), window animations. The
item list compares stat requirements with the character file's base stats.

## 2026-10-17: the boss warp's beams follow its 6x6A state

**What changed:** online, `CreateWarpMapObject_0066c4b4` does not build the
object the models were taken from: that one (`0x0066c6cc`, render
`0x0066cadc`) is the offline / Episode 4 transporter. The online one (0x1e8
bytes, vtable `0x00b35440`, the 6x6A state machine of `render/bosswarp.ts`)
renders with `SeabedTuriganeMapObjectRender_0066c38c`: model 0 always, and the
model at `+0xd4` with the motion at `+0xd8` (frame `+0xc8`, no fog) when the
state handler set one. State 0 sets model 2 + motion 1 (jungle: model 1 +
motion 0), the gather (state 1) and warp (state 2) handlers set model 1 +
motion 0 (with sound effect 6 on the gather), and the occupied (state 3) and
locked (state 4) handlers clear it, so a warp still waiting for its switch
flag shows only its base. The update `0x0066aeec` adds 4.0 (`0x00939c14`) to
the frame and sets it back to 0 once frame + 1.0 reaches the frame count:
part drive `restart-last`. `objectmodels.ts` gives the beams `show: 'idle'` /
`'active'`, and `FieldObjects.setBossWarpState` / `showBossWarps` pick them
from the state the local machine runs (`gamefield.ts`), or 0 / 4 for the
other boss warps. `TObjWarpBoss03` (`0x0160`) keeps the locked / unlocked
parts.

There is no camera in the boss warp's handlers (the only camera read is the
render's distance cull), so the ROADMAP's "boss-warp cutscene camera" is
dropped: the client has none.

**Checks:** `tests/warpmenu.test.ts` (the boss warp parts per archive and
state). In Chrome against newserv, VR Temple Beta: the boss warp showed its
base alone while switch flag 47 was unset and the idle beam once it was set;
walking in opened the question with the player list, Yes went through the
gather and the warp to Barba Ray (floor 14).
## 2026-10-17: NPCs, the Hunter's Guild and a quest from the counter to the reward

**What changed:** Pioneer 2, the Lab and the quests have their people, and an
Episode 1 quest can now be taken at the guild counter, played and paid.

- **NPC classes from the factory table** (`formats/npcmodels.ts`). The per-area
  table at `0x009fba60` (the enemies' table) also builds the NPCs. Every
  humanoid factory runs an initializer that calls one of three base
  constructors, which differ only in the motion table they pass to
  `Player__ApplyWeaponAnimationData`: `SpawnEnemyTypeA_00609010` (table
  `0x0092f470`), `InitializeChallengePlayerObject_0060c858` (`0x0092f79c`) and
  `ConstructEnemyTypeA_0060a580` (`0x0092f5a4`); each table is idle
  `{1, -, 0, 0.9, 1}` + walk `{1, -, 2|1|3, 1.4, 0x20000002}` into the
  NJS_ACTION array of `plymotionnpctown.cpt` (`LoadNpcTownMotion_00607418`, a
  PRC REL). The model is model entry 0 of a BML descriptor (`LoadBML_005b7a84`,
  e.g. `0x009c4110` `bm_n_ebw_i_body.bml`) or a REL (`load_rel_asset`, `*root`
  = the NJS_OBJECT) with a separate `.gvm`, read as `.xvm` on PC (`npc_a00_data.rel`
  + `n_a00_w_body.xvm` ...). The tekker's archive is picked by the local
  section id (`load_tekker_assets`, `0x009c408c`[10]); the NgcBase cast (Elly,
  Karen, Leo, Nol, ...; types 0xF2..0xFF) comes from `InitializeDerolleBMLData
  _0060fca4`, which loads per map type (`0x00807e68` = `0x0097f040`[area]: towns
  all 14 from `0x009c44e0`, jungle/seaside `0x009c46ac`, seabed `0x009c46c4`,
  Episode 4 `0x009c46d4`). 57 classes, 66 archives, all 64-node skeletons.
- **Parameters** (`InitializeEnemyBaseObject_00606c28`, the set_params
  override `0x00606a34`): param2 / param3 are display registers
  (`UpdateMovementRestriction_00606f10`; `>= 1000` = the area script's
  register), param4 the talk action (100..999 talks in the quest, >= 1000 in
  the area script, and it is the speaker id of `message`), param5 the talk
  label.
- **Talking** (`render/npcview.ts`, `EnemyObjectUpdate_0060648c`): the NPC
  turns to the player by `0x400` BAMS a tick (`0x009c3eb0 + 8`), the player is
  turned to face it, then the label runs and the NPC waits for its thread.
  Enter talks to the NPC within 20 units and 60 degrees in front (the counter
  rule `IsEntityInFrontAndInRange_006d739c`, `0x0096c2a0`).
- **The area script** (`quest/town.ts`): Pioneer 2's dialogue is a quest-format
  script, `0x009ce700[locale * 17 + 0x0096a180[map * 2 + online]]` =
  `map_city_on_e.bin` (Lab: `map_labo_on_e.bin`). The counter clerks call
  `bb_p2_menu(n)` (`SetBankMenuOpenFlag_006d7370`), and the counter object of
  `p2_special_npc_menus` (`0x009cf100`: weapon, medical, gear, item, HUNTER
  GUILD, check room, judgment, THE GOVERNMENT GENERAL, giveaway) opens.
- **The Hunter's Guild** (`CreateMedicalCenterDialog_006cafb8` -> the online
  dialog `0x006cd830`): without a quest, the clerk lines of unitxt_shop group 1
  (17 / 18 for the government / Lab counters), the server's menu (A2, flag 1 at
  the government counter as newserv's `on_A2` reads it), the description (A3)
  and "Will you take this offer?"; with one, `GameListMenu_ProcessQuestResult
  State_006cdd30`: r255 = success (line 11, then the `set_qt_success` label: the
  reward window and `pl_add_meseta2` -> 6xC9), r253 = failure, else the
  cancel offer (the `set_qt_cancel` label). A paid quest answers "That quest
  was completed." afterwards.
- **Quest opcodes**: `set_player_start_position` sends 6x24 and moves the
  player (`opcode_p_setpos`, angle in degrees), `p_return_guild` warps to
  Pioneer 2's guild spawn, `at_coords_talk` / `at_coords_call` zones,
  `update_switch_flag`, `del_obj_param`, `npc_crp*` -> 6x69 + an NPC player
  built from `npcplayerchar.dat` (64 records of 0x70, `LoadCharacterData
  _007adf48`) and drawn as a player; 6x69 and 6x77 from others are applied.
- **Text like the exe** (`quest/questui.ts`): `message` is the word balloon
  over the speaker (`DisplayChatBubble_007184f8` with flags 0x2d: white, no
  name tab, the text's own line breaks, held until the script moves on);
  `add_msg` follows the exe's three outputs (window, quest board, else the last
  speaker); `window_msg` is the window at GUI 0xbe (88, 120), 384 x 80
  (`0x00971d18`); `list` at GUI 0x39; the quest board text at GUI 0x74; yes / no
  at GUI 0x2d. The DOM overlay is gone.
- **Fixes**: a `LABEL16_SET` argument is a u8 count of u16 labels (the decoder
  read u16s until a zero, so `switch_jmp` landed inside the next instruction:
  q101 opened the Ragol warp to floor 0); 6x75 and 6x77 now carry size 3
  (newserv dropped the client on the 8-byte 6x77 the first `sync_register`
  sent).

**Checks:** `tests/npcs.test.ts`: 3634 NPC entries of 235 free-play floor
variations and 575 BB quest floors resolve (types no factory constructs, like
q068's 0x14, are skipped as the client does; 0x33 / 0x45 / 0x46 are counted as
not drawn yet); the 66 archives build with 64 nodes and no missing texture and
play the idle motion; the Pioneer 2 talk parameters; the area script runs every
NPC's label, every balloon speaks as that NPC, and the counters 0..7 open.
`tests/questflow.test.ts`: Mop-up Operation #1 places the four players,
opens the Ragol warp to Forest 1, the lieutenant's briefing is 7+ balloon
pages over NPC 105 and starts the mission (r0, synced), and the success
label pays 1500 meseta; the 6x24 / 6x69 / 6xC9 layouts; npcplayerchar.dat.
`tests/quests.test.ts`, `tests/enemies.test.ts`, `tests/warpmenu.test.ts` and
`tsc --noEmit` pass. In Chrome against newserv: Pioneer 2 shows its 23 NPCs
(the Lab its 21, Elly says "Hello! WebHunter." in her balloon); Enter at the
guild clerk opened the welcome window, the categories, Extermination, the
long description with "Will you take this offer?"; Yes downloaded and started
Mop-up Operation #1, which moved the player to its start; the lieutenant
turned and spoke the briefing in balloons; Forest 1 loaded the quest floor;
back at the guild with r255 set the clerk said "Very good! ..." and the
reward window showed "You've been awarded 1500 Meseta." and newserv answered
the 6xC9 with 6xBE.

**Approximations / open:** the talk target is the counter's range / facing
rule, not the player's action-palette target; walking townspeople stand
still; the camera movers of the talk are not played; NPC players do not
follow or fight (6x69 commands 1-3 are logged); the guild clerk's lines use
the quest window's position; text colours are drawn white; the quest board
list opens with B (the exe opens it from the main menu); the other counters
(shops, bank, tekker, medical center) only log.

## 2026-10-17: the CCA main gate, four-light door lamps and the jungle warp beams

**What changed:**

- **CCA main gate** (`TObjWarpJungMain`, object `0x020A`): it is a warp with a
  menu now. Constructor `0x0066d8bc` (create `0x0066d840`): the base warp
  object, radius 15.0 at `+0xac`; in Challenge mode (`get_room_type() == 1`)
  it removes itself unless param6 is odd. Its vtable `0x00b356e0` opens the
  menu at `+0x34` (`0x0066dab4`): a list window at position-table entry `0x34`
  = (176, 130) with three items, unitxt group 10 indices `22, 24, 25`
  (`0x009c9654`), sized by `FUN_0073608c` (widest item + 20, items * 20 - 6 +
  20); `+0x40` (`0x0066da28`) maps the chosen item to the floor table
  `0x009c9660` = 6, 8, 9 (Jungle Area North, Mountain Area, Seaside Area).
  `render/warpmenu.ts` (`CCA_WARP`, `ccaWarpLayout`), kind `cca` in
  `render/fieldobjects.ts`.
- **Jungle warps** (`TObjWarpJung` `0x0201` and the main gate): radius 15.0
  (create `0x0066d4c4`; it was 10). The beam (model 1 of
  `bm_obj_warp_jung.bml`) advances 4.0 frames per tick (`0x00939df8`) and goes
  back to frame 0 once it is past the last frame (`0x0066d28c` /
  `0x0066d6b4`) instead of wrapping the overshoot: new part drive `restart`
  (`NodeAnimator.restart`). The render (`0x0066d2d8`) sets the six beam nodes
  to `ts064_beam_aka` (red, param6 0) or `ts064_beam_ao` (blue, param6 1)
  (names at `0x00939e68` / `0x00939e78`, looked up in texture list 0 by the
  loader `0x0066db88`); those nodes are the only users of ids 1 and 8, so it is
  a texture id remap (new part field `texIds`).
- **Four-light doors** (`0x01AB` Temple, `0x01C0` Spaceship, `0x0221` /
  `0x0222` Seabed): they wait for `param5` flags from `param4` (Ruins / Space:
  the unlock check `0x0061fce0` loops over the raw param5; Seabed:
  `DoorSetState_00620d70` clamps it to 0..4), not always four, and param4 >
  0x100 never opens (`init_map_object_door_switch_type`). Before this a
  two-lamp door waited for four flags and never opened. Each lamp is two model
  nodes (`MapObject_InitializeGeneric_0078e9b0` depth-first indices: Ruins
  `0x0061f8c4` 3,4,6,8 / 2,5,7,9; Space `0x0061fed8` 4,6,8,10 / 5,7,9,11;
  Seabed `InitializeItemDoor_00620f90` 2,4,9,11 / 3,5,10,12; Seabed U
  `0x006211b8` 2,4,7,9 / 3,5,8,10). While the door is closed the body keeps
  its own texture list and lamp i takes the green list once its flag is set
  (or when it waits for none, or the door is unlocked); opening, open and
  closing draw the whole door green (renders `0x0061fa60`,
  `RenderDoorSub_006209dc`). The Ruins / Space archive is picked by map
  (`LoadDoorAssetsForCurrentMap_00620450`: maps 0x15/0x16 Spaceship), and
  Seabed Lower uses the `_02` lists (`fs_obj_doorx4_atui_02`,
  `fs_obj_doorx4_usui_02` and their greens). `objectmodels.ts` `lamps`,
  `ObjectLayer.setLamps`, `fieldobjects.ts` `doorLamps`.

**Checks:** `tests/warpmenu.test.ts` (CCA gate floors, names and window; the
four-light flag rules; the lamp states; the CCA floor has its gate and Temple,
Spaceship and Seabed have lamp doors), `tests/waves.test.ts` (every lamp node
exists and draws a model; all object models still build with no missing
textures). In Chrome against newserv: in an Episode 2 game on the CCA, standing
in the main gate opened the three-item window "Jungle Area North / Mountain
Area / Seaside Area"; Down + Enter warped to Mountain (floor 8). In VR Temple
Alpha the two-flag door showed four lamps, three green and one red with flag
104 set; setting flag 105 unlocked it and it opened (state 5).
## 2026-10-17: the status window, EXP and levels

**What changed:** the game view draws the original client's HUD and the
character levels up. `classic/hud.ts` is the local player's status window in
the top-left corner (colour badge, name, `Lv`, HP / TP bars and numbers, the
photon blast gauge ring), the "EXP+n" text over a killed enemy, the
"Level Up" text over a player's head and the level-up lines of the message
window; `render/playerhud.ts` lays a 2D canvas over the WebGL canvas, scales
the 640x480 space by the window height, ticks the HUD at 30 frames per second
and projects world anchors. `formats/plyleveltbl.ts` reads PlyLevelTbl.prs
from the server's stream file; `combat/progression.ts` holds level, EXP and
stats; `render/combat.ts` wires it: the kill shows the EXP the client
computes, `6xBF` adds the server's EXP, `6x30` levels up, refills HP / TP and
plays the level-up sound, `6xDD` sets the EXP multiplier, and level / EXP /
stats are written back to the game snapshot and the session's E7. The HP
read-out is gone (the DOM line only shows the revive hint while dead); max HP
now uses the client's formula instead of the raw HP stat.

**From PsoBB.exe:**
- **Window:** `CreateChallengeMenuListWindow_007438f0` at window position 0x1d
  of 0x00971f40 = (28, 37), template `0x009f3c04` = {228, 76, element list
  `0x009f3a20`}: 15 typed records (sprite, texts, numbers, bars) with their
  positions, colours and flags, decoded by
  `allocate_counted_array_of_text_objects`. Background
  `render_player_hud_bg` (0x00743b60): gauge pie, corner piece (texture 13
  texels 118,80-187,160 at screen 0,0), window (texture 13 0,0-228,76) of
  f256_hyouji.prs; the badge is texture 0 at (34 * slot, 202)
  (`QuickMenuUpdateListItemPosition_0074253c`).
- **Glyphs:** textureenglish.xvm texture 0, glyph c at ((c & 0xf) * 16,
  c & 0xf0), 13 high (0x0097a7b8), advances / y offsets from 0x009fce80;
  numbers right-aligned (`AutoClass6::unknown_render_text4`), 10 per digit
  (0x00970dcc); current value and "/" at max.x - max.width - 12 (0x00973188).
- **Bars:** `ScrollbarObject_Render_0072a2c4` / `_RenderThumb_00729c90`
  (texels u 230/237-249/252, v 30..37), hold 0x24 frames then 2 per frame
  (`UiElement_UpdateAnimation_00729fa4`, `UpdatePosition_00729924`), damage
  colour 0xffff2924 / heal colour from the template, low (<= 20%, 0x0097308c)
  colours 0xfff2ff19 / 0xffffc114 faded over 11.1 frames
  (`QuickMenuTPBar_InterpolateColor_0072a4d8`).
- **Gauge:** `QuickMenuRenderTextBackgroundInternal_00742bd4`, radius 26 at
  window + (44, 30.5) (0x0097313c), arc 0..0xd700, colours 0x00972fa0.
- **Max HP / TP:** `unknown_set_total_stats`: round(materials + (stat + level)
  * factor), factors 0x00968fc4 = hunter 2.0 / 1.0, ranger 1.85 / 1.0, force
  1.45 / 1.5, androids TP 0 (0x009691b0).
- **EXP / levels:** `handle_packet0x60_subcommand0xbf` (0x006928c0) ->
  vtable +0x30 = `add_to_player_exp_and_clamp` (0x006947dc), cap = threshold of
  level 199 (`GetPlayerStatValue_006ac5e4`); 6x30
  `UpdatePlayerStatsAndLevelMessage_006928e4` ->
  `HandleInvincibilityAndEquipmentReset_00692c14` /
  `ApplyCharacterStatAllocation_00692e84` for the local player, full refill,
  `DisplayLevelUpMessage_00692aa4` (u"Level Up" 0x0093c818, SE 0x58d, 60
  frames, 6-frame fades 0x0097a828). Kill EXP shown by `handle_experience`:
  bp exp * (ep2 13 : 10) * (killer 10 : 8) / 100 * multiplier, magenta, 20
  frames delay + 20 frames (`display_special_attack_text_effect`, float object
  0x0078abd0: 1.4x glyphs, rise 1.4 per frame, per-glyph fade-in).
- **Level-up lines:** `display_levelup_stats` (0x0073fa5c): unitxt(11, 0x59)
  indent, "LEVEL n", "HP +", "TP +", ATP / DFP / MST / ATA / EVP (unitxt 11
  0x9c..0xa0), one every 0x16 frames, into the message window at position
  0x22 = (373, 203), 255 x 120.

**Checks:**
- `tests/level.test.ts` (78 checks): PlyLevelTbl.prs (Sega's file) equals
  newserv's level-table-v4.json in all 2400 entries; thresholds, cap, multi-
  level jumps, the HP / TP formulas per job, kill EXP, the 6xBF / 6x30 / 6xDD
  parsers, the window layout (draw calls of the status window: positions,
  texels, right-aligned numbers), the bar hold/slide and colour fade, the
  floating text lifetimes and the message line pacing.
- `tsc --noEmit` clean; `tests/combatdepth.test.ts` still passes.
- In Chrome against newserv: a level 1 HUmar shows 40/40 HP, 29/29 TP; after
  kills in Forest 1 the server's 6xBF raised EXP 15 -> 52, 6x30 arrived, the
  window went to Lv 2, 48/48 HP, 35/35 TP and the message window listed
  LEVEL 2, HP +8, TP +6, ATP +7, DFP +1, MST +5, ATA +1. No console errors.

**Approximations / open:**
- The window-opening wipe and slide-in are not drawn (the steady state is);
  photon blasts and TP use do not exist yet, so the gauge stays at 0 and TP full.
- The message window's own scroll / timeout and frame are not decoded: lines
  scroll up when 5 are shown and fade after 300 frames (ASSUMED).
- The head anchor of "Level Up" is the model's bounding-box top (the client
  uses player +0x920); the level-up light / particle are not drawn.
- Killing in Forest 1 can still get the client disconnected: newserv rejects
  some `6x60` drop requests ("Flag update refers to missing enemy", then
  "vector") when the enemy index does not match its map; this predates the
  HUD (the live check stubbed the drop request).
- The debug name label over the player and the player list keep the level
  they were built with.

## 2026-10-17: a build that keeps every page, and parts that cannot be wrong

**The build dropped two of the three pages.** Vite only treats `index.html` as
an entry point, so `vite build` emitted `index.html` alone and left out
`classic.html` (the classic UI, the whole point of the project) and
`models.html` (the player model viewer). `client/vite.config.ts` now takes every
`.html` at the client root as an entry, so a page added later is included on its
own; a build now emits the three pages and the dev server still serves them.

**The object part spec is a union now.** `ObjectPartSpec`
(`client/src/formats/objectmodels.ts`) used to be one interface of optional
fields, so a part could ask for a `drive` with no `motion` to drive, or for two
texture lists at once, and still compile. It is an intersection of a base with
two unions instead: a part either plays a motion and says how it is driven, or
holds its bind pose; and its texture list is the archive entry's own, another
entry's, or a separate archive - never two. `objectmodels.typecheck.ts` holds
the compile-time checks: `tsc --noEmit` covers every file under `src`, so each
`@ts-expect-error` there fails the build the day the type stops rejecting that
mistake. Nothing imports the file, so the bundle is unchanged.

## 2026-10-17: more field objects, and an honest "no model" list

**What changed:** four more object classes are drawn, and the volumes that draw
nothing on purpose are no longer reported as gaps.

- `TLazerFenceSw` (the laser fence with its motor): the loader that fills
  `g_SwitchLaserBMLAsset` takes `fe_obj_switch_laz_j.bml` when the map is a CCA
  tower or Seabed one (`is_cca_tower_seanight_map_()`, `seabed_upper`,
  `seabed_lower`) and `fe_obj_switch_laz.bml` elsewhere, with the texture
  archive of the same name (`_a` in Ultimate). It keeps NJCM chunk 0 (the
  fence, whose children are the laser segments) and chunk 1 (the motor) plus
  both NJM chunks. `MapObjectKomoVariant6Render_0065d9d0` draws the laser nodes
  only while the switch is locked (state 0;
  `MapObjectKomoVariant6StateIdle_0065d924` holds it there until
  `IsSwitchUnlockedOnCurrentFloor_00816eec`), then the static model and the
  animated one at the frame in `+0xb8`, advanced by
  `g_KomoVariant6AnimSpeed_00938adc`.
- `TObjLazerFenceExtra` (a fence with no switch of its own): the loader of
  `generic_laser_fence_bml` picks `fe_obj_lazer2_2.bml` in the Episode 2 outdoor
  maps, the Seabed, the Tower and CCA, and `fe_obj_lazer2_4m.bml` elsewhere.
- `TOHealGeneral` (the recovery ring): one model, `fe_obj_kaifuku_moto_2.bml`
  in the loader's first branch, `bm_fe_obj_kaifuku_moto.bml` by default.
- `TObjWarpBoss03`: `InitializeSeabedTuriganeWarpObject_0066c89c` fills the same
  fields from the globals `init_bosswarp_assets` loads, so it draws like
  `TObjWarpBoss` (ancient archive in the Ruins, jungle in CCA and the Seabed,
  the plain one elsewhere). Outside those areas the same type number is
  `TObjFogCollisionPoison`, a volume, so the class is chosen by name.
- `isInvisibleObject()` lists the classes that draw nothing on purpose
  (`TObjPlayerSet`, the fog and event volumes, `TObjRoomId` — whose only drawing
  code in the binary is `TObjRoomId_debug_display` —, the ambient sounds and the
  camera). The object layer counts them separately and the floor log now reads
  "N placed, M invisible", so "no model" means a real gap.

**Checks:** `tests/waves.test.ts` builds every object of every free-play floor:
45480 of 37911 entries resolve across the Ultimate variants (up from 44989), 137
distinct models build with no missing texture (up from 133), and the remaining
list is genuinely unimplemented classes (Pioneer 2 shops and their doors, the
jungle rocks, Vol Opt's ship door and friends). `npx tsc --noEmit` passes.
## 2026-10-17: quests, from the server's menu to a running script

**What changed:** a game can load a quest and run it. `net/quests.ts`
(`QuestClient`) speaks the whole exchange — `A2` for the quest menu, `10` for a
category, `09`/`A3` for a description, `10` again to pick one, then the
`44` + `13` file pair for the `.bin` and the `.dat` with the per-chunk
acknowledgements, and the `AC` barrier in both directions (`A4`/`A5`/`A6`/`A7`
for the download variants are handled on the same path). `formats/questbin.ts`
parses the Blue Burst `.bin` (header, label table, bytecode decoder) and
`formats/questdat.ts` the typed-chunk `.dat` (objects, enemies, wave events per
floor). `formats/questopcodes.ts` is generated from newserv's opcode table by
`tools/gen-quest-opcodes.ts`: 528 Blue Burst opcodes with their argument
shapes, which is what lets the decoder skip an opcode it does not implement by
exactly the right number of bytes. `quest/vm.ts` is the script VM
(threads, registers, the arg stack, floor handlers, map designations, quest
flags, message windows, the quest board); `quest/session.ts` ties the two files
to it, `quest/run.ts` wires it to the game and the view. `render/gameview.ts`
loads a floor from the quest's designation and its `.dat` instead of the
free-play set data when a quest is running, `render/gamefield.ts` ticks the VM
on the game clock and answers its switch-flag and zone-clear questions, and
`net/game.ts` gained `6x75` / `6x6F` / `6x77` (quest flags and synced
registers). The Online tab has a Quests panel: categories, the quest list,
the long description and Load.

**From PsoBB.exe and newserv** (layouts and the full opcode list in
PROTOCOL.md, "Quests"):
- **The VM is thread-based.** `quest_start_thread(0)` (`0x006bc76c`) runs label
  0; `QuestThread2_Constructor_006bc800` sets `pc = objcode_labels[label]` and
  kills the thread when that entry is 0xFFFFFFFF. `thread`, `thread_stg` and
  every floor handler (`quest_start_floor_thread`, `.c:615128`, reading
  `floor_handlers[g_CurrentFloor]`) spawn more. Each runs until it yields.
- **Two argument sources.** Dispatch is a 772-entry table of (setup shim, body)
  pairs (`.c:559261`). An opcode flagged `F_ARGS` reads *no* inline bytes: its
  arguments come from `g_QuestOpcodeArgStack[8]`, filled by `arg_push*`
  (`.c:611281`–`.c:611345`), and `opcode_setup_a` (`.c:602676`) clears the
  stack afterwards. `opcode_set_floor_handler` (`.c:605650`) is the proof:
  `set_floor_handler(argStack[0], (ushort)argStack[1])`. Register arguments on
  that stack are pushed as plain immediates holding the register number, which
  is what real quests emit (`arg_pushb 0x3C; set_player_start_position` is
  `r60-r63`).
- **Which floors are the quest's.** `process_map_designate_v3_BB`
  (`.c:613155`) writes `floor_map_designations[floor]` = {map, map_variant,
  objset} and the per-floor mode `g_QuestData8_00a95628[floor]`: 0 = the
  quest's own set data, 1 = the offline free-play template, 2 = the online one,
  3 = nothing. `HandleQuestDat` (`0x006ba0da`) then either loads the free-play
  assets or appends the `.dat`'s chunks. The geometry always follows the
  designation: `MapLoader_LoadAndSwapGeometry_00806fcc` indexes the map's
  asset-prefix list with `map_variant`.
- **Quest flags** are 0x400 bits per difficulty with MSB-first bit order
  (newserv `FlagsTable<0x400, 4, Difficulty>`); `gset`/`gclear`/`grev`/`glet`
  send `6x75` on BB, the leader sends the whole table as `6x6F`.

**Checks:**
- `tests/quests.test.ts`: all 335 Blue Burst `.bin` files newserv ships
  decompress, parse (all 335 carry the full 0x122C header), produce a label
  table whose label 0 decodes, and run through the VM without throwing; the
  reachable bytecode of all of them decodes with **0 undefined opcodes**; their
  `.dat` files give 1146 floors, 119701 objects, 75405 enemies and 19351 wave
  events with no chunk errors; the generated opcode table is cross-checked
  against `newserv disassemble-quest-script --bb` (every mnemonic newserv
  prints exists in our table, and the name and episode match).
- Running the start label of every BB-English quest and then every floor
  handler reproduces the `floor_assignments` the quest assembler wrote into the
  `.bin` header in 164 of 166 (the two that differ are explained in
  PROTOCOL.md), and reaches no unimplemented opcode outside challenge mode,
  Battle Arena and the enemy-parameter family.
- `tests/quest.live.ts` against newserv: create a game, `A2` → 4 categories,
  open Retrieval → 8 quests, `09`/`A3` description, load "Lost HEAT SWORD",
  both files received and decompressed (11656 + 36056 bytes from 1622 + 14471),
  `AC` round trip, the header and the menu entry agree, the VM designates
  floors 0/1/2/11 and installs their four handlers, and the `.dat` carries set
  data for all four.
- `tsc --noEmit` clean; `tests/quests.test.ts`, `tests/game.live.ts` and
  `tests/setdata.test.ts` pass.
- In Chrome against newserv: created a game (Pioneer 2, 23 enemies / 30
  objects free play), opened the Quest menu, picked "Lost HEAT SWORD"; the
  floor reloaded with the quest's own set data (19 enemies / 26 objects, the
  `.dat`'s floor-0 counts), the quest's opening dialogue played page by page
  ("Ca... can you help me? Please?" through "I cannot do my job without it!
  Please get it back for me."), and warping to Forest 1 loaded the quest's
  forest (84 enemies / 103 objects) and ran its floor handler. No console
  errors.

**Approximations / open:**
- The message window, the choice list and the quest board are DOM overlays, not
  the game's own text renderer; only the common `<rXX>` / `<fXX>` / `<cr>` /
  `<hero name>` / `<hero job>` tokens are interpolated.
- `npc_crp*` records the NPC and logs it: no model, no `6x69`.
- Challenge mode, Battle Arena, the enemy-parameter opcodes
  (`set_enemy_*_data`, `set_override_enemy_bp_index`) and the item opcodes are
  decoded and skipped; the random-enemy `.dat` sections (types 4/5) and the
  `evt2` event format are recognised and skipped.
- `set_player_start_position` is recorded but the player still spawns at the
  floor's `TObjPlayerSet`; `get_player_state` always answers "standing".
- `6x6F` is read but still not sent to a joining player.
## 2026-10-17: taking damage, dying, and enemies that come after you

**What changed:** combat now works in both directions. `combat/playerdamage.ts` tracks the local player's HP and runs the hit / knockback / death / revive states of the client's player state machine, with the field motions and the `6x4A` / `6x4B` / `6x4C` / `6x89` + `6x4D` / `6x4E` / `6x4F` subcommands (`net/game.ts` gained the senders and the parsers). `combat/enemyai.ts` is the generic walking-enemy FSM: an enemy stands at its spawn point, notices a player inside its search radius, cries out, walks at it at its BattleParamEntry movement speed, attacks when the player is inside its AttackData reach and arc, deals damage and knockback at the attack animation's hit frame, recovers for 15 ticks and goes back to the chase or home. `render/combat.ts` drives both at 30 Hz, resolves the enemy melee against the player with the client's own hit and damage formulas, and keeps a small HP read-out over the canvas. `render/combatoverlay.ts` adds the damage number over a hit enemy and the lock-on reticle. `formats/battleparams.ts` now also reads AttackData's reach / arc and the MovementData block.

**From PsoBB.exe** (addresses and layouts in PROTOCOL.md, "The player taking damage" and "Enemy behaviour"):
- Player states `13 / 14 / 15` (light hit, heavy hit, dead) play field motion slots **11 / 9 / 12**, the evade of `6x4A` slot **10** and the stand-up after a revive slot **13**; the slot numbers are the motion-set vtable getters `0x006A75AC`, `0x006A759C`, `0x006A75B4`, `0x006A75A4`, `0x006A75BC`, all `mov eax, N; ret`. The rows come out of the field motion tables `0x009CBEEC` / `0x009CBF04`, all mode 3.
- Invulnerability after a light hit is `invincibility_frames[8 + x]` of the table at `0x009690E8` = 60 ticks; the heavy-hit handler writes the literal 300.
- `6x4B` vs `6x4C` is the damage as a fraction of max HP (≤ 25% is light), and `6x4C` turns the player to face the knockback.
- Dying sends `6x89` (the killer's entity id from `get_enemy_last_attacker_idx` @ `0x007778D8`) and `6x4D` (`player+0x92C` death flags) from one function, `dispatch_actions_0x89_0x4d` @ `0x0069E234`; `6x4E` follows when the death motion ends.
- The Forest enemies share one AI dispatcher (`unknown_booma_enemy_ai`, 10 states). Its per-enemy record at `enemy+0x358` gives the target search radius and the turn rate: Booma family `g_BoomaHitboxParams` @ `0x009BC880` = 225 / 250 / 300 units and 1024 BAMS per tick, Monest `0x009BB764` = 225 / 1536, Savage Wolf `0x009BB9EC` = 225 / 1536, Rag Rappy `0x009BC144` = 150 / 1024, and `DefaultEnemyCollisionParams` @ `0x009C3EB0` = 100 / 1024 for everything else.
- The move speed and the animation step are the enemy's **MovementData** from BattleParamEntry: `fparam1`/`fparam2` normally, `fparam3`/`fparam4` within 50 units of a Hunter (100 for other classes), with hysteresis out at 100 / 150 — the squared distances `{10000, 2500, 22500, 10000}` at `0x00922330` read by `ClearEnemyHitbox_0052AC5C`. Booma: 0.8 / 0.8 / 0.5 / 0.5.
- The melee lands at animation frame 7 (`check_entity_animation_elapsed_threshold(this, 7.0)`) with `try_hit_entity(this, 1.0)` + `cause_knockback(this, 3.0)`, and the recovery is `0xF` = 15 ticks. The reach and arc are `AttackData.distance_x` / `.angle` (Booma 12 and `0x1C71` ≈ 40°).
- Booma collision radii 7 / 7 / 8 (10 / 10 / 9 in Ultimate) are literals in `init_booma_subtypes_global_config`.

**Checks:**
- `tests/combatdepth.test.ts`: 691 checks. All 570 hit / death / revive motion rows, the spot values against the exe tables, the light/heavy split and the whole `PlayerDamage` flow (invulnerability, knockback decay, death → revivable → revive), the `6x4B`/`6x4C`/`6x4D` wire layouts, the AI tables (search radii, turn rates, collision radii, guard-stance distances, the MovementData-index rule against newserv's `notes/movement-data.txt`) and the FSM itself (idle → notice → chase → attack → recover → home, the turn-rate clamp, the 150-tick give-up, a Monest that never moves), plus one Booma hit against the real `BattleParamEntry_on.dat`.
- `tests/game.live.ts` gained a block where A shields an attack, takes a light and a heavy hit, dies and revives, and B receives `6x4A`, `6x4B`, `6x4C`, `6x89`, `6x4D`, `6x4E` and `6x4F` — newserv accepts all of them.
- `tests/combat.test.ts` still passes (5946 checks); `tsc --noEmit` is clean.
- In Chrome against newserv: in Forest 1, Boomas noticed the player at ~145 units, cried out, walked in to `reach + collision radius` = 19 units, attacked and knocked the player back; HP fell 20 → 2 → 0, the death motion played and held, the read-out showed `HP 0/20 - dead (press R)`, R revived with 3/20 HP and the Boomas killed the player again. Attacking back logged `hit E-73 (BOOMA) for 8: 84/92 HP`, the lock-on reticle tracked the nearest enemy in front and the damage numbers floated up over it.

**Approximations / open:**
- The enemies never check line of sight (the client raycasts the map collision in `unknown_booma_enemy_find_target`), so one can notice a player through a wall; an idle enemy stands still instead of walking the wander path, and the pack-spreading (`Derolle*Subordinate*`) is not reproduced.
- Every family uses the generic FSM. Savage Wolf (its own `SavageWolfProcessState_*` leap), Rag Rappy (`update_rappy`, the fake death), Monest (spawns Mothmants) and Poison Lily keep their motions but not their own state machines; the wolf's and Monest's MovementData is zero in the file, so the wolf falls back to an assumed 0.5 units per tick and a Monest simply never moves.
- The attack animation's length and the war cry's length come from the enemy's motion itself, but the second attack (`animation_id` 3 vs 4, chosen by `g_BoomaAttackSuccessChance`) is just alternated; that float was not read out of the binary.
- The knockback is a single impulse damped 0.75 per tick instead of the client's velocity integration (`ClampAndDampPlayerVelocity_00694230`), and the `_DAT_0093DA04` turn threshold is assumed small.
- Only the local player is hurt by enemies: each client resolves its own hits, so a second client is never damaged by this client's AI (the real game works the same way, but there every client runs the AI of the enemies it owns).
- The player's EVP and DFP are the character's base stats; the equipment contribution (`FUN_00770DA4`'s equip path) is still not decoded, as for ATP in the attack direction.
- Reviving is bound to R because the web client has no Reverser, Moon Atomizer or trip back to Pioneer 2; the real client cannot revive itself.
- Hit boxes per body part, techniques, specials and status effects are still missing.
## 2026-10-17: multi-part enemies, boss warp gathering and boss music phases

**What changed:** three things that only show up in boss rooms.

1. **Enemy child objects.** `EnemyPartSpec` (`render/enemymodel.ts`) gained a placement (`offset`, `yaw`, `place: 'enemy' | 'world'`), a `hidden` flag and an `archive` field, so an enemy can be built from children of its own archive, of a second archive, or placed around the arena instead of at its set entry. `buildEnemy` wraps every part in its own group and returns a second root for the world-placed ones; `EnemyLayer` adds that root to the scene unmoved and hides/shows/disposes it with the enemy. Enemies that gained children: **Chaos Sorcerer** (two bits), **Vol Opt phase 1** (6 pillars, 24 monitors and the lightning rod — the `0xC2` controller used to draw nothing at all), **Dark Belra** (the two thrown arms), **De Rol Le** and **Barba Ray** (tentacle and mine models), **Dark Falz** (forms 2 and 3, Rico and her ring) and **Saint-Milion** (its spinner, from the second archive `bm_ene_boss09_tentacle.bml`).
2. **Boss warp gathering (`6x6A`).** `render/bosswarp.ts` is the transporter's five-state machine: the confirmation with the party list, the 300-frame gather, the 0x96-frame warp and the "battle going on in the next area" wait. `net/game.ts` sends `6x6A` and `gamefield.ts` drives the machine, draws the windows through the warp overlay (which gained a message line and a side panel) and warps when the machine says so.
3. **Boss music phases.** `audio/bossbgm.ts` holds the track of every boss phase and maps the leader's boss action subcommands (`6x15`, `6x19`, `6xA4`/`6xA5`) to a phase; `FieldMusic.setBossPhase` plays it.

**From PsoBB.exe** (addresses and tables in PROTOCOL.md, "Child objects", "Boss warp: gathering the party" and "Boss music phases"):
- Vol Opt's controller AI state 0 (`0x0043C680`) builds the whole arena: 6 pillars on a ring of radius 76.0 (`0x008FE56C`) at 60° steps facing `−0x4000 − angle`, 24 monitors as 6 walls × 4 shapes (`i & 3` → model `0x009A5210[shape]`, position `0x009A51E0[shape]` turned by `(i >> 2)·60°`), and the lightning rod at (0, 80, 0). The arena origin is `g_VoloptForm2Config/-Value` = (0, 0) for phase 1 and (0, −5000) for phase 2, which is exactly where `map_boss03n.rel` puts its two sections.
- The Chaos Sorcerer's bits are entities of their own with model entry 1 and the body's texture list, at ±15.0 and 18.0 above the body; the body itself is drawn 22.0 above its entity position, which this client was not doing.
- A boss warp's state machine and its four handlers, the 300/0x96-frame timers, the three unitxt strings and the three GUI window positions.
- Every `play_bgm` call site in the binary (there are 46; the ones that matter are `vol_opt1/2.adx`, `dark1/2.adx`, `proto1/2.adx`, `HALL.adx` and the two Saint-Milion OGGs).

**How the values were read:** the named Ghidra dump gives the code, but not the data tables. Instead of Ghidra headless (which needs disk this machine does not have), the tables were read straight out of a local `PsoBB.exe` with a small PE reader, mapping VA → file offset through the section headers; it reproduced a known value first (`CITY_ZONES` at `0x00934F40`) before anything new was taken from it. Function entry points were pinned by finding the `E8` call sites that target the window a data reference sits in. newserv's `add_enemy_and_children` cross-checks every child count.

**Checks:**
- `tests/enemies.test.ts` also builds and checks the children now (part archives, `texlistOf` ranges, one group per part under the right root, the hidden ones not drawn): 139 distinct models over 235 floor variations, all pass.
- `tests/bossrooms.test.ts` (new): the gather flow as a lone leader, the 300-frame timeout, "No", a non-leader waiting for the leader's `6x6A`, and the music table plus `bossPhaseOf` for `6x15`/`6x19`/`6xA4`/`6xA5`.
- `tests/fieldbgm.test.ts`, `tests/warpmenu.test.ts`, `tests/waves.test.ts`, `tests/combat.test.ts`, `tests/sound.test.ts` still pass; `tsc --noEmit` is clean.
- In Chrome against newserv: warped a game to Vol Opt (floor 13) and the arena came up with its six pillars on the 76-unit ring and the 24 monitors on the six walls; walked into the Forest 2 boss warp and the transporter asked with the party list, the `6x6A` went out on Yes and the floor change followed the gather.

**Approximations / open:**
- The children a fight spawns (tentacles, mines, arms, spinners) are built hidden: the boss FSM places them, and that is not decoded. Only one spinner is built rather than sixteen for the same reason.
- The Saint-Milion spinner is built without a motion: its model has 59 nodes but its motions cover 32, so the client animates a sub-tree of it (the three model/texture/motion slots of `0x009F5B20`).
- Which of `dark1.adx`/`dark2.adx` is form 2 and which is form 3 comes from the order of the two calls, not from the handlers.
- The lightning rod is drawn in its bind pose: its motion table (`g_VoloptMinionStatsData`) has no address in the dump.
- `map_boss03n.rel` has three sections that all carry id 0 (at z 0, −5000 and +5000), so the Vol Opt set entry is placed in the last of them. That is a pre-existing placement quirk of `placeEntities`, not touched here; the children are unaffected because the client places them from the arena origin.

## 2026-10-17: the named Ghidra dump is the first place to look

**What changed:** `tools/refsrc.sh` looks things up in the
[original-psobb-client-source](https://gitlab.psobb.io/psobb/original-psobb-client-source)
checkout. Its `src/Psobb.exe-*.c` is a full Ghidra dump of the binary (~986k
lines, ~13300 functions) whose functions carry community-given names with the
address kept as a suffix, so an address from a capture, a note or another
function resolves to a name and a body in one grep:

```sh
tools/refsrc.sh addr 005c4010   # UpdateGroundItem_005c4010, with its body
tools/refsrc.sh name ItemBML    # LoadItemBMLChunks_005d7a68, InitializeItemBML_005d7ccc, ...
tools/refsrc.sh grep 0x5F       # the hits in headers/ and notes/
```

Everything that has to come from the client is looked up there first; Ghidra
headless (`tools/ghidra/run_any.sh`) stays the fallback for what the dump
leaves unnamed and for the data tables, which it does not carry. The checkout
lives outside this repository (`REFSRC`, by default
`../refsrc/original-psobb-client-source`) and is never committed here.

## 2026-10-17: items on the floor, pickup and the item commands

**What changed:** a game now has items. `net/items.ts` (`GameItems`) keeps the floor items and the local inventory and speaks the Blue Burst item protocol: server drops (`6x5F` from boxes and enemies, `6x5D` for meseta and split stacks), pickup (`6x5A` → the server's `6x59`), dropping (`6x2A`, or `6xC3` + `6x29` for part of a stack and for meseta), equip/unequip/use (`6x25`/`6x26`/`6x27`), inventory creation (`6xBE`), floor-item destruction (`6x63`) and the item state a joining player receives (`6x6D`, BC0-decompressed here for the first time). It also tracks the other players' inventories (from `65`, `6x70`, `6x59`, `6xBE`, `6x29`) so their `6x2A` drops can be shown. `render/flooritems.ts` draws the items with the client's own box models and handles Enter: pick up the nearest item, else break the nearest item box (`6x0B` + `6xA2` to the leader). The Inventory panel (`ui/inventoryPanel.ts`) gained Equip / Unequip / Use / Drop / Drop 1 buttons and a meseta drop field; the rows follow the local inventory, which `GameItems` keeps in step with the server (and writes back into the raw `E7` so the next `6x70` carries it). `render/gameview.ts` only gained the wiring.

**From PsoBB.exe** (details and addresses in PROTOCOL.md, "Items on the floor, pickup and the item commands"):
- A dropped item is **not** drawn with its own model: `FUN_005d7ccc` loads `item.bml` (descriptor `0x009c2794`: 14 models, 1 motion) and `FUN_005d7a2c(kind)` hands out model `kind + 2` with `gun_bullet.xj`'s texture list. `ItemModel.afs` / `ItemTexture.afs` are the held weapon models, not the floor boxes.
- The box kind (`+0xf5`) comes from the table `0x0092bb88` = {0, 1, 1, 2, 3} indexed by `data1[0]`, or 4 when the item is rare (`FUN_005d6990` → `FUN_005d693c`, the same stars/flags test the item names use). Tools with an ItemPMT `type` take kind `type + 4` (`FUN_005c3e3c`), which is how the event boxes (egg, pumpkin, present) appear.
- Wrapped items (`FUN_005d281c`) and kinds 6/7 draw the gift box with two tint tables, `0x009c2000` (box) and `0x009c2060` (ribbon), indexed by the present colour in `+0xf0` (`FUN_005d68b4`).
- Kind 5 (rare tools) scrolls its texture by `1/256` per frame (`FUN_005cb350`, `0x0092bd9c`); every floor item turns `0x200` BAMS per frame (`FUN_005c4010`). There is no bobbing and no extra glow pass in the floor item code.

**Checks:**
- `tests/itemmodels.test.ts`: all 14 `item.bml` entries match the descriptor and the 11 box models build with no missing texture; every ItemPMT item (3055 looks: 1536 definitions, plain and wrapped) resolves to one of them; the decompiled rules spot-checked on hand-made items; BC0 round trip and `6x6D` parsing; the `6x5F` and `6xA2` layouts against newserv's real-client capture (`GC-ForestGameRareMagFeed`); the inventory rules (stacking, splitting, meseta, equip slots, armor unequipping its units, write-back to `E7`). 4608 checks pass.
- `tests/items.live.ts` (two clients against newserv): item ids (creator from `64`, joiner from `6x6D`), A drops an item and B picks it up and gives it back, one item of a stack through `6xC3`/`6x5D`/`6x29`, meseta, equip/unequip/use seen by the other client, Forest 1 boxes broken with `6x0B` + `6xA2` until one drops an item that both clients see and A picks up; at the end each client's inventory equals the one newserv sends back in the lobby (`67`).
- `tests/items.test.ts` and `tests/game.live.ts` still pass; `tsc --noEmit` is clean.
- In Chrome against newserv: in a game on Pioneer 2, Drop put the Handgun and a Monofluid on the floor as spinning boxes at the player's feet, the Inventory panel updated (Monofluid x5 → x4), walking away and back kept them in place, Enter picked one up again, and a second client joining the same game received them in its `6x6D` and saw the same floor items.

**Approximations / open:**
- The drop commands carry only x and z, so the box is placed on the collision mesh under that point; the client's own height rule was not traced.
- The Enter radii (15 for items, 20 for boxes) are fitted; newserv refuses a pickup beyond 30. Enter is a stand-in until combat can break boxes.
- No drop animation (2026-10-18: the exe has none; an item appears where it lands), no "item found" HUD line (the exe has none) or sounds, no classic Item Pack menu actions (the buttons live in the Online tab's panel), no bank, shop, tekker or mag feeding, and no partial-stack amount beyond "Drop 1".
- Enemy drops are implemented on the receiving side only (`6x5F`); the kill requests come from the combat agent's code.
## 2026-10-17: basic combat (attack combo, damage, enemy death, drop request)

**What changed:** the game view can fight. The player attacks with the action-palette keys, the three-attack combo plays the real weapon motions, the hits are rolled with the client's own accuracy and damage formulas against the enemies' `BattleParamEntry` stats, damaged enemies flinch, dead ones play their death motion and disappear, and all of it is sent to the other clients and to newserv with the subcommands a real client sends. New files: `client/src/combat/{attack,formulas,enemymotions}.ts`, `client/src/render/combat.ts`, `client/src/formats/{battleparams,enemyslots}.ts`. `render/gameview.ts` only builds the `CombatView` and hands it each floor; `render/lobbyview.ts` gained four small hooks (`playerAnimator`, `setPlayerAngle`, `resetGait`, `attacking`), `render/enemymodel.ts` a `play()` / `ended` on `NodeAnimator` and `render/enemyview.ts` an instance list plus `remove()`.

**From `PsoBB.exe` (Ephinea 1.25.13)** — the full decode is in PROTOCOL.md, "Combat":
- Hit check `FUN_00777664`: `p = (ATA × {1.0, 0.7, 0.5}[type] × {1.0, 1.3, 1.69}[combo step] − EVP × 0.2) × 0.01`, rolled against `FUN_007751B0`.
- Damage `FUN_007732B8`: `((ATP + spread × rand) + equip_ATP × (1 + attribute) + elements − DFP) × 0.2`, then `{0.9, 1.7, 0.5}[type]`, `× 1.5` on a critical (`rand × 500 <= min(LCK, 100)` for a player attacker, `× 200` for an enemy one). Below 1 damage is a miss; over 25% of max HP sets the big-hit flag; HP below 1 sets the dead flag.
- Stat block of every entity (`FUN_00770DA4` for players, `FUN_007868F8` for enemies): ATP `+0x2CC`, spread `+0x2CE`, EVP `+0x2D0`, DFP `+0x2D2`, ATA `+0x2D4`, LCK `+0x2D6`, HP `+0x334`, resistances `+0x2F6..+0x2FE`. Player ATA is `(class_min_ata + ATA) × 0.1` with the class table at `0x00968A60`.
- Combo states 5/6/7 (`FUN_006A11FC`, `FUN_006A0CFC`, `FUN_006A07D8`), their phases (`FUN_00698FA8`), the hit frames (`0x00968CA0`, per-hit rows for daggers and two more classes), the combo windows (`0x00969078`) and the field motion tables (`0x009CBEEC` / `0x009CBF04`, 6 motion types × 19 weapon classes × 72 slots; slots 2, 3, 4 are the attacks) are ported into `combat/attack.ts`.
- Reach from ItemPMT's weapon range table (`FUN_007A19C0`, row picked by `FUN_005E4BA8`): the volume reaches `a + b` with a horizontal half-angle and a target limit (Saber: 32 units, ±26°, 1 target). `formats/itempmt.ts` now parses `WeaponRange` and `RangedSpecial`.
- Enemy damage and death motions from the enemy motion tables already decoded (`combat/enemymotions.ts`); enemies whose table is not decoded fall back to the archive's `damage*` / `dead*` entries.

**Protocol:** `6x43`/`6x44`/`6x45` (attack 1/2/3), `6x46` (the entities a strike hit), `6x0A` (enemy damage and flags, `0x20900E00` for a killing hit), `6x76` (set flags 8 on the dead enemy), `6x60` to the leader (drop request, `rt_index` from newserv's `type_defs`) and `6xC8` (BB EXP request). Incoming `6x43`-`6x45` play the attacker's motion, incoming `6x0A` applies the damage, flinch or death. Entity ids need the enemy *slot* expansion (children of Monest, Pan Arms, bosses…): `formats/enemyslots.ts` is a port of newserv's `SuperMap::add_enemy_and_children`, and `tools/gen-entity-names.ts` now also generates `ENEMY_TYPE_PARAMS` (drop index and `BattleParamEntry` indexes per enemy type).

**Enemy stats:** `BattleParamEntry*.dat` (`formats/battleparams.ts`) comes from the server's stream file (`04EB`), which newserv also answers on the game-server connection, so the game view fetches `ItemPMT.prs` and the episode's table once per game (`net/bbsession.ts` gained `fetchStreamFiles`).

**Checks:**
- `tests/combat.test.ts` (new, 5946 checks): the formula constants and the hit / damage / flag math, the combo state machine (three-hit chain, a lost combo, the charge pause), the 6x byte layouts, every enemy slot of every Episode 1/2/4 floor against newserv's `print-free-supermap` (types and entity ids), and `BattleParamEntry` rows against newserv's `battle-params.json`.
- `tests/game.live.ts`: client A attacks and kills a Forest 1 enemy; B sees `6x43`, `6x46` and the dead `6x0A`, and the server answers with EXP (`6xBF`) and the item drop (`6x5F`).
- Chrome, against newserv: Forest 1 with 67 enemies, all with battle params; eight attacks on a Booma (92 HP) took it down 14, 16, 16, miss, 15, 16, 14, 15 with flinches, then the death motion, the drop request and the model being removed. No console errors.
- `npx tsc --noEmit` passes.

**Known mismatch:** entity ids are counted from the client's own map files, as the client does, but newserv validates them against its own BB maps, whose `map_city00_00e.dat` has 21 enemy sets where the Ephinea client's has 23 — so ids on floors above Pioneer 2 are shifted by 2 against this server. The commands are accepted and the drop and EXP work; the enemy the server credits can be a neighbour of the one the player hit. `tests/combat.test.ts` and `tests/game.live.ts` therefore read newserv's own map files when they need an id.

**Not done:** techniques (`6x47`/`6x48`), photon blasts, weapon specials and status effects, the player taking damage (`6x4A`-`6x4F`), the equipped weapon model in hand, damage numbers and the lock-on reticle, hit boxes per body part (one box per enemy is used), enemy AI (enemies stand still), mechgun-style multi-shot attacks, and the action-palette assignment (the palette keys are assumed to be normal / heavy / special).
## 2026-10-17: object models, door collision and wave events

**What changed:**
- Field objects are drawn with their real models instead of stand-in panels: doors of every area, area / boss / Ragol / lobby teleporters, switches, boxes and the common scenery of each floor. `formats/objectmodels.ts` maps the `o.dat` type to an archive, model entries, texture archive, texture id and tint; `render/objectview.ts` loads the BMLs the way the client's loaders do and keeps the parts that are only drawn in one state (locked / unlocked door, lit switch) switchable. Doors play their opening motion, warps their beam motion.
- Closed doors block the player: `render/collision.ts` gained `obstacles`, the object collision boxes the client turns on while a door is closed; `move()` refuses a step that ends inside one.
- Wave events: `formats/events.ts` parses the floor's `.evt` (events and action stream), `render/waves.ts` runs the client's state machine (trigger → delay → spawn → all dead → actions), and `render/gamefield.ts` wires it to the enemy layer, the switch flags, the music and the network. Enemies of a wave only appear when their wave starts (`EnemyLayer.hideAll` / `setVisible`), the music switches to the battle variant while a wave of the player's room is alive, and `6x67` (trigger) / `6x76` (enemy defeated) are sent and received.
- For the other agents: `GameView.onEnemyKilled(entityId, floor?)` advances the wave of a killed enemy, and `GameView.fieldObjects` exposes the floor's boxes (`boxes`, `breakBox(index)`). In the browser console `psoWaves` lists the events, triggers one (`psoWaves.trigger(id)`), kills the enemies of the active waves (`psoWaves.killWave([room])`) and dumps doors, switch flags and boxes.

**From PsoBB.exe (Ephinea 1.25.13; details and addresses in PROTOCOL.md, "Object models" and "Wave events", and in the comments of the new files):**
- Object factory: the per-area tables at `0x00a06be0`. Each class's loader reads one BML with `LoadBML_005b7a84` (entries by position) and a `.gvm`/`.xvm` texture archive; `FUN_005b8610/8624/8638` hand out model, texture list and motion. Renders use `FUN_00835090` / `FUN_00835574`, `FUN_00829cc8` for the texture list and `FUN_0081a588` for a per-mesh texture id (the door numbers and lamp colours).
- Forest door `FUN_006573d4` / `FUN_006571f4`: the door, its laser, the numbered sign in the digit colour of `0x009c7b04` and the two lamps (texture 0x15 locked, 0x16 open). Forest switch `FUN_00658b0c` / `FUN_00658824`: base, glow while set, digit in the colour of `0x009c7ce0`.
- Door collision boxes from `InitEnemyCollisionBoxes_007b9a88` in each constructor; flag 1 is set while closed (`FUN_007b52c4`) and cleared when open (`FUN_007b52ec`).
- Event file and action stream: `LoadMapEventTableByVariant_0080cf78`, `set_active_map_event_on_floor`, `quest_event_handler_constructor` / `update_quest_event`, `ProcessQuestEventCommands_0080cc44` with the dispatch table `0x00a11da0`. `6x67` is handled by `FUN_00659f5c`, and `FUN_008003e0` runs the handler of what it sends, so the sender applies its own trigger.
- Battle music: `FUN_0069821c` → `FUN_008114b0` (an enemy of the player's room built and not dead), calm again after 0x5A frames.
- Enemy entity ids: 0x1000 + the slot of the entry, with the child counts ported from newserv's `add_enemy_and_children` (`formats/enemyids.ts`); newserv checks them.

**Checks:**
- `tests/waves.test.ts`: the 227 free-play event files parse (6730 events, 16833 actions, 6209 `set_switch_flag`, 3651 `trigger_event`); every object entry of every free-play floor resolves (44489 of them), 130 distinct models build with no missing textures and their motions play; the wave state machine runs a two-wave chain; the door collision box blocks and stops blocking.
- `tests/game.live.ts` now also checks that a second client sees `6x67` (wave trigger) and `6x76` (enemy defeated) through newserv.
- In Chrome against newserv: Pioneer 2 shows the Ragol teleporter with its beam; Forest 1 loads 76 object models (9 doors, 2 switches, 48 boxes, 11 event triggers, 20 wave events) and 66 enemy models that start hidden; `psoWaves.trigger(21)` spawned room 2's wave after its 30-frame delay, `killWave(2)` cleared it ("room 2 cleared") and set switch flag 2; the room 4 chain (events 41 → 411 → 412, 4 enemies each) unlocked door 43 (state 0 → 2) through its switch flag 3; the nine closed doors are nine collision boxes.

**Approximations / open:**
- Objects still without a model: the Pioneer 2 shops and their doors, laser-fence switches, jungle and crater rocks, Vol Opt's ship door (its two models parse as neither XJ nor NJ chunks), the Lab warps, and the invisible collision objects (which draw nothing anyway). The test prints the list.
- The warp beams are drawn opaque; the exe blends them additively.
- `construct_objects` (action 08) is logged, not executed; the door unlock camera (`TObjDoor` state 1) and the room-unlocked chat bubble are not shown.
- Random-wave quest files (`evt2`) are parsed as empty: free play never uses them.
- The web client applies 6x76 only for the wave state; enemy HP is the combat agent's.

## 2026-10-17: real 3D characters in the classic screens

**What changed:**
- Character creation now draws the real player model (`buildPlayerModel` with the proportion morph) instead of the capsule placeholder. It is animated and seen through the creation camera decoded from `PsoBB.exe`.
- SELECT CHARACTER shows the selected slot's character, spinning, as `FUN_00406ab4` does.
- The `E5` preview parser exposes the visual config.
- New files: `classic/playerview.ts` (shared model, motion and projection code) and `classic/charselect_preview.ts`. `classic/charcreate_model.ts` was rewritten.

**Creation camera (object `FUN_004eb334`, vtable `0x00afd318`):**
- `FUN_004ea5a8` computes the eye: `+0x3c..+0x44` = (r·sin yaw, dist·sin pitch + height, r·cos yaw), with r = dist·cos pitch. The target `+0x48..+0x50` is (0, height, 0). `FUN_004d1ff4` copies eye, target and angle `+0x54` (0x438e) into the global camera.
- Pitch and yaw are eased to 0 (`FUN_007a8c74(a, 0, 0xc0)`), so the camera looks horizontally from (0, height, dist).
- `FUN_004ea854` (camera state 0):
  - the step's mode (0 = HEAD/FACE/HAIR/SKIN, 1 = PROPORTION/AUTO, 2 = other steps) is adopted only after it has been requested for 31 frames;
  - target distance and height: mode 0 = 0.5·h and 0.91·h; mode 1 = 25 and 11; mode 2 = 1.25·h and 0.55·h;
  - h comes from `FUN_004e68cc`: the class table `0x009b11e0` (value at proportion_y = 1, value at 0), lerped by proportion_y, which is reset to 0 outside 0..1;
  - each value moves with its own velocity (`+0x88`, `+0x8c`). The velocity grows by 0.003 per frame up to 0.1. Within 0.1 of the target it shrinks by 0.003, down to 0.00667, and it stops within 0.00667;
  - starting values: distance 30 and height 10.5 (`DAT_00a72230`), mode 2.

**Projection (`FUN_0082eea0` / `FUN_0082ebc8`, angle in ECX):**
- a = ((angle·85)/100)/2 in integer BAMS, read from the disassembly (`LEA`/`ADD` chain, then the `0x51eb851f` multiply).
- fovy = 2·trunc_BAMS(atan(tan(a)/1.1333334)). The result goes to `D3DXMatrixPerspectiveFov` with aspect 4/3.
- Angle 0x3555 gives fovy 57.49° (focal 437.5 px for 480 lines). Angle 0x438e gives 73.74° (focal 320.0 px).

**Two passes:**
- The model pass is `FUN_004e7824` → `FUN_004eb3b8`, `FUN_004e7844`, `FUN_004eb430`:
  - angle 0x3555, near 1, far 10000;
  - the viewport is shifted by ox = −128·(W/640)·k (`_DAT_0091d8f0` = −128). `FUN_0082f308` clips it to x = |ox|..W, so the projection centre sits at (W + |ox|)/2: x = 384 of 640 normally.
  - k (`DAT_00a72234`) is 1, except in the PROPORTION and AUTO editors (`FUN_004f2f28`, `FUN_004f2988`). Once their fade reaches 1, k drops by 1/30 per frame down to 0, which centres the model. While they close, k = max(k, 1 − fade).
  - The model is at the origin, turned by `DAT_00a72120` (0; analog rotation is not reproduced).
- The ruler (`FUN_004ea030`) is drawn by the editors in the 2D pass, after `FUN_004d2968` has reset the viewport to full and the projection to the camera's angle 0x438e (near 1, far 21000).
- The captures confirm both projections:
  - the ruler spacing in 05/06/07 is exactly 48 px per unit at 1800 lines (320/25·3.75), centred at y = 11;
  - the feet, drawn with the narrower angle, reach well below the y = 0 line;
  - in 08 the spacing is 51 px with the height already at 11, which is the camera still easing in from a mode-0 step.
- The ruler quad's color is #404040 in sRGB (it was a linear 0.25 by mistake). Its strip order and colors come from `0x009b8c28`.

**Motions:**
- Both screens load `charamakingmot.bml` (`FUN_004e9a68`, `FUN_004072b8`). Its 49 entries are plain NMDM chunks: an `NJS_MOTION` at +8, offsets relative to it, long-form angle keys.
- Both screens use the same 16-byte motion records (`0x009b1580` for creation, `0x009a2ec0` for select): {mode 1, next 0, entry, speed 1.0, flags 0}.
- Records 0/1/2 are the idle `B02` for male / female / FOmarl (entries 33, 1, 0). Records 3..5 are `B01` (31, 32, 30) and 6..8 are `C10` (47, 48, 46).
- The type is 0 when class_flags & 1 (`FUN_004e9370`), or on select when !(class_flags & 2) (`FUN_0040733c`). FOmarl (class 6) is 2.
- `PlayerAnimator` now takes any `MotionSource`, so these motions play through it.
- `tests/motions.test.ts` decodes the 9 records (2074 keys) and plays them on FOmar, FOmarl and HUnewearl.
- During creation, the section ID is 0xFF until the name is confirmed, so the emblem texture is the empty ring `'z'`: `buildPlayerModel` gained an `emblemSectionId` override.

**SELECT CHARACTER preview (`FUN_00406ab4` → `FUN_00406b50`, vtable `0x00af2308`):**
- Mode 0 (`FUN_0040680c`): position (17, −10.5, −40), Y rotation 0xf3d5, spinning.
- Update `FUN_00406bd8` is driven by the request `+0x100` set by the scene (`FUN_00413b84`): 1 on every cursor change, then 2 if the slot holds a character.
  - State 1 builds the model from the current character (`FUN_004eba6c`) and starts record 0/1/2.
  - State 2 waits for the model.
  - State 3 turns it by −0x100 BAMS per frame. Motion changes: B01 at frames 900 and 1800 (`FUN_00407008`), C10 at 1350 (`FUN_00406fc8`), and back to idle at 2250 (`FUN_00407048`).
  - Render `FUN_00407098` runs in state 3 only.
- The select scene sets no camera or projection of its own. The view is taken as the identity and the projection as the client default (0x3555) over the whole window. That puts the model at x ≈ 506 of the 4:3 screen (≈ 560 of the 16:10 window), to the right of the CHARACTERS box. **No capture with a character exists to confirm this.**

**Slot icons (`FUN_0040e004`):**
- A container (vtable `0x00af2c38`) holds one child per slot (`FUN_0040de04`, vtable `0x00af2c48`; count 4 from `0x008fa268`). `FUN_00401664(3)` → `FUN_0040e15c` sets them up.
- Each child is a 180×38 quad of `f256_player_tex` (u 0..0.703, v 0.594..0.742), the "TRANSFERRING DATA" bar:
  - it flies from (131, 182) to its slot in 14 frames at 1/15 per frame, alpha +1/15 (`FUN_0040df24`);
  - it fades out by 1/15 (`FUN_0040dfcc`);
  - it is drawn white with that alpha (`FUN_0040de9c`).
- The child draws only when the slot record's field +0xc is set. `FUN_006c44d0` writes 0 there, and that is the only reference to `DAT_00a95e3c`, so on Blue Burst the overlay never shows. It is implemented and kept hidden.

**`E5` preview:**
- `parsePreview` now also returns `classFlags`, `costume`, `skin`, `face`, `head`, `hair`, `hairColor` and `proportion` (shared config +0x24..+0x3c).
- Live, against newserv: account webtest has slot 0 = HUmar "WebHunter", proportion (0.5, 0.5).
- Characters made by older tools carry class_flags 0. The preview falls back to the class's own flags.

**Validation:**
- FOmar, costume 7, proportion (0.6, 0), AUTO step, compared with capture 05:
  - SSIM 0.741, PSNR 22.7 over the whole frame (0.722 against 07);
  - SSIM 0.656 on the model region (1440×900 crop 350×780 at 540, 60).
  - What remains: the hair style and face are not matched, lighting (the lobby rig; the screen's lights are not decoded), and the ruler drawn under the model rather than depth-tested against it.
- The model's size, position and the ruler line up with the capture.
- In mode 2 (e.g. COSTUME) the model sits at x = 1728 of 2880, which is (W + 576)/2.
- In Chrome:
  - the select screen with two offline slots shows FOmar and FOmarl spinning to the right of the box;
  - moving to an empty slot drops the model;
  - there are no console errors.
- `tsc`, `tests/players.test.ts` and `tests/motions.test.ts` pass.

**Open:**
- The camera and projection of the select scene; the lights of both screens.
- The analog model rotation (`FUN_004ef18c`) and the camera idle demo (states 1–4 of `0x009b8c60`).
- Under the widescreen patch, k = 1 (normal steps) shifts the viewport by 128·W/640 as the code says; no capture shows a normal step with a model.
- The creation screen does not cross-fade the model on look changes; it is rebuilt with the motion frame kept.

## 2026-10-17: enemy models and idle motions

**What changed:** the game view draws the enemies of each floor with their real models instead of markers (`render/enemyview.ts`), at their spawn position and rotation, playing their idle motion. `formats/enemymodels.ts` maps every set type (and the params that pick variants) to an archive, a model entry and a motion; `render/enemymodel.ts` loads the BML like the client (entries by position, textures shared by texture-list name, separate XVMs for texture swaps) and plays NJS_MOTION on the bones. Objects, NPCs and the two controller types without a model keep their markers. `formats/njmotion.ts` now decodes quaternion keys (Episode 4 motions) and standalone `.njm` files; `RelFile` can wrap a Ninja chunk body.

**From PsoBB.exe:** the per-area type → factory table `0x009fba60`, the asset descriptors (e.g. `0x009bb3f4`) and the loader `FUN_005b7a84`, the Ultimate (`FUN_00520e6c`) and low-detail (`FUN_00482a20`) archive choices, the rappy season table `0x009bbbc0`, and for each constructor the model choice, texture swaps and motion table slot (see PROTOCOL.md, "Enemy models", and the comments in `enemymodels.ts`). newserv's Map.cc comments were used to name params and cross-check the type names.

**Checks:** `tests/enemies.test.ts`: 94 archives match their descriptors; all 24304 enemy entries of the 235 Episode 1/2/4 free-play floor variations (online and offline tables) resolve for every difficulty, both detail levels and the seasonal events; 136 distinct models build with no missing textures and their motions play. In Chrome against newserv: Forest 1 (Booma, Wolf, Rappy, Monest), Cave 1 (sharks, Poison Lily), Jungle North (Merillia, Gibbon, Gee) and Crater East (Boota, quaternion motions) render textured and animated.

**Not done:** sub-objects drawn by separate objects (Dark Belra's arms, Sorcerer bits, Deldepth disc, Morfos arm, Recons, Pofuilly tails, Saint-Milion parts, Vol Opt phase 1), Recobox orientation, Sinow stealth, boss intro motions (the idle slot is shown), the server's rare flags (only param-driven variants), De Rol Le / Barba Ray fins and tentacles.

## 2026-10-17: lobby HUD from the decompiled code: chat, balloons, main menu, info counter

**What changed:** the classic lobby HUD (`classic/lobby.ts`) is now built from what `PsoBB.exe` (Ephinea 1.25.13) does, in three new modules: `classic/chat.ts` (input line, word balloons, chat log), `classic/mainmenu.ts` (the Home menu, its help window, the Item List window, the 3D view shift) and `classic/counter.ts` (the information counter menus). Checked live in Chrome against newserv: chat (balloon with name tab and tail), Home menu with Item Pack > Items (the character file's inventory) and Chat > Log Window, and the counter's Transport menu. `tests/lobby.live.ts` still passes.

**Chat key and input line:**
- Inputs follow the key-config order: input 8 `main_menu_1` = "Menu Open/Close" (HOME), input 9 `begin_chat_input` = "Start" (SPACE). `FUN_0072f37c` opens the input when `FUN_0072fdac` sees input 9; Enter (0x61) sends and Escape (0x4c) cancels (`FUN_0072f280`). F12 is input 31 (`main_menu_2`).
- `FUN_00713540` builds the input (`TWindowKeyboardBase`, ctor `0x0072ebfc`, vtable `0x00b40548`).
  - `FUN_00731300(200, 2)`: 220.1 × 60 (200 + 20.1 at `0x00970f9c`, 2 × 20 + 20 at `0x00970f98`).
  - At most 79 characters (`FUN_007312f0(0x4f)`).
  - Window at table entry 0xc9 = (7, 397); the IME position is 0xcc = (11, 382).
- The render (`FUN_0072fee4`) has no frame: flag 0x40 is only set by `FUN_0078ee8c`. Text wraps at the content width, 20 px per line.
- The cursor (`FUN_007307a8`) is a 5 × 14 quad, `0x8000ff00` / `0x4000ff00` (table `0x00970f68`), alternating every 16 frames.

**Chat log:** there is no log on screen.
- `FUN_0073b858` keeps 30 lines `"<name> > <text>"` (`0x00a9a920`, separator `0x00971cfc`).
- They show in the main menu's **Log Window** (id 0x15, `FUN_00752114`): a list window at (17, 36), 303 × 400 (`0x00973d78`), that also receives new lines (UI table + 0x44).
- The old bottom-left log was not in the original and is gone.

**Word balloons:** `FUN_007184f8` → `FUN_00718b74` holds up to 4 balloons (UI table + 0x90..0x9c). When all four are taken it replaces the one farthest from the player. Vtable `0x00b3fcc8`: update `FUN_0071dd20`, render `FUN_0071e084`.
- **Text and size:** black text, wrapped at 200 px (`FUN_00720940`). The window is the text extent + 20.1 (`0x00970560`). Sound 0x574 plays on each message.
- **Lifetime:** round(length × 3.3 + 55.5) frames (`0x0097037c`, `0x00970380`). Chat uses flags 0xcb (0x1cb with word wrap); bit 1 turns on the countdown.
- **Scale animation:** scale += (target − scale) × 0.47 (`0x00970574`) until the step is below 0.011. It grows 0 → 1, and the text appears when it is done. On a new message it drops to 0.5 and the size lerps over 6 frames. At the end it shrinks to 0.
- **Anchor:** the head point is the model position + model bound × 0.92 (`FUN_00716204`, `0x0096fe90`).
- **Placement** (`FUN_0071f0c0`, `FUN_0071f830`):
  - The balloon sits on an ellipse around the head, with radii ((w/2 + 20)/2, (h/2 + 10)/2) and a default angle of 0xd400 (up-right).
  - It is pushed out by 1000 / camera distance, and only moves when the new spot is 10 or more away.
  - The centre follows the target by 0.21 per frame (`0x00970468`).
  - The balloon is clamped to 20 / 40 from the screen edges (`FUN_0071fe58`).
- **Shape** (`FUN_0071ff10`, `FUN_00720308`, quad `FUN_0082bb74` = P0, P0+A, P0+A+B, P0+B):
  - The white rounded block at (98, 0)–(194, 96) of `f256_hyouji` texture 1, tinted by the speaker's colour (table `0x009702a0`, 12 colours).
  - It leans by 0.342 × height. The corner radius is min(h/2, 32), and the width with the lean is W = w + 0.342 h.
  - A black copy is drawn first, offset by (3, 2.5) × scale.
- **Tail** (`FUN_00720444`): a triangle from the balloon centre (half-width 12 × scale) toward the head, stopping 1000 / distance short of it. It is drawn black under the balloon and coloured over it.
- **Name tab** (`FUN_0072062c`): `texturejapanese.xvm` texture 0, texels 145..193 × 237..256, at (−11, −18) from the balloon.
  - 16 px caps, 25 px high, with the name in black at +6, +3.
  - It fades in over 6 frames.

**Main menu (Home):** the per-player menu object (`FUN_0071a3d0` + 0x2c, ctor `FUN_007338ac`) is filled by `FUN_00733d70` from layout tables of {u16 id, u16, u32 sub-table}.
- **Entries (`0x009f2f40`):** Item Pack, Customize, Technique, Chat, Team, Options, Quit Game. Androids use `0x009f3020`, which has no Technique.
- **Sub-tables:** Item Pack (`0x009f2f80`) = Equip, Items, MAG, Trade Window, Area Map, Quest Board. Chat (`0x009f2fb8`) = Shortcut, Symbol Chat, Guild Card, Simple Mail, Info Board, Log Window. Team (`0x009f2ff0`) = five team entries.
- **Window:** `FUN_00738e40`, render `FUN_0073950c`, at table entry 0x1b = (28, 85).
  - It is 116 wide (`0x009f316c`, set at `0x00739fbe`) and items are 16 px apart (`0x00a9a8e0`, set at `0x00739fb4`).
  - Height = items × 16 + 51 + 39, lerped over 8 frames.
  - The panel is `f256_hyouji` texture 13: an 18 × 28 corner, a 116 × 23 top, 16/4 px body strips and a 39 px bottom. The branch is chosen by `FUN_007083d4`, which returns 1.
- **Labels** are images, not text: 98 × 16 texels of texture 2 of `TextureEnglish.gvm`/`texturejapanese.xvm` (`0x00a9cd48`, loaded by `FUN_0079324c`).
  - The texel origins per id are in table `0x00971980`.
  - Colours: selected 0xff6121, open sub-menu 0x51eaff, disabled 0x686868.
  - The rows fade in one after another: age −2 × row, alpha = age / 4.
- **Help window:** `FUN_0073249c` → `FUN_0073aa40` at entry 0x1c = (17, 312), 206 × 140 (`0x00971100`). It types unitxt 0x0B [id].
- **3D view shift** (`FUN_00733b2c`): while the menu is open, the projection centre moves right by 80 and up by 115.2 (`0x009712c8`/`cc`), and the view scales by 0.75. The change takes 3 frames each way. It is done with a projection-matrix post-transform, and the balloons use the same projection.
- **Item List** (Items, id 0xb, `FUN_0075086c` → `FUN_0075198c` → `FUN_00751a10`):
  - The Ship Select list-window class at entry 3 = (13, 256), 308 × 184 (`0x00973ca0`), 36 rows, titled unitxt 0x0B/0x37 "Item List".
  - Rows show `session.character` items with the names from `formats/itemnames.ts`. ItemPMT is loaded after login, as the Online tab does.

**Information counter:**
- **Trigger:** `TObjInfoCol` (object type 0x0180, radius param1; lobby 1 has six circles of radius 15 around the counter).
  - Its update opens `FUN_0079f218` when the player is inside a circle and presses Decide.
  - `loadLobbyMapData` now returns these circles (`infoCols`).
- **First menu:** entry 0xc6 = (68, 251), "Organize PARTY / Transport / Team", with the info window typing 0x0F/3.
- **Choosing an entry** collapses its menu to that line with the green bar (`FUN_0073600c`: 20 + line height, in 3 frames).
  - The next menu opens at entry 0xc7 = (82, 292): Change SHIP / Change BLOCK (`FUN_0079b568`), or Create Team / Ranking / Master Menu / Leave Team (`FUN_0079a288`).
- **Sizing** (`FUN_0073608c`, `FUN_00736458`): widest text + 20; items × 20 − 6 + 20; items centred.
- **Checked against capture e01:** "Transport" in green over "Change SHIP / Change BLOCK" and "This is the Information Counter." match.
  - psobb.io centres these menus horizontally (68 + 64 on a 768-wide screen).

**Approximations and open items (marked in the code):**
- **Balloons:**
  - The overlap avoidance between balloons (`FUN_0071534c` with random retries) is not ported.
  - The docking of balloons whose speaker is off screen (player-slot positions, `FUN_00717ca8`) is not ported; they are only clamped.
  - The text height is taken as 20 × lines − 6.
- **Name tags over heads:** no code for them was found in PsoBB.exe. They stay fitted to the psobb.io capture. The capture's name sits where ours does, at the counter.
- **Main menu:**
  - Selecting a sub-menu replaces the rows in the same panel; `FUN_00739418` was not fully traced.
  - The window fade-in (`FUN_00710c94`) is not reproduced.
  - Leaves other than Items and Log Window do nothing.
- **Item List:** the client's row format (`FUN_00750954`) is not decoded. Rows are item names, with "E " marking equipped items.
- **Counter:** "Organize PARTY" → Join/Create PARTY is assumed. The leaf actions (ship and block change, party, team) only close the menus.
- **Ship Select:** the camera behind it is still not decoded.

## 2026-10-17: floor music, warp menus, doors and switches

**What changed:**
- `audio/slbgm.ts`, `audio/fieldbgm.ts`: every game floor plays the music `PsoBB.exe` picks for its area. Pioneer 2 and the Lab use the exe's BGM zones (shop, guild, medical, principal, city); field areas use the interactive music; bosses their ADX tracks. `BgmPlayer` gained `playInteractive(index)` and `setBattle(on)`; the Online tab now has music in games.
- `render/warpmenu.ts`, `render/fieldobjects.ts`, `render/gamefield.ts`: warp objects open the original menus as a 2D overlay (classic window frame, selection bar and game text). The Ragol teleporter lists the destinations of the game's episode; area and boss warps show the destination name; the lobby teleporter leaves the game. Doors (Forest, Caves, Mines, Ruins, Desert) follow the Forest door's state machine and are drawn as stand-in panels; switches set their flag and send `6x05`; received `6x05` unlock doors too.
- `GameView` hands this to `GameField` (a few lines in `loadFloor`/constructor); the old "walk into the teleporter → floor 1" shortcut is gone. Note: type 0x44 (`TObjCityAreaWarp`) is the **lobby** teleporter, the Ragol one is 0x43 (`TObjCityMainWarp`).

**Findings (details in PROTOCOL.md, "Floor music" and "Warps, doors and switches"):**
- Field music is not one track per area. The twelve `slbgm_*` descriptors (`0x00a16088`) hold calm and battle tables of `{first, loop, count, transition, next}` records, and `data/ogg/slbgm_*.ogg` are chained Ogg files whose links are the segments. The sequencer (`FUN_00814c7c`, `FUN_00814f30`, `FUN_00815170`) queues one link ahead. In all twelve files the highest link used by the tables is exactly the file's last link, which confirms the decoding.
- Battle music is requested while the player's room has an active wave event (`FUN_0069821c` → `FUN_008114b0`). The web client runs no wave events yet, so the field music stays calm. `BgmPlayer.setBattle(true)` switches through the transition segments.
- The Ragol teleporter's availability mask (`FUN_0064a428`) already contains every destination on this client: Episode 1 Forest 1, Cave 1, Mine 1, Ruins 1; Episode 2 VR Temple Alpha, VR Spaceship Alpha, CCA, Seabed Upper (Lab warp type 1 / 2 split them); Episode 4 the four Crater routes, Crater Interior, Desert 1.
- Object factory: per-area tables of `{type, create, 250000.0, 0}` at `0x00a06be0` (index = area id).

**Checks:** `tests/fieldbgm.test.ts` (area table, sequencer runs, chained-Ogg links of the user's 12 files, BGM zones and the Dark Falz delay), `tests/warpmenu.test.ts` (teleporter entries and labels for the three episodes, window layouts, boss warp table, door flags and states, the warps/doors/switches of every free-play floor of variation 0), `tests/game.live.ts` (a Forest 1 switch's `6x05` reaches the other client through newserv). In Chrome against newserv: Pioneer 2 started `GUILD.adx` at the spawn point (inside the guild zone) and `city.adx` elsewhere; the Ragol teleporter showed Forest 1 / Cave 1 / Mine 1 / Ruins 1 at (176, 130), Cave 1 was chosen with the arrows and Enter and the warp loaded Cave 1 with its interactive music playing (signal on the output); the Cave 1 warp to Cave 2 showed its one-item window; in Forest 1 a switch unlocked its door, which opened when the player came within 70 units; the lobby teleporter returned to lobby 1.

**Approximations / open:**
- Door and warp models are not drawn: doors are translucent panels (red locked, blue unlocked) that sink while opening; the door motion length is assumed to be 30 frames. Closed doors do not block movement yet.
- Wave events (room-clear doors and battle music), the unlock camera of `TObjDoor`, the boss warp's `6x6A` player gathering, the boss fight music phases (`vol_opt1/2`, `dark1/2`, Olga's `T2`/`proto*`), the CCA main-gate warp menu (0x20A) and Episode 2's four-light doors are not done.
- The warp radius is checked horizontally (±30 in height): the exe uses a 3D distance, but the position the client keeps has no height while running.
- The radius of the Ruins/CCA floor warps and the other door types' distances are taken from the Forest objects, not traced.

## 2026-10-17: character file, item table and item names

**What changed:** the full character file (`E7`) is parsed (`net/charfile.ts`) and exposed as `session.character` after `enterLobby`: inventory with equipped markers, stats, level/EXP/meseta, bank, guild card, play time, technique levels, mag stats. `BBSession.streamFiles()` downloads the BB stream file (`04EB`/`01EB`/`03EB`/`02EB`), which is where the BB client gets `ItemPMT.prs`. `formats/itempmt.ts` is a port of newserv's V4 ItemPMT reader; `formats/itemnames.ts` names items from ItemPMT ids + unitxt and formats them like newserv's `describe_item`. The Online tab shows an Inventory panel under the lobby.

**Checks:** `tests/items.test.ts` parses the ItemPMT newserv streams (rebuilt with `newserv encode-item-parameter-table` when no ItemPMT file is given) and compares 36124 values over 1536 item definitions plus specials, stat boosts, star values, max tech levels, tech boosts, combinations, mag feed tables and sale divisors with `item-parameter-table-bb-v4.json`: no mismatches. Names for 1515 item codes match `names-v4.json` (4 entries where newserv corrected the game's text are checked against the game's text). `tests/charfile.live.ts` logs in, downloads the stream file, joins the lobby and prints the character (WebHunter: Saber, Frame, Mag LV5, Monomate x4, Monofluid x4).

**Finding:** ItemPMT ids and unitxt must come from the same build. The local Ephinea client's text tables do not match newserv's ItemPMT (Saber is unitxt entry 156 in `data.gsl:unitxt_e.prs`, 289 in Ephinea's loose `unitxt_j.prs`, 177 in newserv's). With newserv, the original client would show wrong item names for the same reason. The panel falls back to newserv's bb-v4 text set on the dev server.

**Not verified against the exe:** the description format is newserv's; the client's own item-name formatting function was not traced in Ghidra yet.

## 2026-10-17: classic client from SELECT CHARACTER into the lobby

**What changed:** choosing an existing slot in `classic.html` now runs the original flow: the "Connecting.." warp, the game-server login (93 phase 4), the server's main menu as the client's **Ship Select** window over the 3D lobby, `10` *Go to lobby*, `67`, and the 3D lobby (`render/lobbyview.ts` on a WebGL canvas under the 2D stage) with the lobby name window. Checked live in Chrome against newserv: warp, Ship Select, lobby, walking with W, chat send/receive (other players' chat and joins show in the log). `tests/lobby.live.ts` still passes.

**"Connecting.." and the warp (`classic/connecting.ts`, `classic/particles.ts`):**
- `FUN_007bd97c` is a modal loop around the connection. `FUN_004178f8` builds a 3D scene and the warp object `FUN_004179e8` (vtable 0x00af3738). It fades in from black (`FUN_00409d28` mode 2 → `FUN_0040a080`: alpha 1, −1/15 per frame).
- The warp object's update `FUN_00417ccc` fixes the camera at the origin looking down −Z (`FUN_004d31f4(9)`, `FUN_004d33c0`). On its second frame it creates `FUN_00418794`, which has two children:
  - `FUN_0040bf40`: particle effects 0x13 `load_blue`, 0x15 `load_yellow`, 0x17 `loadhikari`, 0x1d `load_circle`, 0x6e `load_red` (ids at 0x008f9ec8), 100 units ahead (0x008f9edc), rotations (0x4000,0,0) except 0x17 (table 0x009a3104);
  - `FUN_00417f90`: 0x16 `load_carsol` at 65 units (0x008fb12c).
- All six are particle type 0 (spawn `FUN_0050ec4c`, update `FUN_0050dbb8`, render `FUN_0050e698`):
  - velocity (rand·+0x38 + +0x30, rand·+0x3c + +0x34, 0), turned by a random angle about Y, then by the emitter rotation. The quarter turn about X makes the rays fan out in the screen plane and fly toward the camera;
  - x/z damped by +0x50, y += +0x54, size ×= +0x2c;
  - tex_flags & 4 → streak of length +0x64·|step| and thickness +0x68·|step| (note: +0x64/+0x68 here, +0x60/+0x64 for type 2);
  - textures by GBIX of `effect_nt.xvm` (785981 = #18, 700531 = #9, 700420 = #24). `XvrTexture` now carries `gbix`.
- "Connecting.." object (vtable 0x00af2438, ctor `FUN_00407bf0`): render `FUN_00407f6c` draws "Connecting.." at (23, 331) while state < 3. `FUN_00408200` sets state 2 with the result, and update `FUN_00407c6c` waits 150 frames before state 3 (errors from unitxt group 0x36, `FUN_004080ac`). The screen keeps the warp for 150 frames after the server answers, like the original.
- The result matches capture 09 of the original (rays, colors, centre, text position) by eye.

**Ship Select (`classic/shipselect.ts`):**
- 07 handler at 0x0079ba38: entry 0's name is compared with `L"BLOCK"`; the window title is the client's `L"Ship Select"` (0x0097ce50) or `L"Block Select"` (0x0097ce68). See PROTOCOL.md.
- List window: `FUN_0073fdc4` → `FUN_0073fe9c` → `FUN_00736988`, at position-table entry 0x28.
  - Position table: `FUN_0073ec50(i)` = 0x00971f40 + 8·i, {x, y} floats. Entry 0x28 = (12, 50).
  - Size 385 × 184 from `FUN_00737f80` (0x00972dd4); the other modes are 385 × 104 and 300 × 104.
  - Items 20 px apart (`FUN_00737cdc`), left-aligned 10 px in, 6 px below the title (measured).
- Info window: `FUN_0079bb58` → `FUN_0079a8c4` → `FUN_0073a888` at entry 0xd5 = (294, 305), 342 × 144. It types unitxt 0x0F/0. `FUN_00793168(i)` is unitxt group 0x0F and `FUN_0079317c(i)` is group 0x0B.
- Measured against the capture of the original:
  - menu frame at x 13.2, y 51.6 (decoded 12, 50), 383 × 181 (decoded 385 × 184);
  - info window 340 wide (decoded 342).
- Widescreen (psobb.io): windows keep a uniform scale by height. Windows whose centre is on the right half move right by the extra width: the info window lands at 294 + 128 and the lobby window at 622 + 128 on a 768-unit screen. `classic/ingame.ts` does the same.

**Lobby (`classic/lobby.ts`):**
- Lobby name window: `FUN_0079eb78` formats `"%s:%02d-%02d"` (0x0097cef0) from the ship name, the block and lobby + 1. `FUN_0073f510` shows it in a 160 × 27 window (0x009f340c) whose right edge is at table entry 0xc0 = (622, 37). It shows "newserv:01-01" as on the capture.
- BGM: `LOBBY.ADX` for Ship Select and the lobby (`FUN_00642c30`); silence while connecting.
- `LobbyView` gained two small additive hooks: `{ labels: false }` (no 3D name sprites) and `playerPositions()` for 2D name tags. The Online tab is unchanged.

**Keyboard (default key config):**
- newserv's `default-keyboard-config.bin` (0x16C bytes, the client's `key_config`) is a list of `{u32, key id}` pairs. They follow the order of the key-config labels in unitxt group 0: Move Forward/Backward/Left/Right, Lock Move Forward, Lock Walk Forward, Decide, Cancel, Menu Open/Close, Start, Select Up/Down/Left/Right, …
- Key ids are named by the table at 0x0097b5e0 (`{id, L": NAME"}`): 0x26 W, 0x22 S, 0x10 A, 0x13 D, 0x61 ENTER, 0x50 BACK SPACE, 0x06 HOME, 0x59 SPACE, 0x5c–0x5f arrows, 0x40–0x4b F1–F12, 0x2a–0x33 1–0.
- So the defaults are: W/S/A/D move, Enter decides, Backspace cancels, Home is the menu, Space is Start, and the arrows select. The classic lobby moves with W/S/A/D only; the arrows no longer move the player there.

**Approximations (marked in the code):**
- The camera behind Ship Select slowly circles lobby 1. The original camera path is not decoded.
- The info text types 2 characters per frame (fitted).
- Ship Select fades in over 15 frames (fitted).
- The chat log (bottom left), the chat input window and the name-tag offset are provisional; their code is not found yet. The chat input opens with Space or Enter.

**Open:**
- The chat log, chat balloon and chat input code. The chat trigger key is probably "Start" (Space) but is not proven.
- The lobby menu (Home) and the info counter menus.
- The ship-select camera.
- Where the `DAT_00a48a3c` mode that picks the list size is set.
- Fresh lobby captures of the original could not be taken this session: the display was asleep, so screencapture returned black frames.

## 2026-10-17: area fog and light

**What changed:** the map viewer applies each area's fog and light the way `PsoBB.exe` does. New parsers `formats/fogentry.ts` and `formats/lightentry.ts`; `MapViewer.setArea(source, area)` (called by `load`) sets the base fog and the light, `setFogRegions(placed)` takes the fog regions from the set data, `setFogOverride(id)` switches like a region does, and `fogProbe` says where "the player" is (the orbit target by default; the lobby sets its own player). The lobby now uses the area light instead of its own lights. Map entries with flag `0x1` are drawn without fog. Details in PROTOCOL.md (Area fog, Fog regions, Area light).

**How the fog works:** a fog object with four slots (base, override, staging, blend). The area start sets the base slot from the table at `0x009c1ec0` (fog id per area). Fog-region objects register their id every frame while the player is inside their sphere; the per-player manager switches the override in, or back to the base when nobody registered. Fades blend color, start and end over `1 / fade_step` frames (100 frames = 3.3 s for 0.01). Some entries wobble start/end with a sine. Render states are plain linear table fog (`FOGSTART`/`FOGEND` clamped to ≥ 0), which is what three.js `Fog` does.

**Checks:** `tests/fog.test.ts` (fog/light values, wobble, fade length, region enter/leave). In Chrome: Forest 1 green haze (`0x80ffaa`, 0..2000), Caves 1 orange (`0xff7000`, 156..791), Mines 1 pale blue (`0xe1e2ff`, 100..4000), Ruins 1 dark green (`0x0d4015`, 0..1193 with the wobble frozen at switch time). Walking the orbit target into the Caves 1 switch room (`TObjFogCollisionSwitch`, radius 240, fog 0x11) fades to the black dark-room fog in about 3 seconds.

**Open:** the sign convention of the light direction (treated as "toward the light", which makes the default `(0, 0, 1)` a headlight); the clear color behind the fog (kept as the viewer background); which areas set `FUN_0078b220()` (alternate fog file and light set); per-room `TObjLight` overrides; switch state (all switches are off in the viewer).

## 2026-10-17: games: create, join, Pioneer 2 and the field

**What changed:**
- `net/game.ts`: games from the lobby. Create (`C1`), list (`08`), join (`10`), the join command `64`, the loading sequence, the state sync to a joining player, warps between floors and leaving to the lobby (`98` + `84`).
- `formats/setdatatable.ts`: the client's `SetDataTableOn.rel` / `Off.rel`, which turns the variations of `64` into map files.
- `render/gameview.ts`: loads the floor the player is on (render map, collision, player starts, enemy and object markers) and warps when the player walks into an area warp.
- Online tab: a Games box in the lobby (create, refresh the list, join), then Warp and Back to lobby in the game.
- `tests/game.live.ts`: two Node clients. A creates a game; B lists and joins it; both see each other; both move (`6x42`, `6x40`, `6x3E`); A warps to Forest 1 and B follows; both return to the lobby; the empty game is deleted. `tests/setdatatable.test.ts` compares the table parser with newserv and resolves every free-play floor.
- The full write-up is in PROTOCOL.md, section "Games".

**How the flow was established:** newserv's server code tells what it accepts, and its `tests/*.test.txt` captures show what a real client sends. They are GC sessions, but the command and subcommand numbers are the same as BB.
- `GC-ForestGameRareMagFeed`: a player creates a game alone and warps.
- `GC-XB-CrossplayForestGame`: a second player joins. The leader sends `6x6D`, `6x6B`, `6x6C`, `6x6E`, `6x6F`, `6x71` and `6x70` to the joiner.

`seq.py` (scratch) turned the captures into command sequences.

**Findings:**
- **newserv holds the joiner's commands until it answers `1D`.** It sends `1D` right after `64`, and queues the other players' sync commands until the reply comes. A client that ignores pings never sees the others.
- **Joins are serialized by the loading flag.** A second player gets `01` "another player is currently loading" until the first one has sent `6F`. The server answers `6F` with `B1`; `Game.ready` resolves on that `B1`.
- **On BB the server sends `6x72` (resume), not the leader.** It goes to everyone except the joiner, once the leader's `6x70` has arrived.
- **The state sync is strict.** newserv records which sync subcommands it expects from whom, and disconnects a client that sends one it did not expect.
  - It also checks the entity counts in `6x6B`, `6x6C` and `6x6E` against every floor's map, including enemy children. The web client therefore sends only `6x6D`, `6x71` and `6x70`.
  - `6x6D` holds the next item ids, 0x00010000 + 0x00200000 × client id + the items each player has used. newserv now logs that they match.
  - The BC0 payload is a literal-only stream.
- **`64` has no appearance data.** It carries `PlayerLobbyDataBB` only (names, guild cards), in slot order. Classes and appearance arrive later in each player's `6x70`. The view then rebuilds the model; the first frames show a capsule.
- **`98` must carry real records.** For BB, newserv takes the battle and challenge records, choice search, info board and blocked senders from `98`, so zeros would wipe them. They are copied from the `00E7` save data. `BBSession.fullCharacter` keeps the latest `00E7`.
- **Map files:** `SetDataTableOn.rel` maps (area, layout, entities) to an object basename, an enemy/event basename and an area setup name.
  - The geometry is the setup name + `n.rel`, or + `_00n.rel` for `map_city00`, `map_labo00` and the jungles. `map_boss04` uses `map_darkfalz00n.rel`.
  - The table also lists quest-only layouts (Cave 03–05). The server only picks within newserv's free-play counts.
  - All 235 free-play variations of Episodes 1, 2 and 4 resolve to files that exist in Ephinea's client.
- **Player starts:** `TObjPlayerSet` `param4` is 0 when arriving from a lower floor and 1 when coming back. In Forest 1, the 0 set is next to the warp from Pioneer 2 and the 1 set is next to the warp to Forest 2.
- **Area warps:** `TObjAreaWarpForest` keeps the destination floor in `param4`. Walking within 12 units of one warps the player. The Pioneer 2 teleporter (`TObjCityAreaWarp`) goes to floor 1, since its destination menu is not implemented.
- **Name length:** newserv keeps 14 characters of the game name, so the UI limits names to 14.

**Lobby/view hooks (additive):**
- `Lobby` gained `detach()` / `attach()`, `selfEntry`, extended-header subcommands, the `6x1F` floor, and the `floorChanged` event.
- `LobbyView` gained a `showPlayer` filter, which hides players on other floors and players made invisible by `6x22`.
- `LobbyView` now ignores events after `dispose()`. Its `Lobby` listeners outlive it, and the game reuses one `Game` across floor views.

**Checked in Chrome:**
- Create a game, then Pioneer 2 loads: 30 objects, 23 NPC sets, the player on its start point.
- A Node bot joins: the FOmarl model appears, runs around and chats.
- Warp to Forest 1: `map_forest01n.rel` with `map_forest01_02o.dat` / `e.dat` (111–120 objects, 59–69 enemy sets, depending on the variation).
- Back to lobby: lobby 1 again, and the game list is empty.

**Open:**
- Enemies are markers. Models from `bm_ene_*.bml` and their motions are next.
- The full sync for real-client joiners: `6x6B`, `6x6C` and `6x6E` need the client's entity expansion; `6x6F` needs the quest flags.
- The Pioneer 2 teleporter menu, boss warps (`TObjWarpBoss`), in-floor map warps (`TObjMapWarpForest`) and doors.
- Field BGM. The area track names are in the exe; only the lobby and city tracks are mapped so far.
- Ultimate Episode 1 uses `SetDataTable*Ulti.rel` on newserv, but that table is not in Ephinea's client. Whether Ultimate uses the `map_a*` geometry is not verified.

## 2026-10-17: sound effects from data/sound/*.pac

**What changed:** the classic UI now plays the game's sound effects. `formats/sepac.ts` parses the banks, `audio/se_tables.ts` is generated from the exe by `tools/gen-se-tables.py`, and `audio/se.ts` (`SePlayer`, plus a shared `se(id)`) plays them with Web Audio. The title, login window, character select and character creation call `se()` wherever the decompiled code calls `FUN_00814298`. Details are in PROTOCOL.md, "Sound effects".

**Format:** a bank is a run of 32-byte aligned waves. Each has a 0x20-byte header (PCMWAVEFORMAT, 12 leftover RIFF bytes, PCM size at `+0x1c`), then the PCM. The exe's per-bank offset records (`0x00a215e0`) match a walk of the file for all 26 banks. `tests/sound.test.ts` parses every bank: 1818 waves, 2524 s in total, each bank's count equal to the exe table's, and every loop point inside its wave.

**Engine:** an SE id maps to a slot (`0x00a1f840`), and a slot to a wave of `common.pac` (always loaded) or of the area bank (`0x00989e60[area]`; area 0 = `city.pac`, loaded at start-up and on the character screens). Volume is `round(f³·6400)` hundredths of a dB with `f = (1 + a/127)(1 + master/127) − 1`, where `a` is the slot's attenuation byte. There are 64 voices; a slot without flag bit 28 cuts its own previous voice. PC buffers have no pan or pitch control.

**Checked in Chrome:** `common.pac` and `city.pac` load into 222 slots. Every UI id (0x56f, 0x570, 0x571, 0x573, 0x575, 0x57c, 0x585, 0x420) resolves to a wave and starts a voice once the first key press unlocks audio. The cursor wave is 3107 frames at 22050 Hz with an RMS of 0.37.

## 2026-10-16: select character screen from the decompiled code

**What changed:** `classic/charselect.ts` is now built from what `PsoBB.exe` (Ephinea 1.25.13) does. Before, it was laid out by hand from a capture. A new `classic/gametext.ts` reproduces the game's 2D text layout. SSIM against the psobb.io capture went from 0.487 to 0.920 (PSNR 18.4 → 28.1), measured at the same backtext animation frame.

**The scene:** scene 6 of the scene switch `FUN_0081aac8` is `FUN_004135e0` (vtable `0x00af3370`, state table `0x009a3738`). Its children, in creation order:

| Object | Constructor / vtable | Render | What it draws |
|---|---|---|---|
| background | `FUN_004010b0` / `0x00af2028` | `FUN_004010e4` | black quad, then `f256_ad_pic_2` tiles via `FUN_00415bcc` (table `0x009a3840`, the same 640×512 layout as the title), additive |
| backtext | `FUN_004012cc` / `0x00af2060` | `FUN_0040131c` | additive quad (0,0)–(639,479), texture = counter / 3, counter 0..14 (`FUN_00401304`) |
| header | `FUN_00415154(row 0)` / `0x00af3500` | `FUN_004154b8` | 8 additive copies of the 512×40 `f512_midashi` row, color `0x1fffffff` |
| UI builder | `FUN_00401504` / `0x00af20c0` | states `0x009a2d68` | tags, slot bars, slot text, frame lines |
| message | `FUN_0040b72c` / `0x00af2810` | `FUN_0040b85c` | two centered lines |
| slot list | `FUN_004121f0` / `0x00af3158` | `FUN_00412800` | cursor bars; owns the scrollbars (`0x00af2ff8`, `FUN_00411828`) |
| help keys | `FUN_0041571c` / `0x00af3538` | `FUN_004158ec` | key caps and labels |

The 3D preview (`FUN_00406ab4`) and the per-slot icons (`FUN_0040e004`, drawn only for existing characters) are not reproduced yet.

**Blend modes:** `FUN_0082acfc(0|1, n)` sets the source and destination blend through the table in `FUN_00837468`. 8 → SRCALPHA, 10 → ONE, 6 → INVSRCALPHA. So `(8, 10)` is additive, which the canvas does with `'lighter'`. `FUN_007a902c` sets additive and `FUN_007a9044` restores normal blending. `FUN_0082bb60` takes the texture index in ECX and the vertex ARGB in EDX (read from the disassembly).

**Frame lines are data:** `FUN_004088b8(parent, id)` instantiates entry `id` of `CAdDrawLineTask.prs` (`FUN_00408c20`). The file `addrawlinetask.prs` is a REL file whose root is an array of `{count, pairs, primitives}`. Each primitive is 0x2c bytes: `{index, x0, y0, z0, ARGB0, x1, y1, z1, ARGB1, speed, width}`.
- A segment (`FUN_0040840c` / `FUN_004089f8`) grows by `speed` = 40 px per frame and is a quad `width` = 2 px wide.
- When a segment completes, it starts the segments chained to it (pair `(a, b)`). Pairs `(-1, b)` start at once.
- Entries used here:
  - 8, the header lines, created by the header;
  - 9, the footer lines, created by the message;
  - 0xb, the CHARACTERS box and tag outline;
  - 0x1c, the green panel (`0xff4da55f`).
- The other lines are `0xff368bbc`.
- Ephinea ships a loose `addrawlinetask.prs` whose right ends are at x = 853 (16:9). The `data.gsl` copy has 640, which is what the reference capture shows, so the values are taken from the `data.gsl` copy.

**Values (640×480 virtual space, 30 frames per second):**
- **Header** (`FUN_004153d4`): rows are 40 px in a 512 texture (`0x008fadac` / `0x008fada8`). Copy `i` is at x = 64 − (10 − t)²·k[i], with k = ±{1, .8, .6, .4} (`0x008fad68`), y 43..83, t = 0..10. The text drawn by `FUN_004155f0` at (620 − width, 86) is not visible in the capture.
- **Tag** (`FUN_00414d60`, `FUN_00414c94`, `FUN_00402750(0)`):
  - tag 0 of `f256_tag` at (134, 118), 174×32 (`0x008fad1c`/`0x008fad20`);
  - u 0..0.6797, v row·32/256;
  - additive, alpha +1/15 per frame.
- **Slot bars** (`FUN_00401664(0, 0)` → `FUN_0040d3ac`, render `FUN_0040d6f8`):
  - 180×38 at (131, 182 + 43·i) (`0x008f86b8`);
  - RGB(54, 188, 136), additive, alpha 0.05 per frame up to 119/255 (`0x008fa1ec`/`0x008fa1f0`);
  - they fly from slot 0 in 15 steps.
- **Slot text** (`FUN_0040e694`):
  - the name (unitxt group 0x39 entry 0 "NEW CHARACTER" when empty) at the bar origin;
  - "LV%d" (0x39/1) right-aligned 20 px lower;
  - each has a 0x111111 shadow at x + 1;
  - alpha +1/15 per frame.
- **Cursor** (`FUN_0041245c`, `FUN_00412800`):
  - drawn from `f256_ad` texture 0 (`DAT_00a3b09c`, loaded at `0x00412954`), additive;
  - three quads 16 | 148 | 16, v 224..242;
  - u 0/16/32/48 for the orange bar, 49/65/81/97 for the green "chosen" bar (`DAT_00a3b088` = 16 at `0x00412948`);
  - the cursor slot is set to alpha 255 and the others lose 25 per frame. The capture matches alpha ≈ 100 on the previous slot, i.e. it was taken about 6 frames after the cursor moved.
- **Scrollbar** (`FUN_00411828`): RGB(37, 236, 0), alpha +1/15 per frame. Its geometry is set somewhere not found yet; x 314, y 182, 3×55 are measured from the capture.
- **Message** (`FUN_0040b7d8`):
  - unitxt 0x1f/0 "Please select character." at y = 370 (+20 for the second line);
  - x = (640 − width) / 2 (`0x008f9e8c`/`0x008f9e88`);
  - alpha +25 per frame.
  - On the widescreen reference the line is centered on the whole window (768 virtual px at 16:10), so the patch must replace the 640. A residual offset of about 3.5 px remains.
- **Help keys** (`FUN_0041571c`, `FUN_004157c4`, `FUN_0041594c`):
  - 32×32 caps from `f256_player_tex`: Enter UV (122, 210), Esc (162, 210);
  - at (156, 421) and (299, 421), set by `FUN_004135e0`;
  - slide in from x = 640 as (640 − x)·(20 − t)²/400 + x;
  - alpha from 0x33, +12 per frame;
  - labels unitxt 0x31/0, 1 at (x + 32, y + 8).
- **Text** (`FUN_007ab554`, `FUN_007ac344`):
  - glyphs are drawn at virtual resolution with a 14 px cell (`0x0097db84`);
  - a space advances 7 px (`0x0097db7c`) and a newline 20 px (`0x0097db78`);
  - the width is the sum of the glyph advances;
  - the last argument (0.4/0.5) is the quad's depth, not a scale.
  - The face is fitted. Every string width in the capture matches Arial bold 11 px (NEW CHARACTER 102, "Please select character." 131, Enter 28, Cancel 36). Tahoma does not match, probably because psobb.io runs under Wine and falls back to another face.

**Validation:**
- `tools/compare.sh` against `select.png`: SSIM 0.920, PSNR 28.1.
- The best backtext frame is texture 1 (SSIM 0.917 vs 0.87 for the other four), which confirms the animation and its additive blending.
- Region SSIMs:
  - slot area 0.87, or 0.92 with the previous slot's fade set to alpha 100;
  - keys 0.89;
  - header 0.93;
  - message 0.39 (the 3.5 px offset).

**Open:**
- Where the scrollbar geometry and the 640 → 768 centering come from.
- Why the header text is invisible.
- The timing of the UI builder states, which gate when the tags and lines start. They start at frame 0 here.
- The 3D preview and slot icons for existing characters.

## 2026-10-16: title effects and the window renderer from the decompiled code

**What changed:**
- The title's light beam is now the original particle effects, not a drawing.
- The flash and the pulsing "PRESS ENTER KEY" are drawn as `PsoBB.exe` draws them.
- The Login menu and the login window use the client's generic window renderer and its textures. The renderer lives in `stage.ts` so other screens can reuse it.

**Light beam (effects 0x1e3–0x1e5):**
- `FUN_0050a0ec(pos, id, 1)` creates an emitter. Ids below 0x200 index `particleentry.dat` in `data.gsl` (512 entries of 0x98 bytes).
- Entries 0x1e3 `title_a`, 0x1e4 `title_b` and 0x1e5 `title_seiunn` hold all the parameters. Their textures are GBIX 700460 and 700151 of `effect_nt.xvm`, which are textures #5 and #43. The id-to-index table is filled from `effect_nt.gvm`'s texlist (code at 0x00501c4c).
- Emitter (`FUN_00508f58`): adds `number` (+0x44) to an accumulator each frame and spawns one particle per whole unit.
- `title_a`/`title_b` are type 2 (`FUN_0051145c`, update `FUN_0051095c`, render `FUN_00511004`):
  - they start at a random offset in a flat 10×1×10 (5×1×5) box around (0, 0, −47);
  - each frame they step |`vacume` + rand·`speed_x`| ≈ 0.2 units away from the emitter (`FUN_007a8f28`);
  - with `tex_flags` 4 they are drawn as streaks along the step's on-screen direction, 7·|step| (1.3·|step|) long and 0.05·|step| (0.03·|step|) high, through renderer type 4 (rotated quad).
  - Particles moving in depth give the fanned rays; particles moving sideways give the horizontal core.
- `title_seiunn` is type 0 (`FUN_0050ec4c`, update `FUN_0050dbb8`, render `FUN_0050e698`):
  - slow (0.08–0.12 units per frame) bluish clouds in random XZ directions, damped by 0.9969 per frame;
  - they live 350–650 frames;
  - they are drawn from the 4×4 atlas, with frame = round(15·age).
- Colours and fades follow the update code:
  - RGB = clamp(age·slope + base) × fade, with fade = min(age/+0x58, (1−age)/+0x5c);
  - the effect_nt renderers with flag 1 premultiply the fade, and the blend is SRCALPHA/ONE (`FUN_007a902c`, ninja blend 8/10).
- Projection (renderers at 0x801b40–0x802114):
  - screen = centre + (x, −y)·D/−z, and the sprite half-size is D/−z · 16 · size;
  - the title sets the screen centre to (124, 201) with `FUN_004d434c`, from constants 0x0096e27c/78 × the viewport scale;
  - D = 240·cot(fov/2) for the default perspective (`FUN_0082eea0`, angle 0x3555 → fov 57.5°, D = 437.44).
  - On the reference capture the rays converge at x = 124 of the stretched 640-wide screen, and the core sits at y ≈ 201.
- `f128_ray_left/right01..20` (`f128_ray.prs`) are **not** this effect. They are referenced only from 0x00410b7b, the pre-title logo/ad code.
- The simulation is deterministic (seeded MSVC-style rand) and replays from frame 0 when the clock jumps back.

**Flash (`FUN_006f475c`, frames 150–170 of 300):**
- k = frame%300 − 150, and the grey level is the low byte of trunc(255·(1 − k·4.2/20)).
- The value goes negative from k = 5 and the byte wraps, so the original strobes; this is reproduced as is.
- It is an additive quad of texture 12, UV (0.574, 0)–(0.824, 0.25), from (319.5, 199.5) to (185.6, 65.6). The corners are reversed, so the image is mirrored on both axes.
- The rectangle comes from 0x0096e1c0 (200), 0x0096e1c8 (320), 0x0096e1c4 (128), 0x0096e148 (−0.5) and the size factor 4.2 at 0x0096e154.

**"PRESS ENTER KEY" (title menu child, vtable 0x00b3eaf8):**
- `FUN_006ff0d4` draws entry 10 of the sprite set at 0x009cff00 + 10·0x20 through `FUN_0082b6bc`:
  - position (193, 338), scale 1;
  - a 256×32 quad with texels (0,0)–(255,31) of title texture 0 (UV = texel/256, clamped to 1).
- Material alpha = (sin(3°·(frame%120)) + 1)/2 (`FUN_006fede0`, frame%120 by the 0x88888889 multiply).
- In state 0, Enter creates the account object `FUN_007617e8`.

**Login window:**
- `FUN_007617e8` reads ACCOUNT/PASSWORD from the registry. Its `FUN_00761c48` builds the "Login" menu that psobb.io shows. It is the original menu, not a psobb.io addition:
  - `FUN_0073566c(&{210, 300}, 5, unitxt(41,2) "Login")`, size {220, 120};
  - items unitxt(41,3..6);
  - a fifth, unselectable item in colour 0xffffcc33 showing "[account]" or unitxt(41,7) "Empty" (`FUN_00761bc0`).
- The credential window is the "Input UserID" YesNo window (`CreateChatShortcutMenuYesNoWindow_0073840c(140, 330, 360, 100, 4)`):
  - "UserID" and "Password" label/value rows, with ':' at +154 and the value at +166 (`RenderInfoCounterEntity_0072e930`);
  - "Confirm" and "Cancel" centred at +202.5. `login.ts` now draws this window.
- Generic window renderer (vtable 0x00b40a38, render `FUN_007352d0`). The texlist is `f256_hyouji.prs` (`FUN_00712d14`).
  - Frame (`FUN_00710f80`):
    - a nine-slice of the 96×96 texel block of texture 1: 32×32 corners (half size when the window is under 64), tiles in steps of 32 with the last tile cut;
    - the height is rounded up to a multiple of 4.
    - The x87 code was checked by running the dumped instructions in a small numeric interpreter for several sizes.
  - Layout (`FUN_0071b900`, `FUN_0071bc28`): content = window inset by 10, plus 6 under a title. Items are 0x14 apart (`FUN_00735c90`).
  - Title pill (`FUN_00760b85`):
    - drawn at (x, y−13) (template 0x00974d00);
    - left cap 40×27, middle max(0, textWidth−112)+80 stretched from texels +20..+60, right cap +40..+80;
    - rows by state from 0x00974bf8: teal 98, orange 125, green 152.
    - The text is centred, 4 px below the pill top (`FUN_00760dac`).
  - Selection bar (`FUN_007120ec`): additive, texture 2, texels (151,57) orange or (151,76) green. The 16-px caps span x−2..x+14 and the right side mirrors it.
- psobb.io's widescreen patch draws these windows with a uniform scale, centred horizontally (`inWindowSpace`), while the background, logo and particles stay stretched. Both were measured on the capture: the window at x = 210 lands at 120 + 210·1.875 of 1440 px.

**Measured, not decompiled:** item text height and font size (Tahoma bold, 11 px virtual; rows centred 7.5 px below the row top), the selection bar height (16), and the selected item's text colour.

**Result:** full-frame SSIM 0.727 → 0.771, PSNR 20.4 → 21.2 (frame 885).

## 2026-10-16: player appearance tables and proportions from PsoBB.exe

**What changed:** the guessed texture slot tables in `render/playermodel.ts` are gone. Texture lists, appearance limits and proportions now follow the client code.

**Findings:**
- The appearance record at `0x009b5b60 + 0x2c * class` holds the limits, the hair/cap/head model names and three texture *name* lists (hair, head, body). `FUN_004e6920` edits each name from the appearance: costume digits, skin letter, face digit, section ID letter. `FUN_004ed735` then binary-searches the class's sorted name table at `0x009b59e0` to find the `pl<L>tex.afs` entry. The tables are generated into `render/playertables.ts` by `tools/gen-player-tables.py`.
- Check: every name the rules can produce exists in the table, and every AFS entry is reachable except two unused FOmar textures.
- Caps use the hair list, and their textures follow the costume (e.g. RAmar `pxtDb_<costume>z_w_hg1`). The head hangs from node 58, hair/cap from node 59 (`FUN_0068a088`).
- The old guesses were wrong in the body lists of HUnewearl, RAcast, RAcaseal, FOmarl, FOnewm, FOnewearl, FOmar and RAmarl (RAmarl's teal top), and in the hair/cap lists of RAmar, FOmarl, FOnewm, FOnewearl, FOmar and RAmarl. HUmar, HUcast and HUcaseal were already right.
- `proportion_x/y` do not scale the model. They morph the body and head between 7 shapes per class from `plZsmpnj.afs`, with barycentric weights over 8 triangles of the unit square (`FUN_004e877c`, `FUN_004e86e4`, `FUN_004e7e54`). The blend covers node positions, scales and vertex positions/normals/weights. In game this runs per player (`FUN_004ee448` loads, `FUN_004ee534` blends).
- Out-of-range appearance values reset to 0 (`FUN_004e665c`); before, they wrapped around.

**Verified:** `tests/players.test.ts`:
- name resolution for every costume/skin/face/section;
- part texture ids inside their lists;
- every shape matches the node/vertex layout of the part it morphs;
- builds at 8 proportion points;
- spot checks.

In `models.html` (new proportion sliders): FOmar hats follow the costume colors, RAmarl's top is red, and RAcast at max proportions is bulkier.

**Open:** the exact normal renormalization in `FUN_004e838c` (it does not matter after shading). `pl<L>smp.rel` is not decoded. No side-by-side capture exists for each class.

## 2026-10-16: animated players in the lobby

**Goal:** decode the player motions and replace the lobby capsules with animated character models.

**Container:** `plymotiondata.rlc` is a big-endian `RelChunkVer0.20` table of 572 PRC entries (PRS + PSO V2 cipher, newserv's PR2/PRC). Each is a REL with one `NJS_MOTION` for the 64-node body. Format in PROTOCOL.md.

**Findings:**
- Angle keys are 8 bytes (`u16 frame`, `i16` BAMS), not the 16-byte keys of map motions; the motion headers are identical (type 3, inp 2). The key lists tile each file exactly, which confirmed the size. Key lists at REL offset 0 have a 0 pointer, so a list is present when its count is non-zero (`njmotion.ts` now does this for maps too; all 11954 map motions still decode).
- The motion numbers come from `PsoBB.exe` tables. A per-player motion set object (player+0x38c) maps class → motion type (6 types), and in the town/lobby folds them into 2 sets with 56 slots. Idle/walk/run are slots 0/1/2 (3/4/5 for FOmarl). The tables (rlc index, mode, next, speed, flags) are copied into `formats/plymotion.ts`.
- Playback speed: record speed per tick, ×1.5 in the run state. Motion changes cross-fade over 5 ticks.

**Lobby:** `LobbyView` loads `pl?nj.bml`/`pl?tex.afs` per class (cached) and builds each player's model from the appearance in `67`/`68` (`LobbyPlayer.appearance`). `PlayerAnimator` plays town idle while standing and run while moving (walk after a `6x40`), for the local player and the others. The capsule stays as a stand-in until the model has loaded. Lights were added for the Lambert player materials, and the camera moved closer (70 units).

**Verified:** `tests/motions.test.ts` decodes all 572 motions (184,944 keys), checks every town table entry, and plays idle/walk/run on all 12 class models. In Chrome against newserv with the bot: HUmar idles at the spawn facing the counter, runs and turns with WASD and returns to idle on release; the RAcast bot runs between points.

**Open:**
- `proportion_x/y` are parsed but not applied.
- The 30 ticks/s rate is assumed. The game's run speed may be 8 units/tick (`DAT_00a94320`, used as `sin/cos × 8`), while the lobby moves at 120 units/s.
- The field (per-weapon) motion tables, emotes and other town slots are not used yet. Spline interpolation is not implemented (no player motion uses it).

## 2026-10-16: character creation rebuilt from the decompiled code

**What changed:** choosing an empty slot on SELECT CHARACTER opens a classic character creation screen (`client/src/classic/charcreate*.ts`) whose layout, sprites, timings and flow come from PsoBB.exe's TCharaMaking code. On confirmation the character goes out as `E5`. `?screen=create` in `classic.html` jumps there offline.

**How:** the whole range 0x004d0000-0x004f8000 was decompiled in one Ghidra run (a range script that also creates functions at every code pointer found in the data sections, 864 functions), then read top-down from the scene constructor. Tables were read straight from the exe with Python.

**Scene (FUN_004df9ec):** loads `charamakingmot.bml`, the texture list `ccconsole_e.pvm` (file `ccconsole_e.xvm`, 20 textures; FUN_004ea4a4, name table 0x009b75c0, list 0x009b8c20), plays `CHARA.adx`, creates the background (FUN_004ed18c), the heading pill (FUN_004eccc8), and either the class selection (FUN_004eb8fc, new character) or the dressing room (FUN_004e2f44, existing character). A 15+3 frame wipe opens the scene (FUN_004ec3c8).

**Sprites:** everything is drawn by FUN_004e9d8c(sprite, z, pos, scale, ARGB float color) and its wrappers (FUN_004e9eb8 white, FUN_004e9ef8 alpha only, FUN_004e9d1c scale + alpha, FUN_004e9f40 alpha + gray, FUN_004e9f8c scaled about the anchor). Sprite records are 0x14 bytes `{w, h, anchorX, anchorY, u0, v0, u1, v1, texture}`; UVs are in 1/256 of the texture (FUN_0082b6bc). Indices below 0x93 come from 0x009b76e0, the rest from a language table (0x009b8260 Japanese/Chinese, 0x009b8680 others). All 199 English records are in `charcreate_data.ts`. z orders the quads (more negative is further back).

**Class selection (FUN_004eb98c, state table 0x009b8d80):**
- State 0 picks the type (Up/Down wrap over 3; Enter or Right continues), state 1 the class within it (ranges at 0x0091d9c0; Esc or Left returns), state 2 waits 10 frames and copies the class default look (0x009b5f60, 0x70 bytes per class) with section ID 0xFF and an empty name (FUN_004eb7ec). List order (0x0091d990): HUmar, HUnewearl, HUcast, HUcaseal, RAmar, RAmarl, RAcast, RAcaseal, FOmar, FOmarl, FOnewm, FOnewearl.
- Widgets (FUN_004eba40), each with fade-in/out and highlight rates:
  - HUNTER/RANGER/FORCE tabs (FUN_004f5ff4): sprite 61+type at (33, 100 + 108 type), sliding 25 px in late in the fade, gray = 0.25 + 0.75 h².
  - Class rows (FUN_004f541c/5590/5890): y = 100 + 27 i, sliding from x = -242 to 58 with a (1 - cos)/2 easing staggered per row; colored square stretched x9.625, an 8x8 piece frame, class name sprite 0x4f+i at (x+5, y+9), face strip 0x5b+i at (169, y+3); the active name blinks with sin(frame << 9).
  - Type/class banner (FUN_004f5c54): colored bar 0x67+type and "Hunter"/"Humar" text 0xb4+i at (393, 82), popping from 1.15x.
  - Illustration window (FUN_004f62ac): 9-slice 0x82..0x8a over (307..607, 100..428).
  - Illustrations (FUN_004f67ec): per-class placement table 0x0091e640 (scale, z, x, y while the type is highlighted, x, y once chosen), eased by 1/4 per frame.
  - Description box (FUN_004f4a00): "information" label 0x8b+type at (310, 255), box at (310, 274) 294 x 150. Text (FUN_004f4e94): 7 lines from unitxt group 0x12 (type, 7 per type) or 0x13 (class id x 7) at (315, 280 + 20 n), fading in after 5 frames with blurred ghost copies.
- Key help (FUN_004f4128/424c/44fc): five items (0x009b9120: Tab CHANGE, Enter OK, Enter CONFIRM, Esc CANCEL, Esc BACK) right-aligned at x = 604, y = 443.
- Input (FUN_004f3b9c): directions repeat at frame 7 and then every 3 frames.

**Dressing room (FUN_004f0c10, update FUN_004eee18, render FUN_004ef530):**
- Background (FUN_004ed008): hexback tiles (textures 13-18) at x 0/256/384, then a quad from transparent at x = 140 to #181818 at 384, and #181818 (alpha 0xFF..0xEC) to 640.
- Heading (FUN_004ecb10/ecc24): gray pill sprite 0x36 stretched from x = 0 to a width that eases (12.93 px/frame max) toward heading width + 15 (100..294), cap 0x37, hex cluster 0x38 at (62, 67), heading at (27, 44) popping from 1.5x. Headings (0x0091db34): CHARACTER SELECT, CHARACTER CREATION, DRESSING ROOM, RENAME, VOICE EFFECT, then one per step.
- Steps (0x009b908c): humans and newmans FACE, HAIR, COSTUME, SKIN COLOR, PROPORTION, CHARACTER NAME, AUTO, OK; androids (class_flags & 0x10) HEAD, BODY, PROPORTION, CHARACTER NAME, AUTO, OK. Column (FUN_004efb84): hex 0/1 at (95, 80 + 44 i), bar 8/9 (10/11 selected, wobbling 9 sin(frame << 10)) from 115 to a width bucket, label 0x93+step at (144, 93 + 44 i).
- Step handlers (0x009b8fc0, {field, function}): list editor for head, face, costume, skin/body (FUN_004f04a8, counts per class at 0x009b5b60: humans 18 costumes, 4 skins, 5 faces, 10 hairs; androids 25 bodies, 5 heads), hair (FUN_004f070c: style row plus R/G/B rows, ±1 per press and ±5 per held frame), proportion (FUN_004f09d0: x wraps over 0..0.99, y clamps, 0.0133 per frame), CHARACTER NAME (FUN_004f0a80: generic text window, 12 units with `\tE`), AUTO (FUN_004f089c: Tab rolls a random look, hair color +64..192 per channel and proportions +0.125..0.5 glide over 30 frames), OK (FUN_004f0b80).
- OK needs a valid name (FUN_004e732c), computes the section ID once (FUN_004e7200, formula in PROTOCOL.md: the class is part of it), and shows the confirmation (FUN_004f00bc): TYPE / CHARACTER NAME / SECTION ID right-aligned at 243/242/202, values at x = 263, section icon 44+id at (212, 234), section name from unitxt group 72. Enter then sends the character after 7 frames. Esc in the step menu returns to the class list after 7 frames.
- The floor line (0x009b90d4) at y = 416..419: transparent at 275 to 50% #c7c7c7 at 400, then solid. The name is drawn right-aligned at (604, 396).
- The horizontal lines behind the model are 3D (FUN_004ea030): lines at y = 0 and 10..24 world units, #ffffa0 at alpha 24, shown only by the PROPORTION and AUTO editors. That matches the AUTO captures.

**Section ID fix:** `sectionIdForName` used the community formula (sum of characters mod 10). The client adds the class and a 0x2D/0x53 bonus at narrow/wide transitions (the first character counts as one). `sectionIdForName(name, charClass)` now follows FUN_004e7200, and the online tab passes the class. `createCharacter` also sends `version` 3, the class's `class_flags` and the "%10d" guild card string, as the client does.

**Model:** `CharacterModelView` (`charcreate_model.ts`: `setAppearance(classId, look)`, `setCamera(mode)`, `setVisible`, `setRuler`, `render`) is the hook for the player models being built in `render/playermodel.ts`. A three.js placeholder (capsule + head + hair cap, measuring lines, ortho framing fitted to the AUTO captures) renders into its own canvas, composited at z -100.

**Validation:** in Chrome on port 5186: class list, description text, illustrations, dressing room menu, hair editor, name, AUTO roll, confirmation (HUmar "souzajluiz" -> PINKAL) and the help items all render with no console errors. Against capture 04 (a fade-in frame where only the hex buttons are visible) the heading pill, hex cluster and the column of hex buttons line up. SSIM over the whole frame is 0.61, mostly because the step bars and labels are already shown in our frame.

**Open:**
- The right half of capture 04 shows the hex tiles through the dark band; with the decompiled colors drawn as normal alpha (0xFF at x = 384) they are hidden. The blend mode of FUN_0082b5d8's flag 0x60 is not traced yet.
- The soft keyboard of the name entry (FUN_0078eba4, at (53, 178)) is replaced by typing into a field; the word filter (FUN_00813f0c) is not reproduced.
- Exact sine arguments of a few pulses (info text ghosts), the idle demo after 900 frames (FUN_004e9640), the hex-shaped wipe (FUN_004ec000; drawn as a fade) and sounds (0x56f-0x57c) are not reproduced.
- Esc on the type list leaves creation; the original has no handler there.
- The camera values of FUN_004ea854 are not mapped to a projection yet.

## 2026-10-16: title screen rebuilt from the decompiled code

**What changed:** the title is now drawn from what `PsoBB.exe` does instead of parameters fitted to a capture.

**How:**
- Ghidra 12 headless analysis of the Ephinea `PsoBB.exe`, plus a small script (`DecompileAt.java`, kept out of the repo) that decompiles functions by address or pointer table, lists references and dumps assembly ranges.
- The exe is instrumented: each function is wrapped in fake `MessageBoxA(-1, 0, 0, 5|4)` calls and `peetles_begin/end` markers. Ghidra still decompiles it, but some function bounds need forcing.

**Findings:**
- `FUN_006fb914` loads `Title.prs` (`"%s.prs"`) into a texture list and registers the title task.
- `FUN_006f8130` constructs the title screen:
  - starts `title.adx`;
  - creates three child objects (background, menu, logo);
  - creates particle effects `0x1e3`–`0x1e5` (the light beam, still approximated).
- Background render, `FUN_006f475c`:
  - tiles from the table at `0x009a3840`: base layer texture 3, flare layer texture 13 in front;
  - every 300 frames (frames 150–170) a flash sprite, texture 12 UV (0.574, 0)–(0.824, 0.25);
  - magic circle centered at (320, 220), one turn every 900 frames;
  - ring: texture 11, size 430, UV 0–0.84;
  - inner ring: texture 12, size 178, UV 0–0.348, rotating the other way;
  - three nodes: texture 12, size 104, UV (0.3496, 0) +0.203, at offsets (±137, −79) and (0, 156);
  - color from `FUN_007a919c`: RGB(0, 88, 115), pulsing to white over frames 150→165→180 of each 300-frame cycle.
- Logo and version, `FUN_006f4cc4`: textures 1 and 2 at (64,61)–(320,317) and (320,61)–(576,317); version text at (10, 460).
- The original BB has an in-game login window (`FUN_006fede0` → `FUN_007617e8`, user name and password), so the classic UI's login window matches the original flow.

**Validation:** sweeping the frame counter, the capture matches angle ≈ 0 (frames 870–900): ring text and node positions line up. psobb.io's widescreen patch keeps these quads round, so the circle is compressed by 1/1.2 around x = 320.

## 2026-10-16: map collision and lobby spawn points

**Goal:** walk on the real collision instead of raycasting the render mesh, and start in the lobby where the original client puts you.

**Collision (`map_*c.rel`):**
- The decomp names the structs (`map_collision_mesh_container`, `map_crel_mesh`, `map_crel_face`). The REL root points to a null-terminated array of mesh containers, each with a bounding circle and node flags. Each mesh has vertices and 0x24-byte faces with flags, normal and bounding circle. The format is in PROTOCOL.md.
- The query constants come from `PsoBB.exe` itself: `objdump` on the functions named in the decomp, then reading the `.rdata` floats they load. Ground probe: `ny >= -1e-4`, a ray 10000 units down, the highest plane under the probe. Walls: one-sided segments, rays 5 units above the feet, stop when `dot <= -0.87`, otherwise slide.
- Player masks: ground `0x5F` (`play_footstep_effects`), walls `0x28A0` (`unknown_player_touching_wall_maybe`). Face statistics over all 175 files agree: `0x01` faces point up, `0x20`/`0x800`/`0x2000`/`0x8000` faces are vertical.
- `CollisionWorld.move()` follows the client's outline: one ray along the motion (stop or slide), then 8 radial rays to push out of walls, then the ground probe. The frame is sub-stepped in 4-unit steps.

**Spawn points:** `TObjPlayerSet` (object type 0) entries in `map_lobby_NNo.dat` (inside `data.gsl`). `param1` is the client id, and there are 12 per lobby around the three sides of the central counter. `loadLobbyMapData()` reads them through `ClientFiles`. Other players are also drawn on their spawn until they send a position.

**Verified:**
- `tests/collision.test.ts`: all c.rel parse and every lobby has spawns for ids 0–11. Ground is found under all 220 `TObjPlayerSet` points in maps whose `o.dat` name matches a c.rel. The exception is `boss06`, whose four spawns have no c.rel floor (probably an object platform); the test skips it.
- In Chrome against newserv: spawn at (0, 20, 135) facing the counter, walking forward stops at the counter, and walking diagonally slides along it.

**Open:**
- The per-class hitbox radius and `bloodstain_z_offset` (5 and 10 for now).
- Collision of lobby objects (`o.dat` types 0x180+) is not loaded.
- The meaning of face flags `0x0100` and `0x4000`.

## 2026-10-16: enemy and object markers

**Goal:** show where enemies and objects spawn in the map viewer.

**What landed:**
- `formats/setdata.ts` parses `map_*e.dat` / `o.dat` (bare arrays of 0x48 / 0x44 entries, layout from newserv `Map.hh`), pairs them with the n.rel files, and places them in world space.
- Names come from a table generated from newserv (`tools/gen-entity-names.ts` → `formats/entitynames.ts`), plus a port of newserv's enemy switch for in-game names ("Savage Wolf" instead of `TObjEneBm5Wolf`).
- Map viewer: set data variant selector, "Show enemies/objects" and "Labels" checkboxes, hover tooltip (name, type, section, wave, local/world position), counts in the status line. Enemies red, NPCs cyan, objects yellow.

**Verification:** `tests/setdata.test.ts`
- Parses 840 files (339 in `data.gsl`, 143 loose, 358 from Tethealla's `map/`): 34,339 enemy and 71,298 object entries.
- 838 files, 105,607 entries match `newserv disassemble-free-map --bb` on type, name, room, floor, position, Y angle, wave/group. The 2 `*e_d.dat` files are skipped because newserv's CLI treats them as objects.
- All 3366 rooms of newserv's `room-layout-index.json` match the n.rel section positions, which confirms that `room` is the section id.
- In Chrome, forest 1 shows 67 enemies and 109 objects on the paths and clearings.

**Findings:**
- The pairing is not uniform: Ep2 `jungle01_00n.rel` uses `jungle01_NN` sets (no layouts), `darkfalz00n.rel` uses `boss04`, and the `map_a*` maps reuse the plain map's sets.
- newserv's nearest-entity chat command passes BAMS angles to `sin`/`cos` as if they were radians. It doesn't matter here (the port converts them), but it is worth reporting upstream.

## 2026-10-16: map entries, texture addressing, motions, handedness

**Goal:** close the open map-rendering gaps from Phase 3.

**Method:**
- Read the decomp's map draw loop (`map_nrel_process_chunk_static_meshes` and the animated loop), the loader, the render-state setters and the camera/projection code. They served as a specification.
- Read two data tables straight from `PsoBB.exe`: `g_StandardRenderStateSetters` at `0xa218c0` and the D3D enum table at `0xa21944`.
- Checked every claim against all 175 `map_*n.rel` with throwaway scripts.
- Checked visually in a scratch three.js page.

**Findings:**
- **The "0x10224" entries are indirect objects.** Flag `0x200` means the entry points at a 0x10 record `{object, runtime ind-tex, runtime f32, i16 id}`; `id` selects a row of `map_*i.bin` (waterfall/water distortion parameters).
  - 403 such entries were skipped before. Another 236 had been "parsed" as garbage objects.
  - All 639 now resolve: jungle07 entries 108/109 are its waterfalls.
- **Not every entry is drawn.** The PC client skips:
  - `0x100` entries: drawn only into the seabed/`boss06` planar-reflection texture.
  - `0x200|0x400` entries without `0x80`: a GameCube-only hook that is empty on PC.
  - Animated entries without a motion.
  - Together that is 1955 entries. They are now kept out of `objects`. Rendered model count: 133488 → 132169.
- **Entry fields** that were "unknown u32" are now decoded:
  - `+4`/`+8` (static) and `+0x14`/`+0x18` (animated) are an effect slot (flag `0x20`) and a `.tam` texture-animation record (flag `0x40`).
  - Animated entries carry `NJS_MOTION`, current frame and frame step. 11954 motions decode (position/angle/scale keys).
- **Texture address modes:** the table read from the exe maps 0 → clamp, 1 → mirror, 2/3 → wrap, and UV ranges in the data confirm it. `MaterialCache` now gives each (texture, wrapS, wrapT) its own `THREE.Texture` clone.
- **Material type 5:** the diffuse color becomes the constant vertex color of meshes without vertex colors. It never occurs in maps.
- **Material type 7:** camera-space texgen (environment map). It is parsed but not rendered.
- **Handedness: no mirroring.** The client's view and projection matrices are both right-handed (`LookAtRH`, `PerspectiveFovRH`), its rotations are standard, and the Pioneer 2 shop banners read correctly in our render.

**Open:**
- Apply motions (an AnimationMixer in the viewer).
- `.tam` texture animation, UV-scroll effect slots, env-map texgen, indirect-texture distortion.
- The section rotation order in `mapviewer.ts` should be `YXZ` (client `ZXY_ANG` mode); this only matters for two crater sections.

## 2026-10-16: player character models

**What landed:** BML reader, Ninja chunk (NJCM) model parser, skinned three.js builder, and `models.html`, a dev page that shows any of the 12 classes with costume/skin/face/head/hair/section ID/hair color. `node tests/players.test.ts` builds every class and variant.

**Findings:**
- Class letters A..L = class 0..11. Head, hair and cap hang from body node 59.
- Chunk models share one vertex buffer across the tree. Weighted vertices are accumulated by later nodes, and the body's polygons are cached at the root and drawn at the end. Replaying that walk gives skin weights for free; all strips resolve.
- `pl?nj.bml` aligns blobs to 0x800, `bm_ene_*.bml` to 0x20.
- Texture ids are per part. The appearance → `pl?tex.afs` mapping was rebuilt from contact sheets of each archive, with the PSO v2 lists of the dashgl/psov2 viewer as ordering hints, then checked by eye. Defaults look right for all 12 classes. Hat/hair texture lists of six classes are approximate.

**Next:** player motions (`plymotiondata.rlc`, NJM), and models in the lobby instead of capsules.

## 2026-10-16: classic UI, title screen

**Goal:** the title, login and character screens must look identical to the original client.

**Reference:**
- The psobb.io macOS build (a Wine wrapper) was pointed at the local newserv. It reads `LoginHost` / `PatchHost` from `psobb.cfg`; the original file is backed up as `psobb.cfg.psobbio-original`.
- Reference captures were taken with `screencapture` while driving the client with keystrokes: title, patch notice, SELECT CHARACTER, character creation, the "Connecting.." warp.
- The captures stay local (`client/public/ref/`, ignored by git).

**Findings:**
- The UI font is Tahoma: the client's `font_tahoma.reg` sets `FONT_JPN=Tahoma`.
- Loose files in `data/` override `data.gsl` entries; `ClientFiles` resolves names the same way.
- The BB title is `title.prs`. `title_eng.prs` is the GameCube Episode I&II title, and `TitleEP4.prs` is the Episode 4 variant.
- `title.prs` layout:
  - 0: "PRESS ENTER KEY" and menu labels.
  - 1–2: logo layers.
  - 3–10: background, 640×512 in tiles.
  - 11: magic circle.
  - 12: rings.
  - 13–20: background with the strong flare.
- The UI is laid out in a 640×480 virtual screen stretched to the window. `Stage` reproduces this with a Canvas2D transform.

**Matching method:**
- `window.classicCapture()` renders the stage at 2880×1800 and posts it to a dev-only `/__capture` endpoint.
- `tools/compare.sh` reports SSIM/PSNR (ffmpeg) against the capture, globally or per region.
- Parameters were chosen by grid search:
  - The flare layer drawn opaque was best on the left background (SSIM 0.83 → 0.90).
  - Circle: 385 px, centered at (345, 256), rotated -0.2 rad.
  - An additive beam with rays was added.
- Result: SSIM 0.716 → 0.732 and PSNR 18.8 → 19.4 for the whole frame. The remaining gap is mostly the beam/ray effect and the circle's glow.

**Note:** Chrome throttles requestAnimationFrame to 2 fps while its window is covered by another app. That is not a client bug; bring the window to the front when measuring.

## 2026-10-16: character creation and the lobby

**Method:** walked the flow live with a Node script against newserv, logging every command, then wrote `Lobby` and the session steps from what came back. Struct offsets come from newserv's `CommandFormats.hh` / `PlayerSubordinates.hh`.

**What landed:**
- **Session:** `BBSession.createCharacter` (E5 → E4) and `BBSession.enterLobby` (93 phase 4 → 07 menu → 10 "Go to lobby" → 67).
- **`Lobby`:** player roster (67/68/69), chat (06), movement subcommands (6x1F/20/3E/3F/40/42), with automatic 6x20 replies to 6x1F.
- **Lobby view:**
  - Loads `map_lobby_NNn.rel` for the lobby number.
  - Players are class-colored capsules with name tags.
  - Third-person camera.
  - WASD running sends 6x42 every 150 ms and 6x3E on release.
  - Ground height comes from a raycast against the render mesh.
- **Online tab:** slot cards with Create / Play, a creation form (name, class, live section ID), the lobby with player list and chat.

**Tests:**
- `tests/lobby.live.ts` runs two clients: A sees B join (68), B gets A's chat, run, stop and angle, and A sees B leave (69). 7/7 pass.
- `tests/bot.live.ts` is a bot that circles the first player and echoes chat.

**Verified in Chrome:** login → Play → lobby 1 rendered with the bot running around; chat round trip "hello bot" → "echo: hello bot". No console errors.

**Open:**
- The section ID uses the community formula (sum of name chars mod 10); confirm it against the client.
- Spawn points are approximated (first floor found near the origin).

## 2026-10-16: map viewer

**What landed:**
- **Parsers:** REL, Ninja object trees with XJ models, the "fmt2" map `n.rel`, and XVM textures (software-decoded DXT1/DXT3/16-bit, including Xbox unswizzling).
- **Viewer:** a three.js map viewer tab with orbit and WASD camera, reading data from a picked folder or from the Vite dev endpoint `/psobb-data`.

**How the formats were worked out:**
- The decomp's map loader notes gave the `n.rel` header: section count at +8, sections at +0x10, NJTL at +0x14, 0x34-byte sections with sub-arrays at +0x20/+0x28 and +0x24/+0x2C.
- The rest came from hex-walking `map_city00_00n.rel`: 16-byte static entries, the NJS_OBJECT and XJ model layouts, vertex types 4, 5 and 7, and material records whose type numbers line up with the client's render-state setter table.
- XVR formats were surveyed across all 203 `.xvm` files: bytes per texel 0.5 means DXT1, 1 means DXT3, and 2 means 16-bit. The flags turned out to be a mipmaps bit (×4/3 size) and an alpha bit.

**Tests:**
- `tests/formats.test.ts` parses all 175 `n.rel` maps (133,488 models) and all 203 `.xvm` archives (7,821 textures).
- 16 Episode 2 maps initially failed. Their entries with flags `0x10224` point at non-object records, so they are now skipped and counted (403 entries total).

**Verified in Chrome:**
- Pioneer 2 (`map_city00_00`): 185 meshes, 15,843 triangles, 246 textures.
- Forest 1: 631 meshes, 24,152 triangles.
- Also loaded: Jungle 7 and Seabed 2. No console errors.

**Security:** the dev endpoint rejects path traversal (`..%2F` gets 403) and only exists in `vite dev`, which is bound to 127.0.0.1.

## 2026-10-16: login in Chrome

**What landed:**
- **Vite + TypeScript client** (`client/`): login form, character slots and a live protocol log.
- **`BBSession`:** full data-server login, i.e. `03` → `93` → `E6` → `19` redirect → reconnect → `93` (with guild card, token and client config) → `E6`, then `E3` per slot → `E4`/`E5`.
- **Key file:** Vite serves the `.nsk` from the local newserv checkout at `/keys/`, so it is never committed.

**Bug found in Chrome:** `E6` and `19` arrived in the same WebSocket message. `waitFor(0x19)` was registered only after `await waitFor(0xE6)` resumed, and by then the `19` had already been dispatched. `BBConnection` now keeps a backlog of unclaimed commands.

**Verified in Chrome:** login as `webtest` gets guild card 2122363817 and four empty slots (`E4`).

## 2026-10-16: foundation

**Starting point:** the `psobb-master` folder was the 2015 Tethealla server (Windows binaries and server data only, no client). The plan: switch the server to newserv and reimplement the client for the browser.

**Environment:**
- **REA MCP:** failed because the default Node was v16 and `rea-agents@6.4.0` needs ≥ 22.19. Fixed by pointing the MCP config at Node v24.18.
- **newserv:** `phosg`, `resource_dasm` and `newserv` built into `vendor/` with a local prefix. Nothing installed system-wide besides `brew install asio libiconv`.
- **Client:** the Ephinea installer was extracted with `7zz`, never executed. Maps live in `data/scene/`; spawn `.dat` files live in `data.gsl`.

**TS ports, all verified against the newserv CLI:**
- `BBCrypt`: ciphertext byte-identical to `newserv encrypt-data --bb` (keys `default` and `default4`).
- `prsDecompress`: 19 real files identical. `chatsensor.prs` is rejected by both newserv and the port.
- `GSLArchive`: 1524 entries, the same count as `newserv extract-gsl`, with identical content.

**Live login through the bridge:**
- **Bug 1, race:** `03` arrived before `BBConnection` installed its handler. The transport now queues early data.
- **Bug 2, framing:** the cleartext `03` is not padded to 8 bytes. Only encrypted commands are padded.
- **Result:** `E6 error_code=0`, then `19` (redirect). Login OK.

## 2026-10-20: Episode 2 FSMs: Gee, Gi Gue, Gibbles

**What changed:** Gee (Jungle / Mountain / Seaside), Gi Gue and Gibbles have
their own brains in `combat/enemyfsmep2a.ts` (`GeeAi`, `GiGueAi`, `GibblesAi`,
plus the shots `GeeSpike`, `GiGueSpit`, `GiGueBomb` and the instant
`GroundBlast`), wired in `render/combat.ts` like the other families (OWN_FSM,
HP fraction, remote hits fed through `onDamage`, Gi Gue's Jellen / Zalure
through `applySelfBuff`, a blocked hit through `GiGueAi.blocked`).
`tests/enemyfsmep2a.test.ts` drives each with several motion lengths and a
20000-frame fuzz (targets coming and going, hits, blocked hits): no state hangs.
No Chrome check (the Episode 2 archives are not on this machine either, so
the motion lengths in the tests are stand-ins).

**Reading the dump:** all three are mislabelled. Gee is `Sinowberill*`
(factory 0x0055c974, vtable 0x00b051c0, dispatcher 0x0055d11c with the jump
table 0x00925500), its spike `GiGues_*` (0x0055fecc, vtable 0x00b053c8, base
0x007acaf8). Gibbles is `Derolle*` (ctor 0x00563200, vtable 0x00b054e0). Gi
Gue (ctor 0x0056beb4, vtable 0x00b05a20) has its handlers named `Gibbles*`.
They were matched by constructor, vtable and motion table (0x009bdf80 /
0x009be180 / 0x009be5c0); the vtables, the float constants and the runtime
globals (written by 0x005643b0, 0x00568ef0 .. 0x0056d4c0, 0x0056bba4) came from
`objdump -d` of PsoBB.exe, which the dump does not carry.

**Gee (states of enemy+0x32e):** 0 spawn (4 frames), 1 rise (the 40-frame
emergence effect) or 2 drop (150 above the ground, down by max(1, param3 + 1))
by param2 == 0, 3 idle (FindEnemyTarget 200 every 45 frames), 4 alert (the
colour fade-up, 19 frames), 5 climb to 45 (61 frames), then ChooseAttack
(0x0055c4bc): param1 == 0 only lunges (8), else 7 shoot, 7 shoot, 8 melee. 7:
fly to within 70 at 0.5, charge MovementData iparam1 + 1 frames while the aim
point creeps at 0.6, release at 15 frames, iparam3 + 1 frames of recovery,
iparam4 volleys; the spike flies at 6 + param4 for 150 frames (tech power
fparam2). 8: 41 frames of turning, 14 degree side steps (7.73 a frame, 4
frames, invulnerable), lunge at fparam1, up to 3 stings at motion frame 10
(try_hit_entity(1.0) + cause_knockback(3.0), slow on a roll <= 0.25). 9: four
8-frame dashes round the player ending at radius 70 (31 frames of turning
between), only the first invulnerable. 13: the flinch (every hit, MovementData
iparam5 frames hold, then back to the state it left, enemy+0x380). 15: no
target, wait 60 frames, fly home at 0.8. The drawn height is enemy+0x3fc, which
only the rise and drop states write (SinowberillRender_0055ce54), so the
climb to 45 changes the aim origin, not the model. Death is state 14 (a
vanish with SE 0x250): no motion.

**Gi Gue:** request protocol of GiGuesUpdate_005695ec (old state's exit with
sub-state -1, then the new one), AI record 0x009be6e4 (search 150, turn 768,
wander speed 0 so it only turns). Idle (walk 150 / stand 90 frames), approach
(turn on the spot by half the turn rate until a player is within
AttackData distance_x = 300 and half the 12288 arc; volley twice, hop the third
time), volley (three rounds of one homing spit: speed fparam3, steering
strength fparam4 + fparam5 a frame, doubled within 150, 90 frames, confusion
roll against fparam6), prepare (Jellen / Zalure, level iparam3, on the players
in the cone), barrier (iparam4 * 30 frames, blocks hits; a blocked hit is
answered with the bomb: speed fparam2, radius 40, power iparam1), hop (60 frames
crouch, rise to 50 at 2.2, 200 away at fparam1, drop 2.3), fall from the sky
(param1 > 0: 150 + param3, 2.3 a frame), emergence 40 frames, flinch (a hit of
a quarter of the HP is answered with a volley).

**Gibbles:** Booma controller with the overrides at vtable +0x80 / +0x84 /
+0xf0 .. +0x100. Waits hidden until a player is within 200, drops in (40-frame
effect, then the landing shockwave of attack row 3), walks at fparam3 = 0.8,
triple slam (blasts at motion frames 8 / 23 / 40, hand hits on every fifth game
frame between), a leap when the target is beyond 150 (or a roll against
param3 every 50 walked units), a guard when an attacking player is within 30
(100 + param1 points), then the heavy swing twice; a hit outside an attack
staggers it, then a leap with the chance of param4.

**ASSUMED (marked in the code):** the player's hit radius (5) and the shots'
vertical extent; the muzzle / bone positions (Gee 45 above, the Gi Gue spit and
bomb at 20, the Gibbles slams half a reach in front of it); the guard drain
(80 per raise instead of 0.2 * (attacker ATP - DFP)); the barrier's own
motions (20 frames each); the order of Gibbles' two last attack rows (62 = rage
swing, 63 = landing); the flat ground and the missing line-of-sight rays; the
retarget phase (the exe starts it at entity_index % interval).

**Left:** Gee's pack states 6 / 10 (never entered by the factory's subtype 0),
the 250-frame sink of a dead Gibbles and Gi Gue's death particles (the owner
removes them), the Gibbles hold of the drop-in animation at frame 100, the hand
bone hit boxes (DAT_009be10c / 009be138), Gi Gue's stomp entities
(0x006f1eb0 / 0x006e7998) beyond the Jellen / Zalure cast, and the real motion
frame counts of the three archives.
## 2026-10-20: Episode 2 FSMs: Sinow family, Deldepth, Delbiter

**What changed:** four more Episode 2 families have their own brains in
`client/src/combat/enemyfsmep2c.ts`: Sinow Berill / Spigell, Sinow Zoa / Zele,
Deldepth and Delbiter. They are not on the Booma substrate: they sit on the
enemy base (`CreateEnemyInstance_005216f4`), whose per-frame update runs the
state's transition check (handler argument 3, skipped when the state was changed from
outside), then its frame (argument 0); a state change runs argument 5 of the old
and 4 of the new state (`SetEnemyAiState_0051f62c`). `ExeBrain` (same file)
reproduces the exe's animation clock (elapsed += the row's speed, a one-shot is
ended at elapsed >= frames - 1, threshold tests `threshold < elapsed <=
threshold + speed`, 0x007aaa30) from the real frame counts of each archive, so no
state waits for the owner's motion to end; the target search is
`FindEnemyTarget_00520ea0` (interval 30, called once per op, so a state that calls it
in both ops searches every 15 frames). Wired in `render/combat.ts` (OWN_FSM,
confusion-aware search, the remote-hit hook for `ExeBrain`, Delbiter's hpFraction,
Zoa's frozen / shocked flag and Zele's self-buff hook). The brains hand the owner
their own flinch / death motions, so `enemymotions.ts` is untouched.

**Sinow Berill / Spigell** (TObjEneMe3StelthReal; ctor 0x0059e0a4, vtable 0x00b0a120,
dispatcher 0x0059eb08, table 0x009bffa0; MovementData rows 6 / 0x10): 19 states
(spawn, ground rise, cloaked idle, ceiling appear, fade-in, drop, chase, lunge,
melee, back step, return, cast, teleport, lost, flinch, death, Gifoie, cloak,
reveal). Constants read from the exe: the 41-update emergence effect (float32
accumulation of 0.2 from -6.0), lunge 100..150 away sliding (d - 20) / 12.857 a
frame (0x00a74718) and invulnerable from frame 14 to 23, melee hits at frames 15 and
23 with a 0.1666 confusion on the Berill's second, back step 80 / 11.25 a frame
invulnerable from frame 15 to 24, teleport to 20 units from the target at its
heading + k * 0x4000 + 0x4000, Resta on itself, Gifoie as a disc growing 0.55 a frame
(Rafoie in Ultimate), the engaged flag 0x10000 that blocks later lunges.

**Sinow Zoa / Zele** (TObjEneMe3SinowZoaReal; create 0x005914dc, vtable 0x00b08f00,
dispatcher 0x00591f20, rows 67 / 68): the Berill machine again (same 19 states and
rows) with its own counters, lunge window 50..150, no frozen melee hold, 30-frame
dissolves, Zoa's Resta / Zele's Zalure + Jellen, the sorcerer bolt 0x006e38e0 (Rabarta
in Ultimate) and the timed cloak effect that freezing or shock ends.

**Deldepth** (TObjEneDelDepth; create 0x00549900, ctor 0x005499b0, vtable 0x00b037a0,
state table of {enter, frame} pairs at 0x009bd160): 14 states (dormant, emerge,
retreat, disc slide, rise, tuck, aim, scan, close, cast, bomb, miss, hurt, dead):
the disc slides in 70..100-unit bursts, rises to the body form near a player, spins,
locks a target, creeps and casts Barta (Megid in Ultimate) or throws a lobbed Rabarta.

**Delbiter** (TObjEneDellBiter; ctor 0x0054a71c, vtable 0x00b03be0, update 0x0054a864,
ProcessState 0x0054aef8, row 13): hidden, walk-in / run-in, wait, chase, claw swing
(frames 10.8..13), roll with the contact hits, howl that confuses within param3 + 30,
Dorphon laser (three beams in Ultimate), flinch, charge-up below half HP.

**ASSUMED / not reproduced (all marked in the code):**
- Map tests: wall and ground probes of the lunge, back step, teleport and Deldepth's slide
  (open ground), line-of-sight rays, terrain following, a ceiling Sinow's root-height
  compensation while it falls (`hang` is the set height above the ground).
- The cross-fade of a new animation is over within the tick it starts.
- Hand / node positions of shots (Gifoie, Rafoie, bolts, bombs, lasers) are the body
  position; the player's hit box radius is 5; techniques are group-0 `tech` hits (no
  resistance, no Rabarta freeze roll).
- The enemy buffs (Shifta / Deband on the Sinow in Ultimate), the Spigell / Zele weapon
  removal, flinch knockback glides, sounds, particles, the non-advanced-effects cloak
  branch (the setting is assumed on). A tech hit is not told from a melee hit.
- Berill: `+0x3b4` starts at 0 so a cloaked idle Sinow goes straight to the fight.
- Deldepth: `onMiss()` is not hooked; the disc model swap (`discForm`) is exposed, not done.
- Delbiter: howl confusions go out one per tick; laser origin / range assumed.

**Checks:** `node tests/enemyfsmep2c.test.ts` (new: every state with the real motion
frame counts, no state hangs in 20000..40000-tick soaks, remote damage, death);
`tests/enemyfsm*.test.ts`, `enemystatus.test.ts`, client `tsc --noEmit` (only the two
missing @capacitor modules). Not checked in Chrome (to do: Seabed / Mines with the
Online tab, Warp to the Sinow and Delbiter floors).

## Boss leftovers: Belra arms and Saint-Milion spinners

Ephinea `PsoBB.exe`; the JP source tree has no matching C for either, so the dump was the
only source.

**Dark Belra's thrown arms (done).** The arm was a purple ball at an assumed hand. Now
(`combat/enemyshots.ts` `BelraArm`, `combat/enemyfsmruins.ts` `BelraAi`, `render/combat.ts`):
- **Drawing** (arm render 0x00539e5c, flight 0x00539c7c, position 0x00539b5c): the arm model
  `re7_b1_larm.nj` / `re7_b1_rarm.nj` (model = arm id + 1) at the arm's ground point lifted by
  its height above ground, at least 10 (`belra_arm_y_offset` 0x009230b4), turned by the heading
  it was thrown with (+0x60), scaled (s, 1, s) with the same s that grows 0.15 a frame to 2.
  The enemy model's two arm parts are now `place: 'world'` (they used to sit under the
  body), and `launchShot` moves the part named in `ShotLook.model` through `EnemyShot.pose()`
  instead of a ball. The state-2 tail of the arm (one frame at speed 0.2, the effect object
  at +0xf8 with step inf) is not drawn: the arm vanishes when its flight ends.
- **The hand** (init_belra_global_config 0x00538e28 tail, throw 0x00537e64): the node origin
  of node 0x21 at motion 3 frame 30 (arm 0) / node 0x38 at motion 5 frame 29 (arm 1) in model
  space, + (0, 20, -4) (`g_BelraModelYOffset` 0x00922f40, `g_BelraModelZOffset` 0x00922f44),
  x / z turned by the heading, added to the body position. `BELRA.handNode` (and
  `handNodeUltimate`, the `_a` model's motions put the hands elsewhere) were read off the
  models with the project's own node walk; `tests/enemies.test.ts` re-derives them. This
  replaces the assumed "12 to the side, 20 up", and the right arm (the first one thrown)
  is on the model's -x side: the old sign was backwards.
- **The body without its arm** (EnemyRender 0x00536d4c, flags 0x420 + arm * 4): bit 1 from
  the launch to the end of the arm's flight hides the polygons of the arm's first and last node
  (0x21 / 0x31, 0x38 / 0x48: the only two with polygons in each 17-node subtree). `BelraAi.armGone`
  says which; `render/combat.ts` `belraTick` collapses the subtree's root bone (33 / 56) while it
  is set, from the body animator's `onFrame`.
- **The regrow** (+0x404, class vtable 0x00aff758): started at the launch (value 0), `+0x14`
  (0x00512404) adds the step once a frame in the throw's sub 2 and finishes at >= 2.0
  (0x0092057c). The step is 0.04 (0x3d23d70a, base ctor 0x0057946c) and 2 / 10 in Ultimate
  (vtable +4 0x00512314 with 10, the ctor's tail): 51 frames in Normal, 10 in Ultimate (float32
  sums). It was an ASSUMED 30. Leaving the throw clears the flags (exit of 0x00537e64).

**Saint-Milion's 16 "spinners" (decoded, not driven).** They are the boss's 16 tentacle
entities (`SaintEmilionEntity`, ctor 0x0076dfec, vtable 0x00b43ca0), each a full enemy
(battle params, hit box, lock-on, minimap icon) in four groups of four: slot i & 3 == 0 leads
(sub-id 0, starts in action 0), the other three follow (sub-id 1, action 10). All start hidden
(flag 0x20) and wait for the boss. `combat/saintmilion.ts` holds what the exe says about them:
the 17-row action table (0x009f78e0), the animation table (0x009f7820: motion, speed, mode;
negative speed is played backwards by hand from the last frame), the procedural pose
(0x0076d138: z in 0..50 moves nodes 3 and 8 along their local x, x in 0..1 scales nodes 46, 49,
52 and 55 by 1 - 0.9 x / 1 - 0.1 x / 1 - 0.9 x, with the per-flag rates), a lead's random spot
(0x0076e48c: angle (slot * 0x1000 + param) & 0xffff, distance 100 + rand16 * 0.0030517578125,
x < 0 stretched 1.5) and a follower's (0x0076e5e8: 50 from the lead at ((slot & 3) * 0x5555 +
param) & 0xffff, accepted when ground exists, no wall lies between and it is 30 from the avoided
spot). `tests/saintmilion.test.ts` is new.
- **The motion puzzle is solved:** the six motions after the first of
  `bm_ene_boss09_tentacle.bml` key the first 32 of the model's 59 nodes (they parse with a node
  count of 32, motion 0 with 59); the other nodes keep their bind pose except for the
  procedural pose above. `EnemyMotionSpec.nodes` lets a part play such a motion
  (`tests/enemies.test.ts`). The earlier "sub-tree through 0x009F5B20" belongs to the boss's own
  parts, not these entities.
- The enemy model now builds all 16 hidden parts (`spinner 0..15`, model = the boss variant)
  instead of one. No motion is attached: which animation an entity plays is the boss's choice.

**Assumed:** the ground under a flying arm is flat (its height stays the launch height); the
particle effects 0xdd / 0x150 that trail the arm and the regrow's fade shader are not drawn
(the arm reappears plain); the Ultimate hand set is picked by difficulty 3 like the brain's
`ultimate`, not by "online" as `pick` does; Saint-Milion: which model an entity draws (+0x370
comes from vtable +0x14c 0x004adce0, not in the dump; the boss variant is used), the rotation
convention of the placements (same as the models' yaw).

**Left:** the Saint-Milion boss itself (there is no brain for it: the entities are never
woken, moved or shown; its action handlers 0x0076d2bc .. 0x0076d6d0, the per-action z / x
rates in 0x00a9b0e0 / e4 / e8 and the battle params of the entities are not decoded), and with
it the pose's draw hook (`SPINNER_Z` / `SPINNER_X` are data only); the other Belra effect
objects (arm trail particles, regrow shader).

**Checks:** `node tests/enemyfsmruins.test.ts` (the hand, the pose, the 51 / 10 frame regrow),
`tests/enemies.test.ts` (hand nodes against both models, tentacle motions, the 16 parts),
`tests/saintmilion.test.ts`, client `tsc --noEmit` (only the two missing @capacitor modules).
Not checked in Chrome.
## 2026-10-20: Boss leftovers: Vol Opt prison bars and cage

**What changed:** the three objects the 2026-10-19 Vol Opt entry listed as "constructors only" now have their update code, read from the disassembly of the Ephinea `PsoBB.exe` (`objdump -d` of the VAs below; the Ghidra dump only names their constructors and the vtable symbols have no functions behind them). `combat/volopt2.ts`: `VoloptBar` (the laser's bars, now real shots that land and hurt), `VoloptCage` (the capture's cage, with the exe's start point, homing and contact test) and the prison's rise; `combat/volopt.ts`: `VoloptLid` (the pillars' "prison bar" object). `render/combat.ts` draws the flying cage as a ball (the bars ride the existing shot balls).

**The names were wrong again.** Three different things carry "VoloptPrisonBar" in the dump:
- `ConstructVoloptPrisonBarEntity` (ctor `0x0044B0BC`, vtable `0x00AF6870`: dtor `0x0044B03C`, update `0x0044B1B8`, draw `0x0044B698`) is the laser's bar, built by the body's state 5 (`case 5` of the laser, four of them at `field_0x70 + k * 0xC`) and by the Ultimate arm (one per player in the arc).
- `VoloptPrisonBarConstructor` at `0x0044B84C` (vtable `0x00AF68C8`, 0x34 bytes, at `+0x3C0` of every pillar: update `0x0044B8C4`, draw `0x0044B9A0`) is the lid of the pillar's hatch. Its draw takes the first node and the child node of BML model entry 13 (`fe_obj_vo_futa_moto.nj`, `+0xD8` of the table at `+0x42C`; the globals `0x00A44CB0/B4` are filled at `0x0043ECCC`) and puts them at `(0, b, 0)` and `(0, a, 0)`, turned by `-60 * index - 90` degrees.
- `VoloptPrisonBarConstructor` at `0x0044BB80` and `UpdateVoloptPrisonBarMusic` (`0x0044BAA8`, the object `AllocateVoloptPrisonBarContext` builds, vtable `0x00AF6928`) count 0x5A frames and start the music (`LoadSLBGM(4)` or the string at `0x008FEA24`): they belong to the Dark Falz scene, not to Vol Opt.
And `ConstructVoloptPrisonEntity` (ctor `0x0044A54C`, vtable `0x00AF6710`, update `0x0044A694`) is the cage that flies; the object it creates on a hit, with the entity id base + 0x20, is the enemy of ctor `0x00449CB4` (vtable `0x00AF6560`, states 7 / 1 / 4 / 5). `ConstructVoloptPrisonCoreEntity` is the missile (model entry 22, `me5p02_y_missile.nj`, `+0x168`), as the previous entry said. The BML model entries are 16 bytes apart starting at `+8`: `+0x128` is entry 18 (`me5p02_y_cage.nj`, the prison's model), `+0x178` entry 23 (`me5p02_y_pillar.nj`, the bar's), `+0x158` entry 21.

**Laser bar** (`VoloptBar`, state at `+0xAC`, timer `+0xB4`, owner `+0xBC`):
- Start height `+0x3C` = 90.0 (`0x008FE9E0`) when the bar is less than 60.0 (`0x008FE9E4`) from the arena origin (`2D distance` `0x0078EA6C` on x and z to `0x00A447B0/B8`, which phase 2 sets to (0, -5000) at `0x0043E954`), else `(distance - 60) * -1/3 + 90` (`0x008FE9D8/DC`).
- State 0 loads the timer with row 37 `iparam6` (`+0x2C` of `g_pVoloptForm2AnimationSpeeds`, the same number the body waits in sub 6) minus one and counts on in the same tick; state 1 counts down; at 0 it builds three ceiling fragments (`0x0044B4E4`: `DerollePartObject` x3, model entry 14) and goes to state 2.
- State 2 adds -16.0 (`0x008FE9BC`) to the height each tick; once it is not above 0.0 (`0x008FE9D0`) the bar lands: timer 15 (0xF), state 3, collision flag 2 on, one collision pass; every player whose entity type (`+0x96`) is 1 inside the box takes `entity_hit_by_tech(owner, 0x008FE92C = 0, (float) row 37 iparam2, 0, -1, -1)` (the vtable `+0x60` call), the particles 0x11E (at height 5.0, `0x0044B433`) and the sound 0x343 follow. The box is `0x009A566C`: centre (0, 18, 0), radius 5.0, flags 0x8005; the player's box is 5 as well (the 2026-10-18 lobby entry), so a player inside 10 is hit, once, on the landing tick only.
- State 3 counts the 15 ticks; state 4 adds +16.0 (`0x008FE9C0`) and deletes the bar at 90.0 (`0x008FE9D4`). With a wait of 4 a bar lives 4 + 6 + 15 + 6 ticks.
- In the web client: shots (`absolute`, tech power = iparam2, group 0 through the existing `enemyTechHitsPlayer`), each client resolves its own player; the landing sound goes out as an `se` event.

**Cage** (`VoloptCage`):
- Built when the aim timer ends (the `ConstructVoloptPrisonEntity` call in the capture's case 2 of the body's state function): position = body + `(0, 30, 35)` turned by the body's `+0x60` (the old code started it at the body), velocity `(0, 0, row 38 fparam1)` turned the same way, life = row 38 `iparam1` (`+0xD0`), target = the aimed player. The sound 0x356 plays at the throw and 0x357 on every tick it lives.
- Each tick: the vector from the cage to the player's weapon point (`+0x300..+0x308`; here `(x, 10, z)` like the missile) is scaled to row 38 fparam2 (`0x0078EA90`) and added to the velocity, which is scaled back to fparam1; the cage moves; a map ray from the old to the new point ends it (`0x0077FFFC`, ASSUMED not reproduced); below height 25.0 (`0x008FE8E0`) a sphere of radius 5.0 (the initialiser at `0x0044A884` writes it to `0x009A5618`) is tested against the players and the first one in the cache order takes `entity_hit_by_tech(owner, 0, 0.0, ...)` (`0x008FE8C8/CC` are zero: only the owner's MST share lands) and is handed to the body's `0x00448660`; then life - 1, and at 0 the cage is gone.
- `0x00448660` writes the player's id to `+0x340`, builds the prison enemy (0x39C bytes, ctor `0x00449CB4`, arguments `0x009A4DEC/F0`) and sets the body's flag 0x200000 (captured). The prison starts at height -25.0 (`0x008FE8AC`), state 7: the first tick plays 0x344, then it rises 5.0 a tick (`0x00A44C44`) to 0.0, where it stores `iparam5 + 0x1C2` at `+0x394` and goes to state 1 (hold, which moves the player to it and counts the timer down); its hit sphere is `0x009A55C0`: centre (0, 18, 0), radius 20. So the player is held 6 ticks longer than before and the prison cannot be shot while it rises (the old code made it a target at once at height 15).

**Hatch lid** (`VoloptLid`, per pillar, `bars` of `VoloptPillar` writes it the way the exe writes `+0x20` and `+0x24 = 0`): state 1 (`0x0044B944`) raises `b` (`+0x2C`) by 1.8 (`0x00A44CA4` = -1.8, set at `0x0044BA1C`) to 0, then `a` (`+0x28`) by 0.3 (`0x00A44CA8`) to 0; state 2 (`0x0044B8E4`) lowers `a` to -3.0 (`0x008FEA10`), then `b` to -18.0 (`0x008FEA14`); both end in state 0. Float32 steps, so opening takes 11 + 10 ticks and closing 10 + 11. The pillar opens it when it attacks or glows and closes it when it lowers, dies or idles (the old comment had these two the wrong way round).

**ASSUMED (neither the dump nor the exe's data has it):**
- Drawing: the bars and the cage are balls; the exe draws models 23 / 21 and a stretched ring for the bar (draw `0x0044B698`, scale `((90 - y) / 90 + 1)`), particles 0x11C / 0x11D / 0x11E for the cage and the landing. The lid is tracked (`pillar.lid.a/b`) but not drawn: its draw needs the node tree of `fe_obj_vo_futa_moto.nj`, and `bm_boss3_volopt.bml` is not on this machine to look at it.
- The players' height in the contact tests (flat tests), the knock-back direction the bar writes into the player (`0x00830AA0`), the three ceiling fragments, the cage's map ray, the prison's hit reaction (state 4: 30 ticks of shake) and death (state 5: sound 0x35, particles 0xFB, 12 ticks), which the web client replaces with the old release.
- The arena origin of the bars' start height is (0, -5000) (`Form2Options.center`).
- The body's own heading used for the cage is `facing()` (heading + 0x8000), as for the old cage.

**Checks:** `tests/volopt.test.ts` (new blocks: start height, the bar's whole timeline and its single hit, the laser's twelve bars with their power and wait, the arm's bar, the cage's start / flight / homing / contact below 25 / first player wins, the prison's rise, the lid's 21 + 21 ticks and its pillar wiring); `tsc --noEmit` (only the two missing @capacitor modules), `bossrooms`, `enemies`, `derolle` pass. Not run in Chrome or against newserv from here (`combat.test.ts` needs the newserv binary, which this worktree does not have).
## 2026-10-20: Boss leftovers: Dragon hit boxes and models

**What changed:** the Dragon's two sets of hit boxes are read from the exe and the tail swipe uses
them. `combat/dragon.ts` has `DRAGON_BODY_BOXES`, `DRAGON_NODE_TABLE`, `DRAGON_TAIL`,
`DragonAi.recordNodes` / `wantsNodes` / `tailBoxes`; the old swipe (an area strike 70 behind the
body with radius 45, both ASSUMED) is gone. `render/combat.ts` `tickDragon` records the tail's
model nodes while the swipe runs, and the player's melee test (`resolveHit`) counts the Dragon from
its body boxes' surface. `PLAYER_RADIUS` is exported from `combat/enemyshots.ts`.

**What the exe says (Ephinea VAs):**
- Body: the ctor `0x00419214` calls `0x0051ff3c` with the table `0x009a39a0`, 7 boxes of 0x2c bytes.
  The table is bss; the static init `0x00425212..0x0042524e` writes only the radius (+0xc): 10, 10,
  10, 15, 15, 10, 10, the file holds flags 0x8003, every position is (0, 0, 0). Nothing in
  `0x00419000..0x00428000` calls the box movers (`0x00520068`, `0x005200e4`, `0x00520158`), so the
  body is spheres at its origin (the biggest 15).
- Tail: a second object built by the ctor at `+0x68c` (`0x004269f8`, the dump's
  "DestroyGameListObject"), 17 boxes cloned from the template `0x009a3fc0` (flags 0x8003, radius
  10.0 written by the static init `0x00426d74`, which is in the CRT init table at `0x009a205c`).
  Its update (`0x00426ba8`, vtable +4) places box i at the world position of the Dragon's recorded
  node array entry 15 + i, then `0x00520304(box, 30.0)` sets flag 2 (low) below 30 above the
  Dragon's y, flag 4 (high) from 30, and runs the generic contact attack `0x00521eb8` with the
  context {3.0, 1}, the hit list `+0xbc` and AttackData row `[0x00a4373c]` (the second of the five
  rows 18, 20, 21, 22, 23: attack index 1). Only the tail swipe (state 4, `0x004227dc`) calls that
  update, from its second tick; the hit list is cleared on entering and when the animation crosses
  frames 10 and 23 (the dump's "Clear/SetChildActive" also flip a +-5 vector at `+0xc4/+0xcc`, a
  knockback direction), so one swipe strikes a player at most three times.
- Nodes: the model draw (`0x00424580`) calls `0x00418d5c` for every node of the model, depth
  first, with a counter; when it equals `0x008fb900[slot]` (0, 8, 10, 40, 41, 50, 51, 54..58, 67,
  70, 71, 72, 74, 76, 79..85, 88..94, 100, 102) it copies the node's world position to `+0x438 +
  12 * slot`. Slots 7..11 need flag 0x80 of `+0x3c8`, slots 18..31 flag 0x200 (the swipe sets
  it), otherwise the last values stay. Checked against `bm_boss1_dragon.bml` (124 nodes): 72..94
  are the tail (two forks), 40/41/50/51 the feet, 54..58 the neck; during `tatk` the tail is low
  at frames 3 and 15 and up at frame 9, which is the swipe. This also pins the foot nodes
  (slots 3..6, array `+0x45c..+0x480`) the render reads for the steps, not used yet.
- Flames and fireballs have no model: their vtables (`0x00af3de0`, `0x00af3e40`) have the empty
  draw `0x0061cdb0`; the visuals are particles (the fireball's landing calls `0x0050b7a4` with
  0x40), which is the particle item, not a model item.

**ASSUMED (marked in the code):** only low boxes touch a player (the exe tests in 3D and the
targets carry no height), the player's body is the shared 5-unit disc, the body boxes' surface
rule for the player's melee (the repo's melee is a point test for every enemy; the exe's generic
test was not read) and the hit box index sent in 6x0A stays 0. The tail knockback direction
(`+0xc4/+0xcc`), the hit callback `vtable +0x50` and the mouth / head nodes are not read.

**Left:** the particles of the flames and fireballs, the mouth and head places (`+0x3f0..+0x437`
come from node 0 plus three points at `0x00a437ac`), the foot dust, the 3D player test, the
tail's knockback.

**Checks:** `node tests/dragon.test.ts` (new section 24: the tables, the record gating, three
strikes per swipe, a raised tail strikes nobody, and with the client data the real model's tail
low / high by frame), client `tsc --noEmit` (only the two missing @capacitor modules). Not
checked in Chrome.
## 2026-10-20: Boss leftovers: De Rol Le chain solver and shell debris

**What changed:** two of De Rol Le's ROADMAP leftovers are closed. The chain solver
`0x0078d9d0` turned out not to be the tentacles' (those are the four `0x00437ba4`
objects, already done) but the body's two **fin chains**; the shell debris are the
**helm break** and the **segments' shell breaks**. New file `combat/derollefins.ts` (pure:
`DrlFins`, `DrlDebris`, the exe's matrix order), small hooks in `combat/derolle.ts`
(`fins`, `helm`, `shells`, events `helmBreak` / `segmentBroken`, `breakSegment(i)`),
10 + 1 + 10 + 10 hidden parts in `formats/enemymodels.ts` (case 0xc1) and the draw in
`render/combat.ts` (`drawDeRolLeFins`, `drawDrlDebris`, the helm cut in `tickDeRolLe`).

**The fin chains** (the dump calls the object "MovementTarget" `0x00434ba4` /
"TeamFlagObject"; matched by callees and constants, the unnamed code read from the disassembly):
- Ctor `0x00434ba4` (made by `0x0042ad4c` at body +0x658) copies two anchors and two
  collision spheres, then builds the rest pose with `0x0078d9d0`: two chains of 6 points
  (table `0x00a43d40`, set by `0x00434f54`: count 6, step (0, 0, -5.0), a 0xff terminator),
  point j = anchor + j * step.
- Anchors: body +0x40c and +0x478 = +0x400 + 12 * k for k = 1 and 10 of the draw-order
  captures `0x008fcba0` (`0x0042a904`), i.e. the model's locator nodes 26 and 96 (the draw
  index is the depth-first node index: the table's `0x4d..0x58` captures are exactly the 12
  nodes under node 77, checked in `tests/derolle.test.ts` on the real model).
- Update (vtable +4, `0x00434d00`): `0x00434c84` refreshes the anchors and the spheres
  (radius 10.0 at the anchor + (0, -7.07, +7.07), 7.07 = `0x008fd480`), then the solver
  `0x0078d130` with the delta (0, 0, -2.0). Per point: += delta, back at the segment length
  (|step| = 5) from the point before, then up to 16 passes of: the sphere that penetrates
  it deepest (radius + half a segment = 12.5, distance floor `0x00836208`) pushes it out
  along the line from the centre, and it goes back to the segment length. A zero vector
  reads as (0, -1, 0) (`0x0097aa94`). Two chains x two spheres.
- Draw (vtable +8, `0x00434d34`): per segment `T(p) * Ry(yaw) * Rx(pitch) * Ry(0 - yaw) *
  S(2.0) * Rx(-0x4000)`, yaw = atan2(-x, -z) (skipped when x = z = 0), pitch = asin(-y) of the
  direction to the next point, both truncated to BAMS with 6.283184051513672 (`0x008fd460`).
  The anchor's yaw slot (this+0x30, +0x40) is always 0, so the two Y turns cancel and only
  the tilt about the axis across the heading is left (as in the generic flag draw
  `0x0078d484`). Model = `model_files[1]` (fin_a, `0x00a43d50`) on all but the last segment,
  `model_files[0]` (fin_b, the tip, `0x00a43d54`) on the last. The matrix helpers were
  identified from their elements (0x0082d8bc Y, 0x0082e9e4 X, 0x00830c04 Z, all standard
  right-handed, post-multiplied, column-major with the translation at e[12..14]: three.js'
  layout, so `matrixWorld.elements` feed them directly).
- Render wiring: the anchors are the captured nodes' `matrixWorld` translations (the same
  way the spine / attach captures already work), the 10 segment groups are
  `place: 'world'` parts decomposed from the matrix and tracked by `TickSmoother`.

**The shell debris** (the dump's "Sinowbeat" / "ParticleEffect" names; both objects share the
update code, the 28-piece `0x00429e60` and the 19-piece `0x004299ec` differ only in count):
- Piece records come from the model object `0x00512124`: one per node that is not hidden
  (flag 8 clear), position = the node position, direction = the xz unit of it
  (`normalize_xz_components`, y kept). The static init edits them once: the direction is
  scaled (1.1, 0, 1.1) (`0x0042a2dc`), the shell's positions by 2.0 (`0x0042a364`).
  `drlPieceRecords` does it from the part's bone positions (no embedded model data).
- Piece (0x2c bytes at +0x20): pos, vel, ax (+0x18), spin (+0x1c), ay (+0x20), alpha, state.
  Update: age + 1, deleted at 160. State 0 falls (g = 0.2, `0x008fc740`); when the vertical
  speed is negative and y < 1.15 (`0x008fcc18`): inside the arena box x in [-75, 76], z in
  [-75, 76] it bounces (vy *= -0.8) and fades (state 2), outside it sinks (state 1) once
  under -10 (`0x008fcc10`), with a particle (`0x170` / `0x171`) on every second piece. State 2
  loses 0.05 alpha a tick and is gone (3) when it goes under 0. State 1: y += vy * 0.2,
  z += vz. ax += spin, ay += 2 * spin in states 0 and 2.
- Helm break (ctor `0x00429d00`, 28 pieces of model 5): `UpdateDerolle` sees flag 0x80 of
  +0x3c8 (set with the shell break's 0x88), clears it and sets 0x40, and builds the object
  from the matrix the body's draw captured at node 77. Position = M * node position,
  velocity = M's rotation (scale 2 included) * direction with vy = rand * 4 + 2 and
  vz -= rand * 4 + 1, spin = (rand - 0.5) * 2 * 3400, angles 0. Draw (`0x0042a034`):
  `T(pos) * Rz(ay) * Rx(ax) * T(-origin) * M`. `render_derolle` with 0x40 set draws the body
  without node 77's children (`0x004335c4`: the render param `+0x2c` points at
  `g_DerolleRenderParam`): the port collapses those four nodes.
- Shell break (ctor `0x00429834`, 19 pieces of model 6, made by the segment's
  `0x004350d4` = vtable +0x1a8, which `0x004354c4` calls when the segment's own pool
  `+0x39c` (MovementData iparam2) runs out): position = segment position + node position,
  velocity = direction, then vy, vz as above and ax, spin, ay = rand * 65536, (rand - 0.5) *
  2 * 3400, rand * 65536 (in that rand order). Draw (`0x00429bc0`): `T(pos) * Ry(spin) *
  Rx(ax) * Rz(ay) * S(2.0)`.

**ASSUMED (also in the code):**
- The fin chains rest at the origin until the body has been drawn once (the capture slots
  are taken as zero at the ctor), then follow the anchors; the first frames after a far
  first anchor show the exe's own transient.
- sin / cos of the BAMS angles are exact (the exe uses a 4096 entry table with a 16 step
  interpolation, within about 1e-7).
- Per-piece alpha (state 2 fades 20 ticks at 0.05) is not drawn: a skinned model has one
  material, so a fading piece stays opaque and vanishes when it reaches state 3. The
  `0x170` / `0x171` particles are not drawn (the particles stay a leftover).
- The helm debris needs the node 77 capture; without a node tree the helm is cut and
  nothing flies.
- rand() is the client's own PRNG (the exe's CRT `rand() / 32768`); pieces differ between
  clients, as they do in the exe (each client runs its own `rand`).

**Left:** a segment's shell break needs the segments as their own hit targets (their pool
+0x39c, hit proxies in the slots the exe gives them, the plate going invisible through
the dump's `DerolleSetAnimationSpeed` alpha): the debris is ready and tested
(`DeRolLeAi.breakSegment(i)`, event `segmentBroken`, the ten `shell debris i` parts) but
nothing calls it until that item lands. The particles. Neither is checked in Chrome.

**Checks:** `node tests/derolle.test.ts` (fin rest pose, length, settling along -z, sphere
push-out, pose angles and the matrix; debris spawn values, bounce / fade / sink, 160-tick
life, the helm and shell draw matrices, the brain's 0x80 -> 0x40 and the segment hook;
the model facts above from the client's own archive when present), `bossrooms`
(part counts), `enemies` (every enemy still builds, 139 models), `smoothrender`, client
`tsc --noEmit` (only the two missing @capacitor modules).

## 2026-10-20: Enemy damage: visuals and audio

What PsoBB.exe (Ephinea 1.25.13) shows and sounds when an enemy is hit, traced in
`EntityHitEntity_00773350` (the weapon strike, per hit box), `entity_hit_by_tech`
(0x00773afc), `HandleSpecialAttack_007765a5`, `ExecuteWeaponSpecialAttack_005ce89c`, the
status entries (`maybe_paralyze_entity`, `confuse_entity`, `freeze_entity`, `shock_entity`)
and their ticks, and the floating text object (`FloatingTextObject_Update_0078ab74`,
`..._Render_0078abd0`). Before: a placeholder canvas number (red for a critical, 0.9 s), a
tinted disc as the status look, no spark, no sound, no MISS. Rules in `combat/hitfx.ts`,
particles in `render/hitfx.ts`, wiring in `render/combat.ts` (`hitFx`, `statusFx`,
`specialFx`, `deathFx`).

**The hit (per hit box, damage >= 0 after the defense):**
- Not critical: `AllocateAndInitializeEnemyEntity_0050325c` makes the spark entity (update
  0x00503308, lives 60 frames): one emission of the particles 4, 5, 6 (y + DAT_0091fca0 =
  -15) and 0xd (`hit_a`..`hit_d`).
- Critical: `unknown_display_critical_hit_effect` (entity 0x00501478, update 0x005014e8):
  the particles 7, 0xb, 0xc (y - 20) and 0xe (`critical_a`..`critical_d`), plus a flash model
  (not drawn), `play_directional_sound_effect(0x42)`, and the damage multiplier.
- Then, with the defender not hidden, by its kind (exact compare of +0x2e8, so a mini-boss'
  0x11 / 0x12 / 0x18 has none): native 0xf1, A.beast 0xf2, machine 0xe3, dark 0x10d, flag 0x40.
- The number: `display_floating_text_effect_numeric(pos, 0xffffffff, 0x14, n)`: white
  (never recoloured for a critical), 0x14 frames, the damage as a short shown when >= 0; a
  hit box that takes less than 0 shows "0" (no spark); an invulnerable defender shows "0".
  The failed accuracy roll shows `display_attack_miss_text`: "MISS", red 0xff0000, 0x14 frames.
  It is the same object as the EXP text: no delay, rise 1.4 per frame, each glyph fades in over
  2 frames in sequence (5.5 frames across the string), the whole text fades over the last 8
  frames (`classic/hud.ts` `FloatingTexts`, already exact); the damage numbers now go through
  it (`hitText`, `PlayerHud.hitPopup`) with the client's font, the canvas sprite stays as the
  fallback until the font loads.
- Techniques (`entity_hit_by_tech`): Foie / Gifoie / Rafoie, Barta / Gibarta / Rabarta and
  Grants make the spark + the kind particle + the number; the Zonde family makes
  `EntityProcessHitEffect_00775204` (0xb9, 0xba + the kind particle) + the number; Megid the
  spark only; Resta on another shows a green "HP" text (not drawn here); the support techniques
  nothing. The specials: HP / TP / EXP steal, freeze, paralysis make the spark, fire the spark +
  kind particle, thunder the Zonde effect.
- `weapon_special_handlers` (0x009c2660, called with type 1 when a special lands): Draw..Gush
  0x10a and Heart..Geist 0xa8 (scale 0.2 x 0.3) and Master's..King's 0xa8 at the attacker's
  weapon position; Charge 0x66, Spirit 0x67 (0.2 x 0.3), Berserk 0x67 likewise; Freeze 0x9a and
  Blizzard 0xbf (create_particle_effect_ex, 15 frames); Heat / Fire 0x18 (5 frames); Dim /
  Shadow 200 + 0x101 (30 frames); Dark 0x1c5 + 0x1c8; Hell the same scaled 2; Devil's / Demon's
  0x1ac. Ice / Frost / Bind..Arrest / Panic..Chaos have nothing on the hit; Flame, Burning and
  the Shock / Thunder / Storm / Tempest bolts are objects (`GuisesCountdown`, `ProjectileRafoie`,
  `GizondeVisualEffect`), not drawn.

**Status on an enemy** (replaces the tinted disc): landing it makes, unless the entity is hidden,
paralysis the particle 0x26, confusion 0x24, shock 0x21 + SE 0x11, freeze the ice object
(`CreateItemEffectHandler_00500fe8`: the BattleMapEffect ice model + particle 0x12e) + SE 0x10;
the particles are `create_particle_effect_3(lockon position, id, 0x50)` followed to the entity.
Every 0x2d frames while it holds: paralysis 0x26 + SE 0xd, shock 0x21 + SE 0x11, freeze SE 0x10
alone, confusion 0x24 + SE 0xf. `EnemyStatus.tick` now reports the confusion period too
(`pulses`; it used to report only the locking statuses).

**Death:** each enemy's own death state spawns its particles (no common routine exists); the
dump shows four families that match the hit kinds by name: `gensei_dead` 0xe4 (native),
`ab_dead` 0xe5 (A.beast, at the ground, 0x1e..0x46 frames), `eall_bakuhatu1/2` + `mecha_hahen`
0xfb 0xfc 0xe3 (machine), `dark_dead` / `dark_dead2` 0xe8 0xec (dark, delayed 10 frames, plus SE
0x202 in the ruins' dark enemies).

**ASSUMED:** the hit point (the enemy origin + 26; the exe uses the hit box position);
which kind uses which death family and its timing (the exe runs them at the end of the death
motion, the port at the kill, 30 frames); the particle types 1 and 2 of particleentry.dat run
with the type 0 simulation (the level-up effect already does); the particle scale fields
+0x44 / +0x48 scale the quad; the attacker's weapon position for the special effects is 20
above the feet; confusion's tick sound is shared with the enemy (the repo's earlier reading of
vtable +0xa0).

**Not found in the exe:** a weapon-class or per-enemy hit sound in the hit path (the only sound
in `EntityHitEntity` is the critical's 0x42); the enemies' flinch sounds live in each FSM
(the ported ones already play theirs).

**Left:** the critical flash model (`effect_nt` model, animated 7 frames), the freeze's ice
model, the death dissolve (`InitializeEnemyState_00512458`: a 10-frame colour ramp on the model)
and the enemy-specific death states' sounds and particles, the Flame / Burning / Shock / Thunder /
Storm / Tempest special objects, the "HP" green text of Resta on another, particle types 1 / 2,
the hit box positions, remote players' strikes on this client. Not seen in Chrome.

**Checks:** `node tests/hitfx.test.ts` (spark and critical particle lists, the exact kind
compare, techniques and specials, the special handlers' table, status apply / repeat and the
45-frame pulses of `EnemyStatus`, death families, the number rules), `enemystatus`, `combat`,
`status`, `buffs`, `enemies`, client `tsc --noEmit` (only the two missing @capacitor modules).

**Chrome (2026-10-20, after the merge):** Forest 1, a Booma hit through `applyEnemyHit`: the white damage number and the hit spark particles show over the enemy, no page errors. Not seen: criticals, MISS, specials / technique effects, status particles, death particles.
## 2026-10-20: Player damage: visuals and audio

**What changed:** the local player (and the remote players the local client sees) now
show and sound what the exe does when hit, blocking, dying, revived or carrying a status
effect. Everything below was read out of the Ephinea PsoBB.exe (the named Ghidra dump,
plus `tools/exedata.py` reads and a capstone disassembly for the functions the dump does
not name); `combat/playerfx.ts` documents each id and address.

**What the exe does, and what existed before:**
- *Hit state entry* (`0x0069ed10` light, `0x0069ea00` heavy): `play_sound_effect_at_player`
  SE `0x13` / `0x14`. Nothing played before. A remote copy (player+0x32c == 2) also runs
  `EntityProcessStatusEffectParticle_007752dc`: the attribute particle.
- *Heavy fall*: when the motion elapsed passes 10 frames SE `0x15`, or `0x21` for a RAcast
  (`get_player_class_footstep_sound_effect_type == 2`). The fall (slot 9) ends in stage 1; with
  the dead flag set the dead state follows, otherwise stage 2 plays the **stand-up motion
  (slot 10)** and ends with `get_invincibility_frames_2` = 60 ticks. Before, the heavy hit was a
  fixed 40 ticks with no stand-up.
- *Light hit*: ends when the motion ends (`CheckPlayerDeathOnHit_0069ecac`), with 60 ticks of
  invulnerability. Before: a fixed 20 ticks.
- *Lethal hit*: the flinch / fall plays out first and the dead state starts at its end
  (`6x89` + `6x4D` are sent there, `6x4C` / `6x4B` carry HP 0 first). Before: the death
  motion started at once.
- *Death*: the helper object (`player_death_class_countdown_helper`, vtable `0x00b44e88`,
  update `0x00788a64`) starts after the death motion; its counter grows by 2 per frame to 128
  and sets the screen colour (`g_UIElementArray_00a98480[1]`) to red with that alpha, then
  calls the return-to-Pioneer-2 routine (`0x006920ac`), which on a field creates the dead
  prompt and sends **`6x4E`**. Before: `6x4E` went out when the death motion ended and there
  was no fade. No sound plays in the dead state's entry.
- *Block* (`6x4A`, `action_block` `0x0069a9c8`, evade-state entry `0x0069f498`): the motion is
  **slot 6** (vtable `+0x4c`), not slot 10 (that table was the stand-up, mislabelled "guard"),
  then `PlayerProcessHurtDamage_0068c8e8`: the effect entity `0x00503144` (particles 0..3,
  `guard_a..d`) and SE `0x23`.
- *Hit effects* (`EntityHitEntity_00773350`, the defender is the local player): the hit spark
  entity `0x005032c8` (particles 4, 5, 6 fifteen below, `0xd`) and the defender's attribute
  particle `0xf1` native / `0xe3` machine (`SetPlayerBattleAction_006951a0`: an android class is
  machine, others native, a Ranger's `|0x20` matches nothing); no damage number for the local
  player (`field_0x32c != 1` is required).
- *Knockback* (`ClampAndDampPlayerVelocity_00694230`): each tick `v = v * 0.5`, below `1e-5`
  zero, then the player moves. Before: 0.75 per tick (an approximation noted as such).
- *Revive* (`6x4F`, `ForceExitSpecialState_0069db5c`, state `0x12`): invulnerability 300 (was
  60) and, on a field, the revive entity (`0x006efc48`, update `0x006efd5c`): emitters `0x35`
  (30 updates), `0x36` (after 35, one), `0x37` (after 45, one) at the player (the first 20
  above) and `0x38` on the 10th update. No sound.
- *Dead marker*: `6x4E` makes the receivers (and the local player after the fade) run
  `TriggerDespawnEffect_00697988`: particle `0xaf` (`soul`), a continuous emitter 10 above the
  dead player on a field, while the player is dead.
- *Status effects*: infliction creates the particle (`0x25` poison, `0x26` paralysis,
  `0x27` slow, `0x24` confusion, `0x21` shock) following the player; shock and freeze play their
  SE on the infliction; every 45 frames the tick repeats the particle and the SE
  (`0xc 0xd 0xe 0xf 0x11`); the freeze tick repeats SE `0x10` only (the freeze itself is the ice
  block entity `CreateItemEffectHandler_00500fe8`). `PlayerStatus.pulse` was an empty callback.
  Remote players' `6x0C` / `6x0D` now drive a `PlayerStatus` per remote player, which ticks the
  same pulses on their position.
- *What the exe does not have* (read, nothing found): no invulnerability blink (the invuln
  flag `0x4000000` is only read by the attackers' hit tests), no camera shake in the player's hit
  path (`set_camera_shake_effect` is called by enemy / boss code only), no low-HP warning sound or
  flash (`QuickMenuStatusBarUpdateHP_007422c4` only recolours the bar and shakes the window,
  already done in `classic/hud.ts`), no death sound in the dead state.

**New / changed code:** `combat/playerfx.ts` (tables, class rules, `FxEmitter` timeline),
`render/playerfx.ts` (`PlayerEffects`: additive particle sprites of `particleentry.dat` ids,
following a player or fixed, delayed / bounded / unbounded emitters, as `render/levelupfx.ts`
draws), `combat/playerdamage.ts` (states `block` / `getup`, motion-driven lengths through the
optional `motionEnded` / `motionFrame` events, `sound` / `fx` events, the death fade,
exact knockback damping, lethal flow), `combat/status.ts` (`pulse(type, onset)`, the freeze
tick pulse), `render/playerhud.ts` (`tint`, the screen overlay), `render/combat.ts` (wiring, the
remote `6x4A..6x4F` handlers with sounds, particles and motion-driven lengths, `6x4E`, the
remote status ticks).

**ASSUMED (also in the code):**
- The hit point is 20 above the player's feet and the status particles use the same height
  (the exe uses the hitbox position and `weapon_position`, neither tracked here); the block
  uses 36 (the `0x24` argument of the position getter at vtable `+0x10c`).
- Particle entries of types 1 and 2 (`0x21`, `0x24..0x26`, `0x35`, `0x37`, ...) are drawn like
  type 0, as `render/levelupfx.ts` does; entries are only seen as names / rates here.
- The screen overlay is drawn over the scene and under the HUD windows and stays at alpha
  128 until the revive or the next floor.
- The shield's own block routine (`0x68c8e8` calls the equipped shield's vtable `+0x70`) looks
  like the no-shield one.
- SEs have no distance attenuation or pan (`play_directional_sound_effect` is not read).
- The local player's own soul marker is shown (the exe handles `6x4E` for the receivers; the
  local call of the same routine after the fade is assumed to create it too).
- A remote player's dying ends its status effects (as for the local player).

**Left:** the freeze's ice block on a player, the dead prompt window the return routine opens
(`DialogListItem_Constructor_0073f0ec`, texture `0x56` of a list not identified) and the
return to Pioneer 2 it leads to, the dead-state camera (`UpdateDeathAnimationState_0069e1fc`
moves a camera target 8 above the body and sets player flag `0x800`; how the camera uses it is
not read), the critical-hit effect and SE `0x42` for an enemy's critical, remote players'
knockback displacement from the `6x4B` / `6x4C` velocity. Every `PlayerDamage.hit` caller (melee,
techniques, traps) draws the spark and the attribute particle; the exe draws them in
`EntityHitEntity` and `entity_hit_by_tech`, not for the Megid death. The hit spark entity `0x005032c8` and
the attribute particles are the same ones the exe draws on a hit enemy, so the enemy-side
visuals can reuse `HIT_SPARK` / `ATTRIBUTE_PARTICLE`. Not checked in Chrome.

**Checks:** `node tests/playerfx.test.ts` (attribute per class, landing SE, status pulses and
their 45-frame ticks through `PlayerStatus`, the emitter tables and the revive timeline, the
particle names `guard_*`, `hit_*`, `konran`, `poison_effect`, `mahi_effect`, `slow_effect`,
`riverser_*`, `soul` in the client's `particleentry.dat`), `tests/combatdepth.test.ts` (the new
slot 6 table, motion-driven states, heavy fall and stand-up, SEs, lethal flow, the death fade,
the 0.5 knockback), `tests/status.test.ts`, client `tsc --noEmit` (only the two missing
@capacitor modules).

**Chrome (2026-10-20, after the merge):** Forest 1, `combat.damage.hit()`: a light hit drops HP 96 -> 86 and plays the hit pose; a lethal hit goes dead -> revivable with the red full-screen fade and HP 0; no page errors. Not seen: heavy fall and stand-up, block, revive particles, status pulses, remote players, and none of the sounds can be judged from here.

## 2026-10-20: Damage visuals: leftovers

Follow-up of "Enemy damage: visuals and audio" (PsoBB.exe, Ephinea 1.25.13 VAs; the Ghidra dump, `tools/exedata.py` and `objdump --triple=i386` for the data and the constants). Rules in `combat/hitmodels.ts`, `combat/deathfx.ts` and `combat/hitfx.ts`, drawing in `render/hitmodels.ts` and `render/hitfx.ts`, wiring in `render/combat.ts`; tests in `tests/hitfx.test.ts`.

**(a) Critical flash.** The entity 0x00501478 (update 0x005014e8, render 0x00501620) draws the root object of `effect_nt.rel` (two crossed 19.2 x 19.2 quads through one axis, additive, double sided, diffuse 0xb2) turned about Y by the camera yaw, with the texture list's entry 0 replaced by entry frame + 1 of `technic_pt.xvm` (entry 0 is the lightning bolt, 1..8 an energy ring in eight variations). Alpha 1 -> 0 by 0.15 a frame (`LerpFloat_00501b34`, step 0x009b9500), scale 1 -> 2 by 20% a frame, frame counter mod 7. Drawn (once made, then 6 updates) as `criticalFlashFrames()`. The geometry is read from the client's file, one shared geometry, one material per live flash.
**(a) Freeze ice.** `InitializeEnemyEntity_00501068` (vtable 0x00afe680): model 1 of `bm_eff_ice.bml` (`ice_root.xj`, ~17 units) at the hit box centre, scale 0 -> radius (hit box radius * 0.15, 1.5 without one) by 0.1 a frame, yaw +0x1000 a frame while growing (+0x10 after), the particle 0x12d every third frame at scale * 10 from the centre, the thaw (frozen flag clear) starts the break model (model 0 with its 20-frame motion; the motion has 20 frames, matching the particle 0x33) and fades the block over 3 frames, then it ends (`IceBlock`).
**(b) Death.** There is no common death routine. 45 functions call the kill handlers together with a particle, sound or debris call; the helpers are 0x00578778 (0xe4), 0x005787a4 (0xe5), 0x005787d0 (explosion 0xfb 0xfc 0xe3) and 0x005787fc (dark 0xe8 0xec, 10 frames late). Classes were matched through the vtables, the factory table 0x009fba60 and the addresses the enemy FSM ports cite (the dump names "Deldepth..." around 0x0054a000 are the Delbiter's). `deathPlanFor(className, type, ctx)` holds the traced plans: Bulclaw, Claw, Dark Belra, Chaos Bringer, Dark Gunner, Delsaber, Chaos Sorcerer, Delbiter, Morfos (SE, dark burst, dissolve), Sinow Beat / Berill / Zoa (SE, 0xf8 at the motion end, explosion 20 frames later), Gi Gue and Canadine (instant), Poison / Nar Lily, Grass Assassin, Nano Dragon, Pofuilly Slime, Hildebear. `DeathRun` steps a plan per game frame (kill / motion end / motion frame / wait). The dissolve is a colour ramp object (vtable 0x00aff758): step 2/10, t from 4 down by the step, alpha offset 0 until t = 2 then t - 2 (to -1 at t = 1), done at t <= 0: 10 frames unchanged, 5 frames of alpha, gone at 20 (`Dissolve`). The port has no per-material alpha, `setModelOpacity` adds one (enemy materials are per instance, originals remembered). Death sounds go through `playSeAt`: `play_directional_sound_effect` drops a sound from 300 or more units away (0x00980ad4); the earlier status sounds use it too. The kind-guess `deathParticles` is gone; enemies without a plan get no particle.
**(c) Specials.** Handlers 0x005cde20 (Flame), 0x005ce054 (Burning), 0x005ce264 (Shock, Thunder), 0x005ce36c (Storm, Tempest) at table entries 25..30. Flame is two `GuisesCountdown` objects (update 0x005ce96c): a point on a circle of radius 40 - 4k, turning 0x1999 BAMS a frame, around a centre 5 ahead of the defender's yaw (and 0x8000 behind), 10 frames, dragging the emitter of particle 10 (`flamePoint`, a tracked emitter in `FieldParticles.spawn`). Burning is a `ProjectileRafoie` object (ctor 0x006ee0d0, colour 0.6 0.6 0.6 0.8), Shock / Thunder a `GizondeVisualEffect` (ctor 0x006f3c22: a jagged 13-point bolt, 100 up, particle 0x1f0), Storm / Tempest `WeaponSpecialAttackZonde` (random such bolts). These need the Rafoie ball and the Zonde bolt, the technique visuals the port does not have yet: left.
**(d) Resta.** `entity_hit_by_tech` case resta: `CreateFloatingTextObject_0078a944(pos, 0xff00ff00, 0x14, 0, L"HP", n)` makes "HP+n" in green for a player that is not hidden and not the local one. Shown over the other targets of the local cast and, for another player's 6x48, over the targets of its 6x47.
**(e) Others' strikes.** A 6x0A that takes HP off an enemy makes the weapon spark and the white number over it.

**ASSUMED:** the flash's camera orientation (the shared axis horizontal on screen) and that it is drawn once before its first update; the break model's scale (the block's last); the body point 26 up for +0x300; Hildebear's burst at the motion end (the exe lands it after a flight); the Nar Lily being the +0x800 variant; the remote Resta's n (MST 0, the caster's MST is not known here); the listener at the player; (e): where the exe makes the numbers on a 6x0A receiver was not traced.

**Left:** Burning / Shock / Thunder / Storm / Tempest objects, the shatter pieces (particles 0x153 with the ice piece model), the debris entities of the death states (models of `bm_ene_common_all`), the traced-but-unmodelled deaths (Monest, Wolf, Dubchic's revivals, Garanz, Epsilon, Epsigard, Ill Gill, Mericarol, Gibbon, Astark, Ep4 enemies, the Deldepth fade), the Delsaber's spin while dissolving. Not seen in Chrome.

**Chrome (2026-10-20, after the merge):** Forest 1, a Savage Wolf hit with criticals through `applyEnemyHit`: the white number and the hit sparks show, then a lethal hit puts it in the death state, no page errors. Not seen: the critical flash quad, the freeze ice block, the dissolve and per-enemy death particles (the wolf has no traced plan), Flame, the Resta number and other players' strikes.

## Quests: misc opcodes and enemy overrides

Skipped opcodes of the quest VM (`tests/questaudit.ts`) that needed no new system, from PsoBB.exe (Ephinea VAs, dump `Psobb.exe-05112026.c`); logic in `quest/miscops.ts`, small `case` blocks in `quest/vm.ts`, test in `tests/questmisc.test.ts`.

**shift_left / shift_right** (`opcode_shift_left` .c:608860 / `_right` .c:608870): the count is the low 5 bits of regB; the right shift is arithmetic (`int >>`).
**get_gender** (`opcode_get_gender` .c:608085): regA is a client id; 0 male, 1 female, 2 when there is no such player. The host maps the player's class (`genderOfClass`: HUnewearl, RAcaseal, FOmarl, FOnewearl, HUcaseal, RAmarl are female).
**find_inventory_item / _ex** (`opcode_item_check` .c:606045, `opcode_pl_chk_item2` .c:606082): the registers fill a compact item (data1[0..2], plus data1[3] stored as the fifth byte for `_ex`), `FindItemInInventory_006a4e50` walks the items and `items_equal` (.c:419047) decides: weapons need data1[1], data1[2] and the fifth byte; armor data1[1], data1[2]; mags data1[1]; tools data1[1], data1[2] and, for tech disks, the fifth byte. The plain form leaves that byte 0 (`reset_item_data`). Result: item id or 0xFFFFFFFF. The runner passes the character file's inventory.
**Keyword detection** (`opcode_keyword_detect` .c:611359 creates the object, `opcode_Keyword` .c:611368 asks it): `InitializeQuestKeywordDetectObject_00616928` makes a 0x3c byte object with four 0x200 byte buffers; `SetQuestKeywordString_00616a2c` (called by `ProcessChatMessageForQuest_006b96a4` for the local player and by the 06 chat handler for the others, by guild card -> slot) copies the chat line into the speaker's slot and sets a 0x78 counter, `UpdateQuestKeywordDetectObject_00616a04` counts it down each update and clears the line at 0. Before `enable_keyword_detect` the object does not exist: chat is not kept and `check_for_keyword` answers 0. `CheckQuestKeywordMatch_00616a64` cuts the keyword at its first `\n`/`\v` (and 32 characters), `FindKeywordIndexInList_00814028` lowercases the chat line (ASCII), puts a space on each side and looks for the keyword as a substring (the keyword is not lowercased, so a quest keyword must be lowercase; a leading and trailing space matches a whole word). Unlike newserv's "only the frame it was said" the client keeps the line for 120 updates. `check_for_keyword` (not on the task list but the half that reads it) is implemented with it. The runner feeds `game.on('chat')` to `QuestVM.sayKeyword(clientId, text)`; `KeywordDetector.update` runs once per `QuestVM.frame()`.
**Enemy parameter overrides** (`opcode_load_enemy_data` .c:608657, `opcode_get_physical_data` / `_attack_` / `_resist_` / `_movement_data` .c:608666..608822, `set_quest_bp_*` .c:752000..752235): `set_override_enemy_bp_index` stores `quest_bp_edit_index`; each of the four opcodes reads a whole row (0x24 / 0x30 / 0x20 / 0x30 bytes, the BattleParamEntry layout) at the label and copies it over that row of the table (current difficulty) when the index is 0..0x5f (`maybe_valid_bp_index`), and sets `g_IsBattleParamsEditedByQuest`. In the port `BattleParams.override(kind, difficulty, index, row)` (copy on first write, so the stream file bytes stay intact), reached through `QuestVMHost.overrideBattleParam` -> `CombatView.overrideBattleParam`, which queues behind the params load; enemies created after the opcode read the new row (the VM also keeps `bpOverrides`).

**ASSUMED:** the fifth byte of the exe's compact item is data1[4] (the vtable call that fills it is not resolved in the dump; newserv documents data1[4]); ground items, which `FindItemInInventory` also walks, are not searched; `UpdateQuestKeywordDetectObject` runs once per VM frame (its caller was not traced); enemies already spawned keep the stats they were built with (the exe reads the table when an enemy is set up; not checked in a running battle quest).

**Left:** nothing from this list; `ba_*`, `cmode_*`, `exp_multiplication` are other work. Not seen in Chrome.
## 2026-10-20: Admin panel

The user asked for a panel to manage logins, users, levels, equipment, quests and everything else that can be managed. Read from newserv's source first (`HTTPServer.cc`, `ShellCommands.cc`, `Account.cc`, `SaveFileFormats.hh`): the HTTP server (`HTTPListen`) has read routes (`/y/summary`, `/y/clients`, `/y/accounts`, `/y/teams`, `/y/config`, `/y/data/...`) and `POST /y/shell-exec`, which runs the shell commands (`add-account`, `update-account` with `flags=`, `ban-duration=` / `unban`, `delete-account`, `add-license`, `delete-license`, `kick`, `announce`, `reload ITEM`). There is no command that edits a character, a quest switch, a team command or a per-player message.

**Design.** `bridge/admin.mjs` (mounted by `bridge/server.mjs` before the public-file handler, so it never gets that handler's `Access-Control-Allow-Origin: *`) proxies fixed routes to newserv on loopback; `bridge/admin-ui/` is the page (plain DOM code, `textContent` only, no CDN); `bridge/admin-chars.mjs` edits `.psochar` / `.psobank` files for what has no command. Docker: the image sets `"HTTPListen": ["127.0.0.1:5080"]` (a bare number would bind every interface), copies the module and page, keeps the audit log and the edited `config.json` on the volume. Docs in `docs/ADMIN.md` and `docs/DEPLOY.md`.

**Findings that shaped it.** newserv's account JSON contains the BB passwords in clear text, so every answer is stripped of `Password` / `AccessKey`. There is no change-password command: the panel does `delete-license` + `add-license` and puts the old license back if the second fails (the old password is read server-side only). The shell splits on spaces and parses numbers with `stoul`, so every token is validated before it is joined. A `.psobank` wins over the bank inside the `.psochar` (`Client::bank_file`), so bank edits write that file. Technique levels above 15 live in `extension_data1` of the inventory slot with the same index, so removing an inventory item moves only state, flags and data, never bytes 1-3 of the slot. `POST /y/shell-exec` needs `Content-Type: application/json`; errors come back as 400 with `Message`. Level table names are the `Version` enum names (`BB_V4`).

**Tests.** `tests/admin.test.ts` (219 checks, fake newserv): login, lockout (per IP and global), idle and absolute expiry, logout, scrypt hash, CSRF / Origin / Sec-Fetch-Site, no CORS, validation of every parameter that reaches the shell, server-side confirmation, the mapping of each action to routes / commands, the audit log (no passwords), characters, banks, config edits. `tests/admin.live.ts` (48 checks) starts the real `vendor/newserv/build/newserv` in a temporary copy of `system/` on random loopback ports and drives the panel: accounts, flags, ban, password (the old password stops logging in), a character created through a real BB session and then edited through the panel (the next real login reads level 42, EXP, meseta, ATP and Foie 18 back), bank file, kick / announce, quests (260), reloads, data tables, config edit with `reload config` (newserv then reports the new value).

**ASSUMED:** the production image's newserv (`sha-ce2273a`) has the same HTTP routes and shell commands as `vendor/newserv` (not run here: no Docker); Traefik overwrites `X-Forwarded-For` / `-Proto` (needed for `ADMIN_TRUST_PROXY`); the `config.json` lines of the editable keys are single-line and top-level as in `config.example.json`; item data typed in the character editor is valid (it is only checked as 12 + 4 hex bytes with class 0-4).

**Left:** several admins / roles, 2FA, per-player messages (newserv has no command), quest enable / disable (file based), drop table editing, IP bans, Ep3 tournaments, non-BB licenses, item names for offline characters, a Chrome pass over the page (only syntax-checked here), the Docker build.
## 2026-10-20: Quest file writers

Foundation of a quest editor in TypeScript (the read side was `formats/questbin.ts`, `questdat.ts`, `prs.ts`). New files: `formats/prscompress.ts` (`prsCompress`), `formats/questwrite.ts` (`serializeQuestBin`, `serializeQuestDat`, `buildQuestDat`, `setQuestDatChunk`, `buildQuestBin`), `formats/qst.ts` (`parseQst`, `packQst`), `formats/questasm.ts` (`disassembleQuest`, `assembleQuest`); types and the script syntax in `docs/QUESTFILES.md`; test `tests/questwrite.test.ts`. Formats from newserv (`QuestScript.cc`, `Quest.cc`, `CommandFormats.hh`); phantasmal-world was not read or copied.

- **PRS encoder:** greedy LZ77 with a 3-byte hash chain (window 8191, matches to 256) and the short (2..5 bytes, 256 back) and long (3..9, or a size byte up to 256) copy forms, one byte of lazy matching, the `00 00` end marker; the control byte is inserted where its first bit is needed, as the decoder reads it. About 103 % of the shipped files' size.
- **Writers:** `.bin` = header, bytecode, label table (the order the header gives), offsets and size recomputed; only model fields that differ from the header bytes are written, so the unknown header words, the create-item mask and `max_players` 0 vs 4 survive. `.dat` = chunks (`0x10 + payload`) and the zero end chunk.
- **`.qst`:** 44 x2 then 13 chunks of 0x400, 8-byte BB command headers, 4 zero bytes after each 13 (newserv `encode_qst_file`); the parser takes the usual quirks (all-zero chunk indexes, padding inside the size) and rejects A6/A7.
- **Script text:** newserv's reassembly syntax with our own details (see the doc). Code vs data per label is decided by reachability from label 0 (including labels pushed on the arg stack for F_ARGS opcodes) plus "decodes cleanly and ends in ret/exit/jmp"; everything else is `.data` hex, so any byte pattern reassembles exactly. The header's floor assignments come from the `bb_map_designate` instructions like newserv does.
- **Results (335 BB quests of newserv):** `.bin` parse -> serialize 335/335 identical, `.dat` 333/333, disassemble -> assemble -> serialize 335/335, pack -> parse 333/333. With the newserv binary on 27 quests: `decode-qst` and `decompress-prs` accept our output, and `disassemble-quest-script` prints the same text for the original, the re-packed and the re-assembled `.bin`. Differences found while doing it: label table entries of unused labels are `0xFFFFFFFF`; q453 references label 0x8A9 beyond its 0x85E-entry table (`.undefined_label`); 242 of the 335 `.bin` have an all-zero create-item mask and the rest carry real entries (`.allow_create_item`).

**ASSUMED:** the `arg_push*` choice when the assembler pushes written F_ARGS arguments (matched against the pushes seen in shipped code, not run in the game); that the game accepts our PRS (the decoder is the repo's and newserv's; the game's was not run); the `PSO/<name>` field's name (file name when the quest name is not ASCII).

**Left:** data labels (strings, NPC stat blocks, camera splines) are hex, not decoded; a `.qst` for the other versions and download quests (A6/A7 encryption); `.dat` object / enemy / event editing (the writer takes chunk payloads, the UI builds them); an optimal PRS parser; `.include` and Qedit mnemonics in the assembler.
## 2026-10-20: Quests: Battle mode

Battle mode as PsoBB.exe (Ephinea 1.25.13) runs it; the Ghidra dump calls the battle controller / player class / rules "SinowberillChallenge*". Code in `quest/battle.ts` (pure), `quest/battlerun.ts` (wiring to `Game`, `CombatView.damage`, `QuestUi`), `quest/battleui.ts` (HUD); tests in `tests/battle.test.ts`; `tests/questaudit.ts` takes `FLOORS=1` to run the floor handlers (battle quests set their rules there).

**Opcodes.** All `ba_*` plus `clear_score_announce`, `set_score_announce`, `set_trap_damage`, `enable/disable_win_pfx`, `ba_get_place`, `ba_get_score`, `get_ba_record` run (`BattleSetup.apply`, small `case` in `vm.ts`). The rule struct is the 0x30 bytes at `g_BaRuleId` (= newserv `BattleRules`). Each opcode body (`opcode_unknownF812..F81B`, `.c:606777..607499`) range-checks and remaps through tables in `.data` read with `tools/exedata.py` (0x00969788: tech [1,0,2], weapons [2,0,1,3], mags [1,0], tools [2,0,1], respawn [1,0,2], dropwep [1,0] inverted, others identity); lives > 99, level > 199, max tech level not 0xFF and > 29, time limit > 0x278d0 reset to 0, `ba_death_tech_level_up` >= 30 and `ba_enable_sonar` >= 2 ignored; trap type 0..3 maps to the internal 0,2,3,1. The nine score weights are `(float)r[b+1] / (float)r[b+2] + (float)r[b]` and live in BSS (0 until a quest sets them; newserv's "defaults" are what the quests pass). `clear_ba_rules` keeps weights and announcements. `ba_initial_floor` maps 0 -> floor 0x10, 1 -> 0x11, v -> v-2 (newserv; the exe's floor arrays are not readable), stored in `vm.initialFloor`.

**Effective rules.** `InitializeSinowberillChallenge_006afd1c` copies the struct through validators (`.c:594094..594290`, `effectiveRules`): trap counts <= 20, teams only with exactly four players (slots alternate team 2, 1, 2, 1). The per-player start (`SinowberillChallengePlayer_ResetAll_00690674`, `localRestrictions`): weapons/armor/units removed for modes 1..3, mags removed for FORBID_ALL, tools removed for modes 1, 2, techs cleared (FORBID_ALL) or capped (LIMIT_LEVEL), scape dolls removed, weapon kept on death when `dropWeapon` = 1, lives from the rules in LIMIT_LIVES, trap counts when trap mode is 1, sonar count, 3600 invulnerable frames. newserv does the same to its copy of the character (`Client::create_battle_overlay`) when the leader's `6xCF` arrives.

**Score.** Per player four groups of {score, raw} at player +0x834 kills, +0x844 deaths, +0x854 damage taken, +0x864 damage given, each `n * weight` (player weight when the other side is a player, enemy weight otherwise); points = round(kills) + (round(given) - round(taken)) - round(deaths) + meseta * weight while alive, rounded half to even (`CalculateTextHeightOffset_00691600`). Remote points arrive in `6x7D` what 3; the victim's client sends `6x8F` so the attacker gets damage credit.

**Controller** (`SinowberillChallengeEntity`, states 0..6): init (timer = minutes * 60 s, leader sends `6xCF`, restrictions, teams), rules window 240 frames (GUI 0x54 = (151, 166), 328 x 166), team window 240 frames (unitxt 0x44:6), `6x7D` what 4 start ack and wait up to 450 frames, loading 150 frames, then the battle: the clock is elapsed whole seconds against the limit, score announcements (the leader sends what 5 at the announced minutes, everybody answers with what 3, the ranking prints when all replied), a CheckPlayerDeath resend every 90 frames, the end at zero time or after 300 frames with fewer than two (teams: one side) fighting, `6x7D` what 0 phase 3, results (120 + 90 frames, then wait up to 450 for the replies), places by the exe's exchange sort (ties share the first index), battle record (place counter saturating at 0xFFFF, disconnect count up at the start and down at the end), then the leader's "same rules?" Yes/No/Lobby (unitxt 0x44:0..3; Yes sends a shuffled `6x7D` what 6). Alone in the game it aborts with phase 5. Dead player (`unknown_dead_player_return_to_p2_related`): FORBID_RESPAWN or no lives left -> out; else a life is spent and `6xD0` (death level up) / `6x9B` (death tech level up) are requested (newserv checks the counts against the rules). The timer text is `H'MM"SS` at GUI 0x24 = (254, 37).

**Game creation.** `Game.create({ battle: true })` sends `C1` byte 0x49 = 1 (tested with a fake connection); the lobby/game list already reads flag 0x10 and the quest menu follows the server's mode.

**ASSUMED:** the weight choice player/enemy inside `CalculateScaledEffectValue_006a90c4` (a stub in the dump); FORBID_RARES removes only rares; `ba_get_place`/`ba_get_score` index the sorted place table by the register value (as the exe does), not by client id (newserv's text); result title strings ("1st"...) and the label/format of the ranking lines (not recovered from `.data`); the rematch re-enters init; lives/points/team-score windows are not in the exe I found (own layout); level-up requested whatever killed the player.

**Left:** player-versus-player attacks (so `6x8F` and player kills are only received), the trap objects and their placement (`6x83`/`6x80` payloads and numbers, the state machine of `update_trap` .c:492596 are read but not ported: radius 50, arm delay 150, 30 frames, damage 700 by default), sonar use, win particles, applying the overlay to the local inventory, respawn teleport (`6x24` positions from what 6), `ba_initial_floor` placement, the battle BGM (Duel1/Duel2), the loading bar, the Chrome check.
## 2026-10-20: Quest editor UI

The user chose "our own editor in TypeScript, reusing what we have", with phantasmal-world (MIT) as the feature and behaviour reference. This is the editor page; the write side (`prscompress.ts`, `questwrite.ts`, `qst.ts`, `questasm.ts`) is built in parallel and only imported here. Guide: `docs/QUESTEDITOR.md`.

**Shape.** `client/questeditor.html` + `client/src/questeditor/`, a standalone page (not `/`); `vite.config.ts` builds it in production next to `classic.html` (the dev pages stay dev-only). The model is plain TypeScript with no DOM: `model.ts` (the document: the `.bin`, a `FloorEdit` per floor with editable object / enemy / event lists, selection, change events), `history.ts` (undo / redo, mergeable commands: a drag or typing in a field is one step, `seal()` ends a run, dirty tracking against the saved state), `datcodec.ts` (the inverse of `questdat.ts` / `events.ts`: 0x44 / 0x48 records, the `.evt` file, the chunk stream), `binhead.ts` (header field edits done on the bytes and parsed again with `parseQuestBin`; the Qedit 0x398 header is upgraded to the full 0x122C one when floor assignments are asked for, which only moves the bytecode and label table since labels are relative to the bytecode; the minimal new `.bin`), `geom.ts` (room-relative <-> world, the inverse of `sectionToWorld`). `toQuestDat()` writes the lists to bytes and parses them again, so the `QuestDat` handed to `serializeQuestDat` always agrees with the bytes. The 3D layer (`scene.ts`) sits on `MapViewer` and the existing `EnemyLayer` / `ObjectLayer` / `NpcLayer`: markers (instanced meshes) are the picking proxies, models are rebuilt (debounced) when entities are added, deleted or change type / parameters and only moved in place for position / rotation edits; the geometry of a floor comes from the quest's designation through `SetDataTableOn.rel` like `GameView.floorFilesFor`. Panels: properties and floors, palette (types of the floor's area from the newserv definition tables), entity list, inspector, wave events with the room / wave spawn lists, script (line numbers, label list, Ctrl+click / F12 to a label, error line jump). `io.ts` is the only user of the write side; `testhook.ts` is the "Test in game" hook (`registerTestInGame`, also on `window.questEditor` and by `postMessage`).

**Small changes elsewhere.** `formats/events.ts`: `WaveEvent.flags` (optional, entry +4) so an edited `.evt` writes back what it read. `render/mapviewer.ts`: `orbitTarget` getter (the editor places and frames by it). `vite.config.ts`: the production pages.

**Checks:** `node tests/questeditor.test.ts` (history merge / seal / dirty, record and event codecs, action text, .dat build and parse, coordinates, header edits including the 0x398 -> 0x122C upgrade, document ops with undo / redo, and 333 newserv BB quests loaded into the model and written back to .dat bytes that parse to the same entities, events and random-section flags); client `tsc --noEmit` clean except the two missing `@capacitor` modules (with throwaway stubs standing in for the four write-side modules); `vite build` of the page alone (the full build stops at the missing `@capacitor/core` in this checkout). Not seen in Chrome: nothing of the page was run in a browser.

**ASSUMED:** `packQst` takes decompressed bin / dat and compresses itself, `opts.filename` is left unset; `assembleQuest(text, headerOptions)` lets the given options win over the header directives of the text; `disassembleQuest` writes labels as `name:` at the start of a line and assembler errors name a `line N`; the new-quest script (`set_episode`, `bb_map_designate`, `ret`) is a valid start label; the nearest room (by section origin) is a good guess for a new entity; zero is an acceptable default for a new entity's parameters; an event's flags field (+4) is runtime only.

**Left:** see the ROADMAP line. Multi-floor navigation, per-type parameter forms, random-wave sections, a rotation gizmo and copy / paste between quests.

## 2026-10-20: Technique visuals: Foie and Barta families

**What changed:** Foie, Gifoie, Rafoie, Barta, Gibarta and Rabarta are the client's objects now, for the local player's casts, other players' casts (`6x47` / `6x48`) and the enemies that cast them. `combat/techfire.ts` holds the rules (the six objects, the hit tests, the targeting system's pick, the effect tables, the enemy shot `FireShot`), `render/techfire.ts` draws and sounds them (`TechFire`, particles through `FieldParticles`, SEs), `render/combat.ts` wires the cast (a small block: `pickFireTargets`, `spawnFire`, `tickFire`, `remoteFire`, the shot loop's `spawned` and `status`). Before, the hit landed `ceil(distance / speed)` ticks after the release as a coloured disc, Rafoie hit everything within 20 of its target, and the enemy casts were `TechBolt` stand-ins (a ball at 4 a frame).

**Details** (Ephinea `PsoBB.exe`; the named dump, `tools/exedata.py` and `objdump`; the dump's names are partly wrong: `AntiTech*` is Barta, `ConstructProjectileRafoie_006ee0d0` is only Rafoie's explosion model entity):
- **Creation** (`unknown_cast_tech`, `action_launch_tech`): Foie `create_foie_object1` / `create_directed_foie_object` (heading, or the first target's hit box centre `collision_box +0x1c`), Gifoie `create_gifoie` (always), Rafoie `create_rafoie_object` (needs the first target), Barta `AntiTechEntity_Constructor_006dd7e4` / `006dddac`, Gibarta `unknown_create_sorc_tech` / `TechniqueEntity_Constructor_006e4058`, Rabarta `CreateRabartaEntity_006ec2d0` (the caster's cast point). A listed target that no longer exists makes nothing. No attack technique object is made where `is_current_map_safe` is 0 (the cities; the function's name is inverted).
- **Foie** (`TechniqueObject_Constructor_006e2f98`, vtable `0x00b3d280`): speed 3 + max(0, level - 4) (`ApplyPowerAndSpeedStats_006e31e8`), range `range_h`, moves along its direction (`+0x48`), ends once the travelled length has passed the range (the test comes before the add), then the first enemy in the entity array that its swept box (half length = half the step, half width 4, `UpdateAoECollision_006ea7c4`) touches takes `entity_hit_by_tech` group 1 and SE `0xaf` (`TechniqueEntity_Start_006e3754`) and the object is gone. It also ends on the map (a ray with mask `0x100`): particles `0x1dc` / `0x1dd` (`006e37b0`).
- **Gibarta** (vtable `0x00b3d328`, `update_gibarta`): speed 3.0, range `range_h`, half width 4 (12 when directed), it pierces: every enemy the box touches (15 a tick) once each (a 32-entry list, `006e4254`), group 2.
- **Barta** (vtable `0x00b3ce20`, `update_barta`, `BartaEntity_UpdatePhysics_006f0568`): speed 2 * (level / 5) + 3 on the ground plane only (direction x / z), range `range_h`, half width 4, 5 above the floor (probe from 10 above, a floor change of more than 12 ends it, a steep wall ends it), starts 5 higher when undirected; pierces, once each, group `0x13`.
- **Gifoie** (vtable `0x00b3d3f8`, `update_gifoie`, `ParticleEffect_Gifoie_Update_006e50f4`): `[1, 1, 1, 2, 2, 3][tier]` spiral emitters, centred 10 from the cast point at `0x4000 + i * 360 / n` degrees, radius +0.55 a frame, angle +(tier + 9) degrees a frame, height wobble `sin(15 * frame)` * (0, 3.5, 7)[tier % 3]. The hit box is round with radius = the first emitter's XZ distance to the cast point + 5 (read before that tick's emitter update, so 15 on the first tick), every enemy once, group 1; it ends when that distance reaches `range_h` (about 70 frames at Lv1).
- **Rafoie** (vtable `0x00b3e058`, `rafoie_aoe_tick`): not a projectile. It follows the first target's position (the list form) or stays at its point (the enemy form `CreateRafoieEffectEntity_006ed87c`), and with the 10th update it explodes: SE `0x8a`, the particles of its tier at (x, y + 13, z) (`0x1ee`, `0x1eb`, `0x189`, `0x18c`, `0x1e2`, `0x1e6`), and a round hit box of radius `range_h` (100 + 10 * (level / 5): rafoie_constructor stores `range_h` as the box radius; the cut-off 250 for a player's AoE, 100 for an enemy's, `0x006eb354` / `0x006eb0e8`) hits every enemy once, group 1; then it ends. A target gone first ends it without a blast.
- **Rabarta** (vtable `0x00b3dee0`): a round box of radius `range_h` round the cast point (the caster; the enemy form at the given point) that lives `cast` frames + 1 (`data.cast`), each enemy that touches it once (a later arrival too), group 2; its particles are persistent emitters that stay where they were made.
- **Hit tests.** `CheckSphereOverlap` on the XZ plane: a round box hits when the centres are closer than the radii's sum; the swept box of the bolts is an oriented box (half length along the motion, half width 4, vertical +-50 ignored). Enemy radius: `collisionRadius()`.
- **Targeting** (`unknown_update_equipment_properties_from_pmt` type 3, `check_enemy_is_targetable` `0x007a2e74`, `create_target_reticles_for_weapon_or_tech`): reach = hit box radius + range_h + range_v (XZ from the weapon position), a horizontal cone (skipped when cos of the half angle is not strictly between -1 and 1) with its apex `range_v` behind the weapon position along the heading and the target in front of the player, a vertical cone (angle_v) seen from that apex, nearest first, the first `targets` taken; with a primary target and fewer than two targets only the primary may be taken. `castTechnique` uses it for the six; the other techniques still use the old range / angle filter.
- **Effects** (tables read from the exe: Foie `0x0096d1c8`, Gibarta `0x0096d2f0`, Barta `0x0096ca84`, Rabarta `0x0096dc6c`, Gifoie `0x0096d3f4`, Rafoie `0x0096dd6c`, entries {id, flags, scale}): Foie follows the ball with `0x14` (scale 1 .. 2.2 by tier), `0xac`, `0x19e`, `0x19c` and makes the one-shot muzzle `0x18` (`create_particle_effect12`); Barta follows with `0x190 / 0x191 / 0x192 / 0x198`; Gibarta's persistent emitters (`0x180`, `0x181`) stay at the start, because `update_gibarta` never calls `copy_pos_to_particle`; Rabarta `0x1d9`, `0x1db / 0x196 / 0x197` stay at the cast point. SEs: `0x87` Foie, `0x88` Gifoie, `0x89` Rafoie (played at a point near the origin in the list form: not heard), `0x8b` Barta, `0x8c` Gibarta, `0x8d` Rabarta, `0xaf` Foie's hit, `0x8a` Rafoie's blast, the cast's charge sound `0xa3` / `0xa4`.
- **Damage** is the existing path (`techHitEnemy`: MST + power, boost, resist, Gibarta / Rabarta freeze roll, Pofuilly split, `6x0A`). For the enemies' casts on a player: group 1 / `0x13` / 2 give the same `(MST * 0.5 + power) * 0.2` as group 0 at 0% resistance (`0x00774b7d`, `0x0077494a`); an enemy's Gibarta / Rabarta also freezes the player with chance 0.75 - EIC / 100 (rolled after the damage).
- **Enemies wired:** Gibbon (Foie, Rafoie), Sorcerer (Rafoie, Gibarta; Episode 2 cycle 0 and cycle 1), Sinow Berill (Gifoie; Ultimate: the fixed Rafoie at the remembered target position), Sinow Zoa (Gibarta; Ultimate: Rabarta centred on itself), Deldepth (Barta wave; its Rabarta bomb hands a `RabartaField` over in `EnemyShot.spawned` when it bursts), Dark Falz forms 1 and 2 (Rafoie / Rabarta reach = `range_h` + 5 of the row's level instead of 25 / 40).

**ASSUMED:**
- The weapon node (the cast point and the targeting apex) is 20 above the feet; an enemy's aim point and hit box centre are 22 up; an enemy's hit box is a round box of its `collisionRadius()`; the lock-on cursor is not a manual primary target; the local player's charge sound plays once.
- The distance cut-off of `GetCollisionDataForEntity_007b65b4` is the XZ distance.
- Map walls (a Foie's / Gibarta's / Barta's ray, the 30 degree wall test) are not modelled; Barta follows the floor through `opts.ground`.
- A Gibbon's Rafoie is the list form on its target; a Berill's cast point is 10 above its feet, a Zoa's `ZOA.boltHeight`.
- The player's own elemental resistance is 0 (armour resists are not tracked).
- Dark Falz' Rafoie / Rabarta hit at once (the exe's Rafoie waits 10 frames, its Rabarta stays `cast` frames).

**Left:** the model particles (entries with flag `0x20`, models of `bm_tec_regurar.bml`: Gibarta's spikes, Barta's icicle, Rabarta's body, Rafoie's ring and fire sphere), the emitters' orientation (the exe turns them by the object's angles; the particle engine only has a pitch), the dynamic light of the cast (`TechniqueEffectObject_Constructor_006eb618`), the creation sounds' pitch by tier (`ProcessAudioCommand_00814664`), the wall impacts, the level 25+ Barta's `0x18a` stream, the per-frame y of Foie's vertical aim against hills, Rafoie's explosion model, Dark Falz' objects as drawn entities, the Epsilon / Gi Gue explosion entity (`ConstructProjectileRafoie_006ee0d0` is only its model entity; those enemies hit by distance themselves), Zonde / Grants / Megid and the special objects (another change).

**Checks:** `node tests/techfire.test.ts` (tiers, the swept and round boxes, each object's life and hits, the targeting pick, the effect tables, the enemy shots), `tests/enemyfsmep2c.test.ts` (Berill ring / Rafoie, Zoa Gibarta / Rabarta, the Deldepth Barta and bomb hand-over), `enemyfsmep2b`, `enemyfsmruins`, `darkfalz`, `techniques`, `combat`, `hitfx`, `enemystatus` pass; client `tsc --noEmit` (only the two missing @capacitor modules). Not run in Chrome or against a second client from here.
## 2026-10-20: Technique visuals: Zonde, Grants, Megid, supports, special objects

What PsoBB.exe (Ephinea 1.25.13 VAs; the named Ghidra dump, `tools/exedata.py` reads, objdump for the tables the dump does not carry, `bm_technic.bml` / `technic_pt.xvm` / `particleentry.dat` out of `data.gsl`) makes for the Zonde family, Grants, Megid, the support techniques and the Shock / Thunder / Storm / Tempest / Burning weapon specials, replacing the placeholder overlay rings and the "ball flying `speed` units" of `render/combat.ts`. Rules in `combat/techlightning.ts` (pure), drawing and the object runtime in `render/techlightning.ts`, wiring in `render/combat.ts` (`castObjects`, `techWorld`, `techShotFor`, `specialStartFx`), tests in `tests/techlightning.test.ts`. Names in the dump are wrong for most of these (the Zonde object is "ZalureEffectEntity", Razonde is "RafoieEffectEntity", "AntiTechEntity" is Barta, "ProjectileRafoie" is the Rafoie explosion sphere): matched by callees, tables and particle names.

**What `unknown_cast_tech` (0x006e0770 area) does.** Zonde, Gizonde and Grants need the 6x47 target list: an empty list creates **nothing** (no "fire ahead" fallback; the port used to draw a fading ball). Megid with no target flies along the heading (`create_megid1`), with one at its hit box (`create_megid`). Razonde and the supports take no target. The attack techniques create nothing on a city map. The creation point is the weapon model data's node (a hand): ASSUMED feet + 20.

**The jagged bolt** (`GizondeVisualEffect_Constructor_006f3c22`, shared by Zonde, Gizonde, Razonde, Shock / Storm, the Gibbon's plain bolt, the Jungle Tank trap and the Galgryphon): 13 points on `start + dir * i * length / 12` with the particle 0x1f0 (`zonde_ryuusi`, rate 3) made once at each; per point a jitter direction (the dominant axis of `dir` decides which component is `(a * d1 + b * d2) / d_axis`, which is added, not negated, so it is not a perpendicular; two random numbers of +-10, then normalised), per inner point a jitter scale of +-8 (the ends 0). Each update (`0x006f4004`): `scale = max(scale - 0.05, 1.0)`, `point = base + jitter * scale`; the alpha (colour `0xff000000`) holds while the counter is at most `hold` (0x14, Razonde 6) and then loses 0x14 an update until it cannot, and the object ends when its counter passes 0x78 (35 updates for hold 20). Drawn as a screen-space ribbon (`0x006f4230`): half width = `thickness` world units at any depth in x and 1.8 times that in y (`0x0096e0c0`), u 0..1 across, v + 1 a point (the texture repeats a segment), colour white with the alpha, the texture is entry 0 of `technic_pt.xvm` (the lightning strand; effect_nt's entry 0x10, which the dump's `g_EffectNT_NJTL.data[0x10]` suggests, is a blue orb). Laid out here in view space (`render/techlightning.ts layout`), additive.

**Tier** (`AllocateEffectBuffer_006e1cec`): `level / 5` for 1..5 else 0 (level 30 = tier 0). All sounds are `play_directional_sound_effect(id, pos)` plus `ProcessAudioCommand_00814664(voice, pitch, 0)` by tier (Zonde 0x8f, Gizonde 0x90, Razonde 0x91, Megid 0x92, Grants 0x93 / end 0x94: +0x100, none, -0x180, -0x180, -0x250, -0x100; Resta 0x95, Anti 0x97, Shifta 0x9b, Jellen 0x9c, Deband 0x9d, Zalure 0x9e: +0x100 twice, none twice, -0x100 twice; Reverser 0x99 plain; Megid hit 0xb0). The pitch unit is ASSUMED 1/256 semitone (the engine's `(v / 3072 - 0.1222) * 4096`, 0.1222 = log2(44100 / 48000)); `SePlayOptions.pitch` is new (`playbackRate = 2 ** (v / 3072)`).

- **Zonde** (vtable 0x00b3e880, update 0x006f2840): on its first update, for the FIRST target only, 14 points (0 straight above, the others spread `rand * i * 13` toward +x / +z: rand is not centred), 100 above the target's origin (500 for point 0 of tier 5), a bolt from each to the target's origin: tiers 0 / 1 / 2 one bolt of 0.5 / 0.6 / 0.7, tiers 3 / 4 three bolts of 0.5 / 0.7, tier 5 fourteen (the first 5.0, the rest 0.5); the particle 0x19f at point 0 (not tier 5); SE 0x8f at the target; then it hits (group 3, tech Zonde) and ends. No travel.
- **Gizonde** (0x006e5520, update 0x006e5890, visuals 0x006e5954): SE 0x90 at the cast point; a bolt from the cast point to the first target's hit box (thickness 0.5 / 0.6 / 0.7 / 0.6 / 0.7 by tier, tier 5 three bolts 5.0 / 0.5 / 0.5), the particle 0x19f there (and 0x188 from tier 3), then one bolt (same thicknesses) between each consecutive pair of targets (a pair at zero distance is skipped). The first target missing or at zero distance: no hit at all; else every target of the list is hit.
- **Razonde** (0x006ee674, update 0x006eebe0): a spiral of 8 points around the cast point, radius `step * (i + 1)` with step 5.4 (level < 15) / 8.1 (15..24) / 10.8 (25..29) / 5.4 (30), angle `(i + 1) * 0x2aaa` (60 degrees, x = cos, z = sin), 7 bolts of thickness 5.0 that hold only 6 updates (tier 5 adds a 0.5 one each), the particle table of the tier at the first spiral points (`0x93`; `0xaa 0xad`; `0xab 0xae`), SE 0x91; on the first update, for a player caster, the same table at the caster's weapon position (the second entry a 60 frame emitter) and the area damage: every enemy within `range_h + 5` of the cast point (a sphere against the hit boxes, at most 15; within 250 of the point for a player's, 100 for an enemy's).
- **Megid** (0x006e98c0 / 0x006ea16e, update 0x006ea3b0): flies `(level / 5) * 2 + 2` a tick for `range_h`, a ray against the map from the old to the new point ends it (not reproduced), a sphere of radius 5 against the hit boxes of which only the FIRST entity of the list is processed a tick; an entity already hit (a list of 32) is skipped; the hit is `entity_hit_by_tech` group 5 (the existing kill roll) plus SE 0xb0 at the entity; a player caster's orb ends unless `maybe_check_for_tech_pierce` bit 0 (the class boost of Megid is exactly 1.0: FOnewearl), an enemy caster's orb never ends on a hit. The emitters that follow it by tier (`0x0096da78`): `1c5 1c8` (scale 1 / 1.4 / 1.8 for tiers 0..2), + `1c4` and scale 2.2 / 2.6 for tiers 3 / 4, tier 5 scale 3 + `1c7`, `1cf`.
- **Grants** (0x006e6c6c, update 0x006e6efc, tracker 0x006e72bc): for the first target, if valid at counter 0: the continuous emitters of the tier at the position (`0x0096d5b4`: `1d3 1d4 1cb` / `1d3 1d4 1d5` / `1d3 1d4 1cc` / `1c0 1d4 10f` / `1c0 1d4 1a4` / `1c2 1d4 1c9 1da`), SE 0x93; a ring wave (model 10 of `bm_technic.bml`, `eff_f_ringwave.xj`: horizontal, scale 0.05 toward 1.2 by 5 % an update, alpha toward 0 by 10 %, the technic_pt entry frame + 1) on every 5th tracker update; at the 30th the burst `b4 b5 b6` and SE 0x94; the target is hit (group 4) on the 31st update if it is still valid.
- **Supports** (`PlayTechniqueHitParticles_006ec06c`, Resta / Anti / Shifta / Deband at a player caster): one ring particle at the caster from `0x1ed 0x1f9 0x1fa 0x1fb` by `GetPlayerTechBoost_006e1fc8` (level 0..1: 0, else the class boost < 1 / < 2 / more), tier 3 adds `0x1f2`, `0x19d`; Anti is tinted `0xff4dff99`, Shifta `0xffff9999`, Deband `0xff337fff` (new `ParticleSpawn.tint`, `SetId_00508ee4`). Jellen, Zalure and Reverser have the sound only. Another player a Resta / Anti lands on gets `0x1f6 0x1f7` / `0x1f8 0x1ff` following it and a delayed sound. Areas (the probe box): `range_h + 5` (Resta, Anti, Shifta, Deband), `range_h` (Jellen), 10 (Reverser); below Lv3 only the caster is hit (the existing rule).
- **Charge sound** (`InstantiateTechniqueEffect_006e104c`, jump table 0x0096cc80, local player): 0xa3 Foie family, 0xa4 Barta family, 0xa5 Zonde family, 0xa6 Megid, 0xa7 Grants / Resta / Anti / Reverser, 0xa2 Deband / Jellen / Zalure / Ryuker / Shifta, for `charge + 0x32 + cast` frames. Played and stopped here. The same object moves the caster's light toward a colour (`CAST_LIGHT`): not drawn (no per-entity light).
- **Weapon specials** (`weapon_special_handlers` 0x009c2660, entries 26..30): Shock / Thunder one bolt 100 above the hit straight down, thickness 1.8; Storm / Tempest the Zonde points and three bolts of 0.7; Burning the Rafoie explosion (`ConstructProjectileRafoie_006ee0d0`: particle 0x1ee at +13, model 11 `eff_rafoie.xj` for 0x6e updates, scale 0.6 toward 0.8 by 15 %, alpha toward 0 by 3.5 %). Their type 0 (the special attack starts, state 0x0069c4a0 case 2, with SE 0x40): the particle at the weapon, 0x69 Flame / Burning, 0xbe Shock / Thunder, 0xa0 Storm / Tempest.
- **Enemies**: an enemy's Gizonde, Grants or Megid is the same object, so `TechBolt` carries `tech` and `render/combat.ts launchShot` swaps it for `GizondeStrike` (the bolt at once, the hit on the first update), `GrantsStrike` (31 updates, then the hit) or `MegidOrb` (3D flight, sphere 5 + the player's radius, never ended by its hit); a Gibbon's Gizonde with nobody in front is `PlainBolt` (particles 0xb9 / 0xba and a 1.8 bolt along the heading, no damage, `unknown_gibbon_behavior2`). The FSM call sites (Chaos Sorcerer, Del Lily, Gibbon) only pass `tech`.

**ASSUMED (also in the code):** the cast point (feet + 20) and the weapon position; the lightning texture (technic_pt entry 0), additive blending and depth test of the bolts (the exe's blend / depth state calls were not decoded); the pitch unit; the ring wave's texture cycle (mod 7, like the critical flash), lifetime (30 frames) and that it follows the target; the Burning ball's texture (technic.xvm entry 5), facing and the exact lifetime of its alpha; the Zalure area; one-shot emissions for the `create_particle_effect3` emitters of Razonde, a continuous emission of the tier's length for Grants' and Megid's; the Zonde / Gizonde hit landing on the next game tick; the enemies' radius for the Megid sphere (`collisionRadius`, default 10), the list order of the Megid hit test (the port's enemy order, not the exe's entity array); the player an enemy's Gizonde / Grants is aimed at (the one best in line with the bolt); the flat ground under players for enemy objects; the targeting system's tech entries (still the repo's range / angle filter).

**Left:** the cast light on the caster; the caster's own body particles for Resta / Anti (custom emitter tables of `create_particle_effect9`, not decoded) and Reverser's target visuals; Megid's map ray; the Gibbon's `max_x_distance` (the plain bolt uses the shot's range); the other type 0 special effects (`TriggerSDJZParticleEffects`, the light); the Galgryphon's and the Jungle Tank trap's bolts; per-target visuals of Shifta / Deband / Jellen / Zalure (none found in the exe); the remote players' damage stays on their own clients. Nothing seen in Chrome.

**Checks:** `node tests/techlightning.test.ts` (tiers, pitches, the dominant axis and jitter, the bolt's points and alpha timeline for hold 20 and 6, Zonde / Gizonde / Razonde plans per tier, the 15 hit cap and the sphere test, Megid speed / range / first-entity rule / pierce, the Grants timeline, ring tiers and tints, the specials, the enemy shots, and the particle names in the client's `particleentry.dat`), `techniques`, `buffs`, `hitfx`, `specials`, `status`, `enemystatus`, `enemyfsm*`, `combat`, `combatdepth`, `playerfx`, client `tsc --noEmit` (only the two missing @capacitor modules).
## 2026-10-20: Quests: Challenge mode

Every Challenge opcode of the BB quests (`challenge-ep1`, `challenge-ep2`, the solo ones) now runs: `node tests/questaudit.ts 3000 challenge` skips only `ba_initial_floor` (the Battle Arena agent's). PsoBB.exe is Ephinea 1.25.13 (the Ghidra dump, `tools/exedata.py`, `objdump -d -M intel` on the exe for data addresses and constants); names in the dump are often swapped (`DecryptChallengeData_004d9eec` is newserv's *encrypt*; `opcode_chl_reverser` is `chl_create_retry_menu`; the "grave" code is called `ChallengeEntity*`), so everything was matched by callees and constants. Logic in `quest/cmode.ts` (no DOM), the character template in `quest/cmodeoverlay.ts` + `formats/challengetemplates.ts` (generated by `tools/gen-challenge-templates.ts`), the game wiring in `quest/cmoderun.ts` (built by `quest/run.ts` only for a game created with the Challenge flag), tests in `tests/cmode.test.ts`.

**Opcodes (exe handler -> what it does).**
- `cmode_stage` (F820, `opcode_cmode_stage` .c:606906): a stage >= the episode's stage count (9 / 5, `uint32_t_ARRAY_009098b0`) becomes 0; `send_packet0xdf_subcommand1` stores it and the leader sends `01DF`. Every DF is sent by the leader only (`g_CurrentPlayerSlotIndex == g_PartyLeaderIdx`); the state is kept on every client.
- `set_cmode_char_template` (F823, `SendPacket0xDFSubcommand2_004db043`): 0..15 (else nothing), replaces every present player (see below), `02DF`.
- `set_cmode_difficulty` (F824, `send_packet0xdf_subcommand3`): only in a Challenge game, sets the game's difficulty, `03DF`. `exp_multiplication` (F825): `regs[0] + regs[1] / regs[2]` in float32, accepted in [0.01, 10000] (`0x00909910` / `0x0090990c`), `04DF`; `handle_experience` (.c:762736) rounds `amount * multiplier` *before* the `/ 100` (`killExp` got a `challenge` option; `CombatView.challengeExpMultiplier`).
- `set_cmode_rank_result` (F864): the rank text is encrypted with the client's routine (first character ^ 0x7F, then (c - previous c) ^ 0x7F, 16 bits wide, at most 11 characters), the colour is or'd with 0xFF000000, `05DF` {colour, 12 words}. `set_cmode_rank_override` (F874, "check<TAB>result", at most 16): the first entry whose check text equals the player's current title replaces it (`ProcessChallengeStageFinalData_004d9218`).
- `set_cmode_rank_threshold` (F868, `send_packet0xdf_subcommand6`): rank 0..2, seconds >= 300 per stage, rank 0 (B) forced to 35999 per stage, an already set rank is refused, and each non-empty threshold must be smaller than the previous one (the loop returns 0 otherwise, after storing); the packet goes out with the 1. `set_cmode_grave_rates` (F88F, `ValidateAndStoreChallengeParameters_004def94`): ten fractions >= 0, the first four and the last six each summing to <= 1.
- `check_rank_time` (F869, `ProcessChallengeStage_004da994` + `ProcessChallengeStageProgression_004d8dec`). A time under the minimum (300 s, `chl_set_min_time_online` in [60, 3600]) or >= 36000 counts as 35999. The stage time is kept if it is the first or better (the first Episode 1 clear also sets the rank title and its 5-bit colour); the total is the sum of the episode's stage times (0 if a stage is missing: result 3), with this run's time for this stage; outside [300, 35999] x stages: result 6; S is tested first, then A, then B: a rank whose threshold the total meets and whose award bit (`rank_award_flags` of the episode) is not set is the answer (2 / 1 / 0), the best rank reached is saved (encoded), nothing unclaimed: 4; a full inventory: 5; not a Challenge game / no stage / no save: 6. The records go out as `ED 08` every time. `item_create_cmode` (F86A) puts the prize in the inventory, marks the award bit and sends `07DF`; the S rank path is `award_item_select / _name / _ok / _give` (the weapon is built as `maybe_put_srank_name_data_into_item`, `buildSRankWeapon`).
- `chl_set_timerecord` (F88D): `6x95` {id, encoded time, token (id + 1) ^ (time - base time)} (the exe's token uses the elapsed time, newserv's note says regB) and the client's own handler runs on it; `chl_get_timerecord` (F88E, `GetChallengeStageProgressionResult_004db6bc`): the slowest score of the players present, -1 when one has none, -2 when one is invalid (a score under the minimum was stored as 35999 by the 6x95 handler). `set_cmode_base_time` (F83C): the timer window text. `get_cmode_prize_rank` (F8AC): the saved best rank.
- `cmode_check_all_players_dead` / `_any_` (F826 / F827): 1 when all / any present player is dead, and a hit marks the stage failed. `get_chl_retry_choice` (F89C) reads `g_CurrentChallengeStageId`, which the rank colour also lives in: while it holds the colour the register is left alone (the quest polls it). `chl_create_retry_menu` (F89D) and `chl_show_dead_player_list` (F8B9) only do something with more than one player (`ChallengeObjectIsMultiplayerReady_004dc208`: alone you are sent to Pioneer 2 and the quest polls forever); `disable_retry_menu` (F8B8) also stops the grave from being saved. `reset_map` (F89B, `.c:608900`): registers to 0, the other quest threads end, floor items, switch / event / wave state and constructed objects start over (`GameView.resetMap`, `GameField.resetState`), the Challenge bookkeeping resets. `get_num_kills` / `reset_kills` read `Game.selfKills` (counted in `sendExpRequest` for the killer). `is_there_grave_message` (F8AA): the record's grave message at 0xA4.

**Records (`PlayerRecordsChallengeBB`, 0x140 at 0x2CB8 of the save, `ChallengeRecords`).** Times at 4 (9 Ep1, 5 Ep2, 9 offline), award states at 0xF4 / 0xFC / 0x104 {flags, encoded best rank}, the rank title (encrypted words) at 0x10C, the grave at 0x60. A time is stored as `(mask << 16) | (mask ^ time)` with 4..12 bits set in the mask (`GenerateChallengeProgressionValue_004d9580`; the decoder gives up on a bad mask).

**Template characters.** The 48 templates (hunter 0x009af360, ranger 0x009b05a0, force 0x009ae1e0, 16 each: level, items, techniques) came from newserv's tables and were compared with the exe's data for all of them (items, equipped flags, technique lists, levels); the one difference is a mag's `data2`, which newserv stores byte-swapped (GC form) and the exe little-endian: the generator swaps it. Applying one (`buildChallengeOverlay`): the inventory is replaced by the template's (new ids from `GameItems.takeItemId`, the same sequence newserv's `assign_inventory_and_bank_item_ids` uses), the stats are the class' base plus every level's gain up to the template's level, EXP at that level, ESP 40, no Meseta, no materials, all techniques forgotten but the template's. The live `CharacterFile`, the raw save, `selfSnapshot` and `CombatView.reloadProgression()` follow; the real character comes back when the runner is disposed (leaving the game).

**HUD** (GUI table 0x00971f40): the timer window at GUI 0x24 = (254, 37), text `h'mm"ss` capped at `9'59"59` (`set_timer_text`, set by `set_cmode_base_time`); the Area counter at GUI 0x27 = (463, 37), `Area NN/NN` from `set_current_area_number` / `set_area_total`; the result panel at GUI 0x43 = (12, 189) with the format strings at 0x00909b58..0x00909c48 (`Clear Time < Stage N >`, the time, `Total Time`, the new-record / difference line, `Title`, `Rank`); the "needs other users' help" window (unitxt 12 / 0x5F) at GUI 0x40 = (20, 120) for a lone player on a field floor. `QuestUi.setHud` draws these.

**Graves** (`ProcessGraveChallengePlayerLogic_004ddcbc`, `SaveChallengeEntityProgressOnDeath_004d9a60`). A dead local player saves episode, stage, floor, one more death (cap 9999), a packed date (the year is capped at 2015 by the exe), the party name and the position in the records, then `6x9D` and `6x7C` go out. On a floor the records (own and the `6x7C` of the others) that match episode, stage and floor are the graves; the leader, once a present player is within 10 units (XZ) of one, rolls the rates (`rand() / 32768`; cumulative thresholds, a zero threshold is skipped, the count is capped by the players present) and sends `6xD1` for each item on a fan of points 7.5 away, starting at heading - (count - 1) * 0x1000 and stepping 0x2000.

**Rules found:** Reverser (technique 0x11) cannot be cast (`CanPlayerCastTechnique_0069a0c4`), and Ryuker is already off through `telepipeAllowed`. The power material gives x5 in Challenge (`add_power_material`): not applied (nothing in the mode gives materials). Enemy and box drops, EXP share and the item table are the server's (newserv's `*Challenge` drop mode options, EXP share off).

**Game creation:** `Game.create` with `challenge` sends `challenge_mode` = 1 and difficulty 0 (the party menu does the same) and refuses Episode 4 as newserv does; `net/game.ts` got `sendChallengeConfig` (DF), `sendChallengeRecords` (ED 08), `sendBroadcastSubcommand`, `sendServerSubcommand`.

**ASSUMED:** the initial value of `g_ChallengeStageFinalData` is -1 (the "not set" the checks test); `g_ChallengeObjectInitialized` becomes 1 when the retry menu is created; `clear_quest_registers` zeroes all 256 registers (the exe memsets 0x400 bytes); the result panel's lifetime (12 s here), the dead-player window's layout, the "Rank" letter names B / A / S, the Title line when no title changed; the grave's heading is 0 and no ground test is made for the drop points; the last chat message is not stored in the grave; the retry list is shown on Pioneer 2 (floor 0) for the leader and a waiting window for the others; the S-rank weapon choices are listed by type number and the name comes from a `prompt`; `6x7C` is sent when the runner is built (the exe sends it when the Challenge object is made on entering the game); the template item ids follow the client's counter; `inventory.items[13].extension_data2 = 1` of newserv's overlay is not applied.

**Left:** the grave's 3D model and its floating text (party name, number of failures, "Defeated by", message, date), the Pioneer 2 Challenge counter's stage list / Records window and the party-name packet (8A), the real S-rank name-entry and weapon-choice windows, the dead-player ghost flow (no return to Pioneer 2 on death, the extra states of the dead player), the x5 material rule, the 450-tick "Area" splash (`ChallengeObjectUIPanel` 0x6c) and the sounds (`0xb7` progress beep), and everything is untested in Chrome.

**Checks:** `node tests/cmode.test.ts` (the encodings, packet sizes, the records' offsets, the 48 templates against the exe's counts / levels, S-rank names, every threshold / rank / prize / retry / grave rule, the overlay against the level table, c88101 and the other 13 Challenge quests through the VM with a recording environment), `node tests/questaudit.ts 3000 challenge`, `tests/quests.test.ts`, `tests/questflow.test.ts`, `tests/level.test.ts`, client `tsc --noEmit` (only the two missing @capacitor modules).
## 2026-10-21: Gibbon enrage Shifta / Deband applied

The Gibbon's enrage (Deband at frame 30, Shifta at 40, on itself) was only exposed as flags because no enemy stat buffs existed; `EntityBuffs` now does. `GibbonAi.casts` queues each cast with the stats row's level; `render/combat.ts` drains it into `buffEnemy` (power = `supportPower(level)`, not reported over the network). `buffEnemy` also reads the attack slot for Shifta now (it only did for Jellen). ASSUMED: power = the stats row's level. Still unread: vtable +0x19c / +0x1a0, the Mericarol flag 0x440 & 0x400.

**Checks:** `node tests/enemyfsmep2b.test.ts` (new: casts queued in order), `combat`, `enemyfsmep2`, `enemystatus`, `buffs`; client `tsc --noEmit` (only the two @capacitor modules). Not run in Chrome.
## 2026-10-21: Gibbon vtable +0x19c / +0x1a0 read: nothing to port

The "unread" slots in the Gibbon entry were mislabelled: the vtable is at 0x00b05740 (ctor 0x00564aa6), and 0x00568b70 / 0x00568bb4 are slots **+0x1ac / +0x1b0**. The real +0x19c / +0x1a0 are the base Enemy's 0x00520638 / 0x005218d4, shared by every enemy (13 / 158 call sites over the exe):
- +0x19c (0x00520638, `ret 4`, a position pointer argument): looks up the floor node under that position (vtable +0x1a4 = 0x00520b44, which searches the node list at +0x128) and, when found, caches its +0xc / +0x10 / +0x14 into +0x250..+0x258; copies the current position (+0x38 / +0x3c / +0x40) into the previous one (+0x44 / +0x48 / +0x4c); stores the new x / z (+0x38 / +0x40) from the argument (y is not written); clears +0x38c.
- +0x1a0 (0x005218d4, no argument): the same node cache from the current position (vtable +0x40 = 0x007712e0), the current-to-previous copy and the +0x38c clear, but no new position.
+0x38c looks like a timer (set to 0x96 in several places, about 480 references); what it times was not traced. These are generic movement bookkeeping, not Gibbon AI; the port keeps no previous-position / node cache / +0x38c timer.

+0x1ac (0x00568b70) and +0x1b0 (0x00568bb4) both start with 0x0051f814, which tests the entity against the global at 0x00a727a4. That global is set non-zero only at 0x004f88c7, inside 0x004f84b8, the mode-1 handler of the exe's **set editor** object (vtable 0x00afe1d8, ctor 0x004fb61c; strings "GROUP ENEMY SETEDITOR", "TOTAL BLOCK : %03d"); every other write stores 0. All 37 / 29 call sites of +0x1ac / +0x1b0 go through the same gate. +0x1ac re-runs the set-params routine (0x00564e98), moves the Gibbon between groups if its group index (+0x46c) changed (leave 0x00564720 / join 0x00564fa0) and resets the home point from the current position (0x00564fb4: +0x300 / +0x308 and +0x74 / +0x7c = x / z, +0x304 = y + 10); +0x1b0 prints "GROUP:%2d" and the other state fields as debug text. Both only run for the entity the set editor picked: a developer tool, not ported. ASSUMED: the set editor is never built in a retail session (its ctor is referenced only from a data table at 0x009b9214 with no code reference found; not proven).

## 2026-10-21: Mericarol flag 0x440 & 0x400: rare roll, never read for the Mericarol

The Mericarol ctor clears +0x440 (0x572c9c) and then rolls `call 0x007751b0` at 0x00572ca6 (a uniform float in [0, 1) from the 55-entry subtractive RNG 0x00763498) against the float at 0x00a73f24 (`fcomp`, `ja 0x572cca` skips the `or`). That float is 0 in the file and set to 0.002 (`0x3b03126f`) by the static initialiser at 0x00573618. So the `or 0x400` runs when roll <= 0.002: about 1 Mericarol in 500 gets the bit. The bit 0x10 and 0x08 readers of the same field (0x573060 / 0x5732c6 / 0x573390) are the Mericarol's own state flags, already ported.

Readers of 0x400: the only test of bit 0x400 after a +0x440 load in the whole .text is `test esi, 0x400` at 0x005593b4, inside 0x00559334 (frame 0x15c). (An earlier search used spaces where objdump prints a tab and wrongly found no caller.) 0x00559334 is called once, at 0x0055a9b3, by the state dispatcher 0x0055a95c (`jmp [4*eax+0x009252ac]` on states 0..9), which is vtable slot +0x164 (the AI state handler) of the class with vtable 0x00b04cc0 (ctor path 0x005585ee). The Mericarol's vtable is 0x00b06320, whose slot +0x164 is its own dispatcher 0x005710b8, so the reader never runs on a Mericarol: +0x440 is a per-class flag field, and the 0xb04cc0 class sets its own bits. Which enemy owns vtable 0x00b04cc0 was not identified.

Result: the Mericarol's 0x400 bit is set and never read, so it changes nothing; the port keeps no 0x400 bit. Caveat: the reader search looked 30 instructions back from each 0x400 test; a copy through a stack slot would not be caught.

## 2026-10-21: player movement: slowed / flag tie traced (exe)

The speed multipliers are in `legSpeed` (`render/playermove.ts`, 0.5 slowed, 0.75 for a flag). The exe function is 0x006978a0 (thiscall, `this` = player + 0x6b8, stack args: the player and the base float, `ret 8`):
- x *= 0.5 (`0x0093ca20`) when 0x00690344(player) is non-zero: that returns `[player+0x30] & 8`, but only when 0x0068a3fc(player) passes, i.e. `[player+0x3ec]` is NOT one of {0, 15, 18, 45} (table 0x0097f1c8, scanned by 0x00807d8c). So the 0.5 gate is bit 8 of +0x30 gated by a state field, not a plain slow flag.
- else x *= 0.75 (`0x0093ca24`) when bit 0x08 of `[this+0xc]` = `[player+0x6c4]` is set. 0x0069ba18 writes that field: 0, then 8 when `[player+0x30] & 0x00100000`. Which state that +0x30 bit is was not traced; calling it `guard` is NOT supported.
- the result goes to `[player+0x6c0]` (read by the walk / run code at 0x006a1a45 and 0x006a2089); then, when `[player+0x68c] & 1`, it is multiplied again by the float `[player+0x690]` and returned. The port has no such extra multiplier.

Callers (direct calls; an earlier search used spaces where objdump prints a tab and wrongly found none): 0x0069788c (base = global float `[0x00a94300]`) at 0x00697896 and 0x00697914 at 0x00697921; 0x0069788c is called from 0x00697881 and from 0x0069bad5 (inside 0x0069babc, reached from the poll 0x0069b93c -> 0x0069ba18), 0x00697914 from the walk / run update at 0x006a1a1d (base `[0x00a94324]`).

Port: the `slowed ? 0.5 : guard ? 0.75` order matches, but both conditions are named on guesses and the `[player+0x690]` factor is missing. Nothing sets `PlayerMover.slowed` / `guard` and the lobby has no status effects, so this changes nothing yet. Open: the meaning of `+0x30` bits 0x08 / 0x00100000, `+0x3ec`, and `+0x68c` / `+0x690`.

## 2026-10-21: Create a PARTY: wrong difficulty names (unitxt group 11 shift), first Playwright test

**Bug** (user: the party creation had no Normal and went back to the lobby). The Difficulty list showed "Hard / Very Hard / Ultimate / View the board": the classic client reads `unitxt_e.prs` from Ephinea's `data.gsl`, whose group 11 lacks entry 0xed ("Send to GM"), so every group 11 entry from 0xed on sits one index lower than PsoBB.exe asks for (0x139 "Challenge" instead of Play Mode "Normal", 0x13d "Hard" instead of Difficulty "Normal", 0x135 "Episode I" instead of the Meseta text). The loose `unitxt_j.prs` of the client data and newserv's bb-v4 `unitxt_e.prs` line up with the exe. Groups 0x00..0xec are the same in both files; groups 1 / 3 (items) differ a lot, so the whole file is not swapped.

**Fix:** `charcreate_text.ts` `menuTextAligned` (group 11 0x139 and 0x13d are the same non-empty word, as the exe's Play Mode list 0x00734578 and Difficulty list 0x00734628 need) and `withAlignedMenuText` (group 11 from the first aligned alternative); `classic/main.ts` loads unitxt once (`loadUnitxt`) and takes group 11 from `unitxt_j.prs` when the first file's is misaligned. This also fixes the other group 11 texts from 0xed on (Meseta, episode / mode names, area map help, team points).

**Level and difficulty** (exe, read by a subagent and checked here): the window does NOT filter difficulties by level. The difficulty list 0x00734628 always adds 0x13d / 0x13e / 0x13f (Normal, Hard, Very Hard) and adds 0x140 (Ultimate) when the window's mode `[this+0x20]` is 1, 2 or 3; the three constructions at 0x0079a777 / 0x0079a7f6 / 0x0079a858 pass 2, 3 and 1 (Episode 2, 4, 1), so Ultimate is always there. No level is read in the window's code. The level rule is the server's: newserv answered "You must be level 20 or above to play this difficulty." for Hard with a new character. Play Mode Challenge greys the Difficulty row (0x00734608), as `CreatePartyWindow.selectable` already did. The return to the lobby after creating a party is by design: `partyHost.back` leaves the game because the classic client has no field scene yet.

**Playwright:** `client/playwright.config.ts` and `client/e2e/party-create.spec.ts` (README in `client/e2e/`): log in, stand on the counter, Organize PARTY -> Create a PARTY -> EPISODE 1, check the Play Mode and Difficulty texts at the exe's indices, register a Normal party, expect the "entered game ... back to the lobby" log. Passes against local newserv. `npm ci` was also needed in `client/` (the @capacitor packages were declared but not installed, which broke `classic.html` under Vite).

**Checks:** `npx playwright test` (1 passed), `tests/gamelist.test.ts` (new: group 11 alignment), `items`, `options`, `teammenu`, `fieldhud`, `warpmenu`, client `tsc --noEmit` clean.

## 2026-10-21: Gibbles concealed while hidden, Epsilon tech immunity applied

**What changed:** a hidden Gibbles is now concealed like the other hidden enemies. `GibblesAi` has an `untargetable` getter (state 0 / 1, and the held drop-in: `dormant` or `arrive` below `arriveHold`), and its frame sets `out.hidden` from that same getter. `render/combat.ts` `concealed()` lists `GibblesAi`, so it is off the radar, lock-on, technique targeting and confused-enemy targeting while hidden. Gibbles stays invulnerable in those states as before (the existing `invulnerable` getter: its lie-in-wait flags are 0x6040000, which include the 0x4000000 invulnerable flag). The exe's hide flag is the same one Mericarol / Gibbon use, so no change to `invulnerable`.

Epsilon's element immunity is applied. `techHitEnemy` in `render/combat.ts` maps the technique's element to its technique group (fire 1, ice 2, lightning 3, grants 4, megid 5) and, while Epsilon is not invulnerable, `EpsilonAi.immuneToTech(group)` blocks the hit: no damage, no status, and a log line. Invulnerable Epsilon keeps the existing "0" path in `applyEnemyHit`. The exe's `EpsigardProcessTechHit_0055aa5c` is only described as "blocks"; no number or effect is mirrored, so none is shown. The comment in `combat/enemyfsmep2d.ts` no longer says the owner does not apply it.

**Files:** `client/src/combat/enemyfsmep2a.ts` (`GibblesAi.untargetable`, `out.hidden`), `client/src/render/combat.ts` (`concealed()`, `TECH_GROUP_OF_ELEMENT`, the immunity check in `techHitEnemy`), `client/src/combat/enemyfsmep2d.ts` (comment), `tests/enemyfsmep2a.test.ts` (Gibbles `untargetable` in the lie-in-wait state and exactly matching `hidden` across the 400-frame drop-in), `docs/HANDOFF.md` (to-do 2 list). `immuneToTech` was already checked in `tests/enemyfsmep2d.test.ts`, so that file is unchanged.

**Checks:** `tests/enemyfsmep2a.test.ts`, `tests/enemyfsmep2d.test.ts`, `tests/combat.test.ts` (needs the newserv data under `vendor/`), client `tsc --noEmit` clean.

Not run in Chrome.

## 2026-10-21: Gibbles hand hit boxes

Exe (PsoBB.exe, Ephinea 1.25.13): two collision_box rows, 0x2c bytes each, radius at +0xc, flags 0x8003. 0x009be10c has radius 15.0 (bytes at 0x009be118 = 0x41700000), 0x009be138 radius 30.0 (0x009be144 = 0x41f00000). The Gibbles ctor 0x00563200 installs them with `call 0x007b9a88` (count 1) on two objects it allocates (0xac bytes): 0x009be10c on +0x3bc (0x005634b5), 0x009be138 on +0x3c0 (0x00563510).

What they are: attack boxes, read only by the combo code. The hand loop at 0x00561534..0x00561737 (the code just before the state 4 handler 0x00561798; ASSUMED the same state) runs when the frame counter is a multiple of 5 (0x00561553, the 0x66666667 reciprocal). It tests the +0x3bc box's flag 0x80000 (set by the overlap pass 0x007b6894, which also places the box), then each player with vtable +0x50; a player that passes gets the vtable +0x5c / +0x60 / +0x68 calls and Gibbles' flags 0x600 and the word +0x388 = 0x10e. A hit counts only above 0x00925ab0 (0.0, the same literal as the rage swing's tech rule). The +0x3c0 box (radius 30) is never read outside the destructor (0x00560134..0x0056018e). Its use is UNCLEAR.

Ported: nothing, so behaviour is unchanged. The hand bones are unknown to the port, so the box centres cannot be placed. The port's `hands()` keeps the body radius plus the attack reach, and the slams keep the half-reach centre. Both are ASSUMED as before. The comment block in `combat/enemyfsmep2a.ts` (above `GIBBLES`) now carries the addresses and the UNCLEAR points. HANDOFF item 2 drops "hand boxes".

ASSUMED / UNCLEAR: the box centres (bone positions); which of the vtable +0x5c / +0x60 / +0x68 calls damages; what the 52 box is for; the hand-to-box mapping (+0x3bc is not tied to a named hand).

Checks: `tests/enemyfsmep2a.test.ts`, `tests/combat.test.ts`, client `tsc --noEmit`. Not run in Chrome.

## 2026-10-21: player leg speed: the 0.5 / 0.75 conditions identified

Follow-up of "player movement: slowed / flag tie traced" (a Haiku subagent traced it, the decisive writes and constants were checked here). In 0x006978a0:
- **0.5 = slowed outside the hubs.** Bit 0x08 of player+0x30 is the slow status: `slow_entity` (0x00778b10) writes `(flags & ~0x3c) | 8` at 0x00778bc6 (the slot value 0x11 = `STATUS.slow`, 0xd2 frames). 0x00690344 applies it only when 0x0068a3fc passes, i.e. the map id at player+0x3ec is not in {0, 15, 18, 45} (table 0x0097f1c8: Pioneer 2 Ep1, lobby, Pioneer 2 Ep2, Pioneer 2 Ep4). So the slow does not slow you in the hubs.
- **0.75 = guard stance.** Bit 0x00100000 of player+0x30 (the Ghidra enum's `in_guard_stance`; newserv calls the same flag "near enemy"), copied to player+0x6c4 bit 0x08 by 0x0069ba18. 0x0052ac5c sets / clears it by the distance to the player's target (0x00770738) with hysteresis: hunters enter within 50 (d^2 2500, 0x00922334) and leave beyond 100 (10000, 0x00922330); other classes 100 / 150 (0x0092233c / 0x00922338); no target clears it (0x0052ad36), a target id >= 0x1000 sets it (0x0052ad28). 0x006a29f4 also sets it (with a velocity reset) at the end of the light-hit and evade states, and the 6x3E / 6x3F / 6x40 handlers copy it from the packet for remote players (0x00698cb6 / 0x00698db5).
- **[player+0x690]**: 0.4 by default (the player ctor), part of the scale block the quest opcode `set_shrink_size` writes; the gate player+0x68c bit 0 is only ever written 0 in player code, so the factor is inert in normal play.

So the port's names `slowed` / `guard` are right after all (the earlier entry doubted `guard`); the hub exemption of the slow and the stance's proximity rule are not ported (`PlayerMover` is only driven in the lobby, where neither applies). `render/playermove.ts` header updated. Unverified details: the 0x006898cc proximity writer (2500 / 3600) and which handlers call 0x006a29f4 (taken from the dump's names).

## 2026-10-21: Gee pack states 6 / 10

**What changed:** nothing ported. The two states are unreachable for a Gee the factory makes, so `combat/enemyfsmep2a.ts` only gets comments: the note in the Gee section (replacing "not reproduced" with the entry paths) and one above `GeeState`. `docs/HANDOFF.md` to-do item 2 no longer lists them.

**The handlers:** dispatcher 0x0055d11c (`cmp eax, 0x12; ja`, `jmp [4*eax + 0x925500]`). Table entry 6 leads to `call 0x0055ebb8` (objdump: `55d1c2: call 0x55ebb8`), entry 10 to `call 0x0055d8d4` (`55d18f: call 0x55d8d4`). State 6 (0x0055ebb8): enter (arg 4) pushes 6, clears enemy+0xb8, clears 0x00400000 of enemy+0x3d0, calls the hit-box vtable +0x188, sets 0x01000000 of enemy+0x30 and enemy+0x43c = 0. Frame (arg 0): FindEnemyTarget 200 (0x00520ea0) and a sub-state machine (enemy+0x43c) that waits on the other pack members (flags 0x4 / 0x80000 / 0x200 of enemy+0x3d0). Transitions (arg 3) are left to vtable +0x1b8. State 10 (0x0055d8d4): enter pushes 10 and clears 0x00400000; frame turns toward the velocity and quantises the altitude, then the hover (`push 0x3f4ccccd`, the 0x00520adc hit check); transition: pushes 6 when vtable +0x1b8 returns 0 and the float at enemy+0x3b4 is below the constant at 0x00925730 (value not read). Both are the pack roles of an entity-group code path that a single Gee never takes (below). Not decoded further: UNCLEAR.

**What enters them (all the `push 6` / `push 10` sites inside the Gee code range 0x0055c974 .. 0x0055fb00):**
- `55c71f: push 6` in state 4's transition (0x0055c5f4, arg 3; the path at 0x0055c6e5): after the 0x00000002 flag of enemy+0x3d0 is cleared, `cmp dword [ebp+0x3cc], 1; je 55c71f` pushes 6, otherwise `push 5` (climb). So 6 needs enemy+0x3cc == 1.
- `55e9ff: push 10` in state 7's exit (0x0055e9e1): `test [eax+0x3d0], 0x00100000; je 55e9fd` pushes 10 when the flag is clear, `push 9` (strafe) when it is set.
- `55d95b: push 6` in state 10's transition (after `call [edx+0x1b8]` returns 0 and the float check at enemy+0x3b4 above).
No other Gee-range site pushes 6 or 10. The other callers of the setter 0x0051f62c with 6 / 10 belong to other families (their own objects).

**Why they are unreachable (the deciding values):**
1. enemy+0x3cc (the role the port calls the pack role) is written in the Gee range only at 0x0055ca28 (`mov dword [ecx+0x3cc], 0`, in the factory 0x0055c974, unconditionally). The factory takes no subtype argument; the other stores to 0x3cc in `.text` are in other families' constructors (e.g. 0x004367cd: 0x1e / 3 / 5 / 10 / 30, in an entity that is not a Gee). The base code at 0x0051f62c / 0x0051f664 / 0x00520ea0 / 0x00521410 / 0x005213ec does not write it.
2. So the alert transition never sees 1: 0x0055c71f is dead for a Gee. The Gee always climbs (state 5) after the alert.
3. The spawn sets the strafe flag: `55fa71: mov eax,[edi+0x3cc]; test; jne 55fa8e`, and for a role of 0 `55fa7b..55fa86: or eax, 0x00100000` on enemy+0x3d0. Nothing the Gee runs clears 0x00100000 (the masks `and ... 0xffefffff` in `.text` are in other families' code, e.g. 0x0044a526 clears enemy+0x390, not 0x3d0; the helpers the Gee calls, 0x0053e538 (sets 0x2), 0x0053fa2c (sets 0x8), 0x00520ea0 / 0x00521410 / 0x005213ec, do not clear it). So at the shoot's exit the test at `55e9e7` finds the flag set, takes 9, and 10 never runs. Its exit to 6 (`55d959`) is then dead as well.

So a Gee made by the factory cannot enter 6 or 10, whatever the set file says: the set parameters feed 0x100 (param1), 0x2000000 / 0x4000000 (param2), the speeds and the step, none of them 0x3cc or 0x100000. The port's `subtype` (`params[5]`, render/combat.ts:785) is not passed to `GeeAi` (render/combat.ts:852) and nothing in the Gee code reads it; the phrase "factory's subtype 0" in the 2026-10-20 entry is therefore wrong: the field is enemy+0x3cc, and it is always 0. The port's `ChooseAttack` also reads 0x3cc in the exe (0x0055c4cc: non-zero means shoot only, no melee): with 0 it is the shoot, shoot, melee pattern the port has.

**Checks:** `/usr/bin/objdump -d -M intel` over the whole `.text` (grep of `[reg+0x3cc]` stores, `0x100000` tests / sets, `0xffefffff` / `0xfeffffff` masks, and `call 0x51f62c` with the pushed value); the jump table read with `tools/exedata.py read 0x00925500 h`. The Ghidra dump is not on this machine (`tools/refsrc.sh` has no REFSRC checkout), so every name here is from the exe. No code change in the behaviour: `tests/enemyfsmep2a.test.ts` is unchanged and must still pass.

**ASSUMED:** (a) "Nothing the Gee runs writes enemy+0x3cc / 0x3d0" is checked over the functions the Gee calls and the whole `.text` store list by pattern, not by dataflow through the owner: the owner (`render/combat.ts`) and the packet code could in principle write the object's memory in another way, not checked; (b) a generic owner path that calls the Gee's setter with 6 or 10 is not visible from the Gee range (the owner calls the Gee through its vtable, as in the port); (c) the spawn's state 1 / 2 choice by 0x2000000 is taken from the port's reading (0x0055fa94), not from the set file. UNCLEAR: the exact states 6 / 10 frame details (the sub-state numbers 0..3 and the hover constants), which are not ported and so not tested.

**Left:** the states 6 / 10 themselves (if a later pass finds a writer of enemy+0x3cc or a clear of 0x00100000 for a Gee, port them from 0x0055ebb8 / 0x0055d8d4 with these notes as the start). Not run in Chrome.

# TODO: what is left for a 100% faithful client

Compiled 2026-10-20 from ROADMAP.md, HANDOFF.md and the agents' "left" lists. `[x]` means
done and tested; nothing here counts as final until it has been seen in Chrome next to the
original client. "100%" is a direction, not a date: the exe has thousands of functions and
only part of them has matching C (psobb-client-source).

## A. Verification debt (built, never seen running in a browser)
- [ ] Challenge mode in a real game (all stages) (partial 2026-10-29: `e2e/challenge-mode.spec.ts` passes: a Challenge party with a second player (B joins from the list), the clerk's challenge dialog, Episode 1 and Stage1 picked, Yes, the quest starts and loads and the leader stands on the stage floor; 2026-10-30: `CM_STAGE=n` picks the stage; a fresh character is offered Stage1 only (newserv c88102.json AvailableIf CC_Ep1_1 = Stage1 cleared), so stages 2+ need an account with a stored clear; Stage1 Area counter and running timer HUD asserted; not run for stages 2+, the stage's play, clear, rewards or the ghost / records flow)
- [ ] Battle mode in a real game (partial 2026-10-29: client/e2e/battle-game.spec.ts passes, two players: start, HUD timer, traps, death and respawn, melee PvP hit (A's 6x46 names B, B's HP drops, A is credited once), time up; 2026-10-30: the results window is drawn (SCORE header and "1st name" / "2nd name" rows, PrintResults_006af27c, no points in the exe's list; its frame position and hold time are ASSUMED; the e2e checks its state on both clients), sonar is covered (step 4b: the use, life 990, pings only above life 90, end; the e2e passes), the 6x8F sender layout and the 0x006918fc receiver body are not verified against the exe; see DEVLOG 2026-10-29 and 2026-10-30)
- [ ] Technique visuals (Foie, Barta, Zonde, Gizonde, Razonde, Grants, Megid, supports, specials) (partial 2026-10-29: `e2e/techvisuals.spec.ts` casts 17 techniques; passes 3 runs in a row with a harness shield before each cast (HP top-up and `PlayerDamage.invuln`, the exe's invulnerability, plus the facing and cast in one evaluate); the 2026-10-26 flake (player busy / immobile under the wave, Gibarta peaking at 0) is not seen in those 3 runs; the shield is a test harness, not player behaviour); left: the exe look of the effects (Razonde's bolts cover the screen at close range), Reverser and Ryuker, the weapon specials)
- [ ] Episode 2 enemy FSMs on Seabed, Mines, Tower (partial 2026-10-26: smoke spec passes on floors 1..17; watch passes on floor 10 but only 2 of 33 groups ran; Seabed Lower and Mines open; real motion lengths for groups a / d in the tests, Gi Gue barrier 5 frames; lobby ping on a closed socket open)
- [x] Ship / block change and team menus at the counter (e2e: `client/e2e/lobby-counter-menus.spec.ts`; Leave Team as a non-master member is still open, see DEVLOG 2026-10-26)
- [ ] Boss fixes (De Rol Le, Vol Opt, Dragon, Belra) (partial 2026-10-29: `e2e/boss-fights.spec.ts` passes (1 passed, 6.6 min, 0 failed requests, 0 page errors): Dragon 9 changes / 4 hits, De Rol Le 8 changes / 1 hit (body stays 6000, segments take the damage), Vol Opt 1 change / 4 hits from the nearest hittable part, Dark Belra 3 changes / 3 hits after its wave trigger; Dark Belra was hidden because its wave-gated models stay hidden and the brain does not tick, and the spec now steps into the floor's event triggers; kill and exit not checked; see DEVLOG 2026-10-29)
- [x] Movement: two-client check, slowed / guard animation tie (2026-10-30: `e2e/two-client-move.spec.ts` passes, 1 passed (2.3m); slowed step 0.6 vs 1.2 plain on both sides, guard step 0.9 vs 1.2 on both sides; open: A's local speed reads 0 in the guard-off window, not explained; see DEVLOG 2026-10-30)
- [ ] Quest editor: open a real quest, drag, Script tab, "Test in game", publish to a deployed host (partial 2026-10-26: local run in client/e2e/questeditor-real.spec.ts and admin-quests.spec.ts; Test in game reaches the panel and publishes a test quest, but entering a game with it is not seen (port 12000 is the shared newserv, and $quest needs AllowStartFromChatCommand); deployed host not done)
- [ ] Admin: Quests tab live (open in editor, publish), login on production (partial 2026-10-26: the whole Quests loop passes locally in client/e2e/admin-quests.spec.ts; production login not done, no production access here)
- [ ] Phones: soft keyboard, rotation lock, adaptive resolution (real iOS / Android; checked by the owner on real devices, not emulated)

## B. Screens and menus
- [ ] Character creation and Input UserID: SSIM needs captures of the original (title 0.77 and select character 0.92 are measured)
- [ ] Quest loading: particle wipes and middle particle; lobby / floor loading screens
- [ ] Classic HUD: balloon overlap and docking, sub-menu transitions, Item List rows, counter leaf actions, ship-select camera
- [ ] Field HUD: Status window, Keyboard / Pad config, MAG panel and Photon Blast window, equipment detail pages, sort (6xC4), palette save (07ED), item list scroll bar, TP use, window shine
- [ ] Minimap: switch icons, door / box / boss icons, battle team colours, Challenge "Area n" title
- [ ] Team: Master Transfer, Buying Privileges, Flag Records, invitations, banned names, team chat line

## C. World and objects
- [ ] Lobby: seasonal decoration model, real spawn points and collision (`*c.rel`)
- [ ] Round hitboxes of field objects other than doors
- [ ] Shape motions: TOKurage, Episode 4 plants, slime body
- [ ] Trap vision (cloaked traps)
- [ ] NPCs: talk-mode camera, TObjNpcEnemy, NPC Rappy / Hildebear / Dark Bringer, Episode 4 quest NPC
- [ ] Episode 2 enemies: wall / ground rays, Gee states, Gibbles sink, Epsilon visuals

## D. Player and character
- [ ] Hair / cap texture lists for hat classes; non-default android heads
- [ ] `proportion_x/y` scaling; per-weapon field motions; emotes, sit
- [ ] Damage: dead prompt and return to Pioneer 2, dead camera, critical-hit effect, remote knockback, shield block routine, hit point heights
- [ ] Items: pickup particle, SE attenuation, drop line-of-sight, pickup lock, tekker window, bank windows, partial stacks

## E. Combat
- [ ] Remote Resta heal; confusion steering (Telepipe ring 0xB0, loop SE 0xA0 and the no-light finding closed 2026-10-30, e2e/telepipe-fx.spec.ts)
- [ ] Technique leftovers: cast light, Resta / Anti particles, wall impacts, special effects
- [ ] Photon blasts (joined / donated), blast objects, weapons with their own specials, per-part hit boxes
- [ ] Enemy specials: Pan Arms split / merge, Pofuilly split, Grass Assassin emerge, Nano Dragon fly-in, Dubwitch link
- [ ] 02R technique projectiles

## F. Bosses
- [ ] De Rol Le: segments as hit targets, particles
- [ ] Vol Opt: real models and lid drawing, ceiling fragments, Ultimate objects, camera, ending warps
- [ ] Dragon: intro camera and particles, model node reads, flame / fireball particles, ground dust, Ultimate Sinow state 0x10
- [ ] Saint-Milion: brain (agent running)
- [ ] Dark Falz: cutscene objects and camera, Ultimate scenes, technique object flight (agent running)

## G. Quests and modes
- [ ] NPC players' follow / attack AI (6x69 1-3)
- [ ] Text colour palette; random-enemy `.dat` sections (types 4 / 5), `evt2`
- [ ] Battle: PvP hits from our side (partial 2026-10-29: our melee strike on a remote player names it in 6x46 and the 6x8F credit goes to one PB path, `pvpCreditAmount` in `combat/pvp.ts`, e2e passes; ASSUMED: the 6x8F attacker gate, the sender's field layout, and the receiver body at 0x006918fc are not verified in the exe; 6x2F not covered), traps and sonar (partial 2026-10-30: the sonar use, its 990-frame life and pings are in `client/e2e/battle-game.spec.ts` step 4b and pass; the sonar effect beyond the ping is not ported), respawn teleport (2026-10-30: wired, `quest/battlerun.ts` respawnTeleport uses `respawnCandidates` + `pickRespawn`; the distance rule is verified against 0x00695444, see DEVLOG; 2026-10-30 later: the no-candidate fallback is ported, 6x24 at the own angle and position via `respawnTarget`; the +0x32c == 2 gate is modelled open), win particles, `ba_initial_floor` (traps are wired in `quest/battlerun.ts` (placement, 6x80, blast on the local player; no trap model drawn, the palette icon not drawn); the respawn pick is in `quest/battletraps.ts`, wired since 2026-10-30; the sonar use is started by `BattleRun.useSonar`)
- [ ] Challenge: grave model and text, stage-select counter, records window, S-rank name entry and prize, material x5 / Scape Doll / dead-player rules, in-stage sounds, ghost flow
- [ ] Download quests (A6 / A7)

## H. Tools (not in the exe)
- [ ] Quest editor: multi-floor overview, named parameter forms, random waves, rotation gizmo, copy / paste, script positions in 3D, delete a published quest, edit `.json`
- [ ] Admin: roles, TOTP, IP bans, drop tables, Ep3 tournaments, quest enable / disable; native-speaker review of the pt-BR and es text
- [ ] Docker build never run on the new quest-publish volume

## Cannot be automated
Captures of the original client (B), real phones (A), native translation review (H).

# TODO: what is left for a 100% faithful client

Compiled 2026-10-20 from ROADMAP.md, HANDOFF.md and the agents' "left" lists. `[x]` means
done and tested; nothing here counts as final until it has been seen in Chrome next to the
original client. "100%" is a direction, not a date: the exe has thousands of functions and
only part of them has matching C (psobb-client-source).

## A. Verification debt (built, never seen running in a browser)
- [ ] Challenge mode in a real game (all stages)
- [ ] Battle mode in a real game
- [ ] Technique visuals (Foie, Barta, Zonde, Gizonde, Razonde, Grants, Megid, supports, specials)
- [ ] Episode 2 enemy FSMs on Seabed, Mines, Tower (animation lengths for groups a / d are stand-ins)
- [ ] Ship / block change and team menus at the counter
- [ ] Boss fixes (De Rol Le, Vol Opt, Dragon, Belra)
- [ ] Movement: two-client check, slowed / guard animation tie
- [ ] Quest editor: open a real quest, drag, Script tab, "Test in game", publish to a deployed host
- [ ] Admin: Quests tab live (open in editor, publish), login on production
- [ ] Phones: soft keyboard, rotation lock, adaptive resolution (real iOS / Android)

## B. Screens and menus
- [ ] Character creation and Input UserID: SSIM needs captures of the original (title 0.77 and select character 0.92 are measured)
- [ ] Quest loading: particle wipes and middle particle; lobby / floor loading screens
- [ ] Classic HUD: balloon overlap and docking, sub-menu transitions, Item List rows, counter leaf actions, ship-select camera
- [ ] Field HUD: Status window, Keyboard / Pad config, MAG panel and Photon Blast window, equipment detail pages, sort (6xC4), palette save (07ED), item list scroll bar, TP use, window shine
- [ ] Minimap: switch icons, door / box / boss icons, battle team colours, Challenge "Area n" title
- [ ] Team: Master Transfer, Buying Privileges, Flag Records, invitations, banned names, team chat line
- [ ] Other Pioneer 2 counters (medical center, giveaway)

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
- [ ] Damage: freeze ice block on players, dead prompt and return to Pioneer 2, dead camera, critical-hit effect, remote knockback, shield block routine, hit point heights
- [ ] Items: pickup particle, SE attenuation, drop line-of-sight, pickup lock, tekker window, bank windows, partial stacks

## E. Combat
- [ ] Telepipe ring particle, light, loop sound; remote Resta heal; confusion steering; freeze button mash
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
- [ ] Battle: PvP hits (6x8F), traps and sonar, respawn teleport, win particles, `ba_initial_floor` (traps and the respawn pick are a tested module in `quest/battletraps.ts`, not wired; sonar and the PvP hit path are not started)
- [ ] Challenge: grave model and text, stage-select counter, records window, S-rank name entry and prize, material x5 / Scape Doll / dead-player rules, in-stage sounds, ghost flow
- [ ] Download quests (A6 / A7)

## H. Tools (not in the exe)
- [ ] Quest editor: multi-floor overview, named parameter forms, random waves, rotation gizmo, copy / paste, script positions in 3D, delete a published quest, edit `.json`
- [ ] Admin: roles, TOTP, IP bans, drop tables, Ep3 tournaments, quest enable / disable; native-speaker review of the pt-BR and es text
- [ ] Docker build never run on the new quest-publish volume

## Cannot be automated
Captures of the original client (B), real phones (A), native translation review (H).

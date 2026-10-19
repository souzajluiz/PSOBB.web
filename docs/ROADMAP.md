# Roadmap

## Next up (queued 2026-10-18)
Work stopped here on request; pick these up first, in order. Each was planned
as its own commit with tests, a DEVLOG entry and a Chrome check.
1. Pan Arms / Pofuilly splits, the Vol Opt seal door's .njs shape motion,
   the rest of the Episode 2 enemies' FSMs (Merillia / Meriltas and Dolmolm /
   Dolmdarl are done; Gee, Ul / Zol Gibbon, Mericarol family, Gibbles, Gi Gue,
   Sinow Berill / Spigell, Sinow Zoa / Zele, Deldepth, Delbiter, Morfos,
   Recobox / Recon, Epsilon / Epsigard left), the Episode 1 boss fights (where
   they move their children), the title / login screens, water distortion.

## Web platform (browser conveniences, not in PsoBB.exe)
- [x] Fullscreen (Alt+Enter, CSS fallback on iPhone), mute (Alt+M, stored; muted by default under the dev server) and the touch pad: stick + palette / menu keys fed as key events (`ui/webcontrols.ts`, `tests/mobilecontrols.test.ts`)
- [ ] Touch: camera drag with a second finger, analog walk / run if the movement code gets an analog input

## Phase 1: foundation ✅
- [x] Build newserv on macOS (Apple Silicon)
- [x] BB cipher in TS, tested against newserv
- [x] PRS, GSL, AFS in TS, tested against newserv
- [x] WebSocket ↔ TCP bridge with port allowlist
- [x] Live BB login through the bridge

## Phase 2: browser client 🚧
- [x] Vite + TypeScript project
- [x] Login screen in Chrome via the bridge
- [x] Follow the `19` redirect and list character slots (`E3` → `E4`/`E5`)
- [x] Character creation (`E5` on the data connection → `E4` approve)
- [x] Character select → main menu (`07`/`10`) → lobby (`93` phase 4)
- [ ] Title, login and character select screens identical to the original client
- [x] `data/` folder picker (File System Access API) + dev-server source

## Phase 3: map viewer
- [x] REL parser (footer + root pointer)
- [x] XJ parser (BB models: vertex/index buffers, strips, render-state materials)
- [x] XVM/XVR decoding (DXT1, DXT3, R5G6B5, A1R5G5B5/A4R4G4B4 swizzled) to WebGL textures
- [x] Render `map_city00_00n.rel` (Pioneer 2) and Forest with orbit + WASD camera
- [x] Enemy/object markers from `map_*e.dat` / `o.dat` (parser checked against newserv on 838 files)
- [x] Identify the Episode 2 entries with flags `0x10224`: indirect objects (`0x200`), now rendered; entries the PC client never draws are filtered
- [x] Texture addressing modes (material type 4: clamp/mirror/wrap), material colors (type 5)
- [x] Decode animated map entries (`NJS_MOTION` layout)
- [x] Play map motions (animated entries: frame += step per 30 Hz tick, wrapped at the frame count)
- [x] Texture animation (`.tam`): UV-scroll effect slots and texture swaps
- [x] Env-map texgen (material type 7: camera-space normal * matrix 0x00a21800)
- [x] Area fog and light (`fogentry.dat`, `lightentry.bin`, fog regions from set data, fades)
- [ ] Water/indirect distortion (`map_*i.bin`)
- [x] Verify handedness: the client is right-handed like three.js, so no mirroring is needed

## Phase 4: online
- [x] Lobby: 3D lobby map, player list, chat
- [x] Classic lobby HUD from the exe: chat input (Space), word balloons with name tab, Log Window, Home main menu (labels, help, view shift), Item List, information counter menus
- [ ] Classic HUD: balloon overlap avoidance and off-screen docking, sub-menu transitions, Item List row format, counter/menu leaf actions, ship-select camera
- [x] Own movement sent via `6x42` / `6x3E`, ground-following on the map collision
- [x] Other players from incoming `6x20/3E/3F/40/42`, `6x1F` answered with `6x20`
- [x] Real lobby spawn points (`TObjPlayerSet` in `map_lobby_NNo.dat`) and collision (`*c.rel`)
- [x] Player hitbox radius from the exe: 5.0 for every class (only its height is per class)
- [x] Collision of lobby objects: TObjLobbyMain (0x0182) round hitbox of radius 32, the only lobby object with one
- [ ] TObjLobbyMain's seasonal decoration model (`bm_obj_lobby_main.bml`); round hitboxes of field objects other than doors
- [ ] Real lobby spawn points and collision (`*c.rel`)
- [x] Character models: `pl?nj.bml` (NJCM) + `pl?tex.afs`, 12 classes, appearance (dev page `models.html`)
- [ ] Exact hair/cap texture lists for hat-wearing classes; non-default android heads
- [x] Player motions (`plymotiondata.rlc`: RelChunk + PRC + NJS_MOTION with short angle keys), town idle/walk/run tables from `PsoBB.exe`
- [x] Player models in the lobby instead of capsules, idle/run animation, facing the movement
- [ ] `proportion_x/y` scaling; field (per-weapon) motion tables; other town motions (emotes, sit)

## Phase 5: game
- [x] Collision (`*c.rel`): parser, ground probe, wall rays/slide (`render/collision.ts`)
- [x] Player camera: zoom levels, chase turn, target lead, source / target easing and wall checks from the exe (`render/playercamera.ts`); lock-on hold, guard / death states and the NPC / boss cameras left out
- [x] Games: create (`C1`), list (`08`), join (`10` → `64`), loading (`1D`/`8A`/`6x3F`/`6x1F`/`6F`), join sync (`6x6D`/`6x6B`/`6x6C`/`6x6E`/`6x6F`/`6x71`/`6x70`), leave (`98` + `84`) (`net/game.ts`, `tests/game.live.ts`)
- [x] Floor maps from the `64` variations via `SetDataTableOn.rel`; Pioneer 2 and field floors with collision, player starts, enemy/object markers; warps (`6x21`/`6x22`/`6x23`) by button or area warp objects
- [x] Full join sync: `6x6B`/`6x6C`/`6x6E`/`6x6F` sent by the leader and applied by the joiner (`net/joinsync.ts`, `tests/joinsync.test.ts`, `tests/joinsync.live.ts`); 6x6D drop numbers / floor items still zero
- [x] Enemy models (`bm_ene_*.bml`, boss archives) at their spawn points with their idle motions, variants by params/difficulty/season (`formats/enemymodels.ts`, `tests/enemies.test.ts`)
- [x] Enemy child objects: Sorcerer bits, Vol Opt phase 1 (pillars, monitors, lightning rod), Belra arms, De Rol Le / Barba Ray tentacles and mines, Dark Falz forms 2–3 and Rico's ring, Saint-Milion's spinner from its second archive (`EnemyPartSpec` placement, `tests/enemies.test.ts`)
- [x] Episode 1 bosses' children from the exe: Vol Opt's lightning rod motion (not in Ultimate) and core, De Rol Le's 5 + 3 stings and the sting attack's placement (frame 18, five floor points, ring around the target), where Dark Falz form 3 / the Dragon start (`formats/enemymodels.ts`, `tests/bossrooms.test.ts`)
- [ ] Where the fight moves the children it spawns (needs the boss FSMs: De Rol Le's tentacle / segments / rocks, Vol Opt's core in its monitor, Dark Falz's forms, Belra's thrown arms, Saint-Milion's 16 spinners), the spinner's motion sub-tree, Deldepth's disc, Morfos's arm/wall, Recons, Pofuilly tails, Recobox orientation
- [x] Floor music: area table, Pioneer 2 / Lab BGM zones, interactive field music (chained Ogg segments, calm/battle sequencer), boss tracks
- [x] Warp menus (Ragol teleporter per episode, area and boss warps, lobby teleporter); door and switch logic with `6x05`
- [x] Door, warp, switch and box models from the per-area object factory (`formats/objectmodels.ts`, `render/objectview.ts`), door motions and door collision
- [x] Wave events: the floor's `.evt` (`formats/events.ts`), the wave state machine (`render/waves.ts`), `6x67` / `6x76` sync, enemies appearing per wave, battle music while a wave of the room is alive
- [x] Laser fences and their switches, the recovery ring and the second boss warp class; the volumes that draw nothing (fog, events, room ids, sounds, camera) are counted as invisible instead of missing
- [x] Map warps (intra-floor): `TObjMapWarpForest`, `TObjCityMapWarp`, `TObjMapWarpAncient`, `TObjLaboMapWarp` menus and `6x55` (sent and received)
- [x] Pioneer 2 doors (shop, guild, Ragol warp, medical center) with their own open/close distances, the Lab's city warps and map warp, the city warp beams' real speed
- [x] Jungle rocks, trap pillars and Vol Opt's ship door models; the lobby door 0x54 and shop generators draw nothing; `construct_objects` (delayed objects by room/group) and the door unlock camera
- [x] Pillar traps TOTrapAncient02 / 02R (rise, hold `6x2C`/`6x2D`, technique, sink) and Vol Opt's seal door lamps from quest flags `0x2c`..`0x2f` (`render/traps.ts`, `tests/traps.test.ts`)
- [ ] Vol Opt seal door `.njs` shape motion; trap vision (cloaked traps); the 02R's technique projectiles
- [x] Boss fight music phases (`audio/bossbgm.ts`: the track of every phase and the `6x15`/`6x19`/`6xA4`/`6xA5` triggers) and `6x6A` boss warp gathering (`render/bosswarp.ts`: confirmation, party list, 300-frame gather, warp) — `tests/bossrooms.test.ts`
- [x] CCA main-gate warp menu (0x20A), Episode 2's four-light door lamps (flags = param5), the jungle warp beams (color by param6, 4 frames per tick, radius 15)
- [x] The boss warp object's beams by 6x6A state (idle / gather + warp / occupied + locked); the client has no boss-warp cutscene camera
- [x] Combat: three-attack combo (`6x43`/`6x44`/`6x45`, motion tables and hit frames from the exe), hit detection with the ItemPMT weapon ranges, the hit/damage formulas, enemy flinch/death motions, `6x46`/`6x0A`/`6x76`, kill -> `6x60` drop request and `6xC8` EXP request (`combat/`, `render/combat.ts`, `tests/combat.test.ts`)
- [x] Combat: the player taking damage (`6x4A` shield, `6x4B`/`6x4C` light/heavy hit, `6x89`+`6x4D` death, `6x4E` revivable, `6x4F` revive), HP tracking, the hit / knockback / death / stand-up field motions, the HP read-out (`combat/playerdamage.ts`)
- [x] Combat: enemy AI from the generic enemy FSM (idle and the walk home, the search radius, the war cry, the chase at the BattleParamEntry MovementData speeds, the melee at the AttackData reach with its damage and knockback, the 15-tick recovery) (`combat/enemyai.ts`)
- [x] Combat: damage numbers over a hit enemy and the lock-on reticle (`render/combatoverlay.ts`)
- [x] In-game HUD from the exe: the player status window (name, colour badge, level, HP / TP bars with the hold-then-slide animation and low colours, numbers, photon blast gauge ring), the "EXP+n" and "Level Up" floating texts, the level-up lines (`classic/hud.ts`, `render/playerhud.ts`)
- [x] Levels: PlyLevelTbl.prs from the stream file (`formats/plyleveltbl.ts`), max HP / TP formulas, `6xBF` EXP, `6x30` level-up with the table's gains, full heal and the level-up sound, `6xDD` EXP multiplier (`combat/progression.ts`, `tests/level.test.ts`)
- [x] HUD: the party members' windows (`classic/hud.ts` PartyWindows, remote HP in `combat/partyhp.ts`) — `tests/party.test.ts`
- [x] HUD: the level-up light, particle 0x23 and name-tag refresh on 6x30 (`render/levelupfx.ts`) — `tests/level.test.ts`
- [x] HUD: the message window's scrolling, 0xb4-frame timing and frameless clipped text, B0 server text (`classic/hud.ts` MessageLines) — `tests/level.test.ts`
- [x] HUD: the window open / close animation and opening wipe (`classic/windowanim.ts`: status and party windows with the element wipe, field menu leaves with the fade and close) — `tests/windowanim.test.ts`
- [ ] HUD: TP use, the window shine, the element wipe inside the field menus, per-window animation of a leaf's later windows
- [x] Combat: techniques (`combat/techniques.ts`: data and per-level scaling, TP, power, damage / Resta / Megid formulas, cast motion and timing, `6x8D`/`6x47`/`6x48`; attack techniques and Resta on self apply, other support techniques only cast) — `tests/techniques.test.ts`
- [x] Combat: support technique effects (`combat/buffs.ts`: Shifta / Deband on the caster and, from a remote 6x48, on the local player; Jellen / Zalure on enemies; the stronger-holds rule, durations and ticks, the ATP / spread / DFP changes in the weapon and enemy damage math; Anti's cure hook; Reverser revives the local player; the HUD status icons) — `tests/buffs.test.ts`
- [x] Ryuker and the Telepipe item: the field pipe, `6x68` (own, remote, 6x70), the Pioneer 2 pipes (TObjLuker) and the round trip with the exe's arrival spots (`net/telepipe.ts`, `render/telepipe.ts`, `tests/telepipe.test.ts`); particles drawn per effect_nt renderer (3 axis-aligned, 4 turned)
- [x] Combat: status effects on the local player (`combat/status.ts`: poison with its damage period, paralysis, freeze, shock, slow, confusion slots and durations, android immunity, the freeze / paralysis lock, slow's motion step, `6x0C` / `6x0D`, the HUD icons, Anti by level, Antidote / Antiparalysis, the Ultimate wolves' and Mothmants' melee rolls) — `tests/status.test.ts`
- [x] Combat: per-family FSMs of Forest / Caves (`combat/enemyfsm.ts`): Poison Lily (track, spit projectile that poisons, bite, the scream that paralyzes), Savage / Barbarous Wolf (stalk, the leap with its arc, hop back), the Rag Rappy's fake death and run-off, the Monest spawning Mothmants into its MOTHMANT child slots — `tests/enemyfsm.test.ts`
- [x] Combat: Caves FSMs (`combat/enemyfsmcaves.ts`): Grass Assassin (chase, slash, web hold via 6x2C, enraged dash), Nano Dragon (wander, homing volley, piercing fire breath, take-off / flight / landing), the Sharks' own AI record; enemy projectiles and technique hits on the player (`combat/enemyshots.ts`) — `tests/enemyfsmcaves.test.ts`
- [x] Combat: Mines FSMs (`combat/enemyfsmmines.ts`): Dubchic / Gillchic (walk, two-hit melee, the Gillchic's slow, laser volley, the Dubchic getting up 4 times), Garanz (HP phases, ground mines, homing missile barrage with super armor), Sinow Beat / Gold (ceiling drop, warp-strike, confusing combo, warp away, the Gold's cast), Canadine / Canane (laser, zap dive, orbit, the 8-member ring in its CANADINE_GROUP slots with its release / free / self-destruct rules) — `tests/enemyfsmmines.test.ts`
- [x] Combat: Ruins FSMs (`combat/enemyfsmruins.ts`): Bulclaw / Bulk / Claw (the split into the 4 CLAW child slots with the HP share, the Bulk's flee, merge and self-destruct, the form's model), Dark Belra (walk segments, thrown arm through entry 19, the paralysing punch, the dizzy spin, the confused spin-and-throw), Dark Gunner (the control object's dash / volley cycle, the rotating Death Gunner, the shield, the group stun), Chaos Bringer (charge with confusion, swing, TP drain and the piercing laser), Chaos Sorcerer (warp placement, the attack / attack / heal cycle from its bits), Delsaber (combo, jump, shield-broken slash, the proactive guard), the Dimenian's own record; confused enemies target other enemies and hit them; the Del Lily's (and Ultimate Lilies') Megid — `tests/enemyfsmruins.test.ts`
- [x] Combat: status effects on enemies (`combat/enemystatus.ts`: paralysis, freeze, shock, confusion with the exe's immunities by enemy kind, durations, EVP, the behaviour lock, `6x0A` / `6x9C` sync both ways, Gibarta / Rabarta freeze and Zonde shock rolls) — `tests/enemystatus.test.ts`
- [x] Combat: weapon specials (`combat/specials.ts`: the special from data1[4] and ItemPMT, attack permission, the hit check and miss retry, HP / TP / EXP steal, Charge / Spirit / Berserk, freeze / paralysis / confusion, fire / thunder with the shock roll, instant kill, HP divide; `6x9A` / `6xC6` / `6xC7` / `6x2F`) — `tests/specials.test.ts`
- [x] Combat: photon blasts (`combat/photonblast.ts`: the gauge from damage dealt / taken with `6x39` / `6x3A`, the HUD ring, firing from a palette slot with `6x49` / `6x37`, the six basic blasts' power and effects) — `tests/photonblast.test.ts`
- [x] Combat: Episode 2 FSMs (`combat/enemyfsmep2.ts`) on the Booma substrate (the controller and the chase / melee handlers): Merillia / Meriltas (buried start, the wake-up radius, appear / burrow, war cry, chase, melee, the low-HP run and the poisoning pollen cloud), Dolmolm / Dolmdarl (emergence, melee, back step, the holding dance via 6x2C); VR Temple / Spaceship spawn Episode 1 classes, which already have theirs — `tests/enemyfsmep2.test.ts`. Left: Gee (flying, 18 states, spike volley, slowing dive), Ul / Zol Gibbon (20 states), Mericarol / Mericus / Merikle, Gibbles, Gi Gue, Sinow Berill / Spigell, Sinow Zoa / Zele, Deldepth, Delbiter, Morfos, Recobox / Recon, Epsilon / Epsigard; the Merillia's stroll, its run's wall ray and the cloud's node position, the Dolmolm's height test
- [ ] Combat left to do: the telepipe's type-1 ring particle, light and loop sound, remote players' Resta heal on the local player, confusion's steering, the freeze button mash, status particles and sounds, the real technique effects and projectiles (the targeting system's tech entries are ASSUMED), joined / donated photon blasts and the blast objects, the weapons with their own special routines, hit boxes per body part, the Pan Arms split / merge, the Pofuilly Slime split, the Grass Assassin's emerge, the Nano Dragon's fly-in and power-up, the Dubwitch link, the Sinow mirage clones and the Gold's technique effect, the Canadine's later ring cycles, the rest of those FSMs (the wolf's side dash and howl, the Lily's low-HP spin, the Rappy's own chase, the Mothmant's own FSM, the Monest's wake-up state), the Sorcerer's bits as hittable entities and its healing of other enemies, the Bringer's Ultimate weapon unequip, the Delsaber's job-mask target preference and a remote player's guard drain, the Gunner control's own position, the Bulk's wall-clearance flee point, line of sight and the idle wander path, enemies attacking remote players
- [x] Full character file (`E7`): inventory, stats, bank, techniques (`net/charfile.ts`)
- [x] ItemPMT from the server stream file, item names and descriptions (`formats/itempmt.ts`, `formats/itemnames.ts`)
- [x] Inventory panel in the Online tab
- [x] Item commands: equip/unequip/use/drop from the Inventory panel (`6x25`/`6x26`/`6x27`/`6x2A`/`6xC3`/`6x29`), pickup (`6x5A` → `6x59`), server drops (`6x5D`/`6x5F`), inventory creation (`6xBE`), join item state (`6x6D`, BC0) — `net/items.ts`
- [x] Items on the floor with the client's own models (`item.bml` box models, present colours, spin) and item boxes broken with Enter (`6x0B` + `6xA2`) — `formats/itemmodels.ts`, `render/flooritems.ts`
- [x] Classic field HUD (`render/fieldhud.ts`): the in-game main menu with the exe's availability rules (`classic/fieldmenu.ts`), Item Pack > Items with the client's rows, icons, colours, description, Purpose (Use / Equip / Remove / Drop) and Amount windows (`classic/itempack.ts`), the Technique menu with levels and TP costs (`classic/techmenu.ts`), the action palette from the character's config with Ctrl switching (`classic/palette.ts`) — `tests/fieldhud.test.ts`
- [x] Main menu > Options (`classic/options.ts`, field and lobby): the exe's ten rows and their choices, the option word bits (message speed drives the window animation, cursor position drives the main menu's cursor memory), Brightness as the gamma offset, saved with `01ED` — `tests/options.test.ts`
- [x] Field HUD: casting techniques from the palette keys and the Technique menu
- [x] Item Pack > MAG: the MAG list, Select, the item list, feeding with `6x28` and the client's own feed (stats, sync, IQ, level, evolution, photon blast, the 0x189c-frame feed timer) (`net/magfeed.ts`, `classic/magmenu.ts`, `tests/magfeed.test.ts`)
- [x] Minimap: the radar in the field HUD and Item Pack > Area Map with the full map (pan, zoom, drag), rooms from `map_*r.rel` revealed as they are discovered (kept per floor, TObjRaderCol rooms), player markers, enemy icons, the compass, the status window closing on HUD flag bit 1 (`formats/minimap.ts`, `classic/minimap.ts`, `classic/areamap.ts`, `render/minimap.ts`) — `tests/minimap.test.ts`
- [ ] Minimap left to do: TObjRaderHideCol / TObjRaderIcon (switch icons), the door / box / boss icons the objects add, the battle-mode team colours, the Challenge "Area n" title
- [ ] Field HUD left to do: the Status window (menu id 0x19 exists in the exe but no menu or key opens it in this build), Options > Keyboard Config / Pad Button Config (and the uses of function keys, keyboard / mouse controls, auto disconnect), the MAG window's stat panel layout and its Photon Blast window, the item detail pages for equipment (requirements, attributes, mag stats), automatic / manual sort (`6xC4`), saving a switched palette (`07ED`), the scroll bar of the item list
- [x] Pioneer 2 shops (weapons, armor, tools: `6xB5`/`6xB6`/`6xB7`, sell `6xC0`, the client's `get_item_shop_cost`) and the bank (`6xBB`/`6xBC`/`6xBD`: meseta and items) with the exe's windows and flows (`classic/shop.ts`, `tests/shop.test.ts`)
- [x] Tekker: identify an unknown weapon (`6xB8`/`6xB9`), accept (`6x29` + `6xBA`, with the equip question) or refuse, the 100-meseta fee and the section-id lines (`classic/shop.ts` TekkerCounter, `tests/tekker.test.ts`)
- [x] Floor item presentation from the exe: no arc (an item appears where it lands, origin 6 above the ground under y + 300), a random start angle, fog off, SE 0x571 at the picker on 6x59, no drop sound or "item found" line (the exe has none), the local drop's spot search (`render/flooritems.ts`, `tests/drops.test.ts`)
- [ ] Items left to do: the 0x9B w_itemget particle (type 1) on appear / pickup, 3D attenuation of SE 0x571, the drop spot's line-of-sight test and 6x2C hold, the pending-pickup lock (+0x94, 900 frames), the tekker's item picture window and BGM changes, the bank item windows' own lines, partial-stack UI beyond "Drop 1"
- [x] Quests: the server's quest menu (`A2`/`A3`, `09`/`10`), the `44`/`13` file pair (and the `A6`/`A7` download variants) with the `AC` barrier (`net/quests.ts`)
- [x] Quest `.bin`: BB header, label table and a bytecode decoder over all 528 BB opcodes, generated from newserv's table (`formats/questbin.ts`, `formats/questopcodes.ts`, `tools/gen-quest-opcodes.ts`)
- [x] Quest `.dat`: the typed-chunk objects / enemies / wave events per floor (`formats/questdat.ts`)
- [x] Quest VM: threads, registers, the arg stack, floor handlers, the map designations, quest flags (`6x75`/`6x6F`), counters, switch flags, message windows and the quest board (`quest/vm.ts`, `quest/session.ts`, `quest/run.ts`)
- [x] Quest floors: the quest's designation decides the map and the variation, and its `.dat` replaces the free-play set data (`render/gameview.ts`)
- [x] NPCs: every humanoid NPC class of the factory table (Pioneer 2, Lab, quest NPCs, the tekker by section id, the NgcBase cast per map type) with its own model and the town idle motion (`plymotionnpctown.cpt`), display registers, turning to the player and talk (`formats/npcmodels.ts`, `render/npcview.ts`, `tests/npcs.test.ts`)
- [x] Quests: the area script (`map_city_on_e.bin`), the Hunter's Guild and government counters (quest menu, accept, result on r255/r253, reward label, cancel), quest NPC talk, `at_coords_talk`/`call`, `set_player_start_position` (`6x24`), `p_return_guild`, the meseta reward (`6xC9`), NPC players (`6x69` + `npcplayerchar.dat`), the speech balloon / window / list / quest board text drawn like the exe (`quest/town.ts`, `quest/questui.ts`, `tests/questflow.test.ts`), the main menu's Quest Board window (`classic/questboard.ts`, `tests/questboard.test.ts`)
- [x] NPCs: walking townspeople (param6 = 1 wander around the spawn point), turning back to the spawn angle after a talk, NPC collision (round hitbox of radius 5 that stops the player and the other NPCs, sidestep response) (`render/npcwander.ts`)
- [x] NPCs: the talk cameras: camera movers of the Principal, his secretary and three Lab NPCs (table 0x00909260), the default side view (heading +- 0x6000), NPCs that do not turn for the talk
- [ ] NPCs: the talk mode of the player camera (+0x100: field of view 0x22d8, target offset), TObjNpcEnemy (0x33), the NPC Rappy / Hildebear / Dark Bringer (0x45 / 0x46 / 0xa9) and the Episode 4 quest NPC (0x118)
- [ ] Quests: NPC players' follow / attack AI (6x69 commands 1-3 are logged only), the other Pioneer 2 counters (medical center, giveaway), the text colour palette, challenge mode and Battle Arena opcodes, the enemy-parameter family, random-enemy `.dat` sections (types 4/5) and the `evt2` event format

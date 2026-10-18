# Roadmap

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
- [ ] Collision of lobby objects (counters, props from `o.dat`) and the real per-class hitbox radius
- [ ] Real lobby spawn points and collision (`*c.rel`)
- [x] Character models: `pl?nj.bml` (NJCM) + `pl?tex.afs`, 12 classes, appearance (dev page `models.html`)
- [ ] Exact hair/cap texture lists for hat-wearing classes; non-default android heads
- [x] Player motions (`plymotiondata.rlc`: RelChunk + PRC + NJS_MOTION with short angle keys), town idle/walk/run tables from `PsoBB.exe`
- [x] Player models in the lobby instead of capsules, idle/run animation, facing the movement
- [ ] `proportion_x/y` scaling; field (per-weapon) motion tables; other town motions (emotes, sit)

## Phase 5: game
- [x] Collision (`*c.rel`): parser, ground probe, wall rays/slide (`render/collision.ts`)
- [x] Games: create (`C1`), list (`08`), join (`10` → `64`), loading (`1D`/`8A`/`6x3F`/`6x1F`/`6F`), join sync (`6x6D`/`6x71`/`6x70`), leave (`98` + `84`) (`net/game.ts`, `tests/game.live.ts`)
- [x] Floor maps from the `64` variations via `SetDataTableOn.rel`; Pioneer 2 and field floors with collision, player starts, enemy/object markers; warps (`6x21`/`6x22`/`6x23`) by button or area warp objects
- [ ] Full join sync for real-client joiners (`6x6B`/`6x6C`/`6x6E` need the entity expansion, `6x6F` quest flags)
- [x] Enemy models (`bm_ene_*.bml`, boss archives) at their spawn points with their idle motions, variants by params/difficulty/season (`formats/enemymodels.ts`, `tests/enemies.test.ts`)
- [x] Enemy child objects: Sorcerer bits, Vol Opt phase 1 (pillars, monitors, lightning rod), Belra arms, De Rol Le / Barba Ray tentacles and mines, Dark Falz forms 2–3 and Rico's ring, Saint-Milion's spinner from its second archive (`EnemyPartSpec` placement, `tests/enemies.test.ts`)
- [ ] Where the fight puts the children it spawns (tentacles, mines, thrown arms, the 16 spinners), the spinner's motion sub-tree, Deldepth's disc, Morfos's arm/wall, Recons, Pofuilly tails, Recobox orientation
- [x] Floor music: area table, Pioneer 2 / Lab BGM zones, interactive field music (chained Ogg segments, calm/battle sequencer), boss tracks
- [x] Warp menus (Ragol teleporter per episode, area and boss warps, lobby teleporter); door and switch logic with `6x05`
- [x] Door, warp, switch and box models from the per-area object factory (`formats/objectmodels.ts`, `render/objectview.ts`), door motions and door collision
- [x] Wave events: the floor's `.evt` (`formats/events.ts`), the wave state machine (`render/waves.ts`), `6x67` / `6x76` sync, enemies appearing per wave, battle music while a wave of the room is alive
- [x] Laser fences and their switches, the recovery ring and the second boss warp class; the volumes that draw nothing (fog, events, room ids, sounds, camera) are counted as invisible instead of missing
- [x] Map warps (intra-floor): `TObjMapWarpForest`, `TObjCityMapWarp`, `TObjMapWarpAncient`, `TObjLaboMapWarp` menus and `6x55` (sent and received)
- [x] Pioneer 2 doors (shop, guild, Ragol warp, medical center) with their own open/close distances, the Lab's city warps and map warp, the city warp beams' real speed
- [ ] Remaining object models (the lobby door 0x54, shop generators, jungle rocks, traps, Vol Opt's ship door), the `construct_objects` action, the door unlock camera
- [x] Boss fight music phases (`audio/bossbgm.ts`: the track of every phase and the `6x15`/`6x19`/`6xA4`/`6xA5` triggers) and `6x6A` boss warp gathering (`render/bosswarp.ts`: confirmation, party list, 300-frame gather, warp) — `tests/bossrooms.test.ts`
- [x] CCA main-gate warp menu (0x20A), Episode 2's four-light door lamps (flags = param5), the jungle warp beams (color by param6, 4 frames per tick, radius 15)
- [x] The boss warp object's beams by 6x6A state (idle / gather + warp / occupied + locked); the client has no boss-warp cutscene camera
- [x] Combat: three-attack combo (`6x43`/`6x44`/`6x45`, motion tables and hit frames from the exe), hit detection with the ItemPMT weapon ranges, the hit/damage formulas, enemy flinch/death motions, `6x46`/`6x0A`/`6x76`, kill -> `6x60` drop request and `6xC8` EXP request (`combat/`, `render/combat.ts`, `tests/combat.test.ts`)
- [x] Combat: the player taking damage (`6x4A` shield, `6x4B`/`6x4C` light/heavy hit, `6x89`+`6x4D` death, `6x4E` revivable, `6x4F` revive), HP tracking, the hit / knockback / death / stand-up field motions, the HP read-out (`combat/playerdamage.ts`)
- [x] Combat: enemy AI from the generic enemy FSM (idle and the walk home, the search radius, the war cry, the chase at the BattleParamEntry MovementData speeds, the melee at the AttackData reach with its damage and knockback, the 15-tick recovery) (`combat/enemyai.ts`)
- [x] Combat: damage numbers over a hit enemy and the lock-on reticle (`render/combatoverlay.ts`)
- [x] In-game HUD from the exe: the player status window (name, colour badge, level, HP / TP bars with the hold-then-slide animation and low colours, numbers, photon blast gauge ring), the "EXP+n" and "Level Up" floating texts, the level-up lines (`classic/hud.ts`, `render/playerhud.ts`)
- [x] Levels: PlyLevelTbl.prs from the stream file (`formats/plyleveltbl.ts`), max HP / TP formulas, `6xBF` EXP, `6x30` level-up with the table's gains, full heal and the level-up sound, `6xDD` EXP multiplier (`combat/progression.ts`, `tests/level.test.ts`)
- [ ] HUD: the window-opening wipe, the party members' windows, photon blast charge, TP use, the message window's own scrolling / timing and frame, the level-up light and particle, name-tag level refresh
- [x] Combat: techniques (`combat/techniques.ts`: data and per-level scaling, TP, power, damage / Resta / Megid formulas, cast motion and timing, `6x8D`/`6x47`/`6x48`; attack techniques and Resta on self apply, other support techniques only cast) — `tests/techniques.test.ts`
- [x] Combat: support technique effects (`combat/buffs.ts`: Shifta / Deband on the caster and, from a remote 6x48, on the local player; Jellen / Zalure on enemies; the stronger-holds rule, durations and ticks, the ATP / spread / DFP changes in the weapon and enemy damage math; Anti's cure hook; Reverser revives the local player; the HUD status icons) — `tests/buffs.test.ts`
- [x] Ryuker and the Telepipe item: the field pipe, `6x68` (own, remote, 6x70), the Pioneer 2 pipes (TObjLuker) and the round trip with the exe's arrival spots (`net/telepipe.ts`, `render/telepipe.ts`, `tests/telepipe.test.ts`)
- [ ] Combat left to do: the telepipe's type-1 ring particle, light and loop sound, remote players' Resta heal on the local player, status effects for Anti to cure, the real technique effects and projectiles (the targeting system's tech entries are ASSUMED), photon blasts, specials and status effects, hit boxes per body part, the per-family enemy FSMs (Savage Wolf's leap, Rag Rappy's fake death, Monest spawning Mothmants, Poison Lily), line of sight and the idle wander path, enemies attacking remote players
- [x] Full character file (`E7`): inventory, stats, bank, techniques (`net/charfile.ts`)
- [x] ItemPMT from the server stream file, item names and descriptions (`formats/itempmt.ts`, `formats/itemnames.ts`)
- [x] Inventory panel in the Online tab
- [x] Item commands: equip/unequip/use/drop from the Inventory panel (`6x25`/`6x26`/`6x27`/`6x2A`/`6xC3`/`6x29`), pickup (`6x5A` → `6x59`), server drops (`6x5D`/`6x5F`), inventory creation (`6xBE`), join item state (`6x6D`, BC0) — `net/items.ts`
- [x] Items on the floor with the client's own models (`item.bml` box models, present colours, spin) and item boxes broken with Enter (`6x0B` + `6xA2`) — `formats/itemmodels.ts`, `render/flooritems.ts`
- [x] Classic field HUD (`render/fieldhud.ts`): the in-game main menu with the exe's availability rules (`classic/fieldmenu.ts`), Item Pack > Items with the client's rows, icons, colours, description, Purpose (Use / Equip / Remove / Drop) and Amount windows (`classic/itempack.ts`), the Technique menu with levels and TP costs (`classic/techmenu.ts`), the action palette from the character's config with Ctrl switching (`classic/palette.ts`) — `tests/fieldhud.test.ts`
- [x] Field HUD: casting techniques from the palette keys and the Technique menu
- [ ] Field HUD left to do: the Status window (menu id 0x19 exists in the exe but no menu or key opens it in this build), MAG (feeding `6x28`) / Area Map / Options windows, the item detail pages for equipment (requirements, attributes, mag stats), automatic / manual sort (`6xC4`), saving a switched palette (`07ED`), window open/close animations, the scroll bar of the item list
- [x] Pioneer 2 shops (weapons, armor, tools: `6xB5`/`6xB6`/`6xB7`, sell `6xC0`, the client's `get_item_shop_cost`) and the bank (`6xBB`/`6xBC`/`6xBD`: meseta and items) with the exe's windows and flows (`classic/shop.ts`, `tests/shop.test.ts`)
- [x] Tekker: identify an unknown weapon (`6xB8`/`6xB9`), accept (`6x29` + `6xBA`, with the equip question) or refuse, the 100-meseta fee and the section-id lines (`classic/shop.ts` TekkerCounter, `tests/tekker.test.ts`)
- [ ] Item drop animation (arc from the enemy/box), the "item found" HUD line and sounds, the tekker's item picture window and BGM changes, the bank item windows' own lines, mag feeding (`6x28`), partial-stack UI beyond "Drop 1"
- [x] Quests: the server's quest menu (`A2`/`A3`, `09`/`10`), the `44`/`13` file pair (and the `A6`/`A7` download variants) with the `AC` barrier (`net/quests.ts`)
- [x] Quest `.bin`: BB header, label table and a bytecode decoder over all 528 BB opcodes, generated from newserv's table (`formats/questbin.ts`, `formats/questopcodes.ts`, `tools/gen-quest-opcodes.ts`)
- [x] Quest `.dat`: the typed-chunk objects / enemies / wave events per floor (`formats/questdat.ts`)
- [x] Quest VM: threads, registers, the arg stack, floor handlers, the map designations, quest flags (`6x75`/`6x6F`), counters, switch flags, message windows and the quest board (`quest/vm.ts`, `quest/session.ts`, `quest/run.ts`)
- [x] Quest floors: the quest's designation decides the map and the variation, and its `.dat` replaces the free-play set data (`render/gameview.ts`)
- [x] NPCs: every humanoid NPC class of the factory table (Pioneer 2, Lab, quest NPCs, the tekker by section id, the NgcBase cast per map type) with its own model and the town idle motion (`plymotionnpctown.cpt`), display registers, turning to the player and talk (`formats/npcmodels.ts`, `render/npcview.ts`, `tests/npcs.test.ts`)
- [x] Quests: the area script (`map_city_on_e.bin`), the Hunter's Guild and government counters (quest menu, accept, result on r255/r253, reward label, cancel), quest NPC talk, `at_coords_talk`/`call`, `set_player_start_position` (`6x24`), `p_return_guild`, the meseta reward (`6xC9`), NPC players (`6x69` + `npcplayerchar.dat`), the speech balloon / window / list / quest board drawn like the exe (`quest/town.ts`, `quest/questui.ts`, `tests/questflow.test.ts`)
- [ ] NPCs: walking townspeople (param6 = 1 wander), the talk camera movers, NPC collision, TObjNpcEnemy (0x33), the NPC Rappy / Hildebear / Dark Bringer (0x45 / 0x46 / 0xa9) and the Episode 4 quest NPC (0x118)
- [ ] Quests: NPC players' follow / attack AI (6x69 commands 1-3 are logged only), the other Pioneer 2 counters (medical center, giveaway), the in-game main menu that opens the quest board (B key for now), the text colour palette, challenge mode and Battle Arena opcodes, the enemy-parameter family, random-enemy `.dat` sections (types 4/5) and the `evt2` event format

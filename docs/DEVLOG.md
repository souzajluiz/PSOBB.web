# Devlog

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

// Enemy set entry (map_*e.dat) -> model archive, model entry and idle motion,
// reverse-engineered from PsoBB.exe (Ephinea 1.25.13; addresses are VAs).
//
// - 0x009fba60: per-area table (47 areas) of {u32 set type, factory, f32
//   distance^2, u32 child count} rows, ended by type 0xFFFF. The factory
//   allocates the enemy object and runs its constructor.
// - Each enemy class has an asset loader (run per area from the lists at e.g.
//   0x009fc420) that loads one BML through an asset descriptor {char *bml,
//   char **models, char **motions, u16 model_count, u16 motion_count}
//   (ENEMY_ASSETS below, with the descriptor addresses) into a model set:
//   FUN_005b7a84 reads the archive entries by position (render/enemymodel.ts).
//   In Ultimate (FUN_00520e6c: online flag DAT_009f9860 and difficulty
//   DAT_00a9cd68 == 3) many loaders pass another archive name with the same
//   descriptor (FUN_0051f674): the *_a.bml / *_ap.bml files. Episode 2
//   loaders load the descriptor's *_low.bml when FUN_00482a20() == 0 (the
//   graphics detail option DAT_00a46c64, FUN_00482ca0).
// - The constructor calls set_params (vtable +0x14c, FUN_00786848 for most:
//   param1..5 -> +0x35c..+0x36c, param6 -> +0x370, param7 -> +0x374), picks
//   model entry i (obj+0x34 = *(set+0x42c) + 8 + i*0x10, texture list +0xC),
//   sets the motion table (obj+0xD8) and starts a slot with FUN_007aa4c8.
//   Motion table rows (0x10): u16 mode (1 loop, 2 chain to `next`, 3 once),
//   u16 next, u32 motion index, f32 frames per tick, u32 flags.
//
// Indices below are archive entry positions: models from 0, motions from the
// first motion entry (`models` entries in). When the constructor starts a
// non-idle slot (appear / vanish / boss intro), the idle slot is used instead
// and named in the comment.

import type { EnemyMotionSpec, EnemyPartSpec } from '../render/enemymodel.ts';
import type { EnemySet } from './setdata.ts';

export interface EnemyAsset {
  descriptor: number; // address of the asset descriptor in PsoBB.exe
  bml: string;
  ultimate?: string; // archive loaded with the same descriptor in Ultimate
  low?: string; // low-detail archive (own descriptor, same counts)
  lowDescriptor?: number;
  aliases?: string[]; // other archives loaded with this descriptor
  models: string[]; // descriptor names (the loader only uses the counts)
  motions: string[];
}

// prettier-ignore
export const ENEMY_ASSETS: EnemyAsset[] = [
  { descriptor: 0x009bb3f4, bml: 'bm_ene_bm1_shark.bml', ultimate: 'bm_ene_bm1_shark_a.bml',
    models: ['bm1f_s_wala_body.nj', 'bm1tl_s_wala_body.nj', 'bm1_s_wala_body.nj'],
    motions: ['appear_bm1_s_wala_body.njm', 'atackl_bm1_s_wala_body.njm', 'atackr_bm1_s_wala_body.njm', 'damage_bm1_s_wala_body.njm', 'deadb_bm1_s_wala_body.njm', 'dead_bm1_s_wala_body.njm', 'leader_bm1_s_wala_body.njm', 'mihari_bm1_s_wala_body.njm', 'run_bm1_s_wala_body.njm', 'stund_bm1_s_wala_body.njm', 'wakeup_bm1_s_wala_body.njm', 'walk_bm1_s_wala_body.njm'] },
  { descriptor: 0x009bb4f0, bml: 'bm_ene_bm2_moja.bml', ultimate: 'bm_ene_bm2_moja_a.bml',
    models: ['bm2c_s_moj_body.nj', 'bm2f_s_moj_body.nj', 'bm2w_s_moj_body.nj'],
    motions: ['cstand_bm2c_s_moj_body.njm', 'cwalk_bm2c_s_moj_body.njm', 'damage_bm2f_s_moj_body.njm', 'deadb_bm2f_s_moj_body.njm', 'dead_bm2f_s_moj_body.njm', 'giva_bm2f_s_moj_body.njm', 'hoe_bm2f_s_moj_body.njm', 'jump_bm2f_s_moj_body.njm', 'punch_bm2f_s_moj_body.njm', 'stand_bm2f_s_moj_body.njm', 'walk_bm2f_s_moj_body.njm'] },
  { descriptor: 0x009bb74c, bml: 'bm_ene_bm3_fly.bml', ultimate: 'bm_ene_bm3_fly_a.bml',
    models: ['bm3_fly_body.nj', 'bm3_s_nest.nj'],
    motions: ['atack_bm3_fly_body.njm', 'damage_bm3_fly_body.njm', 'dam_bm3_s_nest.njm', 'dead_bm3_fly_body.njm', 'dead_bm3_s_nest.njm', 'down_bm3_s_nest.njm', 'dwndam_bm3_s_nest.njm', 'dwnexit_bm3_s_nest.njm', 'dwnwait_bm3_s_nest.njm', 'exit_bm3_s_nest.njm', 'fly_bm3_fly_body.njm', 'land_bm3_s_nest.njm', 'move_bm3_fly_body.njm', 'trance_bm3_s_nest.njm', 'wait_bm3_s_nest.njm'] },
  { descriptor: 0x009bb9d8, bml: 'bm_ene_bm5_wolf.bml', ultimate: 'bm_ene_bm5_wolf_a.bml',
    models: ['bm5_s_kem_body.nj', 'bm5_s_keml_body.nj'],
    motions: ['dams_bm5_s_kem_body.njm', 'deadl_bm5_s_kem_body.njm', 'deadr_bm5_s_kem_body.njm', 'eat_bm5_s_kem_body.njm', 'hoe_bm5_s_kem_body.njm', 'hunt_bm5_s_kem_body.njm', 'okil_bm5_s_kem_body.njm', 'okir_bm5_s_kem_body.njm', 'runb_bm5_s_kem_body.njm', 'run_bm5_s_kem_body.njm', 'sleep_bm5_s_kem_body.njm', 'stdup_bm5_s_kem_body.njm', 'wait_bm5_s_kem_body.njm', 'walk_bm5_s_kem_body.njm'] },
  { descriptor: 0x009bbb4c, bml: 'bm_ene_grass.bml', ultimate: 'bm_ene_grass_a.bml',
    models: ['re1_b_grass_base.nj'],
    motions: ['damege_re1_b_base.njm', 'die_re1_b_base.njm', 'lattack_re1_b_base.njm', 'mad_re1_b_base.njm', 'rattack_re1_b_base.njm', 'spit_re1_b_base.njm', 'wait_re1_b_base.njm', 'walk_re1_b_base.njm'] },
  { descriptor: 0x009bbe18, bml: 'bm_ene_lappy.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_lappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bbe60, bml: 'bm_ene_lappy_ap.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_lappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bbea8, bml: 'bm_ene_lappy_es.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_elappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bbef0, bml: 'bm_ene_lappy_ap_es.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_elappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bbf80, bml: 'bm_ene_lappy_hw.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_hlappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bbfc8, bml: 'bm_ene_lappy_ap_hw.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_hlappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bc058, bml: 'bm_ene_lappy_xs.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_slappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bc0a0, bml: 'bm_ene_lappy_ap_xs.bml',
    models: ['re3_b_lappy_base.nj', 're3_s_slappy_base.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bc130, bml: 'bm_ene_sandlappy.bml',
    models: ['nj00_sandlappy.nj', 'nj01_darklappy.nj'],
    motions: ['attack_re3_b_base.njm', 'damage_re3_b_base.njm', 'die_re3_b_base.njm', 'run_re3_b_base.njm', 'tumble_re3_b_base.njm', 'wait2_re3_b_base.njm', 'wait_re3_b_base.njm', 'wake2_re3_b_base.njm', 'wake_re3_b_base.njm', 'walk_re3_b_base.njm'] },
  { descriptor: 0x009bc328, bml: 'bm_ene_re2_flower.bml', ultimate: 'bm_ene_re2_flower_a.bml', aliases: ['bm_ene_dkflower.bml'],
    models: ['re2_b_flower_root.nj'],
    motions: ['attack_re2_b_root.njm', 'damege_re2_b_root.njm', 'die_re2_b_root.njm', 'laugh_re2_b_root.njm', 'waitc_re2_b_root.njm', 'waito_re2_b_root.njm', 'wake_re2_b_root.njm'] },
  { descriptor: 0x009bc4b4, bml: 'bm_ene_ill_gill.bml',
    models: ['darkand_body.nj'],
    motions: ['wait_darkand_body.njm', 'walk_darkand_body.njm', 'kamae_darkand_body.njm', 'tackle_darkand_body.njm', 'lattack_darkand_body.njm', 'rattack_darkand_body.njm', 'damage_darkand_body.njm', 'prekamae_darkand_body.njm', 'kage_darkand_body.njm', 'dead_darkand_body.njm'] },
  { descriptor: 0x009bc650, bml: 'bm_ene_balclaw.bml',
    models: ['re6_b_bal_body.nj', 're6_b_bcbody.nj', 're6_b_claw_body.nj'],
    motions: ['balattack_re6_b_bal_body.njm', 'balcomb_re6_b_bal_body.njm', 'baldamage_re6_b_bal_body.njm', 'baldie_re6_b_bal_body.njm', 'balshout_re6_b_bal_body.njm', 'balwait_re6_b_bal_body.njm', 'bcattack_re6_b_bcbody.njm', 'bcdamage_re6_b_bcbody.njm', 'bcdie_re6_b_bcbody.njm', 'bcwait_re6_b_bcbody.njm', 'clattack_re6_b_claw_body.njm', 'cldamage_re6_b_claw_body.njm', 'cldie_re6_b_claw_body.njm', 'cllturn_re6_b_claw_body.njm', 'clrturn_re6_b_claw_body.njm', 'clwait_re6_b_claw_body.njm'] },
  { descriptor: 0x009bca84, bml: 'bm_ene_re8_b_beast.bml', ultimate: 'bm_ene_re8_b_beast_a.bml',
    models: ['re8_b_beast_wola_body.nj', 're8_b_rdbeast_wola_body.nj', 're8_b_srdbeast_wola_body.nj'],
    motions: ['appear_bm1_s_wala_body.njm', 'atackl_bm1_s_wala_body.njm', 'atackr_bm1_s_wala_body.njm', 'damage_bm1_s_wala_body.njm', 'deadb_bm1_s_wala_body.njm', 'dead_bm1_s_wala_body.njm', 'leader_bm1_s_wala_body.njm', 'mihari_bm1_s_wala_body.njm', 'run_bm1_s_wala_body.njm', 'stund_bm1_s_wala_body.njm', 'wakeup_bm1_s_wala_body.njm', 'walk_bm1_s_wala_body.njm'] },
  { descriptor: 0x009bcb54, bml: 'bm_ene_re7_berura.bml', ultimate: 'bm_ene_re7_berura_a.bml',
    models: ['re7_b_bell_body.nj', 're7_b1_larm.nj', 're7_b1_rarm.nj'],
    motions: ['attack_re7_b_body.njm', 'damege_re7_b_body.njm', 'die_re7_b_body.njm', 'lattack_re7_b_body.njm', 'memai_re7_b_body.njm', 'rattack_re7_b_body.njm', 'wait_re7_b_body.njm', 'walk_re7_b_body.njm'] },
  { descriptor: 0x009bcda8, bml: 'bm_ene_df2_bringer.bml', ultimate: 'bm_ene_df2_bringer_a.bml',
    models: ['bm8_s_kb_body.nj'],
    motions: ['beam_bm8_s_kb_body.njm', 'cold_bm8_s_kb_body.njm', 'damage_bm8_s_kb_body.njm', 'dead_bm8_s_kb_body.njm', 'hoe_bm8_s_kb_body.njm', 'kamae_bm8_s_kb_body.njm', 'kiri_bm8_s_kb_body.njm', 'run_bm8_s_kb_body.njm', 'tpkyu_bm8_s_kb_body.njm', 'wait_bm8_s_kb_body.njm', 'walk_bm8_s_kb_body.njm'] },
  { descriptor: 0x009bce98, bml: 'bm_ene_me1_mb.bml', ultimate: 'bm_ene_me1_mb_a.bml',
    models: ['me1n_y_mb.nj', 'me1_y_mb.nj'],
    motions: ['change02_me1_y_mb.njm', 'change01_me1_y_mb.njm', 'damage01_me1_y_mb.njm', 'damage02_me1_y_mb.njm', 'wait01_me1_y_mb.njm', 'wait02_me1_y_mb.njm'] },
  { descriptor: 0x009bd090, bml: 'bm_ene_darkgunner.bml',
    models: ['re5_b_cly_cy_line.nj', 're5_b_gunner_body.nj', 're5_b_rcly_cy_line.nj', 'shockwave.nj'],
    motions: ['attack_re5_b_body.njm', 'await_re5_b_body.njm', 'damage2_re5_b_body.njm', 'damage_re5_b_body.njm', 'die_re5_b_body.njm', 'drop_re5_b_body.njm', 'duckdame_re5_b_body.njm', 'duckdie_re5_b_body.njm', 'duckroop_re5_b_body.njm', 'duckwake_re5_b_body.njm', 'duck_re5_b_body.njm', 'move_re5_b_body.njm', 'pullback_re5_b_body.njm', 'wait_re5_b_body.njm'] },
  { descriptor: 0x009bd284, bml: 'bm_ene_del_depth.bml', low: 'bm_ene_del_depth_low.bml', lowDescriptor: 0x009bd2d8,
    models: ['swim_body.nj', 'swim_disc.nj', 'swim_kirai.nj'],
    motions: ['changea_swim_disc.njm', 'changeb_swim_disc.njm', 'damage_swim_disc.njm', 'dead_swim_disc.njm', 'move_swim_disc.njm', 'attack_swim_body.njm', 'attack2_swim_body.njm', 'changea_swim_body.njm', 'changeb_swim_body.njm', 'damage_swim_body.njm', 'dead_swim_body.njm', 'wait_swim_body.njm'] },
  { descriptor: 0x009bd534, bml: 'bm_ene_biter_body.bml', low: 'bm_ene_biter_body_low.bml', lowDescriptor: 0x009bd578,
    models: ['biter_body.nj'],
    motions: ['attack_biter_body.njm', 'beam_biter_body.njm', 'damage_biter_body.njm', 'dead_biter_body.njm', 'kamae_biter_body.njm', 'run_biter_body.njm', 'stop_biter_body.njm', 'tpkyu_biter_body.njm', 'wait_biter_body.njm', 'walk_biter_body.njm'] },
  { descriptor: 0x009bd6c8, bml: 'bm_ene_df1_saver.bml',
    models: ['df1_s_kil_body.nj'],
    motions: ['aseri_df1_s_kil_body.njm', 'atack_df1_s_kil_body.njm', 'damage_df1_s_kil_body.njm', 'deadb_df1_s_kil_body.njm', 'dead_df1_s_kil_body.njm', 'defdam_df1_s_kil_body.njm', 'defence_df1_s_kil_body.njm', 'jump_df1_s_kil_body.njm', 'nail_df1_s_kil_body.njm', 'wait_df1_s_kil_body.njm', 'walk_df1_s_kil_body.njm'] },
  { descriptor: 0x009bd934, bml: 'bm_ene_df3_dimedian.bml', ultimate: 'bm_ene_df3_dimedian_a.bml',
    models: ['df3_sl_wala_body.nj', 'df3_ssl_wala_body.nj', 'df3_s_wala_body.nj'],
    motions: ['appear_bm1_s_wala_body.njm', 'atackl_bm1_s_wala_body.njm', 'atackr_bm1_s_wala_body.njm', 'damage_bm1_s_wala_body.njm', 'deadb_bm1_s_wala_body.njm', 'dead_bm1_s_wala_body.njm', 'leader_bm1_s_wala_body.njm', 'mihari_bm1_s_wala_body.njm', 'run_bm1_s_wala_body.njm', 'stund_bm1_s_wala_body.njm', 'wakeup_bm1_s_wala_body.njm', 'walk_bm1_s_wala_body.njm'] },
  { descriptor: 0x009bdac4, bml: 'bm_ene_abgc01_wola_body.bml', low: 'bm_ene_abgc01_wola_body_low.bml', lowDescriptor: 0x009bdb08,
    models: ['abgc01_wola_body.nj', 'abgc01l_wola_body.nj'],
    motions: ['atack_l_abgc01_wola_body.njm', 'atack_r_abgc01_wola_body.njm', 'damage_abgc01_wola_body.njm', 'dead_abgc01_wola_body.njm', 'odori_abgc01_wola_body.njm', 'wait_abgc01_wola_body.njm', 'wait2_abgc01_wola_body.njm', 'wake_abgc01_wola_body.njm', 'walk_abgc01_wola_body.njm'] },
  { descriptor: 0x009bdd2c, bml: 'bm_ene_dubchik.bml', ultimate: 'bm_ene_dubchik_a.bml',
    models: ['me2_y_me2.nj', 'me2_y_me2_2.nj'],
    motions: ['damage_b_me2_y_me2.njm', 'damage_f_me2_y_me2.njm', 'kamae01_me2_y_me2.njm', 'kamae02_me2_y_me2.njm', 'revival_b_me2_y_me2.njm', 'revival_f_me2_y_me2.njm', 'scratch01_me2_me2.njm', 'scratch02_me2_y_me2.njm', 'shoot01_me2_y_me2.njm', 'shoot02_me2_me2.njm', 'starting_me2_y_me2.njm', 'wait01_me2_y_me2.njm', 'wait02_me2_y_me2.njm', 'walk01_me2_y_me2.njm', 'walk02_me2_y_me2.njm'] },
  { descriptor: 0x009bddfc, bml: 'bm_ene_epsilon.bml',
    models: ['re6_b_bcbody.nj', 're6_b_bal_body.nj', 're6_b_claw_body.nj', 'bc1_bc_body.nj', 'bc2_body.nj', 're6_hahen1.nj', 're6_b1_hahen2.nj'],
    motions: ['body_wait_re6_b_bcbody.njm', 'bal_wait_re6_b_bal_body.njm', 'claw_wait_re6_b_claw_body.njm', 'bc_rot_bc1_bc_body.njm'] },
  { descriptor: 0x009bdfe0, bml: 'bm_ene_me1_gee.bml', low: 'bm_ene_me1_gee_low.bml', lowDescriptor: 0x009be010,
    models: ['me1_y_mb.nj', 'needle_body.gj'],
    motions: ['attack_me1_y_mb.njm', 'damage_me1_y_mb.njm', 'tuki_me1_y_mb.njm', 'wait_me1_y_mb.njm'] },
  { descriptor: 0x009be254, bml: 'bm_ene_gibbles.bml', low: 'bm_ene_gibbles_low.bml', lowDescriptor: 0x009be298,
    models: ['gibb_body.nj'],
    motions: ['attack_gibb_body.njm', 'damage_gibb_body.njm', 'dead_gibb_body.njm', 'guard_gibb_body.njm', 'jump_gibb_body.njm', 'kamae_gibb_body.njm', 'landing_gibb_body.njm', 'punch_gibb_body.njm', 'wait_gibb_body.njm', 'walk_gibb_body.njm'] },
  { descriptor: 0x009be4e4, bml: 'bm_ene_bm5_gibon_u.bml', low: 'bm_ene_bm5_gibon_u_low.bml', lowDescriptor: 0x009be528,
    models: ['gibon.nj', 'gibonb_gibon.nj'],
    motions: ['attack_gibon.njm', 'back_gibon.njm', 'damage_gibon.njm', 'dead_gibon.njm', 'fire_gibon.njm', 'hoe_gibon.njm', 'run_gibon.njm', 'wait_gibon.njm', 'walk_gibon.njm'] },
  { descriptor: 0x009be688, bml: 'bm_ene_gi_gue.bml', low: 'bm_ene_gi_gue_low.bml', lowDescriptor: 0x009be6d0,
    models: ['gi_gue_all.nj', 'gi_gue_missile.nj', 'gi_gue_barrier.nj'],
    motions: ['damage_gi_gue_all.njm', 'fire_gi_gue_all.njm', 'missile_gi_gue_all.njm', 'move_gi_gue_all.njm', 'wait_gi_gue_all.njm', 'rot_gi_gue_missile.njm', 'exp_exp_barrier.njm', 'on_on_barrier.njm', 'redu_redu_barrier.njm'] },
  { descriptor: 0x009be804, bml: 'bm_ene_gyaranzo.bml', ultimate: 'bm_ene_gyaranzo_a.bml',
    models: ['me4_y_hahen01.nj', 'me4_y_hahen02.nj', 'me4_y_hahen03.nj', 'me4_y_me4.nj', 'me4_y_me4p.nj', 'me4_y_mine.nj', 'me4_y_missile.nj'],
    motions: ['attack_me4_y_me4.njm', 'damage01_me4_y_me4.njm', 'damage02_me4_y_me4.njm', 'deth_me4_y_me4.njm', 'wait_me4_y_me4.njm', 'walk01_me4_y_me4.njm', 'walk02_me4_y_me4.njm', 'walk03_me4_y_me4.njm'] },
  { descriptor: 0x009bea5c, bml: 'bm_ene_bm9_s_mericarol.bml', low: 'bm_ene_bm9_s_mericarol_low.bml', lowDescriptor: 0x009bea98,
    models: ['bm9_s_meri_body.nj'],
    motions: ['atack_bm9_s_meri_body.njm', 'damage_bm9_s_meri_body.njm', 'dead_bm9_s_meri_body.njm', 'fire_bm9_s_meri_body.njm', 'laugh_bm9_s_meri_body.njm', 'wait_bm9_s_meri_body.njm', 'wait2_bm9_s_meri_body.njm', 'wake_bm9_s_meri_body.njm'] },
  { descriptor: 0x009bed20, bml: 'bm_ene_re8_merill_lia.bml', low: 'bm_ene_re8_merill_lia_low.bml', lowDescriptor: 0x009bed70,
    models: ['re8_b_beast_wola_body.nj', 're8_b_srbeast_wola_body.nj'],
    motions: ['appear_re8_b_beast_wola_body.njm', 'atk_a_re8_b_beast_wola_body.njm', 'atk_b_re8_b_beast_wola_body.njm', 'damage_re8_b_beast_wola_body.njm', 'dead_re8_b_beast_wola_body.njm', 'stand_re8_b_beast_wola_body.njm', 'wait_re8_b_beast_wola_body.njm', 'wakeup_re8_b_beast_wola_body.njm', 'walk_re8_b_beast_wola_body.njm', 'run_bm1_s_wala_body.njm', 'kahun_re8_b_beast_wola_body.njm', 'umari_re8_b_beast_wola_body.njm'] },
  { descriptor: 0x009bee9c, bml: 'bm_ene_morfos.bml', low: 'bm_ene_morfos_low.bml', lowDescriptor: 0x009beed8,
    models: ['kabe_arm.nj', 'kabe_body.nj', 'kabe_wall.nj'],
    motions: ['attack_kabe_arm.njm', 'attack_kabe_body.njm', 'beam_kabe_body.njm', 'damage_kabe_body.njm', 'dead_kabe_body.njm', 'wait_kabe_body.njm'] },
  { descriptor: 0x009bf0bc, bml: 'bm_ene_nanodrago.bml',
    models: ['bm6_s_drc_body.nj'],
    motions: ['beam_bm6_s_drc_body.njm', 'damfly_bm6_s_drc_body.njm', 'damgrd_bm6_s_drc_body.njm', 'deadg_bm6_s_drc_body.njm', 'deads_bm6_s_drc_body.njm', 'fly_bm6_s_drc_body.njm', 'joy_bm6_s_drc_body.njm', 'land_bm6_s_drc_body.njm', 'lasfly_bm6_s_drc_body.njm', 'lift_bm6_s_drc_body.njm', 'wait_bm6_s_drc_body.njm', 'walk_bm6_s_drc_body.njm'] },
  { descriptor: 0x009bf708, bml: 'bm_ene_recobox.bml', low: 'bm_ene_recobox_low.bml', lowDescriptor: 0x009bf760,
    models: ['me7_all.nj', 'me7_box_all.nj', 'bomb_body.nj', 'b_parts_b_parts01.gj', 'b_parts_b_parts02.gj', 'b_parts_b_parts03.gj'],
    motions: ['close_me7_box_all.njm', 'close_only_me7_box_all.njm', 'open_me7_box_all.njm', 'open_only_me7_box_all.njm', 'attack_me7_all.njm', 'b_attack_me7_all.njm', 'damage_me7_all.njm', 'dethpose_me7_all.njm', 'start_me7_all.njm', 'wait_me7_all.njm'] },
  { descriptor: 0x009bf984, bml: 'bm_ene_me3_shinowa.bml', ultimate: 'bm_ene_me3_shinowa_a.bml',
    models: ['me3_y_me3.nj'],
    motions: ['apper_me3_y_me3.njm', 'backstep_me3_y_me3.njm', 'damage_me3_y_me3.njm', 'death_me3_y_me3.njm', 'f_attack_me3_y_me3.njm', 'sword_me3_y_me3.njm', 'transform_me3_y_me3.njm', 't_wait_me3_y_me3.njm', 'wait_me3_y_me3.njm', 'walk_me3_y_me3.njm'] },
  { descriptor: 0x009bfb08, bml: 'bm_ene_me3_shinowa_zoa.bml', low: 'bm_ene_me3_zoa_low.bml', lowDescriptor: 0x009bfb50,
    models: ['me3_y_me3.nj'],
    motions: ['t_wait_me3_y_me3.njm', 'apper_me3_y_me3.njm', 'backstep_me3_y_me3_1.njm', 'bareta_me3_y_me3.njm', 'damage_me3_y_me3.njm', 'death_me3_y_me3.njm', 'f_attack_me3_y_me3.njm', 'sword_me3_y_me3.njm', 'transform_me3_y_me3_1.njm', 'wait_me3_y_me3.njm', 'walk_me3_y_me3.njm'] },
  { descriptor: 0x009bff30, bml: 'bm_ene_re4_sorcerer.bml', ultimate: 'bm_ene_re4_sorcerer_a.bml',
    models: ['re4_b_sorcer_body.nj', 're4_b_bit.nj'],
    motions: ['attack2_re4_b_body.njm', 'attack3_re4_b_body.njm', 'attack1_re4_b_body.njm', 'cure_re4_b_body.njm', 'damage_re4_b_body.njm', 'die_re4_b_body.njm', 'enter_re4_b_body.njm', 'wait_re4_b_body.njm'] },
  { descriptor: 0x009c00a8, bml: 'bm_ene_me3_stelthshinowa.bml', low: 'bm_ene_me3_beril_low.bml', lowDescriptor: 0x009c00f0,
    models: ['me3_y_me3.nj'],
    motions: ['t_wait_me3_y_me3.njm', 'apper_me3_y_me3.njm', 'backstep_me3_y_me3_1.njm', 'bareta_me3_y_me3.njm', 'damage_me3_y_me3.njm', 'death_me3_y_me3.njm', 'f_attack_me3_y_me3.njm', 'sword_me3_y_me3.njm', 'transform_me3_y_me3_1.njm', 'wait_me3_y_me3.njm', 'walk_me3_y_me3.njm'] },
  { descriptor: 0x009c0414, bml: 'bm_ene_astark.bml',
    models: ['nj00_astark.nj', 'sonic_wave.nj'],
    motions: ['cstand_bm2c_s_moj_body.njm', 'cwalk_bm2c_s_moj_body.njm', 'damage_bm2f_s_moj_body.njm', 'dead_bm2f_s_moj_body.njm', 'deadb_bm2f_s_moj_body.njm', 'giva_bm2f_s_moj_body.njm', 'hoe_bm2f_s_moj_body.njm', 'jump_bm2f_s_moj_body.njm', 'punch_bm2f_s_moj_body.njm', 'punch_r_bm2f_s_moj_body.njm', 'stand_bm2f_s_moj_body.njm', 'walk_bm2f_s_moj_body.njm'] },
  { descriptor: 0x009c077c, bml: 'bm_ene_boota.bml',
    models: ['nj00_boota.nj', 'nj01_ze_boota.nj', 'nj02_ba_boota.nj'],
    motions: ['appear_bm1_s_wala_body.njm', 'atackl_bm1_s_wala_body.njm', 'atackr_bm1_s_wala_body.njm', 'damage_bm1_s_wala_body.njm', 'dead_bm1_s_wala_body.njm', 'deadb_bm1_s_wala_body.njm', 'leader_bm1_s_wala_body.njm', 'mihari_bm1_s_wala_body.njm', 'run_bm1_s_wala_body.njm', 'rush_bm1_s_wala_body.njm', 'stund_bm1_s_wala_body.njm', 'wakeup_bm1_s_wala_body.njm', 'walk_bm1_s_wala_body.njm'] },
  { descriptor: 0x009c0c38, bml: 'bm_ene_dolphon.bml',
    models: ['nj00_dolphon.nj', 'nj01_dolphon_e.nj'],
    motions: ['attack_biter_body.njm', 'beam_biter_body.njm', 'damage_biter_body.njm', 'dead_biter_body.njm', 'kamae_biter_body.njm', 'run_biter_body.njm', 'stop_biter_body.njm', 'tokyu_biter_body.njm', 'wait_biter_body.njm', 'walk_biter_body.njm'] },
  { descriptor: 0x009c0f94, bml: 'bm_ene_girtablulu.bml',
    models: ['nj00_girtablulu.nj'],
    motions: ['atack_bm9_s_meri_body.njm', 'damage_bm9_s_meri_body.njm', 'dead_bm9_s_meri_body.njm', 'eyedamage_bm9_s_meri_body.njm', 'fire_bm9_s_meri_body.njm', 'laugh_bm9_s_meri_body.njm', 'wait2_bm9_s_meri_body.njm', 'wait_bm9_s_meri_body.njm', 'wake_bm9_s_meri_body.njm'] },
  { descriptor: 0x009c1278, bml: 'bm_ene_golan.bml',
    models: ['nj00_golan.nj', 'nj01_golan_d.nj', 'nj02_golan_p.nj'],
    motions: ['appear_bm1_s_wala_body.njm', 'atackl_bm1_s_wala_body.njm', 'atackr_bm1_s_wala_body.njm', 'damage_bm1_s_wala_body.njm', 'dead_bm1_s_wala_body.njm', 'deadb_bm1_s_wala_body.njm', 'leader_bm1_s_wala_body.njm', 'mihari_bm1_s_wala_body.njm', 'run_bm1_s_wala_body.njm', 'stund_bm1_s_wala_body.njm', 'wakeup_bm1_s_wala_body.njm', 'walk_bm1_s_wala_body.njm'] },
  { descriptor: 0x009c160c, bml: 'bm_ene_yowie.bml',
    models: ['nj00_yowie.nj', 'nj01_s_lizard.nj'],
    motions: ['dams_bm5_s_kem_body.njm', 'deadl_bm5_s_kem_body.njm', 'deadr_bm5_s_kem_body.njm', 'eat_bm5_s_kem_body.njm', 'hoe_bm5_s_kem_body.njm', 'hunt_bm5_s_kem_body.njm', 'okil_bm5_s_kem_body.njm', 'okir_bm5_s_kem_body.njm', 'runb_bm5_s_kem_body.njm', 'run_bm5_s_kem_body.njm', 'sleep_bm5_s_kem_body.njm', 'stdup_bm5_s_kem_body.njm', 'wait_bm5_s_kem_body.njm', 'walk_bm5_s_kem_body.njm'] },
  { descriptor: 0x009c1930, bml: 'bm_ene_zu.bml',
    models: ['nj00_zu.nj', 'nj01_pazuzu.nj'],
    motions: ['beam_bm6_s_drc_body.njm', 'damfly_bm6_s_drc_body.njm', 'damgrd_bm6_s_drc_body.njm', 'deadg_bm6_s_drc_body.njm', 'deads_bm6_s_drc_body.njm', 'fly_bm6_s_drc_body.njm', 'joy_bm6_s_drc_body.njm', 'land_bm6_s_drc_body.njm', 'lasfly_bm6_s_drc_body.njm', 'lift_bm6_s_drc_body.njm', 'plane_body.njm', 'wait_bm6_s_drc_body.njm', 'walk_bm6_s_drc_body.njm', 'walk_s_drc_body.njm'] },
  { descriptor: 0x009c1de8, bml: 'bm_ene_melissa.bml',
    models: ['nj00_melissa_a.nj', 'nj01_melissa_aa.nj'],
    motions: ['apear_bm4_ps_mb_body.njm', 'apper_bm4_ps_ma_body.njm', 'atack_bm4_ps_ma_body.njm', 'attack_merisa.njm', 'damage_bm4_ps_ma_body.njm', 'death_merisa.njm', 'hi_jump_merisa.njm', 'jump_merisa.njm', 'kie_bm4_ps_ma_body.njm', 'kie_bm4_ps_mb_body.njm', 'melissa_death_f_merisa.njm', 'move_bm4_ps_mb_body.njm', 'move_bm4_ps_mb_body.njs', 'nodam_bm4_ps_ma_body.njm', 'tlatk_bm4_ps_ma_tail.njm', 'tope_merisa.njm', 'wait2_bm4_ps_ma_body.njm', 'wait_bm4_ps_ma_body.njm', 'wait_bm4_ps_mb_body.njm', 'wait_bm4_ps_mb_body.njs'] },
  { descriptor: 0x009f7680, bml: 'bm_ene_boss09.bml',
    models: ['boss00_root.nj', 'boss01_root.nj', 'boss02_root.nj'],
    motions: ['1st_advent_root.njm', '1st_attack_root.njm', '1st_bark_root.njm', '1st_correct_A_root.njm', '1st_correct_B_root.njm', '1st_correct_C_root.njm', '1st_damage_A_root.njm', '1st_damage_B_root.njm', '1st_diving_root.njm', '1st_move_root.njm', '1st_rebound_A_root.njm', '1st_rebound_B_root.njm', '1st_rebound_C_root.njm', '1st_sandsonic_root.njm', '1st_standby_root.njm', '2nd_advent_root.njm', '2nd_damage_root.njm', '2nd_daunt_root.njm', '2nd_diving_root.njm', '2nd_headadvent_root.njm', '2nd_missile_root.njm', '2nd_nemesis_root.njm', '2nd_sandlaser_A_root.njm', '2nd_sandlaser_B_root.njm', '2nd_sandstorm_root.njm', '2nd_skulk_root.njm', '2nd_standby_root.njm', 'event_1st_2nd_root.njm', 'event_appear_root.njm', 'event_die_root.njm', 'event_escape_root.njm'] },
  { descriptor: 0x009bf3d0, bml: 'bm7_s_paa_body.bml',
    models: ['bm7_s_paa_body.nj', 'bm7_s_pal_body.nj', 'bm7_s_par_body.nj'],
    motions: ['atack_bm7_s_pal_body.njm', 'atack_bm7_s_par_body.njm', 'beamdwn_bm7_s_paa_body.njm', 'beamup_bm7_s_paa_body.njm', 'btamed_bm7_s_paa_body.njm', 'btameu_bm7_s_paa_body.njm', 'bunri_bm7_s_pal_body.njm', 'bunri_bm7_s_par_body.njm', 'cry_bm7_s_paa_body.njm', 'damage_bm7_s_paa_body.njm', 'damage_bm7_s_pal_body.njm', 'damage_bm7_s_par_body.njm', 'deada_bm7_s_paa_body.njm', 'deada_bm7_s_pal_body.njm', 'deada_bm7_s_par_body.njm', 'deadb_bm7_s_paa_body.njm', 'deadb_bm7_s_pal_body.njm', 'deadb_bm7_s_par_body.njm', 'gattai_bm7_s_pal_body.njm', 'gattai_bm7_s_par_body.njm', 'heal_bm7_s_pal_body.njm', 'run_bm7_s_pal_body.njm', 'run_bm7_s_par_body.njm', 'wait_bm7_s_paa_body.njm', 'wait_bm7_s_pal_body.njm', 'wait_bm7_s_par_body.njm', 'walk_bm7_s_paa_body.njm', 'walk_bm7_s_pal_body.njm', 'walk_bm7_s_par_body.njm', 'walkl_bm7_s_paa_body.njm', 'walkr_bm7_s_paa_body.njm'] },
  { descriptor: 0x009bfd48, bml: 'bm4_ps_ma_body.bml',
    models: ['bm4_ps_ma_body.nj', 'bm4_ps_ma_tail.nj', 'bm4_ps_mar_body.nj', 'bm4_ps_mar_tail.nj', 'bm4_ps_mb_body.nj', 'bm4_ps_mbr_body.nj'],
    motions: ['apear_bm4_ps_mb_body.njm', 'apper_bm4_ps_ma_body.njm', 'atack_bm4_ps_ma_body.njm', 'damage_bm4_ps_ma_body.njm', 'kie_bm4_ps_ma_body.njm', 'kie_bm4_ps_mb_body.njm', 'move_bm4_ps_mb_body.njm', 'move_bm4_ps_mb_body.njs', 'nodam_bm4_ps_ma_body.njm', 'tlatk_bm4_ps_ma_tail.njm', 'wait_bm4_ps_ma_body.njm', 'wait_bm4_ps_mb_body.njm', 'wait_bm4_ps_mb_body.njs', 'wait2_bm4_ps_ma_body.njm'] },
  { descriptor: 0x009c4b8c, bml: 'bm_fs_obj_zombie_con.bml',
    models: ['fs_obj_zombie_con.gj'],
    motions: [] },
  { descriptor: 0x009a3c9c, bml: 'bm_boss1_dragon.bml', ultimate: 'bm_boss1_dragon_a.bml',
    models: ['boss1_s_nb_dragon.nj', 'boss1_s_sd_dragon.nj'],
    motions: ['bossop_boss1_s_nb_dragon.njm', 'daml_boss1_s_nb_dragon.njm', 'dams_boss1_s_nb_dragon.njm', 'dead_boss1_s_nb_dragon.njm', 'down_boss1_s_nb_dragon.njm', 'fire_boss1_s_nb_dragon.njm', 'flyshot_boss1_s_nb_dragon.njm', 'fly_boss1_s_nb_dragon.njm', 'frin_boss1_s_nb_dragon.njm', 'frloop_boss1_s_nb_dragon.njm', 'frout_boss1_s_nb_dragon.njm', 'kiri_boss1_s_nb_dragon.njm', 'land_boss1_s_nb_dragon.njm', 'lift_boss1_s_nb_dragon.njm', 'nkdown_boss1_s_nb_dragon.njm', 'nkup_boss1_s_nb_dragon.njm', 'nobi_boss1_s_nb_dragon.njm', 'stand_boss1_s_nb_dragon.njm', 'tatk_boss1_s_nb_dragon.njm', 'tobidasi_boss1_s_nb_dragon.njm', 'tukomi_boss1_s_nb_dragon.njm', 'walk_boss1_s_nb_dragon.njm', 'wgwalk_boss1_s_nb_dragon.njm', 'wing_boss1_s_nb_dragon.njm', 'wngclose_boss1_s_nb_dragon.njm', 'wngopn_boss1_s_nb_dragon.njm'] },
  { descriptor: 0x009a46f0, bml: 'bm_boss2_de_rol_le.bml', ultimate: 'bm_boss2_de_rol_le_a.bml',
    models: ['boss2_b_derorure_fin_b.nj', 'boss2_b_derorure_fin_a.nj', 'boss2_b_derorure_body.nj', 'boss2_b_derorure_sting.nj', 'boss2_b_derorure_tentacle.nj', 'boss2_b_helm_break.nj', 'boss2_b_shell_break.nj'],
    motions: ['beam02_boss2_b_body.njm', 'beamwait_boss2_b_body.njm', 'beam_a_boss2_b_body.njm', 'beam_b_boss2_b_body.njm', 'beam_c_boss2_b_body.njm', 'bite_lloop_boss2_b_body.njm', 'bite_rloop_boss2_b_body.njm', 'die_boss2_b_body.njm', 'enter_boss2_b_body.njm', 'fd02_boss2_b_body.njm', 'fjump_boss2_b_body.njm', 'forward_boss2_b_body.njm', 'lrjump_boss2_b_body.njm', 'l_bite_boss2_b_body.njm', 'rljump_boss2_b_body.njm', 'r_bite_boss2_b_body.njm', 'scatter_boss2_b_body.njm', 'tloop_boss2_b_tentacle.njm'] },
  { descriptor: 0x009a80b4, bml: 'bm_boss5_gryphon.bml',
    models: ['boss5_s_body.nj', 'boss5_ss_body.nj', 'lo_boss5_s_body.nj', 'lo_boss5_ss_body.nj'],
    motions: ['fly_boss5_s_body.njm', 'hoe_boss5_s_body.njm', 'kakuin_boss5_s_body.njm', 'kakuland_boss5_s_body.njm', 'kakuout_boss5_s_body.njm', 'kaku_boss5_s_body.njm', 'land_boss5_s_body.njm', 'op_boss5_s_body.njm', 'shot_boss5_s_body.njm', 'stand_boss5_s_body.njm', 'takeoff_boss5_s_body.njm', 'walk_boss5_s_body.njm', 'huseout_boss5_s_body.njm', 'houko_boss5_s_body.njm', 'huse_boss5_s_body.njm', 'husein_boss5_s_body.njm', 'dead_boss5_s_body.njm', 'kiri_boss5_s_body.njm', 'kiriland_boss5_s_body.njm', 'kirin_boss5_s_body.njm', 'kiriout_boss5_s_body.njm', 'run_boss5_s_body.njm', 'runin_boss5_s_body.njm', 'runout_boss5_s_body.njm', 'tuno_boss5_s_body.njm', 'tunoin_boss5_s_body.njm', 'tunout_boss5_s_body.njm'] },
  { descriptor: 0x009abb4c, bml: 'bm_boss7_de_rol_le_c.bml',
    models: ['boss2_b_derorure_body.nj', 'boss2_b_derorure_tentacle.nj', 'boss2_b_helm_break.nj', 'boss2_b_shell_break.nj', 'ikada_h_hahen.gj', 'hige_at01_tentacle.nj'],
    motions: ['beam02_boss2_b_body.njm', 'beamwait_boss2_b_body.njm', 'beam_a_boss2_b_body.njm', 'beam_b_boss2_b_body.njm', 'beam_c_boss2_b_body.njm', 'bite_lloop_boss2_b_body.njm', 'bite_rloop_boss2_b_body.njm', 'ed_boss2_b_derorure_body.njm', 'op_boss2_b_derorure_body.njm', 'fd02_boss2_b_body.njm', 'fjump_boss2_b_body.njm', 'forward_boss2_b_body.njm', 'lrjump_boss2_b_body.njm', 'l_bite_boss2_b_body.njm', 'rljump_boss2_b_body.njm', 'r_bite_boss2_b_body.njm', 'scatter_boss2_b_body.njm', 'tloop_boss2_b_tentacle.njm', 'hige_down_hige_down_tentacle.njm', 'hige_up_hige_up_tentacle.njm', 'hige_wait_hige_wait_tentacle.njm'] },
  { descriptor: 0x009ac3d0, bml: 'bm_boss8_dragon.bml',
    models: ['boss1_s_nb_dragon.nj', 'lo_boss1_s_nb_dragon.nj', 'boss1_s_sd_dragon.nj'],
    motions: ['dead_boss1_s_nb_dragon.njm', 'bossopgc_boss1_s_nb_dragon.njm', 'down_boss1_s_nb_dragon.njm', 'frin_boss1_s_nb_dragon.njm', 'frloop_boss1_s_nb_dragon.njm', 'frout_boss1_s_nb_dragon.njm', 'land_boss1_s_nb_dragon.njm', 'lift_boss1_s_nb_dragon.njm', 'nkdown_boss1_s_nb_dragon.njm', 'nkup_boss1_s_nb_dragon.njm', 'nobi_boss1_s_nb_dragon.njm', 'stand_boss1_s_nb_dragon.njm', 'tatk_boss1_s_nb_dragon.njm', 'walk_boss1_s_nb_dragon.njm', 'wngclose_boss1_s_nb_dragon.njm', 'wngopn_boss1_s_nb_dragon.njm', 'daml_boss1_s_nb_dragon.njm', 'dams_boss1_s_nb_dragon.njm', 'fire_boss1_s_nb_dragon.njm', 'fly_boss1_s_nb_dragon.njm', 'flyshot_boss1_s_nb_dragon.njm', 'kiri_boss1_s_nb_dragon.njm', 'tobidasi_boss1_s_nb_dragon.njm', 'tukomi_boss1_s_nb_dragon.njm', 'wgwalk_boss1_s_nb_dragon.njm', 'wing_boss1_s_nb_dragon.njm'] },
  { descriptor: 0x009a4dc8, bml: 'bm_boss3_volopt.bml', ultimate: 'bm_boss3_volopt_ap.bml',
    models: ['fe_obj_hira_kage.nj', 'fe_obj_vo_mo_dai_aka.gj', 'fe_obj_vo_mo_dai_ao.gj', 'fe_obj_vo_mo_dai_hakai.gj', 'fe_obj_vo_mo_sho01_aka.gj', 'fe_obj_vo_mo_sho01_ao.gj', 'fe_obj_vo_mo_sho01_hakai.gj', 'fe_obj_vo_mo_sho02_aka.gj', 'fe_obj_vo_mo_sho02_ao.gj', 'fe_obj_vo_mo_sho02_hakai.gj', 'fe_obj_vo_mo_sho03_aka.gj', 'fe_obj_vo_mo_sho03_ao.gj', 'fe_obj_vo_mo_sho03_hakai.gj', 'fe_obj_vo_futa_moto.nj', 'fe_obj_vo_tenjo_hahen01.nj', 'fe_obj_vo_tenjo_hahen02.nj', 'fs_obj_hiraishin_a.nj', 'me5p01_y_all.nj', 'me5p02_y_cage.nj', 'me5p02_y_all.nj', 'me5p02_y_all_parts.nj', 'me5p02_y_broken01.nj', 'me5p02_y_missile.nj', 'me5p02_y_pillar.nj', 'me5_y_all.nj'],
    motions: ['attack_me5p01_y_all.njm', 'b_attack_me5p02_y_all.njm', 'damage_me5_y_all.njm', 'damage_me5p01_y_all.njm', 'damage_me5p02_y_all.njm', 'death_me5p02_y_all.njm', 'fs_obj_hiraishin_a.njm', 'fs_obj_hiraishin_b.njm', 'fs_obj_hiraishin_c.njm', 'f_attack_me5p02_y_all.njm', 'l_attack_me5p02_y_all.njm', 'r_attack_me5p02_y_all.njm', 'start_me5p01_y_all.njm', 'start_me5p02_y_all.njm', 'wait_me5_y_all.njm', 'wait_me5p01_y_all.njm', 'wait_me5p02_y_all.njm'] },
  { descriptor: 0x009a5900, bml: 'darkfalz_dat.bml',
    models: ['df1_anzen.nj', 'df1_s_body.nj', 'df1_s_da_heada.nj', 'df1_s_db_heada.nj', 'df1_s_dc_heada.nj', 'df1_s_dodai.nj', 'df1_s_simobe.nj', 'df1_s_waist.nj', 'df2_s_body.nj', 'df2_s_dodai1.nj', 'df3_s_body.nj', 'df3_s_wing.nj', 'df3_sl_body.nj', 'df3_sl_wing.nj', 'df_event_tower.nj', 'df_rikomiraju_body.nj', 'fd_obj813_face.nj', 'fd_obj813_flower01.nj', 'rico_ring3_rico_ring.nj'],
    motions: ['beaml_df1_s_body.njm', 'beaml_df1_s_root.njm', 'beaml_df2_s_body.njm', 'beaml_df2_s_dodai1.njm', 'beamr_df1_s_body.njm', 'beamr_df1_s_root.njm', 'beamr_df2_s_body.njm', 'beamr_df2_s_dodai1.njm', 'damage_df1_s_body.njm', 'damage_df1_s_da_heada.njm', 'damage_df1_s_dodai.njm', 'damage_df1_s_root.njm', 'damage_df2_s_body.njm', 'damage_df2_s_dodai1.njm', 'damage_df3_s1_wing.njm', 'damage_df3_s_body.njm', 'damage_df3_s_wing.njm', 'dead1_df1_s_body.njm', 'dead1_df1_s_da_heada.njm', 'dead1_df1_s_root.njm', 'dead_df2_s_body.njm', 'dead_df2_s_dodai1.njm', 'dead_df3_s_body.njm', 'df1op_df1_s_body.njm', 'df1op_df1_s_da_heada.njm', 'df2op_df1_s_body.njm', 'df2op_df1_s_da_heada.njm', 'df2op_df2_s_body.njm', 'df2op_df2_s_dodai1.njm', 'df3_op_df2_s_body.njm', 'df3_op_df2_s_dodai1.njm', 'df3_op_df3_s1_wing.njm', 'df3_op_df3_s_body.njm', 'df3_op_df3_s_wing.njm', 'df3dead_df3_s_body.njm', 'df3dead_df_rikomiraju_body.njm', 'df_rikomiraju_body.njm', 'dwntec_df3_s_body.njm', 'fd_obj813_face.njm', 'fd_obj813_flower01.njm', 'haki_df1_s_da_heada.njm', 'haki_df1_s_root.njm', 'hakiin_df1_s_da_heada.njm', 'hakiin_df1_s_root.njm', 'hakiout_df1_s_da_heada.njm', 'hakiout_df1_s_root.njm', 'hoe_df1_s_body.njm', 'hoe_df1_s_da_heada.njm', 'hoe_df2_s_body.njm', 'hoe_df2_s_dodai1.njm', 'jisin_df2_s_body.njm', 'jisin_df2_s_dodai1.njm', 'jyousyou_df3_s1_wing.njm', 'jyousyou_df3_s_body.njm', 'jyousyou_df3_s_wing.njm', 'kakou_df3_s1_wing.njm', 'kakou_df3_s_body.njm', 'kakou_df3_s_wing.njm', 'laser_df3_s1_wing.njm', 'laser_df3_s_body.njm', 'laser_df3_s_wing.njm', 'lhassya_df1_s_body.njm', 'lhassya_df2_s_body.njm', 'lhassya_df2_s_dodai1.njm', 'lkiri_df3_s1_wing.njm', 'lkiri_df3_s_body.njm', 'lkiri_df3_s_wing.njm', 'ltame_df1_s_body.njm', 'ltame_df2_s_body.njm', 'rico_ring3_rico_ring.njm', 'ricoult1_df_rikomiraju_body.njm', 'ricoult2_df_rikomiraju_body.njm', 'rkiri_df3_s1_wing.njm', 'rkiri_df3_s_body.njm', 'rkiri_df3_s_wing.njm', 'uptec_df3_s_body.njm', 'wait_df1_s_body.njm', 'wait_df1_s_da_heada.njm', 'wait_df1_s_dodai.njm', 'wait_df1_s_root.njm', 'wait_df1_s_waist.njm', 'wait_df2_s_body.njm', 'wait_df2_s_dodai1.njm', 'wait_df3_s1_wing.njm', 'wait_df3_s_body.njm', 'wait_df3_s_wing.njm', 'wing_df2_s_body.njm', 'wing_df2_s_dodai1.njm', 'wing_wing_root.njm', 'yubi_df3_s_body.njm'] },
  { descriptor: 0x009a6c3c, bml: 'boss06_plotfalz_dat.bml',
    models: ['bossgc_laser.nj', 'bossgc_pf01_kirai.nj', 'bossgc_pf01_leg.nj', 'bossgc_pf02_body.nj', 'bossgc_pf02l_body.nj', 'bossgc_pf_mag.nj', 'bssgc_pf01_body.nj', 'flow_body.nj', 'flow_dark_body.nj', 'flow_sord.nj', 'flowen_aa_t_ok_head.nj', 'flowen_az_t_body.nj', 'lo_bossgc_pf01_leg.nj', 'lo_bossgc_pf02_body.nj', 'lo_bossgc_pf02l_body.nj', 'lo_bossgc_pf_mag.nj', 'lo_bssgc_pf01_body.nj', 'op_flow_mark.nj', 'wxmS02_k_m_sp_rbuki.nj'],
    motions: ['appear_bossgc_pf01_kirai.njm', 'bouend_bossgc_pf02_body.njm', 'bousou_bossgc_pf02_body.njm', 'dead_bossgc_pf01_leg.njm', 'dead_bossgc_pf_mag.njm', 'dead_bssgc_pf01_body.njm', 'dpb_bossgc_pf02_body.njm', 'end_bossgc_pf02_body.njm', 'flow_dark_body.njm', 'flowend1_flow_body.njm', 'flowend1_flow_sord.njm', 'flowend2_flow_body.njm', 'fukatu_bossgc_pf_mag.njm', 'grdwait_bossgc_pf01_leg.njm', 'grdwait_bssgc_pf01_body.njm', 'hoe_bssgc_pf01_body.njm', 'jump_bossgc_pf02_body.njm', 'jyut_a_bssgc_pf01_body.njm', 'jyut_b_bssgc_pf01_body.njm', 'jyut_c_bssgc_pf01_body.njm', 'jyut_d_bssgc_pf01_body.njm', 'jyut_e_bssgc_pf01_body.njm', 'kakusan_bssgc_pf01_body.njm', 'kakuside_bssgc_pf01_body.njm', 'kamae_bossgc_pf02_body.njm', 'kaming_bossgc_pf02_body.njm', 'kiri1_bossgc_pf02_body.njm', 'kiri2_bossgc_pf02_body.njm', 'kiri3_bossgc_pf02_body.njm', 'land_bossgc_pf01_leg.njm', 'land_bssgc_pf01_body.njm', 'op3_bossgc_pf01_leg.njm', 'op3_bssgc_pf01_body.njm', 'op_bossgc_pf01_leg.njm', 'op_bossgc_pf02_body.njm', 'op_bssgc_pf01_body.njm', 'op_op_flow_mark.njm', 'roll_bossgc_pf01_leg.njm', 'roll_bssgc_pf01_body.njm', 'sarch_bossgc_pf02_body.njm', 'sidetoup_bossgc_pf01_leg.njm', 'sidetoup_bssgc_pf01_body.njm', 'skwait2_bossgc_pf01_leg.njm', 'skysd_bssgc_pf01_body.njm', 'skywait_bossgc_pf01_leg.njm', 'skywait_bssgc_pf01_body.njm', 'sodatk_bssgc_pf01_body.njm', 'takeoff_bossgc_pf01_leg.njm', 'takeoff_bssgc_pf01_body.njm', 'tame_bossgc_pf_mag.njm', 'tinmoku_bossgc_pf_mag.njm', 'tlatk_bossgc_pf01_leg.njm', 'tlatk_bssgc_pf01_body.njm', 'uptoside_bssgc_pf01_body.njm', 'wait_bossgc_pf02_body.njm', 'wait_bossgc_pf_mag.njm', 'waitside_bssgc_pf01_body.njm', 'waitvsk_bossgc_pf02_body.njm', 'walk_bossgc_pf02_body.njm', 'walkgd_bossgc_pf02_body.njm', 'walkvsk_bossgc_pf02_body.njm', 'wxmS02_k_m_sp_rbuki.njm'] },
];

const BY_BML = new Map<string, EnemyAsset>();
for (const a of ENEMY_ASSETS) for (const n of [a.bml, a.ultimate, a.low, ...(a.aliases ?? [])]) if (n) BY_BML.set(n, a);

// Asset descriptor of an archive name (normal, Ultimate, low or alias).
export function enemyAsset(bml: string): EnemyAsset | null {
  return BY_BML.get(bml) ?? null;
}

export interface EnemyModelContext {
  area: number; // newserv/client area number
  episode: number; // 1, 2, 3 (= Episode 4), as in the join command
  difficulty: number; // 0..3
  event: number; // lobby event (join command)
  // DAT_00a46c64 == 0 (graphics detail option, FUN_00482ca0): Episode 2
  // loaders pick *_low.bml. Default: full detail.
  lowModels?: boolean;
  // DAT_009f9860: Ultimate models need an online game (FUN_00520e6c). Default true.
  online?: boolean;
}

export interface EnemyModelSpec {
  name: string; // client class (newserv naming)
  bml: string;
  models: number; // descriptor model count (motions start after these entries)
  parts: EnemyPartSpec[];
  textures?: string[]; // extra texture archives the parts use (EnemyPartSpec.textureArchive)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(Math.trunc(v), lo), hi);
const loop = (index: number, speed: number): EnemyMotionSpec => ({ index, speed, loop: true });
const once = (index: number, speed: number): EnemyMotionSpec => ({ index, speed, loop: false });

function pick(base: string, ctx: EnemyModelContext): string {
  const a = BY_BML.get(base)!;
  if (a.ultimate && ctx.difficulty === 3 && ctx.online !== false) return a.ultimate; // FUN_00520e6c
  if (a.low && ctx.lowModels) return a.low; // FUN_00482a20() == 0
  return a.bml;
}

function spec(name: string, bml: string, parts: EnemyPartSpec[]): EnemyModelSpec {
  const a = BY_BML.get(bml);
  if (!a) throw new Error(`no asset descriptor for ${bml}`);
  const textures = parts.map((p) => p.textureArchive).filter((t): t is string => !!t);
  return { name, bml, models: a.models.length, parts, ...(textures.length ? { textures } : {}) };
}

// Lobby event -> rappy season (FUN_00527934: DAT_00921ae0[event]): 1 -> 1
// (Christmas), 4 -> 2 (Easter), 5 -> 3 (Halloween), others 0.
export function rappySeason(event: number): number {
  return event === 1 ? 1 : event === 4 ? 2 : event === 5 ? 3 : 0;
}
// Descriptor table 0x009bbbc0[episode * 8 + season * 2 + ultimate] (Ep1/Ep2).
const RAPPY_BML = [
  ['bm_ene_lappy.bml', 'bm_ene_lappy_ap.bml'],
  ['bm_ene_lappy_xs.bml', 'bm_ene_lappy_ap_xs.bml'],
  ['bm_ene_lappy_es.bml', 'bm_ene_lappy_ap_es.bml'],
  ['bm_ene_lappy_hw.bml', 'bm_ene_lappy_ap_hw.bml'],
];

// Types whose object draws nothing itself (controllers).
export const NO_MODEL_TYPES = new Set([0xa3, 0xc2]);

// The model of an enemy set entry, or null for types that draw nothing (the
// Dark Gunner control enemy) or whose model is not decoded yet.
// params[0..4] = param1..5 (floats), params[5] = param6, params[6] = param7
// (FUN_00786848 stores them at +0x35c..+0x374).
export function enemyModelFor(e: EnemySet, ctx: EnemyModelContext): EnemyModelSpec | null {
  const p = e.params;
  const p6 = Math.trunc(p[5]);
  const ult = ctx.difficulty === 3 && ctx.online !== false;
  const ep = ctx.episode;
  switch (e.type) {
    // Hildebear: ctor 0x00515454, model FUN_005157e0 (param6 >= 1 -> Hildeblue,
    // model 2; else model 1), table 0x009bb420 slot 0 = stand, 0.5.
    case 0x40:
      return spec('TObjEneMoja', pick('bm_ene_bm2_moja.bml', ctx), [{ model: p6 >= 1 ? 2 : 1, motion: loop(9, 0.5) }]);
    // Rappy: ctor 0x00526d90, loader 0x00527934. Rare = param6 & 1.
    // Ep1: model 0, rare with re3_b_lappy_base_ao (Ultimate: _niji) textures;
    // Ep2: rare = model 1 (seasonal); Ep4: bm_ene_sandlappy, rare = model 1.
    // Table 0x009bbc20 slot 0 = wait, speed 0.9 (static init 0x00527890).
    case 0x41: {
      const rare = (p6 & 1) !== 0;
      const motion = loop(6, 0.9);
      if (ep === 3) return spec('TObjEneLappy', 'bm_ene_sandlappy.bml', [{ model: rare ? 1 : 0, motion }]);
      const bml = RAPPY_BML[rappySeason(ctx.event)][ult ? 1 : 0];
      if (ep === 2) return spec('TObjEneLappy', bml, [{ model: rare ? 1 : 0, motion }]);
      return spec('TObjEneLappy', bml, [{ model: 0, motion, ...(rare ? { textureArchive: ult ? 're3_b_lappy_base_niji.xvm' : 're3_b_lappy_base_ao.xvm' } : {}) }]);
    }
    // Monest: ctor 0x005191c0, model 1 (bm3_s_nest) with model 0's texture
    // list, table 0x009bb6a0 slot 0 = wait_bm3_s_nest, 0.3.
    case 0x42:
      return spec('TObjEneBm3FlyNest', pick('bm_ene_bm3_fly.bml', ctx), [{ model: 1, texlistOf: 0, motion: loop(14, 0.3) }]);
    // Savage / Barbarous Wolf: ctor 0x0051b2e8, FUN_0051b660: param2 >= 1 ->
    // model 1 with model 0's texture list; table 0x009bb860 slot 0 = wait, 0.8.
    case 0x43:
      return spec('TObjEneBm5Wolf', pick('bm_ene_bm5_wolf.bml', ctx), [p[1] >= 1 ? { model: 1, texlistOf: 0, motion: loop(12, 0.8) } : { model: 0, motion: loop(12, 0.8) }]);
    // Booma / Gobooma / Gigobooma: ctor 0x00535f1c, FUN_00536274 (param6 0, 1,
    // 2 -> models 0, 2, 1); table 0x009bc980 slot 0 = stund, 0.6.
    case 0x44:
      return spec('TObjEneBeast', pick('bm_ene_re8_b_beast.bml', ctx), [{ model: [0, 2, 1][clamp(p6, 0, 2)], motion: loop(9, 0.6) }]);
    // Grass Assassin: ctor 0x005249c8, model 0, table 0x009bbaa0 slot 0 = wait, 0.7.
    case 0x60:
      return spec('TObjGrass', pick('bm_ene_grass.bml', ctx), [{ model: 0, motion: loop(6, 0.7) }]);
    // Poison Lily / Del Lily (area 0x23, bm_ene_dkflower even in Ultimate):
    // ctor 0x005293ac starts slot 1 of 0x009bc280 = waitc (closed), 0.3.
    case 0x61:
      return spec('TObjEneRe2Flower', ctx.area === 0x23 ? 'bm_ene_dkflower.bml' : pick('bm_ene_re2_flower.bml', ctx), [{ model: 0, motion: loop(4, 0.3) }]);
    // Nano Dragon: ctor 0x0057f6b0, table 0x009befc0 slot 0 = wait (chains to itself), 0.8.
    case 0x62:
      return spec('TObjEneNanoDrago', 'bm_ene_nanodrago.bml', [{ model: 0, motion: loop(10, 0.8) }]);
    // Evil / Pal / Guil Shark: ctor 0x00512bd0, FUN_00512f94 (param6 0, 1, 2
    // -> models 2, 0, 1); table 0x009bb300 slot 0 = stund, 0.6.
    case 0x63:
      return spec('TObjEneShark', pick('bm_ene_bm1_shark.bml', ctx), [{ model: [2, 0, 1][clamp(p6, 0, 2)], motion: loop(9, 0.6) }]);
    // Pofuilly Slime: spawner 0x0059594c, slime ctor 0x00596000 / FUN_005997c8:
    // model 0x009bfbf0[rare] = 0; table 0x009bfc80 slot 0 = BML motion 10 (wait2), 0.5.
    case 0x64:
      return spec('TObjEneSlime', 'bm4_ps_ma_body.bml', [{ model: 0, motion: loop(10, 0.5) }]);
    // Pan Arms (combined): ctor 0x00582ef4, model 0, table 0x009bf220 slot 0 = wait, 0.7.
    case 0x65:
      return spec('TObjEnePanarms', 'bm7_s_paa_body.bml', [{ model: 0, motion: loop(23, 0.7) }]);
    // Dubchic / Gillchic: ctor in 0x00556600, model 0; Gillchic (param6 != 0)
    // draws with me2_y_me2_z(.xvm) (Ultimate _z_a). The ctor starts slot 5
    // (starting, chains to slot 0); idle = slot 0 of 0x009bdbe0 = wait01, 0.5.
    case 0x80:
      return spec('TObjEneDubchik', pick('bm_ene_dubchik.bml', ctx), [
        { model: 0, motion: loop(11, 0.5), ...(p6 !== 0 ? { textureArchive: ult ? 'me2_y_me2_z_a.xvm' : 'me2_y_me2_z.xvm' } : {}) },
      ]);
    // Garanz: ctor in 0x0056f8f4, model 3 (me4_y_me4), table 0x009be740 slot 0 = wait, 0.7.
    case 0x81:
      return spec('TObjEneGyaranzo', pick('bm_ene_gyaranzo.bml', ctx), [{ model: 3, motion: loop(4, 0.7) }]);
    // Sinow Beat / Gold: FUN_00590d74, model 0; Gold (param2 >= 1,
    // FUN_0058d660) uses the texture list copy with ids 0..2 -> 3..5 (loader
    // 0x0059051c); table 0x009bf8a0 slot 0 = t_wait, 0.5.
    case 0x82:
      return spec('TObjEneMe3ShinowaReal', pick('bm_ene_me3_shinowa.bml', ctx), [{ model: 0, motion: loop(7, 0.5), ...(p[1] >= 1 ? { texRemap: [3, 4, 5] } : {}) }]);
    // Canadine: model 0 (me1n_y_mb) with model 1's texture list (FUN_0053e2c0);
    // Canane: model 1. Table 0x009bce00 slot 0 = wait01, 0.2.
    case 0x83:
      return spec('TObjEneMe1Canadin', pick('bm_ene_me1_mb.bml', ctx), [{ model: 0, texlistOf: 1, motion: loop(4, 0.2) }]);
    case 0x84:
      return spec('TObjEneMe1CanadinLeader', pick('bm_ene_me1_mb.bml', ctx), [{ model: 1, motion: loop(4, 0.2) }]);
    // Dubwitch: ctor 0x00618ae4, static model (descriptor 0x009c4b8c, no motions).
    case 0x85:
      return spec('TOCtrlDubchik', 'bm_fs_obj_zombie_con.bml', [{ model: 0 }]);
    // Delsaber: ctor 0x0055018c, table 0x009bd5e0 slot 0 = wait, 1.0.
    case 0xa0:
      return spec('TObjEneSaver', 'bm_ene_df1_saver.bml', [{ model: 0, motion: loop(9, 1) }]);
    // Chaos Sorcerer: ctor 0x0059b220, body model 0 (the bits are child
    // objects), table 0x009bfe80 slot 0 = wait, 0.6.
    case 0xa1:
      return spec('TObjEneRe4Sorcerer', pick('bm_ene_re4_sorcerer.bml', ctx), [{ model: 0, motion: loop(7, 0.6) }]);
    // Dark Gunner: factory 0x00545e54, model 1 (FUN_005b8610(1)), table
    // 0x009bcf60 slot 0 = wait, 1.0.
    case 0xa2:
      return spec('TObjEneDarkGunner', 'bm_ene_darkgunner.bml', [{ model: 1, motion: loop(13, 1) }]);
    // Dark Gunner control (0x00543ab8): no model.
    case 0xa3:
      return null;
    // Chaos Bringer: ctor 0x0053a454, table 0x009bccc0 slot 0 = wait, 0.8.
    case 0xa4:
      return spec('TObjEneDf2Bringer', pick('bm_ene_df2_bringer.bml', ctx), [{ model: 0, motion: loop(9, 0.8) }]);
    // Dark Belra: ctor 0x00536bfc, body model 0, table 0x009bcaa0 slot 0 =
    // wait, 0.8. The arms (models 1, 2) are a child object (0x005398b0) whose
    // attachment is not decoded yet.
    case 0xa5:
      return spec('TObjEneRe7Berura', pick('bm_ene_re7_berura.bml', ctx), [{ model: 0, motion: loop(6, 0.8) }]);
    // Dimenian / La / So: ctor 0x00551d3c, FUN_005520f8 (model 2 - param6),
    // table 0x009bd840 slot 0 = stund, 0.6.
    case 0xa6:
      return spec('TObjEneDimedian', pick('bm_ene_df3_dimedian.bml', ctx), [{ model: 2 - clamp(p6, 0, 2), motion: loop(9, 0.6) }]);
    // Bulclaw: factory 0x00533f90, FUN_00532960(1) -> model 1 (bcbody), table
    // 0x009bc680 slot 0 = bcwait, 0.8. Claw: ctor 0x005354d4, model 2, table
    // 0x009bc7c0 slot 0 = clwait, 1.0.
    case 0xa7:
      return spec('TObjEneBalClawBody', 'bm_ene_balclaw.bml', [{ model: 1, motion: loop(9, 0.8) }]);
    case 0xa8:
      return spec('TObjEneBalClawClaw', 'bm_ene_balclaw.bml', [{ model: 2, motion: loop(15, 1) }]);
    // Dragon (area 0x0b): ctor 0x00419214, model 0, table 0x009a3ae0 slot 0 =
    // stand, 0.5. Gal Gryphon (Ep2): ctor 0x004a67c0, model 0, table 0x009a7c80
    // slot 0 = stand, 0.8.
    case 0xc0:
      if (ep === 2) return spec('TBoss5Gryphon', 'bm_boss5_gryphon.bml', [{ model: 0, motion: loop(9, 0.8) }]);
      return spec('TBoss1Dragon', pick('bm_boss1_dragon.bml', ctx), [{ model: 0, motion: loop(17, 0.5) }]);
    // De Rol Le: ctor 0x0042ad4c, body model 2; the ctor starts the "enter"
    // slot; idle = slot 1 of 0x009a45c0 = forward, speed 0.6 (static init 0x00434372).
    case 0xc1:
      return spec('TBoss2DeRolLe', pick('bm_boss2_de_rol_le.bml', ctx), [{ model: 2, motion: loop(11, 0.6) }]);
    // Barba Ray: ctor 0x004af634, body model 0; idle = slot 1 of 0x009aba20 =
    // forward, 0.6 (static init 0x004b9c00).
    case 0xcb:
      return spec('TBoss7DeRolLeC', 'bm_boss7_de_rol_le_c.bml', [{ model: 0, motion: loop(11, 0.6) }]);
    // Vol Opt: 0xc2 is the controller and draws nothing itself (ctor
    // 0x0043e3b0); 0xc5 (phase 2, ctor 0x004483fc -> FUN_004491cc) draws model
    // 19 (FUN_00448e40), table 0x009a5340 slot 0 = wait_me5p02_y_all, 0.7.
    case 0xc2:
      return null;
    case 0xc5:
      return spec('TBoss3VoloptP02', pick('bm_boss3_volopt.bml', ctx), [{ model: 19, motion: loop(16, 0.7) }]);
    // Dark Falz: the controller (ctor 0x0044c93c) creates the phase-1 body
    // (0x0044e44a -> FUN_004570b0), whose render FUN_00455568 draws six models
    // at its origin (table 0x009a6140) with the state-0 motions of table
    // 0x009a5e28; frame step 0.4 (+0x3f4, set by the ctor).
    case 0xc8: {
      const m = (model: number, motion: number): EnemyPartSpec => ({ model, motion: loop(motion, 0.4) });
      return spec('TBoss4DarkFalz', 'darkfalz_dat.bml', [m(7, 80), m(5, 78), m(3, 77), m(2, 77), m(4, 77), m(1, 76)]);
    }
    // Olga Flow: the controller (ctor 0x0048d814) creates the phase-1 beast
    // (FUN_0048d188 -> ctor 0x00497580); its render FUN_00494120 draws models
    // 2 (leg) and 6 (body) of table 0x009a7058 with the motions of state
    // DAT_009a70a4 = 2 in table 0x009a6dc0 (leg skywait, body waitside), step
    // DAT_009a70a8 = 1. The +0x4f0 height offset is not applied.
    case 0xca:
      return spec('TBoss6PlotFalz', 'boss06_plotfalz_dat.bml', [{ model: 2, motion: loop(44, 1) }, { model: 6, motion: loop(56, 1) }]);
    // Gol Dragon: ctor 0x004cb480, model 0, table 0x009abf60 slot 0 = stand, 0.5.
    case 0xcc:
      return spec('TBoss8Dragon', 'bm_boss8_dragon.bml', [{ model: 0, motion: loop(11, 0.5) }]);
    // Sinow Berill / Spigell: FUN_0059e254 picks ground (param1 < 1 or 2 <=
    // param1 < 3: slot 2 = wait) or ceiling (slot 0 = t_wait) of 0x009bffa0;
    // Spigell (param6 > 0) uses texture ids 3..5 for 0..2 (loader 0x005a155c).
    case 0xd4:
      return spec('TObjEneMe3StelthReal', pick('bm_ene_me3_stelthshinowa.bml', ctx), [{ model: 0, motion: sinowGround(p[0]) ? loop(9, 0.5) : loop(0, 0.5), ...(p6 > 0 ? { texRemap: [3, 4, 5] } : {}) }]);
    // Merillia / Meriltas: ctor 0x00575e70, model clamp(param6, 0, 1), table
    // 0x009bec00 slot 0 = stand, 0.6.
    case 0xd5:
      return spec('TObjEneMerillLia', pick('bm_ene_re8_merill_lia.bml', ctx), [{ model: clamp(p6, 0, 1), motion: loop(5, 0.6) }]);
    // Mericarol / Mericus / Merikle: ctor 0x00572c00, model 0; subtype
    // (FUN_00572fa8) = param6 if 0..2 else 0 (not rare); the draw function
    // FUN_00573100 uses texture ids 3..5 (subtype 1) or 6..8 (subtype 2) for
    // 0..2. Table 0x009be9a0 slot 2 = wait2, 0.5.
    case 0xd6: {
      const sub = p6 >= 0 && p6 <= 2 ? p6 : 0;
      return spec('TObjEneBm9Mericarol', pick('bm_ene_bm9_s_mericarol.bml', ctx), [{ model: 0, motion: loop(6, 0.5), ...(sub ? { texRemap: sub === 1 ? [3, 4, 5] : [6, 7, 8] } : {}) }]);
    }
    // Ul / Zol Gibbon: ctor 0x00564a64, param6 < 1 -> model 0 else 1, table
    // 0x009be3a0 slot 0 = wait, 1.0.
    case 0xd7:
      return spec('TObjEneBm5GibonU', pick('bm_ene_bm5_gibon_u.bml', ctx), [{ model: p6 < 1 ? 0 : 1, motion: loop(7, 1) }]);
    // Gibbles: ctor 0x00563200, table 0x009be180 slot 0 = wait, 0.3.
    case 0xd8:
      return spec('TObjEneGibbles', pick('bm_ene_gibbles.bml', ctx), [{ model: 0, motion: loop(8, 0.3) }]);
    // Gee: factory 0x0055c974 (model FUN_0055c520), table 0x009bdf80 slot 0 = wait, 0.9.
    case 0xd9:
      return spec('TObjEneMe1Gee', pick('bm_ene_me1_gee.bml', ctx), [{ model: 0, motion: loop(3, 0.9) }]);
    // Gi Gue: ctor 0x0056beb4, table 0x009be5c0 slot 0 = wait (chains to itself), 0.7.
    case 0xda:
      return spec('TObjEneMe1GiGue', pick('bm_ene_gi_gue.bml', ctx), [{ model: 0, motion: loop(4, 0.7) }]);
    // Deldepth: ctor 0x005499b0, body model 0 (disc and mines are separate
    // objects), table 0x009bd1e0 slot 0 = wait_swim_body, 0.5.
    case 0xdb:
      return spec('TObjEneDelDepth', pick('bm_ene_del_depth.bml', ctx), [{ model: 0, motion: loop(11, 0.5) }]);
    // Delbiter: ctor 0x0054a71c, table 0x009bd460 slot 0 = wait, 0.5.
    case 0xdc:
      return spec('TObjEneDellBiter', pick('bm_ene_biter_body.bml', ctx), [{ model: 0, motion: loop(8, 0.5) }]);
    // Dolmolm / Dolmdarl: ctor 0x00553c7c, param6 < 1 -> model 0 else 1, table
    // 0x009bd9c0 slot 0 = wait, 0.8.
    case 0xdd:
      return spec('TObjEneDolmOlm', pick('bm_ene_abgc01_wola_body.bml', ctx), [{ model: p6 < 1 ? 0 : 1, motion: loop(5, 0.8) }]);
    // Morfos: ctor 0x0057a134, body model 1 (arm and wall are separate parts),
    // table 0x009bee20 slot 0 = wait_kabe_body, 0.5.
    case 0xde:
      return spec('TObjEneMorfos', pick('bm_ene_morfos.bml', ctx), [{ model: 1, motion: loop(5, 0.5) }]);
    // Recobox: ctor 0x0058859c, box model 1, table 0x009bf680 slot 0 =
    // close_only, 0.1 (floor/ceiling/wall orientation from param6 not decoded).
    case 0xdf:
      return spec('TObjEneRecobox', pick('bm_ene_recobox.bml', ctx), [{ model: 1, motion: loop(1, 0.1) }]);
    // Sinow Zoa / Zele (Seabed) or Epsilon (area 0x23, ctor 0x005585ac: model 0
    // bcbody, table 0x009bdeb8 slot 0 = body_wait, 0.3).
    case 0xe0:
      if (ctx.area === 0x23) return spec('TObjEneEpsilonBody', 'bm_ene_epsilon.bml', [{ model: 0, motion: loop(0, 0.3) }]);
      return spec('TObjEneMe3SinowZoaReal', pick('bm_ene_me3_shinowa_zoa.bml', ctx), [{ model: 0, motion: sinowGround(p[0]) ? loop(9, 0.5) : loop(0, 0.5), ...(p6 > 0 ? { texRemap: [3, 4, 5] } : {}) }]);
    // Ill Gill: ctor 0x0052e44c, table 0x009bc3e0 slot 0 = wait, 0.6.
    case 0xe1:
      return spec('TObjEneIllGill', 'bm_ene_ill_gill.bml', [{ model: 0, motion: loop(0, 0.6) }]);
    // Episode 4 (one archive each; set_params FUN_00786848). Rare = param6 & 1.
    // Astark: ctor 0x005a3e2c, model 0, table 0x009c0160 slot 0 = stand, 0.5.
    case 0x110:
      return spec('Astark', 'bm_ene_astark.bml', [{ model: 0, motion: loop(10, 0.5) }]);
    // Satellite Lizard / Yowie: FUN_005aec2c (param2 >= 1 -> model 0 yowie,
    // else 1 lizard), table 0x009c1340 slot 0 = wait, 1.0.
    case 0x111:
      return spec('SatelliteLizardYowie', 'bm_ene_yowie.bml', [{ model: p[1] >= 1 ? 0 : 1, motion: loop(12, 1) }]);
    // Merissa A / AA: FUN_005b6ea0; the ctor starts the vanish motion, the
    // idle is slot 1 of 0x009c1980 = wait, 0.5.
    case 0x112:
      return spec('MerissaA', 'bm_ene_melissa.bml', [{ model: p6 & 1 ? 1 : 0, motion: loop(16, 0.5) }]);
    // Girtablulu: ctor 0x005aba28 starts slot 2 of 0x009c0d80 = wait2, 0.5.
    case 0x113:
      return spec('Girtablulu', 'bm_ene_girtablulu.bml', [{ model: 0, motion: loop(6, 0.5) }]);
    // Zu / Pazuzu: ctor 0x005b4884, table 0x009c16a0 slot 0 = wait (chains to itself), 0.8.
    case 0x114:
      return spec('Zu', 'bm_ene_zu.bml', [{ model: p6 & 1 ? 1 : 0, motion: loop(11, 0.8) }]);
    // Boota / Ze / Ba: FUN_005a602c clamp(param6, 0, 2), table 0x009c05a0 slot 0 = stund, 0.6.
    case 0x115:
      return spec('BootaFamily', 'bm_ene_boota.bml', [{ model: clamp(p6, 0, 2), motion: loop(10, 0.6) }]);
    // Dorphon / Eclair: FUN_005a9c58, table 0x009c0880 / 0x009c0920 slot 0 = wait, 0.5.
    case 0x116:
      return spec('Dorphon', 'bm_ene_dolphon.bml', [{ model: p6 & 1 ? 1 : 0, motion: loop(8, 0.5) }]);
    // Goran / Pyro Goran / Goran Detonator: FUN_005adf28 clamp(param6, 0, 2),
    // table 0x009c10c0 slot 0 = stund, 0.6.
    case 0x117:
      return spec('GoranFamily', 'bm_ene_golan.bml', [{ model: clamp(p6, 0, 2), motion: loop(9, 0.6) }]);
    // Saint-Milion / Shambertin: ctor 0x0076a8e8, FUN_0076af74 (model
    // 0x009f75c8[variant]); the ctor starts the "advent" motion (slot 0),
    // idle = slot 1 of 0x009f6a20 = 1st_move, speed 4. Sub-parts not decoded.
    case 0x119:
      return spec('Episode4Boss', 'bm_ene_boss09.bml', [{ model: p6 & 1, motion: loop(9, 4) }]);
  }
  return null;
}

// Sinow Berill / Zoa start on the ground when param1 < 1 or 2 <= param1 < 3
// (FUN_0059e254 / FUN_00591708).
function sinowGround(param1: number): boolean {
  return param1 < 1 || (param1 >= 2 && param1 < 3);
}

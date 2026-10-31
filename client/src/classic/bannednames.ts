// The client's banned name list. ValidatePlayerName (0x00819f28) walks 0x168 / 4 = 90 wide-string
// pointers at 0x00a163a0 (banned_names_list) and calls wcsstr (0x0085aa95) with the typed name:
// a name that CONTAINS any entry (case sensitive, no folding) is refused. The entries are the
// company, product and staff names players must not pass themselves off as (Sega, Sonic Team,
// PSOBB staff / support staff / guardian / game master, in half width, full width and katakana
// spellings, plus look-alike spellings and three staff names). The strings below are read from
// the executable's data (the table's 90 pointers, UTF-16), in order, duplicates included.
//
// The exe calls it from two team places, both on the Yes of the "Set Team Name as [%s]?" question:
// HandleLobbyMenuInput_00799c28 (create team, 01EA) and HandleLobbyMenuConfirm_00799b30 (rename,
// 1EEA, which this port has no menu for). A refused name shows the "already registered" notice
// (team_name_in_use, unitxt 15 0x6b) and no packet is sent.
export const BANNED_NAMES: readonly string[] = [
  'SONICTEAM', 'SonicTeam', 'sonicteam', 'ＳＯＮＩＣＴＥＡＭ', 'ＳｏｎｉｃＴｅａｍ', 'ｓｏｎｉｃｔｅａｍ',
  'ソニックチーム', 'ｿﾆｯｸﾁｰﾑ', '株式会社ソニックチーム', '株式会社セガ', 'セガ', 'ｾｶﾞ',
  'SEGA', 'Sega', 'ＳＥＧＡ', 'ＳｅＧａ', 'Ｓｅｇａ', 'セガＰＣ',
  'ｾｶﾞPC', 'セガPC', 'ｾｶﾞＰＣ', 'SEGAPC', 'SegaPC', 'ＳＥＧＡＰＣ',
  'ＳｅＧａＰＣ', 'ＳｅｇａＰＣ', 'ＰＳＯＢＢ運営班', 'ＰＳＯＢＢ', 'PSOBB運営班', 'PSOBB',
  '運営班', 'スタッフキャラクター', 'ｽﾀｯﾌｷｬﾗｸﾀｰ', 'すたっふきゃらくたー', 'さぽーとすたっふ', 'サポートスタッフ',
  'ｻﾎﾟｰﾄｽﾀｯﾌ', 'supportstaff', 'SupportStaff', 'SUPPORTSTAFF', 'ＳｕｐｐｏｒｔＳｔａｆｆ', 'ＳＵＰＰＯＲＴＳＴＡＦＦ',
  'スタッフキャラクター', 'STAFFキャラクター', 'Staffcharacter', 'StaffCharacter', 'ガーディアン', 'ｶﾞｰﾃﾞｨｱﾝ',
  'guardian', 'Guardian', 'GUARDIAN', 'ｇｕａｒｄｉａｎ', 'Ｇｕａｒｄｉａｎ', 'ＧＵＡＲＤＩＡＮ',
  'ゲームマスター', 'ｹﾞｰﾑﾏｽﾀｰ', 'GAMEマスター', 'ＧＡＭＥマスター', 'GAMEﾏｽﾀｰ', 'ＧＡＭＥﾏｽﾀｰ',
  'ゲームmaster', 'ゲームMaster', 'ゲームMASTER', 'ｹﾞｰﾑMASTER', 'GAMEMASTER', 'GameMaster',
  'gamemaster', 'ＧＡＭＥＭＡＳＴＥＲ', 'ＧａｍｅＭａｓｔｅｒ', 'ｇａｍｅｍａｓｔｅｒ', 'ゲ一ムマスタ一', 'ガ一ディアン',
  '株式会社ンニックチーム', '株式会社ソ二ックチ一ム', '株式会社ソニックチ一ム', '株式会社ソニックチーム', 'ンニックチーム', 'ン二ックチ一ム',
  'ン二ックチーム', 'ンニックチ一ム', 'ソ二ックチ一ム', 'ソニックチ一ム', 'ソニックチーム', 'ソニック千ーム',
  'ソニック千一ム', 'ソニック千一ム', 'ソ二ック千一ム', '見吉隆夫', '中裕司', '節政暁生',
];

// ValidatePlayerName's result inverted: true when the name must be refused.
export function isBannedName(name: string): boolean {
  return BANNED_NAMES.some((banned) => name.includes(banned));
}

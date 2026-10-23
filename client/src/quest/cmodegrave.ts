// The grave of Challenge Mode: the text that floats over it, its fade and its
// heading (PsoBB.exe, Ephinea 1.25.13 Ghidra dump names; VAs are the exe's).
// Pure: no DOM, no three.js (quest/cmoderun.ts places the text, quest/questui.ts
// draws it).
//
// The grave is a ChallengeEntityProgress object, one per player whose record
// (quest/cmode.ts `saveGrave`) matches this stage and floor:
//   ChallengeEntityProgress_Constructor_004dedfc   object +0xac = slot, +0xc0..0x144
//                                                  = the record's 0x60..0xe4 (the
//                                                  exe copies 0x84 bytes; the object
//                                                  is 0x38c long), +0x38 = position,
//                                                  +0x60 = slot << 13 (the heading)
//   UpdateChallengeUI_004df408                     the six lines at +0x144 + n * 0x60
//   UpdateGraveChallengeSubPanel_004de304          the text is drawn when
//                                                  CanProcessGraveChallenge_004de810 (the
//                                                  distance b0 <= 500, 0x00909cc0)
//   UpdateChallengePlayerGraveDistance_004de164    the fade (object +0xb4)

// The grave's model: the tomb / rebirth-mark archive the object loader reads
// (LoadBML_005b7a84 with g_pRebirthMarkBaseBMLPath, 0x005089ec "re_b_mark_base.bml";
// `unknown_challenge_related`, 0x00622d14 area). ASSUMED: the name has no directory
// prefix. It is not in the local data set, so the model is not drawn yet.
export const GRAVE_MODEL_BML = 're_b_mark_base.bml';

// Text fade (UpdateChallengePlayerGraveDistance_004de164): a line fades in while
// the local player is within this XZ distance (0x00909c94) and nearer to this
// grave than to any other (the nearest other grave starts at 50, 0x00909dc0).
export const GRAVE_TEXT_RANGE = 50;
export const GRAVE_NEAREST_START = 50;
export const GRAVE_FADE_IN = 0.13333334; // 0x00909c90, per game tick
export const GRAVE_FADE_OUT = -0.044444446; // 0x00909c8c, per game tick
// The text is drawn while the local player is within this distance (0x00909cc0).
export const GRAVE_DRAW_RANGE = 500;
// The spacing of the six lines in the 640x480 space (0x00909c9c).
export const GRAVE_LINE_STEP = 25;
// The grave's game ticks are 30 a second (ASSUMED: the exe's frame rate here).
export const GRAVE_TICK_MS = 1000 / 30;
// Where the text starts above the grave's position (the exe adds
// g_GraveChallengeTextYOffset, not located; ASSUMED 2.0).
export const GRAVE_TEXT_HEIGHT = 2;

// The heading of a grave: the owner's slot << 13 (BAMS; ProcessGraveChallengePlayerLogic
// passes it to the drop fan, which starts at heading - (count - 1) * 0x1000).
export function graveHeading(slot: number): number {
  return (slot << 13) & 0xffff;
}

// The unitxt strings of group 12 the lines use (the port's English text, the
// Ephinea collection of unitxt_j.prs at 0x4c / 0x4d / 0x4e).
export interface GraveStrings {
  partyName: string; // 0x4c, "Party Name : " then the party name ("%s%s")
  failed: string; // 0x4d, "Number of times failed : " then the count ("%s%d")
  defeatedBy: string; // 0x4e, "Defeated by %s." (the killer's name)
}
export const GRAVE_STRINGS_EN: GraveStrings = {
  partyName: 'Party Name : ',
  failed: 'Number of times failed : ',
  defeatedBy: 'Defeated by %s.',
};

// The packed date of a grave (the record's u32 at 0x68): year - 2000 in the top
// 4 bits, then month (4), day (5), hour (5), minute (6). The exe stores 15 for
// every year from 2015 on, and its reader rejects 15 (FormatChallengeTimestamp_004df250),
// so a grave saved in 2015 or later shows no date.
export interface GraveDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function decodeGraveDate(packed: number): GraveDate | null {
  const v = packed >>> 0;
  const yy = (v >>> 28) & 0xf;
  const month = (v >>> 24) & 0xf;
  const day = (v >>> 16) & 0x1f;
  const hour = (v >>> 8) & 0x1f;
  const minute = v & 0x3f;
  if (yy === 0xf || month === 0 || month >= 13 || day === 0 || day >= 0x20 || hour >= 0x18 || minute >= 0x3c) return null;
  return { year: 2000 + yy, month, day, hour, minute };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// The timestamp line: "%d/%02d/%02d %02d:%02d" (year first) when the locale is 0,
// "%02d/%02d/%d %02d:%02d" (month first) otherwise (0x00909e34 / 0x00909e64).
export function formatGraveDate(d: GraveDate, locale = 0): string {
  const hm = `${pad2(d.hour)}:${pad2(d.minute)}`;
  if (locale === 0) return `${d.year}/${pad2(d.month)}/${pad2(d.day)} ${hm}`;
  return `${pad2(d.month)}/${pad2(d.day)}/${d.year} ${hm}`;
}

export interface GraveTextInput {
  // The name of the player in the owner's slot, null when that player is not
  // here (the exe then leaves line 0 empty).
  owner: string | null;
  deaths: number;
  team: string;
  message: string;
  // The killer's name, null when there is none (the record's 0xffffffff).
  defeatedBy: string | null;
  // The packed date, given only for the local player's own grave (the exe's
  // timestamp is for the local slot alone).
  date: number | null;
  locale?: number;
  strings?: GraveStrings;
}

// The six lines of a grave (UpdateChallengeUI_004df408 and the Format* helpers),
// top to bottom; an empty string is a line the exe leaves blank.
export function graveLines(i: GraveTextInput): string[] {
  const s = i.strings ?? GRAVE_STRINGS_EN;
  const lines = ['', '', '', '', '', ''];
  if (i.owner !== null) lines[0] = `< ${i.owner.replace(/ +$/, '')} >`;
  lines[1] = `${s.failed}${i.deaths}`;
  if (i.team !== '') lines[2] = `${s.partyName}${i.team}`;
  if (i.defeatedBy !== null) lines[3] = s.defeatedBy.replace('%s', i.defeatedBy);
  if (i.message !== '') lines[4] = `"${i.message}"`;
  if (i.date !== null) {
    const d = decodeGraveDate(i.date);
    if (d) lines[5] = formatGraveDate(d, i.locale ?? 0);
  }
  return lines;
}

// One game tick of a grave's text fade. `distToThis` is the local player's XZ
// distance to this grave (null with no local player); `nearestOther` the
// smallest such distance to another grave (GRAVE_NEAREST_START when there is
// none); `isLocalOwner` whether the grave is the local player's own.
export function graveFadeStep(fade: number, distToThis: number | null, nearestOther: number, isLocalOwner: boolean): number {
  if (distToThis !== null && nearestOther <= distToThis && (distToThis !== nearestOther || !isLocalOwner)) {
    return fadeOut(fade);
  }
  const b0 = distToThis ?? Infinity;
  return b0 < GRAVE_TEXT_RANGE ? fadeIn(fade) : fadeOut(fade);
}

function fadeIn(fade: number): number {
  const v = GRAVE_FADE_IN + fade;
  return v > 1 ? 1 : v;
}

function fadeOut(fade: number): number {
  const v = GRAVE_FADE_OUT + fade;
  return v >= 0 ? v : 0;
}

// Beat time (Swatch Internet Time, "@000".."@999") as PsoBB.exe computes it.
//
// GetBeatTime_0077b950 = 30 * (local seconds of the day) + g_PhaseTimerBeatTimeBase (0x00a9b1e8):
//   the clock is GetLocalTime (get_time_0083ace8), seconds only, milliseconds ignored.
// get_beat_time_0077bab4 = (GetBeatTime / 0xa20) % 1000: 2592 frames (30 fps) = 86.4 s = one beat,
//   a day is 1000 beats (0x278d00 frames). The division and the modulo are the exe's signed ones.
// The base is written in two places:
//   - InitializePhaseTimer_0077bc80: 0x1a5e00 (1728000 frames = 16 h), the value before any server time.
//   - HandlePacketBaseBeatTime_0079d89c (B1, set_base_beat_time_from_packet_b1 0x0077bb68):
//     base = server frames - local frames + 0x1a5e0, then folded into [0, one day). The server frames
//     are the hour, minute and second of the B1 string (get_base_beat_time_in_frames 0x0077bbfc).
//     newserv (send_server_time, SendCommands.cc) sends gmtime, so with newserv the beat is
//     (UTC frames + 0x1a5e0) / 2592 and the local clock cancels out. 0x1a5e0 = 108000 frames = 3600 s,
//     so with a UTC server the beat is Swatch Internet Time (BMT = UTC+1) exactly.
//     InitializePhaseTimer's 0x1a5e00 is 16 x 0x1a5e0 (1728000 frames = 16 h); its purpose is ASSUMED.
//
// Evidence: reverse/refsrc/original-psobb-client-source src/Psobb.exe-05112026.c lines 752556-752740
// (GetBeatTime, get_beat_time, set_base_beat_time_from_packet_b1, InitializePhaseTimer) and the
// PsoBB.exe disassembly of 0x0077b950, 0x0077bab4, 0x0077bb68, 0x0077bc80 (the constants are read
// from the bytes: 0x1a5e0 is "05 e0 a5 01 00" at 0x0077bbc3, 0x1a5e00 is "movl $0x1a5e00" at 0x0077bc8a).

export const FRAMES_PER_SECOND = 30;
export const FRAMES_PER_BEAT = 0xa20; // 2592
export const BEATS_PER_DAY = 1000;
export const FRAMES_PER_DAY = 0x278d00; // 2592000 = 1000 beats
export const PHASE_TIMER_DEFAULT_BASE = 0x1a5e00; // InitializePhaseTimer_0077bc80
const SERVER_BASE_OFFSET = 0x1a5e0; // set_base_beat_time_from_packet_b1: one hour of frames (UTC+1)

export interface ClockTime {
  hour: number;
  minute: number;
  second: number;
}

// The local clock of an epoch ms (GetLocalTime: the machine's time zone, seconds only).
export function clockOf(nowMs: number): ClockTime {
  const d = new Date(nowMs);
  return { hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
}

// (((hour * 60) + minute) * 60 + second) * 30, the frames of the clock within the day.
export function clockFrames(t: ClockTime): number {
  return ((t.hour * 60 + t.minute) * 60 + t.second) * FRAMES_PER_SECOND;
}

// GetBeatTime_0077b950.
export function beatFrames(t: ClockTime, base: number): number {
  return clockFrames(t) + base;
}

// get_beat_time_0077bab4 on a frame count: (frames / 0xa20) % 1000, C truncation for the division.
export function beatFromFrames(frames: number): number {
  return Math.trunc(frames / FRAMES_PER_BEAT) % BEATS_PER_DAY;
}

// set_base_beat_time_from_packet_b1 (0x0077bb68): the base from the server clock and the local clock
// at receipt. The folding is the exe's loops; the day is 0x278d00 frames.
export function beatBaseFromServer(server: ClockTime, local: ClockTime): number {
  let base = clockFrames(server) - clockFrames(local) + SERVER_BASE_OFFSET;
  if (base < 0) {
    if (-base > 0xed4dff) {
      do base += 0xc5c100; while (base < -0xed4e00);
    }
    do base += FRAMES_PER_DAY; while (base < 0);
  }
  return base;
}

// The B1 string "YYYY:MM:DD: HH:MM:SS.mmm" (astruct_63: hour at 12, minute at 15, second at 18).
// Null when the string does not have that shape.
export function parseServerTimeB1(s: string): ClockTime | null {
  const m = /^\d{4}:\d{2}:\d{2}: (\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]), second: Number(m[3]) };
}

// The beat (0..999) at an epoch ms with the given base; the local clock of nowMs. Pure.
export function beatTime(nowMs: number, base: number = PHASE_TIMER_DEFAULT_BASE): number {
  return beatFromFrames(beatFrames(clockOf(nowMs), base));
}

// g_PhaseTimerBeatTimeBase, the one global the beat clock reads.
let phaseBase = PHASE_TIMER_DEFAULT_BASE;

export function phaseTimerBase(): number {
  return phaseBase;
}

// HandlePacketBaseBeatTime_0079d89c: the B1 string as received at localNowMs. A string that does not
// parse leaves the base as it is (the exe would read the digits at the fixed offsets regardless).
export function setPhaseBaseFromServerTime(s: string, localNowMs: number): void {
  const server = parseServerTimeB1(s);
  if (server) phaseBase = beatBaseFromServer(server, clockOf(localNowMs));
}

// The live beat: the global base at the current local clock.
export function liveBeatTime(nowMs: number = Date.now()): number {
  return beatTime(nowMs, phaseBase);
}

// Test hook: the base back at the InitializePhaseTimer value (the start of a session).
export function resetPhaseTimerBase(): void {
  phaseBase = PHASE_TIMER_DEFAULT_BASE;
}

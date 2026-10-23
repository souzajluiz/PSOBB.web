// The lobby's main menu availability (classic/lobby.ts lobbyMenuRules over the
// field's validateMenuEntry, ValidateMenuItemCondition_00732620): which entries
// are replaced by id + 1 ("cannot be used") and greyed in the lobby, online,
// with and without a team.
// Run: node tests/lobbymenu.test.ts
import { validateMenuEntry } from '../client/src/classic/fieldmenu.ts';
import { lobbyMenuRules } from '../client/src/classic/lobby.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

const noTeam = lobbyMenuRules(false);
const team = lobbyMenuRules(true);

// Not used in the lobby: Customize, Equip, MAG (id + 1, greyed).
eq(validateMenuEntry(0, noTeam), { id: 1, enabled: false }, 'Customize in the lobby');
eq(validateMenuEntry(9, noTeam), { id: 10, enabled: false }, 'Equip in the lobby');
eq(validateMenuEntry(0x17, noTeam), { id: 0x18, enabled: false }, 'MAG in the lobby');
// Safe map: Technique and Area Map are off; the Quest Board needs a running quest.
eq(validateMenuEntry(3, noTeam), { id: 4, enabled: false }, 'Technique on a safe map');
eq(validateMenuEntry(0xc, noTeam), { id: 0xd, enabled: false }, 'Area Map on a safe map');
eq(validateMenuEntry(0xf, noTeam), { id: 0x10, enabled: false }, 'Quest Board with no quest');
// Online: Quit Game is Disconnect (8); Trade Window is on (safe and online).
eq(validateMenuEntry(7, noTeam), { id: 8, enabled: true }, 'Quit Game online');
eq(validateMenuEntry(0x1a, noTeam), { id: 0x1a, enabled: true }, 'Trade Window online');
// Items, Log Window, Chat, Options are always on.
eq(validateMenuEntry(0xb, noTeam), { id: 0xb, enabled: true }, 'Items');
eq(validateMenuEntry(0x15, noTeam), { id: 0x15, enabled: true }, 'Log Window');
eq(validateMenuEntry(6, noTeam), { id: 6, enabled: true }, 'Options');
// Team rows need a team.
eq(validateMenuEntry(0x23, noTeam), { id: 0x24, enabled: false }, 'Team with no team');
eq(validateMenuEntry(0x23, team), { id: 0x23, enabled: true }, 'Team in a team');
eq(validateMenuEntry(0x2d, team), { id: 0x2d, enabled: true }, 'Point Regist in a team');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('lobbymenu: all checks passed');

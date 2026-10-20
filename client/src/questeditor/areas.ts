// Quest editor: area names and the default floor -> area table of each episode.
// The same tables as render/gameview.ts (AREA_NAMES) and net/game.ts
// (floorToArea), repeated here so the editor page does not pull the whole game
// client into its bundle.

export const AREA_NAMES: Readonly<Record<number, string>> = {
  0x00: 'Pioneer 2', 0x01: 'Forest 1', 0x02: 'Forest 2', 0x03: 'Cave 1', 0x04: 'Cave 2', 0x05: 'Cave 3',
  0x06: 'Mine 1', 0x07: 'Mine 2', 0x08: 'Ruins 1', 0x09: 'Ruins 2', 0x0a: 'Ruins 3', 0x0b: 'Dragon',
  0x0c: 'De Rol Le', 0x0d: 'Vol Opt', 0x0e: 'Dark Falz', 0x12: 'Lab', 0x13: 'VR Temple Alpha',
  0x14: 'VR Temple Beta', 0x15: 'VR Spaceship Alpha', 0x16: 'VR Spaceship Beta', 0x17: 'Central Control Area',
  0x18: 'Jungle North', 0x19: 'Jungle South', 0x1a: 'Mountain', 0x1b: 'Seaside', 0x1c: 'Seabed Upper',
  0x1d: 'Seabed Lower', 0x1e: 'Gal Gryphon', 0x1f: 'Olga Flow', 0x20: 'Barba Ray', 0x21: 'Gol Dragon',
  0x22: 'Seaside Night', 0x23: 'Tower', 0x24: 'Crater East', 0x25: 'Crater West', 0x26: 'Crater South',
  0x27: 'Crater North', 0x28: 'Crater Interior', 0x29: 'Desert 1', 0x2a: 'Desert 2', 0x2b: 'Desert 3',
  0x2c: 'Saint-Milion', 0x2d: 'Pioneer 2 (Ep4)', 0x2e: 'Test map',
};

export const MAX_AREA = 0x2e;
export const NUM_QUEST_FLOORS = 0x12;

// Header episode byte (0 = Ep1, 1 = Ep2, 2 = Ep4) -> the game's episode number (1, 2, 3 = Ep4).
export const gameEpisode = (headerEpisode: number): number => (headerEpisode === 1 ? 2 : headerEpisode === 2 ? 3 : 1);

// The area each floor takes when the quest does not designate it.
export function floorToArea(episode: number): number[] {
  switch (episode) {
    case 2:
      return [0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23];
    case 3:
      return [0x2d, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2e, -1, -1, -1, -1, -1, -1, -1];
    default:
      return [...Array(0x12).keys()];
  }
}

export const areaName = (area: number): string => AREA_NAMES[area] ?? `Area ${area}`;

export const FLOOR_TYPE_NAMES = ['Quest set data', 'Free-play template (offline)', 'Free-play template (online)', 'Nothing'] as const;

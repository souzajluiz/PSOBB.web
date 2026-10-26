// Quest editor: the entity clipboard. Copy (Ctrl+C) keeps the selected entities
// in memory, shared by every quest open in the page, so they can be pasted
// (Ctrl+V) onto another floor or into another quest. Cut (Ctrl+X) is a copy and
// a delete. Pure logic: no DOM, no three.js (tests/questeditor-clipboard.test.ts).
//
// A paste keeps the copied positions (local to each room, so the entities stay
// in their room) and lands on the floor it is pasted to. Pasting again onto the
// floor the entities were copied from shifts each paste by PASTE_OFFSET, so the
// copy does not sit on the original; the same offset is what Duplicate uses.

import type { SetEntity } from '../formats/setdata.ts';
import { cloneEntity } from './model.ts';

export type Vec3 = [number, number, number];

export const PASTE_OFFSET: Vec3 = [10, 0, 10];

export interface EntityClipboard {
  readonly entities: readonly SetEntity[];
  readonly floor: number; // the floor the entities were copied from
  pastes: number; // pastes onto that floor since the copy
}

let clip: EntityClipboard | null = null;

// Copies `list` into the clipboard. An empty list leaves the clipboard as it was.
export function copyEntities(list: readonly SetEntity[]): EntityClipboard | null {
  if (!list.length) return clip;
  const floor = list[0].floor;
  const entities = list.filter((e) => e.floor === floor).map((e) => cloneEntity(e));
  clip = { entities, floor, pastes: 0 };
  return clip;
}

export function clipboardContents(): EntityClipboard | null {
  return clip;
}

export function clearClipboard(): void {
  clip = null;
}

// The copies to add when the clipboard is pasted onto `targetFloor`, or null when
// nothing was copied. Each call is one paste (the counter moves on).
export function takePaste(targetFloor: number): SetEntity[] | null {
  if (!clip || !clip.entities.length) return null;
  const sameFloor = targetFloor === clip.floor;
  if (sameFloor) clip.pastes += 1;
  const step = sameFloor ? clip.pastes : 0;
  const shift: Vec3 = [PASTE_OFFSET[0] * step, PASTE_OFFSET[1] * step, PASTE_OFFSET[2] * step];
  return clip.entities.map((e) => {
    const copy = cloneEntity(e);
    copy.floor = targetFloor;
    copy.position = [e.position[0] + shift[0], e.position[1] + shift[1], e.position[2] + shift[2]];
    return copy;
  });
}

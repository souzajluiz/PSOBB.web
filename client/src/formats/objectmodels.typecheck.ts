// Compile-time checks for the object part spec (formats/objectmodels.ts).
// Nothing imports this file: `tsc --noEmit` checks every file under src, so the
// `@ts-expect-error` lines below fail the build if one of them starts to
// compile, and the plain ones fail if a valid part stops compiling. There is no
// runtime code here, so the bundle is unchanged.

import type { ObjectPartSpec } from './objectmodels.ts';

// A part can hold its bind pose, or play a motion and say how it is driven.
const still: ObjectPartSpec = { model: 0 };
const animated: ObjectPartSpec = { model: 1, motion: 0, drive: 'loop', speed: 4 };
const doorLeaf: ObjectPartSpec = { model: 0, motion: 0, drive: 'door', show: 'locked' };

// @ts-expect-error a drive without a motion has nothing to drive
const driveWithoutMotion: ObjectPartSpec = { model: 0, drive: 'loop' };
// @ts-expect-error a speed without a motion is never read
const speedWithoutMotion: ObjectPartSpec = { model: 0, speed: 2 };
// A shape motion is drawn at a motion's frame.
const shaped: ObjectPartSpec = { model: 1, motion: 0, drive: 'loop-last', shape: 1 };
// @ts-expect-error a shape motion without a motion has no frame
const shapeWithoutMotion: ObjectPartSpec = { model: 0, shape: 1 };
// @ts-expect-error a motion still needs to say how it is driven
const motionWithoutDrive: ObjectPartSpec = { model: 0, motion: 1 };

// The texture list is the entry's own, another entry's, or a separate archive.
const ownList: ObjectPartSpec = { model: 2 };
const borrowedList: ObjectPartSpec = { model: 2, texlistOf: 0 };
const archiveList: ObjectPartSpec = { model: 2, textures: 'fe_obj_switch.xvm' };

// @ts-expect-error two texture lists for one part
const twoLists: ObjectPartSpec = { model: 2, texlistOf: 0, textures: 'fe_obj_switch.xvm' };
// @ts-expect-error `show` only takes the states the renderer knows
const unknownState: ObjectPartSpec = { model: 0, show: 'sometimes' };

export type ObjectModelTypeChecks = [typeof still, typeof animated, typeof doorLeaf, typeof ownList, typeof borrowedList, typeof archiveList, typeof driveWithoutMotion, typeof speedWithoutMotion, typeof motionWithoutDrive, typeof twoLists, typeof unknownState, typeof shaped, typeof shapeWithoutMotion];

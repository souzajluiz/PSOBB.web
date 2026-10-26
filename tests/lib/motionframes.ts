// The real motion lengths of an enemy: the frame count of each .njm in its BML (the NMDM header, u32
// at +4). Motion j is the j-th entry after the `models` model entries, as client/src/formats/enemymodels.ts
// lists them. Read from data.gsl (PSOBB_DATA, else ~/Downloads/psobb-client/data); undefined when it is
// absent, and the tests then run their stand-in lengths alone.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../../client/src/formats/archives.ts';
import { BmlArchive } from '../../client/src/formats/bml.ts';
import { RelFile } from '../../client/src/formats/rel.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME ?? '', 'Downloads/psobb-client/data');

export function motionFrames(bml: string, models: number): number[] | undefined {
  try {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
    const archive = new BmlArchive(gsl.get(bml));
    return archive.entries.slice(models).map((e) => RelFile.chunk(archive.get(e.name), 'NMDM')?.u32(4) ?? 40);
  } catch {
    return undefined;
  }
}

// A Rig length callback from a frame list (a motion past the list runs 40).
export const realLen = (frames: number[] | undefined): ((i: number) => number) | null => (frames ? (i) => frames[i] ?? 40 : null);

// File lookup for the static roots bridge/server.mjs serves (the client build,
// the PSOBB data folder, newserv's keys, text and map sets).
//
// The game asks for files by the names its own tables hold, and the data
// folder keeps the names of the zip or the copy it came from. macOS folds
// case, so a name in another case still opens there; Linux (the Docker image)
// does not, and the same request would be a 404. So a segment that is not
// there exactly is matched against its directory's names ignoring case. The
// exact name always wins, and the match is made on the directory listing
// (not on existsSync, which folds case on macOS by itself).
//
// Path safety: no segment may be '.', '..' or contain a backslash or NUL, and
// the resolved path must stay inside the root.

import { readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// A resolver with its own listing cache: directory -> the names it holds,
// rebuilt when the directory's mtime changes (a file added or removed there).
export function createResolver() {
  const listings = new Map();

  function listing(dir) {
    let st;
    try {
      st = statSync(dir);
    } catch {
      return null;
    }
    if (!st.isDirectory()) return null;
    const hit = listings.get(dir);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit;
    const exact = new Set();
    const lower = new Map();
    for (const name of readdirSync(dir)) {
      exact.add(name);
      const k = name.toLowerCase();
      if (!lower.has(k)) lower.set(k, name);
    }
    const entry = { mtimeMs: st.mtimeMs, exact, lower };
    listings.set(dir, entry);
    return entry;
  }

  // The real name of `name` in `dir`: the exact one, else the one name that
  // differs only in case; null when there is none.
  function childName(dir, name) {
    const l = listing(dir);
    if (!l) return null;
    if (l.exact.has(name)) return name;
    return l.lower.get(name.toLowerCase()) ?? null;
  }

  // The real path of `rel` (segments separated by '/') under `root`, or null.
  function locate(root, rel) {
    const base = resolve(root);
    const segs = rel.split('/').filter((s) => s !== '');
    if (segs.some((s) => s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) return null;
    let cur = base;
    for (const seg of segs) {
      const real = childName(cur, seg);
      if (real === null) return null;
      cur = resolve(cur, real);
    }
    if (cur !== base && !cur.startsWith(base + sep)) return null;
    return cur;
  }

  // A regular file under `root`, or null.
  function file(root, rel) {
    const p = locate(root, rel);
    if (p === null || p === resolve(root)) return null;
    try {
      return statSync(p).isFile() ? p : null;
    } catch {
      return null;
    }
  }

  // A directory under `root`, or null.
  function directory(root, rel) {
    const p = locate(root, rel);
    if (p === null) return null;
    try {
      return statSync(p).isDirectory() ? p : null;
    } catch {
      return null;
    }
  }

  return { file, directory, locate };
}

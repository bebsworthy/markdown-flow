// src/registry/atomic-write.ts
//
// Atomic file write via temp + rename. Isolated to one small module so
// the side-effectful surface is focused and its tests stand alone.
//
// Algorithm (POSIX-first, see docs/tui/plans/P4-T1.md §3):
//   1. Write to a same-directory temp file with a random suffix.
//   2. fsync the temp file.
//   3. fs.rename (POSIX-atomic within the same filesystem) to target.
//   4. On failure at any step before rename, best-effort unlink the temp.
//
// Platform notes: POSIX (macOS, Linux) is the supported target. Windows
// rename semantics may vary if the destination is held open by another
// process; not handled here (see plan §3).

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

export async function writeFileAtomic(
  targetPath: string,
  contents: string,
): Promise<void> {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tempPath = path.join(
    dir,
    `.${base}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );

  let fh: fs.FileHandle | null = null;
  try {
    fh = await fs.open(tempPath, "wx", 0o644);
    await fh.writeFile(contents, "utf8");
    await fh.sync();
    await fh.close();
    fh = null;
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    if (fh !== null) {
      try {
        await fh.close();
      } catch {
        // Swallow — we're already in an error path.
      }
    }
    try {
      await fs.unlink(tempPath);
    } catch {
      // Temp file may have been renamed already or never existed; ignore.
    }
    throw err;
  }
}

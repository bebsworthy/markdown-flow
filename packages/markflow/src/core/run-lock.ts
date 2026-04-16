import { basename, join } from "node:path";
import * as lockfile from "proper-lockfile";
import { RunLockedError } from "./errors.js";

/**
 * Return the canonical lockfile path for a run directory. Exported so tests
 * and callers can assert the file's existence/absence without duplicating the
 * path convention.
 */
export function lockPathFor(runPath: string): string {
  return join(runPath, ".lock");
}

/**
 * Acquire an exclusive on-disk lock for a run directory.
 *
 * Behaviour:
 * - Uses `proper-lockfile.lock` with `retries: 0` — a second caller fails
 *   immediately with `RunLockedError`. This satisfies the "fails fast"
 *   acceptance criterion for concurrent resume.
 * - `stale: 30_000` lets a subsequent caller reclaim the lock if the previous
 *   process crashed without releasing. `proper-lockfile` auto-refreshes its
 *   mtime every `stale / 2` ms while the holder is alive.
 * - `realpath: false` avoids symlink resolution, which otherwise requires the
 *   target to already exist and would follow through to unexpected paths.
 * - `onCompromised` logs to stderr; throwing would crash the engine mid-run.
 * - `proper-lockfile` installs its own `signal-exit` handler that cleans up
 *   any still-held locks on process exit, SIGINT, and SIGTERM — no explicit
 *   fallback registration needed here.
 *
 * The returned release function is idempotent: calling it a second time is a
 * no-op. That matters because `WorkflowEngine.start()`'s `finally` block runs
 * after any user-level release in a test helper.
 */
export async function acquireRunLock(
  runPath: string,
): Promise<() => Promise<void>> {
  const lockPath = lockPathFor(runPath);
  const runId = basename(runPath);

  let rawRelease: () => Promise<void>;
  try {
    rawRelease = await lockfile.lock(runPath, {
      lockfilePath: lockPath,
      realpath: false,
      stale: 30_000,
      retries: 0,
      onCompromised: (err: Error) => {
        process.stderr.write(
          `[markflow] run lock for ${runId} compromised: ${err.message}\n`,
        );
      },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ELOCKED") {
      throw new RunLockedError(runId, lockPath);
    }
    throw err;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await rawRelease();
    } catch {
      // Release races (e.g. process exit handler already swept the lock dir)
      // must not propagate — the caller is in a `finally` block.
    }
  };
}

import { promises as fsp, watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { EngineEvent } from "./types.js";

const TERMINAL_TYPES = new Set<EngineEvent["type"]>([
  "workflow:complete",
  "workflow:error",
]);

/**
 * Stream events from a run's `events.jsonl`, starting at `fromSeq` (inclusive),
 * following appends via `fs.watch` until a terminal event is observed or the
 * consumer aborts via the supplied `AbortSignal`.
 *
 * Contract:
 * - Never skips events; never duplicates them.
 * - Partial lines (no trailing `\n`) are buffered until the newline arrives.
 * - Terminal events (`workflow:complete`, `workflow:error`) are yielded, then
 *   the generator returns.
 * - `break` in a `for await` triggers the `finally` block which tears down the
 *   `fs.watch` handle and removes the abort listener. No leaked handles.
 * - If `runDir` does not exist, `fs.watch` will throw `ENOENT` — this is a
 *   programmer error (bad run id) and surfaces as-is.
 * - The caller bounds waiting by threading an `AbortSignal` to its own timer.
 *
 * See `docs/tui/plans/P1-T3.md` for the full design.
 */
export async function* tailEventLog(
  runDir: string,
  fromSeq: number,
  options?: { signal?: AbortSignal },
): AsyncIterableIterator<EngineEvent> {
  const signal = options?.signal;
  if (signal?.aborted) return;

  const eventsPath = join(runDir, "events.jsonl");

  // Subscribe to the parent directory FIRST — before probing for the file —
  // so we don't miss the creation event if the writer touches it between our
  // existence check and our watch subscription.
  const watcher: FSWatcher = fsWatch(runDir, { persistent: false });

  // Swallow watcher errors — on some platforms the watcher can emit
  // transient errors (e.g. temporary unmount); we don't want to crash the
  // generator. The drain loop will surface real issues via fs.open/stat.
  watcher.on("error", () => {
    /* noop */
  });

  /** Pending wake-up, resolved by a watch event or an abort. */
  type Waiter = { resolve: () => void };
  let waiter: Waiter | null = null as Waiter | null;

  const onChange = () => {
    const w = waiter;
    waiter = null;
    w?.resolve();
  };
  watcher.on("change", onChange);
  watcher.on("rename", onChange);

  const onAbort = () => {
    const w = waiter;
    waiter = null;
    w?.resolve();
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  const waitForChange = (): Promise<void> => {
    if (signal?.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      waiter = { resolve };
    });
  };

  let position = 0;
  let carry = "";

  try {
    // Wait for the file to appear if necessary. The watcher is already armed.
    while (!(await exists(eventsPath))) {
      if (signal?.aborted) return;
      await waitForChange();
      if (signal?.aborted) return;
    }

    // Main drain/wait loop.
    while (true) {
      if (signal?.aborted) return;

      // Arm a waiter BEFORE draining — if the writer appends between our
      // drain and our next await, the `change` event will fire, `waiter` is
      // set below after drain, but we miss it. So instead: install the
      // waiter first, then drain, then await. This way any change during
      // drain is coalesced into the waiter's resolve callback.
      //
      // NOTE: actually install the waiter AFTER the drain — because during
      // drain we already are catching up to current EOF via stat(). Any
      // change event fired during drain will call `onChange`, which with no
      // waiter installed is a no-op. That's fine: we'll re-stat on the next
      // pass anyway, and stat.size > position will catch the bytes.
      //
      // But we still need coverage for "writer appends after our final
      // read but before our waiter is installed". The pattern below handles
      // it by re-draining one more time if stat shows new bytes immediately
      // after install — see the post-install size re-check.

      const drained = await drainOnce(eventsPath, position, carry);
      position = drained.position;
      carry = drained.carry;

      for (const event of drained.events) {
        if (event.seq >= fromSeq) {
          yield event;
        }
        if (TERMINAL_TYPES.has(event.type)) {
          return;
        }
      }

      if (signal?.aborted) return;

      // Install waiter, then re-check size to avoid a race where the writer
      // appended between the drain and the waiter install.
      const waitPromise = waitForChange();
      try {
        const stat = await fsp.stat(eventsPath);
        if (stat.size > position) {
          // New bytes landed in the race window — immediately re-drain.
          // Resolve the waiter we just installed so we don't leak it; the
          // next loop iteration will install a fresh one.
          const w: Waiter | null = waiter;
          waiter = null;
          w?.resolve();
          continue;
        }
      } catch {
        // File disappeared — unusual, but treat as "wait and retry".
      }

      await waitPromise;
    }
  } finally {
    watcher.removeListener("change", onChange);
    watcher.removeListener("rename", onChange);
    watcher.close();
    if (signal) signal.removeEventListener("abort", onAbort);
    // Ensure any pending waiter is resolved so we don't leak a promise.
    const w: Waiter | null = waiter;
    waiter = null;
    w?.resolve();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

interface DrainResult {
  position: number;
  carry: string;
  events: EngineEvent[];
}

async function drainOnce(
  filePath: string,
  position: number,
  carry: string,
): Promise<DrainResult> {
  let fd: fsp.FileHandle | null = null;
  try {
    fd = await fsp.open(filePath, "r");
    const stat = await fd.stat();
    if (stat.size <= position) {
      return { position, carry, events: [] };
    }
    const size = stat.size - position;
    const buf = Buffer.alloc(size);
    const { bytesRead } = await fd.read(buf, 0, size, position);
    const newPosition = position + bytesRead;
    const text = carry + buf.toString("utf-8", 0, bytesRead);
    const parts = text.split("\n");
    const newCarry = parts.pop() ?? "";
    const events: EngineEvent[] = [];
    for (const line of parts) {
      if (line.length === 0) continue;
      events.push(JSON.parse(line) as EngineEvent);
    }
    return { position: newPosition, carry: newCarry, events };
  } finally {
    if (fd) await fd.close();
  }
}

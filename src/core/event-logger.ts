import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  NON_PERSISTED_EVENT_TYPES,
  type EngineEvent,
  type EngineEventPayload,
} from "./types.js";

export interface EventLogger {
  /**
   * Stamp the payload with a monotonic `seq` and ISO-8601 `ts`, persist it
   * to `events.jsonl` (unless the event type is in-memory only), and return
   * the stamped envelope.
   *
   * `seq` is assigned synchronously before any `await`, so concurrent callers
   * in a single-threaded V8 get stable, monotonic ordering. The underlying
   * `appendFile` is serialized through a promise chain so the on-disk line
   * order matches `seq` order.
   */
  append(payload: EngineEventPayload): Promise<EngineEvent>;

  readonly path: string;
}

export interface EventLoggerOptions {
  /**
   * Factory for `ts`. Injected so emission tests can make timestamps
   * deterministic; defaults to the real clock.
   */
  now?: () => string;
}

export function createEventLogger(
  runDir: string,
  opts: EventLoggerOptions = {},
): EventLogger {
  const filePath = join(runDir, "events.jsonl");
  const now = opts.now ?? (() => new Date().toISOString());

  let seq = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    path: filePath,

    append(payload: EngineEventPayload): Promise<EngineEvent> {
      // Synchronous stamp — runs before any await, so there is no window
      // for another microtask to observe an out-of-order or duplicated seq.
      const stamped = {
        ...payload,
        seq: ++seq,
        ts: now(),
      } as EngineEvent;

      if (NON_PERSISTED_EVENT_TYPES.has(payload.type)) {
        return Promise.resolve(stamped);
      }

      const line = JSON.stringify(stamped) + "\n";
      tail = tail.then(() => appendFile(filePath, line, "utf-8"));
      return tail.then(() => stamped);
    },
  };
}

export async function readEventLogRaw(runDir: string): Promise<string> {
  return readFile(join(runDir, "events.jsonl"), "utf-8");
}

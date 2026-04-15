import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InconsistentLogError,
  TruncatedLogError,
  UnsupportedLogVersionError,
  type EngineEvent,
  type EngineSnapshot,
  type Token,
} from "./types.js";

/**
 * Pure, deterministic fold of an event stream into an `EngineSnapshot`.
 *
 * Invariants:
 *   - never reads the clock (all timestamps come from event `ts`);
 *   - strict: unknown tokenId on state transitions, or out-of-order `seq`
 *     throw `InconsistentLogError`;
 *   - non-persisted event types (e.g. `step:output`) are never present in
 *     the input and therefore never observed here.
 */
export function replay(events: EngineEvent[]): EngineSnapshot {
  const snap: EngineSnapshot = {
    tokens: new Map<string, Token>(),
    retryBudgets: new Map(),
    globalContext: {},
    completedResults: [],
    status: "running",
    batches: new Map(),
  };

  let lastSeq = 0;
  let sawRunStart = false;

  for (const evt of events) {
    // Gaps are expected: non-persisted events (e.g. step:output) claim a
    // seq but never hit disk. Require strict monotonicity only.
    if (evt.seq <= lastSeq) {
      throw new InconsistentLogError(
        `Out-of-order seq: got ${evt.seq} after ${lastSeq} (type=${evt.type})`,
      );
    }
    lastSeq = evt.seq;

    switch (evt.type) {
      case "run:start": {
        if (sawRunStart) {
          throw new InconsistentLogError(
            "Duplicate run:start event in log",
          );
        }
        if (evt.v !== 1) {
          throw new UnsupportedLogVersionError(evt.v);
        }
        sawRunStart = true;
        break;
      }

      case "token:created": {
        if (snap.tokens.has(evt.tokenId)) {
          throw new InconsistentLogError(
            `token:created for existing tokenId ${evt.tokenId}`,
          );
        }
        const tok: Token = {
          id: evt.tokenId,
          nodeId: evt.nodeId,
          generation: evt.generation,
          state: "pending",
        };
        if (evt.batchId != null) tok.batchId = evt.batchId;
        if (evt.itemIndex != null) tok.itemIndex = evt.itemIndex;
        if (evt.parentTokenId != null) tok.parentTokenId = evt.parentTokenId;
        snap.tokens.set(evt.tokenId, tok);
        break;
      }

      case "token:state": {
        const tok = snap.tokens.get(evt.tokenId);
        if (!tok) {
          throw new InconsistentLogError(
            `token:state for unknown tokenId ${evt.tokenId}`,
          );
        }
        if (tok.state !== evt.from) {
          throw new InconsistentLogError(
            `token:state for ${evt.tokenId} expected from=${tok.state}, event says from=${evt.from}`,
          );
        }
        tok.state = evt.to;
        break;
      }

      case "global:update": {
        Object.assign(snap.globalContext, evt.patch);
        break;
      }

      case "output:ref":
      case "step:start":
      case "step:timeout":
      case "step:retry":
      case "route":
      case "retry:exhausted": {
        // Pure notifications with no snapshot mutation.
        break;
      }

      case "step:waiting":
      case "approval:decided": {
        if (evt.v !== 1) {
          throw new UnsupportedLogVersionError(evt.v);
        }
        // Pure notifications. Token-state transitions are carried by paired
        // `token:state` events; suspended-run detection happens after the fold.
        break;
      }

      case "run:resumed": {
        if (evt.v !== 1) {
          throw new UnsupportedLogVersionError(evt.v);
        }
        // No-op marker; observable in the log as "this run was resumed at seq N".
        break;
      }

      case "token:reset": {
        const tok = snap.tokens.get(evt.tokenId);
        if (!tok) {
          throw new InconsistentLogError(
            `token:reset for unknown tokenId ${evt.tokenId}`,
          );
        }
        tok.state = "pending";
        delete tok.edge;
        delete tok.result;
        break;
      }

      case "step:complete": {
        snap.completedResults.push(evt.result);
        const tok = snap.tokens.get(evt.tokenId);
        if (tok) {
          tok.edge = evt.result.edge;
          tok.result = evt.result;
        }
        break;
      }

      case "retry:increment": {
        snap.retryBudgets.set(`${evt.nodeId}:${evt.label}`, {
          count: evt.count,
          max: evt.max,
        });
        break;
      }

      case "batch:start": {
        if (evt.v !== 1) throw new UnsupportedLogVersionError(evt.v);
        if (snap.batches.has(evt.batchId)) {
          throw new InconsistentLogError(
            `batch:start for existing batchId ${evt.batchId}`,
          );
        }
        snap.batches.set(evt.batchId, {
          nodeId: evt.nodeId,
          expected: evt.items,
          completed: 0,
        });
        break;
      }

      case "batch:item:complete": {
        if (evt.v !== 1) throw new UnsupportedLogVersionError(evt.v);
        const batch = snap.batches.get(evt.batchId);
        if (!batch) {
          throw new InconsistentLogError(
            `batch:item:complete for unknown batchId ${evt.batchId}`,
          );
        }
        batch.completed++;
        break;
      }

      case "batch:complete": {
        if (evt.v !== 1) throw new UnsupportedLogVersionError(evt.v);
        const b = snap.batches.get(evt.batchId);
        if (!b) {
          throw new InconsistentLogError(
            `batch:complete for unknown batchId ${evt.batchId}`,
          );
        }
        break;
      }

      case "workflow:complete": {
        snap.status = "complete";
        break;
      }

      case "workflow:error": {
        snap.status = "error";
        break;
      }

      // step:output is non-persisted; encountering it in the log means the
      // log was produced by a buggy writer. Treat as inconsistency.
      case "step:output": {
        throw new InconsistentLogError(
          "step:output must not appear in persisted event log",
        );
      }

      default: {
        const _exhaustive: never = evt;
        throw new InconsistentLogError(
          `Unknown event type in log: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }

  // If the run is non-terminal and has at least one waiting token, project
  // status as "suspended" so `RunInfo` / CLI can distinguish mid-run pauses
  // from genuinely in-flight runs.
  if (snap.status === "running") {
    for (const tok of snap.tokens.values()) {
      if (tok.state === "waiting") {
        snap.status = "suspended";
        break;
      }
    }
  }

  return snap;
}

/**
 * Scan a persisted event log for the maximum numeric suffix of any
 * `token:created` event's `tokenId`. Used by `openExistingRun` to seed a
 * resumed engine's `tokenCounter` so newly allocated ids do not collide.
 *
 * Returns 0 if no matching tokens were ever created.
 */
export function extractTokenCounter(events: EngineEvent[]): number {
  let max = 0;
  for (const evt of events) {
    if (evt.type !== "token:created") continue;
    const match = /^token-(\d+)$/.exec(evt.tokenId);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Read `events.jsonl` from a run directory and return the parsed events.
 *
 * Tolerates a single truncated trailing line (crash recovery). Any earlier
 * parse failure throws `TruncatedLogError` with the byte offset of the bad
 * line.
 */
export async function readEventLog(runDir: string): Promise<EngineEvent[]> {
  const raw = await readFile(join(runDir, "events.jsonl"), "utf-8");
  if (raw.length === 0) return [];

  const hasTrailingNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  // split("\n") on a newline-terminated string yields a trailing empty entry;
  // drop it so we don't mistake it for a truncated record.
  if (hasTrailingNewline) lines.pop();

  const events: EngineEvent[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    try {
      if (line.length === 0) continue;
      events.push(JSON.parse(line) as EngineEvent);
    } catch (err) {
      if (isLast && !hasTrailingNewline) {
        // Crashed mid-write on the last record — accept and stop.
        return events;
      }
      throw new TruncatedLogError(
        `Parse error in events.jsonl at line ${i + 1} (byte offset ${offset}): ${(err as Error).message}`,
        offset,
      );
    }
    offset += line.length + 1;
  }
  return events;
}

// src/log/select.ts
//
// Resolve a step-row selection into a concrete log target (`stepSeq` +
// `nodeId`) or an `empty` reason — the log panel consumes this to decide
// whether to open a sidecar stream.
//
// PURITY NOTE: only type-only imports from markflow + sibling pure types.

import type { EngineEvent } from "markflow-cli";
import type { StepsSnapshot } from "../steps/types.js";
import type { LogPanelEmptyReason } from "./types.js";

export type ResolveLogTargetResult =
  | {
      readonly exists: true;
      readonly stepSeq: number;
      readonly nodeId: string;
      readonly tokenId: string;
    }
  | { readonly exists: false; readonly reason: LogPanelEmptyReason };

export interface LogSelection {
  readonly rowId: string;
}

/**
 * Resolve a step-table row id into a log target. Requires the step's
 * owning `step:start` event to have been observed in the event ring —
 * without it we can't form the sidecar filename (`<seqPadded4>-<node>…`).
 */
export function resolveLogTarget(
  snapshot: StepsSnapshot | null,
  events: readonly EngineEvent[],
  selection: LogSelection | null,
): ResolveLogTargetResult {
  if (selection == null) {
    return { exists: false, reason: { kind: "no-selection" } };
  }
  const rowId = selection.rowId;
  if (rowId.startsWith("batch:")) {
    return { exists: false, reason: { kind: "aggregate" } };
  }
  // Row id is a token id. Locate the matching `step:start` event — this
  // gives us both the `seq` (→ sidecar filename) and the `nodeId`.
  for (const ev of events) {
    if (ev.type !== "step:start") continue;
    if (ev.tokenId !== rowId) continue;
    return {
      exists: true,
      stepSeq: ev.seq,
      nodeId: ev.nodeId,
      tokenId: rowId,
    };
  }
  // No step:start — either the token exists in the snapshot but hasn't
  // started yet, or the id is unknown.
  if (snapshot && snapshot.tokens.has(rowId)) {
    return { exists: false, reason: { kind: "pending" } };
  }
  return { exists: false, reason: { kind: "not-found", id: rowId } };
}

// src/events/merge.ts
//
// Pure helper that fuses the in-memory ring tail with an on-disk event
// log for the Events tab. Ring wins on seq collisions (includes
// non-persisted events). Deterministic by seq order.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §3.3
//
// PURITY NOTE: no ink/react/node:* imports.

import type { EngineEvent } from "markflow";

export function mergeEventSources(
  ring: readonly EngineEvent[],
  persisted: readonly EngineEvent[],
): EngineEvent[] {
  const bySeq = new Map<number, EngineEvent>();
  for (const e of persisted) bySeq.set(e.seq, e);
  for (const e of ring) bySeq.set(e.seq, e);
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
}

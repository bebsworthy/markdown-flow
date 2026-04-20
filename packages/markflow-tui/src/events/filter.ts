// src/events/filter.ts
//
// Pure kind-group mapping + filter-match helper for the Events tab.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §2.2
//
// PURITY NOTE: no ink/react/node:* imports.

import type { EngineEvent, EngineEventType } from "markflow-cli";
import type { EventKindGroup, EventsFilter } from "./types.js";

/**
 * Collapse the ~30 engine event types into 6 user-level groups. Exhaustive
 * over every `EngineEventType`; unknown types fall through to `"run"`.
 */
export function groupForType(type: EngineEventType): EventKindGroup {
  switch (type) {
    case "run:start":
    case "run:resumed":
    case "workflow:complete":
    case "workflow:error":
      return "run";
    case "token:created":
    case "token:state":
    case "token:reset":
      return "token";
    case "step:start":
    case "step:complete":
    case "step:output":
    case "step:timeout":
    case "step:waiting":
    case "output:ref":
    case "global:update":
      return "step";
    case "route":
      return "route";
    case "retry:increment":
    case "retry:exhausted":
    case "step:retry":
      return "retry";
    case "batch:start":
    case "batch:item:complete":
    case "batch:complete":
    case "approval:decided":
      return "batch";
    default:
      return "run";
  }
}

/**
 * Returns true when `event` passes every active predicate in `filter`. A
 * null-ish nodeId on an event never matches a node filter.
 */
export function matchesFilter(
  event: EngineEvent,
  filter: EventsFilter,
  // The search haystack (summary + nodeId + type) is precomputed by the
  // derive step; callers without a precomputed haystack may pass null here
  // and a minimal fallback is used. Kept as an optional third parameter so
  // filter.ts can stay zero-dependency on format.ts.
  precomputedHaystack?: string,
): boolean {
  // Kind filter
  if (filter.kinds !== "all") {
    const grp = groupForType(event.type);
    if (!filter.kinds.has(grp)) return false;
  }

  // Node filter
  if (filter.nodeId !== null) {
    const n = eventNodeId(event);
    if (n !== filter.nodeId) return false;
  }

  // Search filter
  if (filter.search.length > 0) {
    const needle = filter.search.toLowerCase();
    const hay =
      precomputedHaystack ?? buildFallbackHaystack(event);
    if (!hay.toLowerCase().includes(needle)) return false;
  }

  return true;
}

/** Best-effort nodeId extraction for arbitrary engine events. */
export function eventNodeId(event: EngineEvent): string | null {
  // Most payloads carry `nodeId` directly; a few carry a `from`/`to` pair.
  const payload = event as unknown as Record<string, unknown>;
  const n = payload["nodeId"];
  if (typeof n === "string") return n;
  const from = payload["from"];
  if (typeof from === "string") return from;
  return null;
}

function buildFallbackHaystack(event: EngineEvent): string {
  const node = eventNodeId(event) ?? "";
  return `${event.type} ${node}`;
}

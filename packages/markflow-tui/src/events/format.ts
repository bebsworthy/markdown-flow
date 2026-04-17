// src/events/format.ts
//
// Pure row formatters for the Events tab — turn `EngineEvent` into a
// presentation-ready `EventsPanelRow`.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §2 / §3
//
// PURITY NOTE: no ink/react/node:* imports.

import type { EngineEvent, EngineEventType } from "markflow";
import type { ColorRole } from "../theme/tokens.js";
import { eventNodeId, groupForType } from "./filter.js";
import type { EventKindGroup, EventsPanelRow } from "./types.js";

const KIND_LABEL_WIDTH = 14;

/**
 * Format a `ts` ISO timestamp as `HH:MM:SS.mmm` in UTC. Malformed input
 * returns an 8-space pad so columns stay aligned.
 */
export function formatEventTimestamp(ts: string): string {
  const n = Date.parse(ts);
  if (!Number.isFinite(n)) return "            ";
  const d = new Date(n);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Pad/truncate a kind label to the fixed 14-col width. */
export function formatEventKind(type: EngineEventType | string): string {
  if (type.length >= KIND_LABEL_WIDTH) return type.slice(0, KIND_LABEL_WIDTH);
  return type + " ".repeat(KIND_LABEL_WIDTH - type.length);
}

/** Map a group to its presentation `ColorRole`. */
export function roleForGroup(group: EventKindGroup): ColorRole {
  switch (group) {
    case "run":
      return "accent";
    case "token":
      return "dim";
    case "step":
      return "running";
    case "route":
      return "route";
    case "retry":
      return "retrying";
    case "batch":
      return "batch";
  }
}

/** Short human summary for one engine event (per-type dispatch). */
export function summariseEvent(event: EngineEvent): string {
  switch (event.type) {
    case "run:start":
      return `workflow=${event.workflowName} source=${event.sourceFile}`;
    case "run:resumed":
      return `resumed@${event.resumedAtSeq}`;
    case "workflow:complete":
      return `results=${event.results.length}`;
    case "workflow:error":
      return event.error;
    case "token:created": {
      const parent = event.parentTokenId ? ` parent=${event.parentTokenId}` : "";
      const batch = event.batchId ? ` batch=${event.batchId}` : "";
      const idx = event.itemIndex !== undefined ? ` idx=${event.itemIndex}` : "";
      return `token=${event.tokenId} node=${event.nodeId} gen=${event.generation}${parent}${batch}${idx}`;
    }
    case "token:state":
      return `token=${event.tokenId} ${event.from} -> ${event.to}`;
    case "token:reset":
      return `token=${event.tokenId}`;
    case "step:start":
      return `node=${event.nodeId} token=${event.tokenId}`;
    case "step:output":
      return `node=${event.nodeId} stream=${event.stream} bytes=${event.chunk.length}`;
    case "step:complete": {
      const e = event.result.edge ? ` edge=${event.result.edge}` : "";
      const xc =
        event.result.exit_code != null
          ? ` exit=${event.result.exit_code}`
          : "";
      return `node=${event.nodeId}${e}${xc}`;
    }
    case "step:timeout":
      return `node=${event.nodeId} elapsed=${event.elapsedMs}ms limit=${event.limitMs}ms`;
    case "step:waiting":
      return `node=${event.nodeId} prompt=${JSON.stringify(event.prompt)}`;
    case "step:retry":
      return `node=${event.nodeId} attempt=${event.attempt} delay=${event.delayMs}ms reason=${event.reason}`;
    case "retry:increment":
      return `node=${event.nodeId} label=${event.label} ${event.count}/${event.max}`;
    case "retry:exhausted":
      return `node=${event.nodeId} label=${event.label}`;
    case "route": {
      const edge = event.edge ? ` edge=${event.edge}` : "";
      return `from=${event.from} to=${event.to}${edge}`;
    }
    case "batch:start":
      return `batch=${event.batchId} node=${event.nodeId} items=${event.items}`;
    case "batch:item:complete":
      return `batch=${event.batchId} idx=${event.itemIndex} ok=${event.ok} edge=${event.edge}`;
    case "batch:complete":
      return `batch=${event.batchId} status=${event.status} ok=${event.succeeded} fail=${event.failed}`;
    case "approval:decided":
      return `node=${event.nodeId} choice=${event.choice}`;
    case "output:ref":
      return `stepSeq=${event.stepSeq} node=${event.nodeId} stream=${event.stream} path=${event.path}`;
    case "global:update":
      return `keys=${event.keys.join(",")}`;
    default: {
      // Future-proof: unknown types render a JSON fallback.
      const e = event as unknown as { type: string };
      return `type=${e.type}`;
    }
  }
}

/** Build the haystack string used by the search filter. */
export function buildSearchHaystack(event: EngineEvent): string {
  const node = eventNodeId(event) ?? "";
  return `${event.type} ${node} ${summariseEvent(event)}`;
}

/** Build a presentation-ready row from one engine event. */
export function formatEventRow(event: EngineEvent): EventsPanelRow {
  const group = groupForType(event.type);
  return {
    seq: event.seq,
    ts: formatEventTimestamp(event.ts),
    kindLabel: formatEventKind(event.type),
    group,
    nodeId: eventNodeId(event),
    summary: summariseEvent(event),
    role: roleForGroup(group),
  };
}

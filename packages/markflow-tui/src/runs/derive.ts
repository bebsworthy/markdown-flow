// src/runs/derive.ts
//
// Pure projection helpers turning engine `RunInfo` records into displayable
// `RunsTableRow` values. All outputs are strings + structured cells; the
// component does zero derivation of its own.
//
// Authoritative references:
//   - docs/tui/features.md §3.2 (table contents)
//   - docs/tui/mockups.md §1 (column semantics)
//   - docs/tui/plans/P5-T1.md §5.6, §6.3, §6.4
//
// PURITY NOTE: no ink/react/node:* imports. Only type-only imports from
// `markflow` and the sibling pure modules plus runtime constants from the
// theme tokens module (which is itself pure).

import type { RunInfo, RunStatus, StepResult } from "markflow-cli";
import type { ColorRole } from "../theme/tokens.js";
import type { GlyphKey } from "../theme/glyphs.js";
import { UNICODE_GLYPHS } from "../theme/glyphs.js";
import type { RunsTableRow, StatusCell } from "./types.js";

// ---------------------------------------------------------------------------
// Status → color-role / glyph-key / label mappings
// ---------------------------------------------------------------------------

/**
 * Engine status → theme color role. Engine `"error"` maps to the `"failed"`
 * role (red); engine `"suspended"` maps to `"waiting"` (yellow). The other
 * two pass through unchanged.
 */
export function runStatusToRole(status: RunStatus): ColorRole {
  switch (status) {
    case "running":
      return "running";
    case "complete":
      return "complete";
    case "error":
      return "failed";
    case "suspended":
      return "waiting";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Engine status → glyph key (index into `theme.glyphs`). */
export function runStatusToGlyphKey(status: RunStatus): GlyphKey {
  switch (status) {
    case "running":
      return "running";
    case "complete":
      return "ok";
    case "error":
      return "fail";
    case "suspended":
      return "waiting";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * Engine status → user-facing label per mockups.md §1 line 20. Engine
 * `"complete"` renders as `"ok"`, `"error"` as `"failed"`.
 */
export function runStatusToLabel(status: RunStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "suspended":
      return "waiting";
    case "complete":
      return "ok";
    case "error":
      return "failed";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Extract a short, differentiable portion of a run id. Run ids are ISO
 * timestamps with colons/dots replaced by dashes (e.g.
 * `2026-04-19T10-18-20-290Z`). The date prefix is identical for same-day
 * runs, so we extract the `HH:MM:SS` time portion instead. Falls back to
 * the first 8 chars for non-timestamp ids.
 */
export function formatShortId(id: string): string {
  const m = id.match(/T(\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}

/**
 * Format a started-at ISO timestamp as `HH:MM:SS` in local time. Malformed
 * ISO returns the em-dash glyph ("—") per hide-don't-grey discipline —
 * falling back to a raw "Invalid Date" would be noise.
 */
export function formatStartedHMS(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Format an elapsed-ms value as a compact duration.
 *   < 60s          → "Ns"
 *   < 1h           → "NmSSs"
 *   < 24h          → "NhMm"
 *   >= 24h         → "Nd Hh"
 * Negative or NaN → "—".
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }
  if (totalSeconds < 86400) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${h}h${m.toString().padStart(2, "0")}m`;
  }
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

/**
 * Elapsed-ms for a run. For terminal runs uses `completedAt - startedAt`;
 * for active runs uses `now - startedAt`. Returns 0 (rather than negative)
 * on malformed timestamps so downstream numeric sorts stay well-behaved.
 */
export function deriveElapsedMs(info: RunInfo, nowMs: number): number {
  const start = Date.parse(info.startedAt);
  if (!Number.isFinite(start)) return 0;
  const end =
    info.completedAt != null ? Date.parse(info.completedAt) : nowMs;
  const effEnd = Number.isFinite(end) ? end : nowMs;
  const diff = effEnd - start;
  return diff < 0 ? 0 : diff;
}

// ---------------------------------------------------------------------------
// Step label — best-effort projection from `info.steps[]`
// ---------------------------------------------------------------------------

interface BatchProgress {
  readonly current: number;
  readonly total: number;
}

/**
 * Detect `node#N/M`-style batch progression from the trailing run of
 * steps that share a node prefix. Matches when the last step's node ends
 * in `#<digits>` — the engine's batch-item naming convention.
 */
function extractBatchProgress(steps: ReadonlyArray<StepResult>): {
  base: string;
  progress: BatchProgress;
} | null {
  if (steps.length === 0) return null;
  const last = steps[steps.length - 1]!;
  const match = last.node.match(/^(.+)#(\d+)$/);
  if (!match) return null;
  const base = match[1]!;
  const currentIndex = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(currentIndex)) return null;
  // Count how many trailing items share this base.
  let count = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.node.startsWith(`${base}#`)) count += 1;
    else break;
  }
  // We can't know the total without engine state; fall back to treating
  // the highest index seen as the lower-bound total.
  const current = count;
  const total = Math.max(currentIndex + 1, count);
  return { base, progress: { current, total } };
}

/**
 * Project a user-facing STEP label. Best-effort — the engine does not
 * expose a "current step" field, so we name the last completed step. For
 * batch progressions we render `"node M/N"` when we can detect the
 * pattern. Empty steps → em-dash per hide-don't-grey.
 */
export function deriveStepLabel(info: RunInfo): string {
  const steps = info.steps;
  if (steps.length === 0) return "—";
  const last = steps[steps.length - 1]!;
  const batch = extractBatchProgress(steps);
  if (batch) {
    return `${batch.base} ${batch.progress.current}/${batch.progress.total}`;
  }
  return last.node;
}

// ---------------------------------------------------------------------------
// Note — best-effort free-text
// ---------------------------------------------------------------------------

/**
 * Project a human-readable NOTE cell. Error runs surface the last step's
 * summary or exit code; suspended runs surface the prompt (quoted);
 * running runs with a non-zero exit on the last step are mid-retry and
 * render `"↻ retrying"`. Everything else is blank.
 */
export function deriveNote(info: RunInfo): string {
  const last =
    info.steps.length > 0 ? info.steps[info.steps.length - 1]! : null;
  if (info.status === "error") {
    if (last?.summary) return last.summary;
    if (last && last.exit_code != null && last.exit_code !== 0) {
      return `exit ${last.exit_code} · retries exhausted`;
    }
    return "";
  }
  if (info.status === "suspended") {
    if (last?.summary) return `"${last.summary}"`;
    return "waiting";
  }
  if (info.status === "running") {
    if (last && last.exit_code != null && last.exit_code !== 0) {
      return `${UNICODE_GLYPHS.retry} retrying`;
    }
    return "";
  }
  return "";
}

// ---------------------------------------------------------------------------
// StatusCell builder
// ---------------------------------------------------------------------------

/**
 * Build the structured status cell. The glyph comes from the UNICODE
 * table — this is a "pure" view of the glyph; the Ink renderer still
 * consults `theme.glyphs[key]` so ASCII terminals get `[run]` etc. We
 * carry the `glyphKey` alongside so the renderer can do the lookup.
 */
export function toStatusCell(status: RunStatus): StatusCell {
  const role = runStatusToRole(status);
  const glyphKey = runStatusToGlyphKey(status);
  const label = runStatusToLabel(status);
  return {
    glyph: UNICODE_GLYPHS[glyphKey],
    glyphKey,
    label,
    role,
  };
}

// ---------------------------------------------------------------------------
// Top-level row projection
// ---------------------------------------------------------------------------

/**
 * Project a `RunInfo` into a `RunsTableRow`. `nowMs` is threaded in so
 * callers can freeze time for tests and a future ticker can re-derive
 * rows on a cadence without us reading `Date.now()` here.
 */
export function deriveAgeMs(info: RunInfo, nowMs: number): number {
  const start = Date.parse(info.startedAt);
  if (!Number.isFinite(start)) return 0;
  const diff = nowMs - start;
  return diff < 0 ? 0 : diff;
}

export function toRunsTableRow(info: RunInfo, nowMs: number): RunsTableRow {
  const statusCell = toStatusCell(info.status);
  const elapsedMs = deriveElapsedMs(info, nowMs);
  const ageMs = deriveAgeMs(info, nowMs);
  return {
    id: info.id,
    idShort: formatShortId(info.id),
    workflow: info.workflowName,
    statusLabel: `${statusCell.glyph} ${statusCell.label}`,
    statusCell,
    step: deriveStepLabel(info),
    elapsed: formatElapsed(elapsedMs),
    elapsedMs,
    age: formatElapsed(ageMs),
    ageMs,
    started: formatStartedHMS(info.startedAt),
    note: deriveNote(info),
    info,
  };
}

// src/steps/detail-types.ts
//
// Type-only surface for the step detail panel (P6-T2). Zero runtime exports —
// mirrors the `src/steps/types.ts` discipline so the purity probe stays trivial.
//
// Authoritative references:
//   - docs/tui/features.md §3.4 (Step detail pane)
//   - docs/tui/mockups.md §1 bottom pane, §4 bottom pane, §6 bottom pane
//   - docs/tui/plans/P6-T2.md §2
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Only type-only imports
// from sibling pure modules.

import type { GlyphKey } from "../theme/glyphs.js";
import type { ColorRole } from "../theme/tokens.js";

// ---------------------------------------------------------------------------
// Selection — the view-layer handle threaded through `selectStepDetail`
// ---------------------------------------------------------------------------

export interface StepDetailSelection {
  /** `StepRow.id` from the step table — either a token id or `"batch:<id>"`. */
  readonly rowId: string;
}

// ---------------------------------------------------------------------------
// Field shape (pre-formatted; component never reaches for formatters)
// ---------------------------------------------------------------------------

export interface StepDetailField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** `"pair"` packs two fields onto one row; `"full"` spans both columns. */
  readonly layout: "pair" | "full";
}

// ---------------------------------------------------------------------------
// Stderr-tail preview line
// ---------------------------------------------------------------------------

export interface StderrTailLine {
  readonly seq: number | null;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Last-log-line preview
// ---------------------------------------------------------------------------

export interface LastLogLine {
  readonly seq: number;
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Empty / not-found / token / aggregate variants
// ---------------------------------------------------------------------------

export interface StepDetailEmpty {
  readonly kind: "empty";
}

export interface StepDetailNotFound {
  readonly kind: "not-found";
  readonly rowId: string;
}

export interface StepDetailTokenData {
  readonly nodeId: string;
  readonly tokenId: string;
  /** `seq` of the most recent relevant event (if any). */
  readonly seq: number | null;
  /** e.g. `"deploy-eu \u00b7 script (bash) \u00b7 seq=198"` */
  readonly headline: string;
  /** For terminal-failed steps (mockup \u00a76 parity); `null` otherwise. */
  readonly statusLine: string | null;
  readonly role: ColorRole;
  readonly glyphKey: GlyphKey;
  /** Ordered: type, attempt, timeout, exit, started, ended, edge, local, global, last log. */
  readonly fields: ReadonlyArray<StepDetailField>;
  /** Empty for running/ok tokens. */
  readonly stderrTail: ReadonlyArray<StderrTailLine>;
  /** Copy above the stderr-tail block (e.g. `"(last 3 lines \u2014 `2` or Tab for full log)"`). */
  readonly stderrTailNote: string | null;
}

export interface StepDetailAggregateData {
  readonly batchId: string;
  readonly nodeId: string;
  readonly headline: string;
  readonly role: ColorRole;
  readonly glyphKey: GlyphKey;
  readonly fields: ReadonlyArray<StepDetailField>;
}

export type StepDetailModel =
  | StepDetailEmpty
  | StepDetailNotFound
  | { readonly kind: "token"; readonly data: StepDetailTokenData }
  | { readonly kind: "aggregate"; readonly data: StepDetailAggregateData };

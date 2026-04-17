// src/help/types.ts
//
// Pure types for the help overlay (P7-T3). No runtime exports.

import type { KeySpec } from "../components/types.js";

export interface HelpRow {
  readonly keys: KeySpec;
  readonly label: string;
  readonly annotation?: string;
}

export interface HelpSection {
  readonly category: string; // "GLOBAL" for uncategorised rows.
  readonly rows: readonly HelpRow[];
}

export interface HelpModel {
  readonly sections: readonly HelpSection[];
  readonly totalRows: number;
}

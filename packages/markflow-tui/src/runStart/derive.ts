// src/runStart/derive.ts
//
// Pure derive functions for the input-prompt modal (P9-T1). Projects a
// parsed `WorkflowDefinition` into modal rows, folds rows into an inputs
// override map, and decides whether the submit gate is open.
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Registered in
// test/state/purity.test.ts.

import type { WorkflowDefinition } from "markflow";
import type { RunInputRow } from "./types.js";

/** Project `workflow.inputs[]` into modal rows, preserving declaration order. */
export function deriveRunInputRows(
  workflow: WorkflowDefinition,
): readonly RunInputRow[] {
  return workflow.inputs.map((decl) => ({
    key: decl.name,
    description: decl.description ?? "",
    required: decl.required === true,
    placeholder: decl.default ?? "",
    draft: "",
  }));
}

/**
 * Fold the row set into `{KEY: value}` overrides, skipping optional rows
 * whose draft is empty. Required rows always emit (`draft || placeholder`).
 */
export function composeRunInputs(
  rows: readonly RunInputRow[],
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.required) {
      out[row.key] = row.draft !== "" ? row.draft : row.placeholder;
      continue;
    }
    if (row.draft !== "") {
      out[row.key] = row.draft;
    }
  }
  return out;
}

/**
 * Names of required rows whose `draft` is empty *and* `placeholder` is
 * empty. These are the keys that block submit.
 */
export function missingRequiredInputs(
  rows: readonly RunInputRow[],
): readonly string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (!row.required) continue;
    if (row.draft !== "") continue;
    if (row.placeholder !== "") continue;
    out.push(row.key);
  }
  return out;
}

/** True when the modal would actually block submit. */
export function canSubmitRunInputs(rows: readonly RunInputRow[]): boolean {
  return missingRequiredInputs(rows).length === 0;
}

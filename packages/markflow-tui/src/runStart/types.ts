// src/runStart/types.ts
//
// Pure type declarations for the input-prompt modal (P9-T1).
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Type-only surface
// plus the pure union `RunWorkflowResult` consumed by both the engine
// bridge (`engine/run.ts`) and the modal. Registered in
// test/state/purity.test.ts.

/** One row in the input-prompt modal. */
export interface RunInputRow {
  readonly key: string;
  readonly description: string;
  readonly required: boolean;
  /** Default from `InputDeclaration.default` (empty string if none). */
  readonly placeholder: string;
  /** User-entered override; empty string means "use placeholder". */
  readonly draft: string;
}

/** Overlay-local form FSM — mirrors ResumeFormState. */
export type RunInputFsm = "idle" | "submitting" | "error";

export interface RunInputFormState {
  readonly rows: readonly RunInputRow[];
  readonly cursor: number;
  readonly fsm: RunInputFsm;
  readonly error: string | null;
}

export type RunInputFormAction =
  | { readonly type: "CURSOR_MOVE"; readonly delta: number }
  | { readonly type: "CURSOR_SET"; readonly index: number }
  | { readonly type: "SET_DRAFT"; readonly key: string; readonly value: string }
  | { readonly type: "SUBMIT_START" }
  | { readonly type: "SUBMIT_OK" }
  | { readonly type: "SUBMIT_FAIL"; readonly error: string };

/** Typed outcome of `runWorkflow` (engine/run.ts). */
export type RunWorkflowResult =
  | { readonly kind: "ok"; readonly runId: string }
  | { readonly kind: "invalidInputs"; readonly missing: readonly string[] }
  | { readonly kind: "parseError"; readonly message: string }
  | { readonly kind: "locked"; readonly runId: string; readonly lockPath: string }
  | { readonly kind: "error"; readonly message: string };

// src/resume/types.ts
//
// Pure type declarations for the resume wizard overlay (P7-T2).
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Type-only surface.
// Registered in test/state/purity.test.ts.

/** Minimal run metadata the wizard needs in its header line. */
export interface ResumableRun {
  readonly runId: string;
  readonly workflowName: string;
  readonly status: "error" | "suspended";
  readonly startedAt: string;
  readonly lastSeq: number;
  readonly lastEventLabel: string;
}

/** One row in the "Nodes to re-run" list. */
export interface RerunNode {
  readonly nodeId: string;
  readonly tokenId: string;
  readonly state: "complete" | "error" | "waiting" | "skipped";
  readonly summary: string;
  readonly preselected: boolean;
}

/** One row in the inputs editor. */
export interface InputRow {
  readonly key: string;
  readonly original: string;
  readonly draft: string;
  readonly edited: boolean;
  readonly required: boolean;
}

export type ResumeFocus = "rerun" | "inputs" | "confirm";

/** Local state for the wizard's form + submit FSM. */
export interface ResumeFormState {
  readonly focus: ResumeFocus;
  readonly rerunCursor: number;
  readonly inputsCursor: number;
  readonly rerun: ReadonlySet<string>;
  readonly inputs: Readonly<Record<string, string>>;
  readonly fsm: "idle" | "submitting" | "error";
  readonly error: string | null;
}

export type ResumeFormAction =
  | { readonly type: "FOCUS_NEXT" }
  | { readonly type: "FOCUS_PREV" }
  | { readonly type: "CURSOR_MOVE"; readonly delta: number }
  | { readonly type: "RERUN_TOGGLE" }
  | { readonly type: "INPUT_EDIT"; readonly key: string; readonly value: string }
  | { readonly type: "SUBMIT_START" }
  | { readonly type: "SUBMIT_OK" }
  | { readonly type: "SUBMIT_FAIL"; readonly error: string };

/** Typed outcome of `resumeRun()`. */
export type ResumeSubmitResult =
  | { readonly kind: "ok" }
  | { readonly kind: "locked"; readonly runId: string; readonly lockPath: string }
  | { readonly kind: "notResumable"; readonly status: string }
  | { readonly kind: "unknownNode"; readonly nodeId: string }
  | { readonly kind: "error"; readonly message: string };

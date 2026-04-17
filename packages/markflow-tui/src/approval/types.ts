// src/approval/types.ts
//
// Pure type declarations for the approval overlay (P7-T1).
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Type-only surface.
// Registered in test/state/purity.test.ts.

/** A single in-flight approval gate, extracted from the event tail. */
export interface PendingApproval {
  readonly runId: string;
  readonly nodeId: string;
  readonly tokenId: string;
  readonly prompt: string;
  readonly options: readonly string[];
  /** `seq` of the `step:waiting` event that surfaced this gate. */
  readonly waitingSeq: number;
}

/** Local state for the modal's option cursor + submit FSM. */
export interface ApprovalFormState {
  readonly cursor: number;
  readonly fsm: "idle" | "submitting" | "error";
  readonly error: string | null;
}

export type ApprovalFormAction =
  | { readonly type: "CURSOR_MOVE"; readonly delta: number }
  | { readonly type: "SUBMIT_START" }
  | { readonly type: "SUBMIT_OK" }
  | { readonly type: "SUBMIT_FAIL"; readonly error: string };

/** Typed outcome of a `decideApproval()` call. */
export type ApprovalSubmitResult =
  | { readonly kind: "ok" }
  | { readonly kind: "locked"; readonly runId: string; readonly lockPath: string }
  | { readonly kind: "notWaiting" }
  | { readonly kind: "invalidChoice" }
  | { readonly kind: "error"; readonly message: string };

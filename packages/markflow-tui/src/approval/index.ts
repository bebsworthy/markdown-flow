// src/approval/index.ts
//
// Barrel re-exports for the approval slice. Pure.

export type {
  ApprovalFormAction,
  ApprovalFormState,
  ApprovalSubmitResult,
  PendingApproval,
} from "./types.js";
export {
  countPendingApprovalsByRun,
  derivePendingApprovals,
  findPendingApproval,
} from "./derive.js";
export {
  approvalFormReducer,
  initialApprovalFormState,
} from "./reducer.js";

// src/steps/index.ts
//
// Barrel for the step-table pure module surface. Re-exports types + pure
// functions only. Does NOT re-export the React components — importers that
// need the Ink components import from `../components/step-table.js` directly.

export type {
  StepStatus,
  StepRowKind,
  BatchAggregate,
  BatchAggregateStatus,
  RetryHint,
  StepRow,
  ColumnAlign,
  StepStatusCell,
  StepProgressCell,
  StepColumnId,
  StepColumnWidths,
  StepTableColumn,
  StepsSnapshot,
} from "./types.js";

export {
  buildStepRows,
  indexByParent,
  orderRoots,
  projectStepsSnapshot,
} from "./tree.js";

export {
  BATCH_COLLAPSE_THRESHOLD,
  DEFAULT_PROGRESS_BAR_WIDTH,
  shouldAggregateBatch,
  formatProgressBar,
  deriveAggregateStatus,
  toBatchAggregate,
  formatAggregateNote,
  aggregateBatchRow,
} from "./aggregate.js";

export {
  STEP_WIDE_TIER_MIN,
  STEP_MEDIUM_TIER_MIN,
  STEP_COLUMNS_WIDE,
  STEP_COLUMNS_MEDIUM,
  STEP_COLUMNS_NARROW,
  pickStepColumnSet,
  computeStepColumnWidths,
  fitStepCell,
} from "./columns.js";

export {
  tokenToStatus,
  stepStatusToRole,
  stepStatusToGlyphKey,
  stepStatusToLabel,
  toStepStatusCell,
  formatAttempt,
  deriveStepElapsedMs,
  formatStepElapsed,
  formatEdgeNote,
  formatWaitingNote,
} from "./derive.js";

export {
  applyRetryEvent,
  buildRetryHints,
  formatRetryCountdown,
  EMPTY_RETRY_HINTS,
} from "./retry.js";
export type { RetryHintMap } from "./retry.js";

export {
  isUpstreamFailed,
  upstreamNoteLabel,
} from "./upstream.js";

export type {
  StepDetailSelection,
  StepDetailField,
  StderrTailLine,
  LastLogLine,
  StepDetailEmpty,
  StepDetailNotFound,
  StepDetailTokenData,
  StepDetailAggregateData,
  StepDetailModel,
} from "./detail-types.js";

export {
  selectStepDetail,
  formatJsonOneLine,
  pickLastLog,
  pickStderrTail,
  pickRouteTarget,
  computeStepTypeLabel,
  computeAttemptLabel,
  computeTimeoutLabel,
} from "./detail.js";

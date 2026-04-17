// src/log/index.ts
//
// Barrel — re-exports the pure log-panel surface for component consumers.

export type {
  AnsiColor,
  LogLine,
  LogLineSegment,
  LogPanelEmptyReason,
  LogPanelModel,
  LogPanelRow,
  LogPanelSettings,
  LogPanelState,
  LogReducerAction,
  LogStream,
} from "./types.js";
export { LOG_RING_CAP } from "./types.js";
export { ANSI_PATTERN, parseAnsi, stripAnsi } from "./ansi.js";
export { initialLogPanelState, logReducer, linesSincePause } from "./reducer.js";
export {
  appendEventLines,
  mergeSidecarTail,
  parseSidecarText,
  type IngestTarget,
} from "./ingest.js";
export {
  resolveLogTarget,
  type LogSelection,
  type ResolveLogTargetResult,
} from "./select.js";
export { deriveLogModel, emptyReasonLabel, formatHeader } from "./derive.js";

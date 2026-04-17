// src/components/index.ts
//
// Public barrel for the components surface. Re-exports the Keybar,
// AppShell, and ModeTabs components + their public types. Does NOT
// re-export layout internals — those live in keybar-layout.ts and
// app-shell-layout.ts and are scanned for purity via
// test/state/purity.test.ts.

export { Keybar, type KeybarProps } from "./keybar.js";
export { AppShell, type AppShellProps } from "./app-shell.js";
export { ModeTabs, type ModeTabsProps } from "./mode-tabs.js";
export {
  WorkflowBrowser,
  type WorkflowBrowserProps,
} from "./workflow-browser.js";
export { WorkflowList, type WorkflowListProps } from "./workflow-list.js";
export {
  WorkflowPreview,
  type WorkflowPreviewProps,
} from "./workflow-preview.js";
export {
  WorkflowBrowserEmpty,
  type WorkflowBrowserEmptyProps,
} from "./workflow-browser-empty.js";
export {
  AddWorkflowModal,
  type AddWorkflowModalProps,
} from "./add-workflow-modal.js";
export {
  AddModalFuzzyTab,
  type AddModalFuzzyTabProps,
} from "./add-modal-fuzzy-tab.js";
export {
  AddModalUrlTab,
  type AddModalUrlTabProps,
} from "./add-modal-url-tab.js";
export { RunsTable, type RunsTableProps } from "./runs-table.js";
export {
  RunsFilterBar,
  type RunsFilterBarProps,
} from "./runs-filter-bar.js";
export { RunsFooter, type RunsFooterProps } from "./runs-footer.js";
export {
  RunDetailPlaceholder,
  type RunDetailPlaceholderProps,
} from "./run-detail-placeholder.js";
export { StepTable, type StepTableProps } from "./step-table.js";
export {
  StepTableView,
  type StepTableViewProps,
} from "./step-table-view.js";
export {
  StepDetailPanel,
  type StepDetailPanelProps,
} from "./step-detail-panel.js";
export {
  StepDetailPanelView,
  type StepDetailPanelViewProps,
} from "./step-detail-panel-view.js";
export { LogPanel, type LogPanelProps } from "./log-panel.js";
export {
  LogPanelView,
  LogPaneStatusContext,
  useLogPaneStatus,
  type LogPanelViewProps,
  type LogPaneStatus,
} from "./log-panel-view.js";
export type { Binding, AppContext, KeySpec, Category } from "./types.js";

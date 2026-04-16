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
export type { Binding, AppContext, KeySpec, Category } from "./types.js";

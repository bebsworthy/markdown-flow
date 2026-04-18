// src/app.tsx
//
// Root component. Wraps the tree in <ThemeProvider> and renders the
// <AppShell> chrome. In `browsing.workflows` mode, the top slot hosts the
// <WorkflowBrowser>; all other modes still show the scaffold placeholder
// until their owning task lands.
//
// The `q` quit binding is retained from the scaffold — it remains the
// canonical test hook for `scaffold.test.tsx`.
//
// This file also owns the add-workflow overlay lifecycle (P4-T3):
//   - callbacks for addEntry / removeEntry + saveRegistry
//   - modal render when overlay.kind === "addWorkflow"
//   - one-shot launch-arg ingestion once the registry has loaded
//   - restricted empty-state keybar under AppShell's `keybar` slot

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { dirname } from "node:path";
import { Box, Text, useInput, useStdout } from "ink";
import { ThemeProvider } from "./theme/context.js";
import { AppShell } from "./components/app-shell.js";
import { ModeTabs } from "./components/mode-tabs.js";
import { WorkflowBrowser } from "./components/workflow-browser.js";
import { AddWorkflowModal } from "./components/add-workflow-modal.js";
import { Keybar } from "./components/keybar.js";
import { WORKFLOWS_EMPTY_KEYBAR } from "./components/keybar-fixtures/workflows-empty.js";
import { APPROVAL_KEYBAR } from "./components/keybar-fixtures/approval.js";
import { RESUME_KEYBAR } from "./components/keybar-fixtures/resume.js";
import { ApprovalModal } from "./components/approval-modal.js";
import { ResumeWizardModal } from "./components/resume-wizard-modal.js";
import { CommandPaletteModal } from "./components/command-palette-modal.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { selectKeybarFixture } from "./components/keybar-fixtures/registry.js";
import type { KeybarSelection } from "./components/keybar-fixtures/registry.js";
import type { CommandExecContext, CommandResult } from "./palette/types.js";
import {
  countPendingApprovalsByRun,
  findPendingApproval,
} from "./approval/index.js";
import type { ApprovalSubmitResult } from "./approval/types.js";
import { decideApproval as defaultDecideApproval } from "./engine/decide.js";
import { resumeRun as defaultResumeRun } from "./engine/resume.js";
import { runWorkflow as defaultRunWorkflow } from "./engine/run.js";
import { InputPromptModal } from "./components/input-prompt-modal.js";
import { deriveRunInputRows } from "./runStart/derive.js";
import type {
  RunInputRow,
  RunWorkflowResult,
} from "./runStart/types.js";
import type { ResolvedEntry } from "./browser/types.js";
import type { RunInfo, WorkflowDefinition } from "markflow";
import {
  deriveInputRows,
  deriveRerunNodes,
  deriveResumableRun,
  findFailingNode,
  isRunResumable,
} from "./resume/index.js";
import type {
  InputRow,
  RerunNode,
  ResumableRun,
  ResumeSubmitResult,
} from "./resume/types.js";
import { RunsTable } from "./components/runs-table.js";
import { RunDetailPlaceholder } from "./components/run-detail-placeholder.js";
import { StepTableView } from "./components/step-table-view.js";
import { GraphPanelView } from "./components/graph-panel-view.js";
import { ViewingBottomSlot } from "./components/viewing-panes.js";
import { pickFrameSlots } from "./components/app-shell-layout.js";
import {
  NARROW_TIER_MAX,
  composeBreadcrumb,
  pickNarrowLevel,
  type NarrowLevel,
} from "./components/narrow-layout.js";
import { StepDetailPanelView } from "./components/step-detail-panel-view.js";
import { detectCapabilities } from "./theme/capabilities.js";
import { buildTheme } from "./theme/theme.js";
import {
  buildStepRows,
  projectStepsSnapshot,
} from "./steps/tree.js";
import { buildRetryHints } from "./steps/retry.js";
import { composeViewingTabRow, type ViewingTabKey } from "./components/viewing-pane-tabs-layout.js";
import { reducer, initialAppState } from "./state/reducer.js";
import { initialEngineState } from "./engine/reducer.js";
import type { EngineState } from "./engine/types.js";
import {
  addEntry,
  loadRegistry,
  removeEntry,
  resolveRegistryPath,
  saveRegistry,
} from "./registry/index.js";
import { ingestUrl } from "./add-modal/url-ingest.js";
import type { RegistryState } from "./registry/types.js";
import type { UrlIngestResult } from "./add-modal/types.js";
import type { RunsTableRow } from "./runs/types.js";

export interface AppProps {
  readonly onQuit: () => void;
  readonly registryConfig?: {
    readonly listPath: string | null;
    readonly persist: boolean;
  };
  readonly initialLaunchArgs?: ReadonlyArray<string>;
  /**
   * Test override for URL ingestion. Same signature as `ingestUrl`.
   * Production defaults to `ingestUrl`.
   */
  readonly urlIngestor?: (
    url: string,
    baseDir: string,
  ) => Promise<UrlIngestResult>;
  /**
   * Test seam — seeds the runs-table feed that production will wire to
   * `runs.watch()` in P6-T0. When undefined, the feed is empty (the
   * current production behaviour). When provided, rows are passed
   * through verbatim — no sort/filter pre-processing.
   */
  readonly initialRunRows?: ReadonlyArray<RunsTableRow>;
  /**
   * Test seam — seeds the engine slice that production will wire to the
   * adapter+reducer in P6-T0. When undefined, the slice is empty (the
   * current production behaviour — the step table renders an empty state
   * until the live feed lands). See docs/tui/plans/P6-T1.md §8.1.
   */
  readonly engineState?: EngineState;
  /**
   * Optional override for the path to the `runs/` parent. Threaded to
   * <LogPanelView> so the log pane can open per-step sidecar files. Null
   * disables sidecar reads (the ring-buffer tail still populates lines).
   */
  readonly runsDir?: string | null;
  /**
   * Test seam — overrides the `decideApproval` call used by the
   * approval modal. Production defaults to the real engine bridge
   * (`src/engine/decide.ts`).
   */
  readonly decideApproval?: (args: {
    readonly runsDir: string;
    readonly runId: string;
    readonly nodeId: string;
    readonly choice: string;
    readonly decidedBy?: string;
  }) => Promise<ApprovalSubmitResult>;
  /**
   * Test seam — overrides the `resumeRun` call used by the resume wizard.
   * Production defaults to the real engine bridge (`src/engine/resume.ts`).
   */
  readonly resumeRun?: (args: {
    readonly runsDir: string;
    readonly runId: string;
    readonly rerunNodes: readonly string[];
    readonly inputOverrides: Readonly<Record<string, string>>;
  }) => Promise<ResumeSubmitResult>;
  /**
   * Test seam — optional override for the parsed workflow passed to the
   * resume wizard modal. Production leaves this undefined; the modal does
   * not currently use workflow fields beyond input declarations, which are
   * sourced via `deriveInputRows(workflow, events)`.
   */
  readonly resumeWorkflow?: import("markflow").WorkflowDefinition | null;
  /**
   * Test seam — overrides the `runWorkflow` call used by the run-entry
   * flow (P9-T1). Production defaults to the real engine bridge
   * (`src/engine/run.ts`).
   */
  readonly runWorkflow?: (args: {
    readonly runsDir: string;
    readonly workspaceDir: string;
    readonly sourceFile: string;
    readonly inputs: Readonly<Record<string, string>>;
    readonly onRunStart?: (runId: string) => void;
  }) => Promise<RunWorkflowResult>;
  /**
   * Test seam — snapshot of currently-resolved workflows used by the
   * run-entry flow to look up a workflow by name or id when the runs
   * table emits `r`. Production threads this from the workflow browser
   * once resolvers have completed; tests seed it.
   */
  readonly runRegistryLookup?: ReadonlyArray<ResolvedEntry>;
}

export function App({
  onQuit,
  registryConfig,
  initialLaunchArgs,
  urlIngestor,
  initialRunRows,
  engineState,
  runsDir,
  decideApproval,
  resumeRun,
  resumeWorkflow,
  runWorkflow: runWorkflowProp,
  runRegistryLookup,
}: AppProps): React.ReactElement {
  const effectiveEngineState: EngineState = engineState ?? initialEngineState;
  const [state, dispatch] = useReducer(reducer, initialAppState);
  const { stdout } = useStdout();

  // ---- Pending approvals derivation (P7-T1) -----------------------------
  // Recompute on every render — the activeRun.events ring is capped and
  // re-allocated per append, so useMemo would re-fire anyway (plan §6 D8).
  const pendingCountsByRun = countPendingApprovalsByRun(
    effectiveEngineState.runs,
    effectiveEngineState.activeRun,
  );
  const activePending = findPendingApproval(
    effectiveEngineState.activeRun?.events ?? [],
  );
  // `derivePendingApprovals` fills runId from info.id; when info is null the
  // string is empty. Rehydrate from the active snapshot so callers get the
  // authoritative runId.
  const pendingForActiveRun =
    state.mode.kind === "viewing" &&
    effectiveEngineState.activeRun &&
    effectiveEngineState.activeRun.runId === state.mode.runId &&
    activePending
      ? { ...activePending, runId: effectiveEngineState.activeRun.runId }
      : null;
  // `pendingApprovalsCount` threaded to keybar AppContext.
  const pendingApprovalsCount: number =
    state.mode.kind === "viewing"
      ? (pendingCountsByRun.get(state.mode.runId) ?? 0)
      : Array.from(pendingCountsByRun.values()).reduce((a, b) => a + b, 0);

  const decide = decideApproval ?? defaultDecideApproval;
  const resume = resumeRun ?? defaultResumeRun;
  const startRun = runWorkflowProp ?? defaultRunWorkflow;

  // ---- Resume wizard derivations (P7-T2) -------------------------------
  const activeRun = effectiveEngineState.activeRun;
  const activeRunInfo = activeRun?.info ?? null;
  const runResumable: boolean =
    state.mode.kind === "viewing" &&
    activeRun !== null &&
    activeRun.runId === state.mode.runId &&
    isRunResumable(activeRunInfo);

  let resumableRun: ResumableRun | null = null;
  let rerunNodes: readonly RerunNode[] = [];
  let inputRows: readonly InputRow[] = [];
  if (runResumable && activeRun && activeRunInfo) {
    resumableRun = deriveResumableRun(activeRunInfo, activeRun.events);
    rerunNodes = deriveRerunNodes(activeRunInfo, activeRun.events);
    if (resumeWorkflow) {
      inputRows = deriveInputRows(resumeWorkflow, activeRun.events);
    }
  }

  const [registryState, setRegistryState] = useState<RegistryState>({
    entries: [],
  });
  const [registryPath, setRegistryPath] = useState<string | null>(null);
  const [registryLoaded, setRegistryLoaded] = useState<boolean>(false);

  // Refs so async callbacks never capture stale state.
  const registryPathRef = useRef<string | null>(null);
  registryPathRef.current = registryPath;
  const latestStateRef = useRef<RegistryState>(registryState);
  latestStateRef.current = registryState;

  useEffect(() => {
    let cancelled = false;
    const cfg = registryConfig ?? { listPath: null, persist: true };
    const resolved = cfg.persist
      ? resolveRegistryPath(cfg.listPath, process.cwd())
      : null;
    setRegistryPath(resolved);
    if (resolved === null) {
      setRegistryLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    loadRegistry(resolved).then(
      ({ state: loaded }) => {
        if (cancelled) return;
        setRegistryState(loaded);
        setRegistryLoaded(true);
      },
      () => {
        // Corruption handling deferred — registry keeps its initial empty
        // state and the UI still works.
        if (cancelled) return;
        setRegistryLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [registryConfig]);

  // ---- Persistence callbacks ---------------------------------------------

  const onAddEntry = useCallback(async (source: string): Promise<void> => {
    const addedAt = new Date().toISOString();
    const next = addEntry(latestStateRef.current, { source, addedAt });
    latestStateRef.current = next;
    setRegistryState(next);
    const p = registryPathRef.current;
    if (p !== null) {
      try {
        await saveRegistry(p, next);
      } catch {
        /* Persistence failures are swallowed; a toast surface lands later. */
      }
    }
  }, []);

  const onRemoveEntry = useCallback(async (source: string): Promise<void> => {
    const next = removeEntry(
      latestStateRef.current,
      (e) => e.source === source,
    );
    latestStateRef.current = next;
    setRegistryState(next);
    const p = registryPathRef.current;
    if (p !== null) {
      try {
        await saveRegistry(p, next);
      } catch {
        /* Persistence failures swallowed; toast surface deferred. */
      }
    }
  }, []);

  // ---- Launch-arg ingestion ---------------------------------------------

  const launchArgsConsumedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!registryLoaded) return;
    if (launchArgsConsumedRef.current) return;
    const args = initialLaunchArgs ?? [];
    if (args.length === 0) {
      launchArgsConsumedRef.current = true;
      return;
    }
    launchArgsConsumedRef.current = true;
    const ingestor = urlIngestor ?? ingestUrl;
    (async () => {
      for (const arg of args) {
        if (/^https?:\/\//i.test(arg)) {
          try {
            const res = await ingestor(arg, process.cwd());
            if (res.ok) await onAddEntry(res.workspaceDir);
          } catch {
            /* Swallow per §4 — toast lands in a later task. */
          }
        } else {
          await onAddEntry(arg);
        }
      }
    })();
  }, [registryLoaded, initialLaunchArgs, urlIngestor, onAddEntry]);

  // ---- Run-entry helpers (P9-T1) ----------------------------------------
  //
  // Two shapes of caller:
  //   1. `startRunFromEntry(entry)` — given a ResolvedEntry from the
  //      workflow browser or runs-table resolver, open the input modal
  //      when required inputs are declared; otherwise invoke the bridge
  //      directly and transition to viewing mode on success.
  //   2. `startRunFromWorkflow(workflow, sourceFile)` — same logic but
  //      sourced from a parsed WorkflowDefinition (palette path).
  // Both funnel into the same bridge call + overlay open.
  const launchRun = useCallback(
    async (args: {
      readonly sourceFile: string;
      readonly workspaceDir: string;
      readonly inputs: Readonly<Record<string, string>>;
    }): Promise<RunWorkflowResult> => {
      if (!runsDir) {
        return { kind: "error", message: "runsDir is not configured" };
      }
      return startRun({
        runsDir,
        workspaceDir: args.workspaceDir,
        sourceFile: args.sourceFile,
        inputs: args.inputs,
        onRunStart: (runId) => {
          dispatch({ type: "OVERLAY_CLOSE" });
          dispatch({ type: "MODE_OPEN_RUN", runId });
        },
      });
    },
    [runsDir, startRun],
  );

  const startRunForWorkflow = useCallback(
    (args: {
      readonly workflowId: string;
      readonly workflow: WorkflowDefinition;
      readonly sourceFile: string;
    }): void => {
      const rows = deriveRunInputRows(args.workflow);
      if (rows.length === 0) {
        // Direct launch — no modal.
        void launchRun({
          sourceFile: args.sourceFile,
          workspaceDir: dirname(args.sourceFile),
          inputs: {},
        });
        return;
      }
      dispatch({
        type: "OVERLAY_OPEN",
        overlay: {
          kind: "runInput",
          workflowId: args.workflowId,
          sourceFile: args.sourceFile,
          workspaceDir: dirname(args.sourceFile),
          workflowName: args.workflow.name,
          seedRows: rows as readonly RunInputRow[],
          state: "idle",
        },
      });
    },
    [launchRun],
  );

  const startRunFromEntry = useCallback(
    (entry: ResolvedEntry): void => {
      if (entry.status !== "valid") return;
      if (!entry.workflow || !entry.absolutePath) return;
      startRunForWorkflow({
        workflowId: entry.id,
        workflow: entry.workflow,
        sourceFile: entry.absolutePath,
      });
    },
    [startRunForWorkflow],
  );

  const runsTableStartRun = useCallback(
    (info: RunInfo): void => {
      const entries = runRegistryLookup ?? [];
      const match = entries.find(
        (e) =>
          e.workflow !== null &&
          (e.workflow.name === info.workflowName ||
            (e.absolutePath !== null && e.absolutePath === info.sourceFile)),
      );
      if (match) startRunFromEntry(match);
    },
    [runRegistryLookup, startRunFromEntry],
  );

  const paletteRunWorkflow = useCallback(
    async (arg: string): Promise<CommandResult> => {
      const entries = runRegistryLookup ?? [];
      if (entries.length === 0) {
        return {
          kind: "unavailable",
          message: "no workflows registered",
        };
      }
      const needle = arg.trim();
      if (needle === "") {
        return { kind: "usage", message: "usage: :run <workflow>" };
      }
      // Exact match on name or id.
      let match: ResolvedEntry | null =
        entries.find(
          (e) =>
            (e.workflow && e.workflow.name === needle) || e.id === needle,
        ) ?? null;
      if (!match) {
        // Unique prefix match on name.
        const prefixMatches = entries.filter(
          (e) => e.workflow && e.workflow.name.startsWith(needle),
        );
        if (prefixMatches.length === 1) {
          match = prefixMatches[0]!;
        } else if (prefixMatches.length > 1) {
          return {
            kind: "usage",
            message: `ambiguous: matches ${prefixMatches
              .map((e) => (e.workflow ? e.workflow.name : e.id))
              .join(", ")}`,
          };
        }
      }
      if (!match) {
        return {
          kind: "unavailable",
          message: `no workflow matching '${needle}'`,
        };
      }
      if (match.status !== "valid" || !match.workflow || !match.absolutePath) {
        return {
          kind: "unavailable",
          message: "workflow is not resolvable",
        };
      }
      // Schedule the run-entry dispatch for the NEXT macrotask so the
      // palette's `{kind:"ok"}` branch can run its own `OVERLAY_CLOSE`
      // first without clobbering the new `runInput` overlay. Palette
      // sees `ok`, closes itself; then we open the input modal on the
      // next tick.
      const resolvedMatch = match;
      setImmediate(() => {
        startRunForWorkflow({
          workflowId: resolvedMatch.id,
          workflow: resolvedMatch.workflow!,
          sourceFile: resolvedMatch.absolutePath!,
        });
      });
      return { kind: "ok" };
    },
    [runRegistryLookup, startRunForWorkflow],
  );

  // ---- Global key bindings ----------------------------------------------
  //
  // Esc precedence (plan §6.1 / §8):
  //   1. overlay open       → owned by overlay components (this hook returns early).
  //   2. runsFilter.open    → owned by <RunsFilterBar>'s own useInput (LIFO).
  //   3. mode = viewing.*   → dispatch MODE_CLOSE_RUN.
  //   4. otherwise          → no-op.
  //
  // `q` in viewing.* dispatches MODE_CLOSE_RUN (back to runs list).
  // In browsing.* it quits the app.

  // ---- Auto-open approval overlay (P7-T1) ------------------------------
  // When viewing the active run and a gate opens, pop the modal. Does not
  // auto-open in browsing.*: there `a` is the explicit trigger.
  //
  // Suppression: when the user presses `s` (Suspend-for-later) the overlay
  // closes but the underlying gate stays pending. We must NOT auto-reopen on
  // that same tokenId — the user explicitly chose to leave. `a` re-opens
  // explicitly. A new or resolved gate clears suppression.
  const suppressedTokensRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (state.overlay !== null) return;
    if (state.mode.kind !== "viewing") return;
    const active = effectiveEngineState.activeRun;
    if (!active || active.runId !== state.mode.runId) return;
    const next = findPendingApproval(active.events);
    if (!next) return;
    if (suppressedTokensRef.current.has(next.tokenId)) return;
    dispatch({
      type: "OVERLAY_OPEN",
      overlay: {
        kind: "approval",
        runId: active.runId,
        nodeId: next.nodeId,
        state: "idle",
      },
    });
    // Include the last seq in deps so a newly-arrived gate after a previous
    // close re-auto-opens on its own event.
  }, [
    state.overlay,
    state.mode,
    effectiveEngineState.activeRun,
  ]);

  // ---- Narrow-tier layout detection (P8-T2) -----------------------------
  const colsForNarrow = stdout?.columns ?? 80;
  const isNarrow = colsForNarrow < NARROW_TIER_MAX;
  const narrowLevel: NarrowLevel | null = isNarrow
    ? pickNarrowLevel({
        mode: state.mode,
        selectedStepId: state.selectedStepId,
      })
    : null;

  useInput((input, key) => {
    if (state.overlay !== null) return;
    if (state.runsFilter.open) {
      // Filter bar handler runs first via LIFO; this is a belt-and-suspenders
      // guard so a stray Esc never closes RUN mode when the bar is open.
      return;
    }
    // --- P8-T2 narrow drill gestures -------------------------------------
    // These only fire when the single-pane layout is active. At wide /
    // medium widths the existing two-pane semantics are preserved.
    if (isNarrow && state.mode.kind === "viewing") {
      // Esc at stepdetail → pop back to step list (deselect the step).
      if (key.escape && state.selectedStepId !== null) {
        dispatch({ type: "SELECT_STEP", stepId: null });
        return;
      }
      // Enter at steplist → drill into the first step row (SELECT_STEP).
      if (key.return && state.selectedStepId === null) {
        const active = effectiveEngineState.activeRun;
        const info = active && active.runId === state.mode.runId
          ? active.info ?? effectiveEngineState.runs.get(state.mode.runId) ?? null
          : effectiveEngineState.runs.get(state.mode.runId) ?? null;
        const events = active && active.runId === state.mode.runId ? active.events : [];
        const snapshot = projectStepsSnapshot(events, info);
        const retryHints = buildRetryHints(events);
        const rows = buildStepRows(snapshot, info, Date.now(), retryHints);
        if (rows.length > 0) {
          dispatch({ type: "SELECT_STEP", stepId: rows[0]!.id });
          return;
        }
      }
    }
    if (key.escape && state.mode.kind === "viewing") {
      if (state.mode.focus !== "graph") {
        dispatch({ type: "FOCUS_VIEWING_PANE", focus: "graph" });
        return;
      }
      dispatch({ type: "MODE_CLOSE_RUN" });
      return;
    }
    if (state.mode.kind === "viewing") {
      // Tab-switching keystrokes in viewing mode (P6-T4 — re-keyed from
      // P6-T3). `1/2/3/4` map to graph/detail/log/events respectively.
      if (input === "1") {
        dispatch({ type: "FOCUS_VIEWING_PANE", focus: "graph" });
        return;
      }
      if (input === "2") {
        dispatch({ type: "FOCUS_VIEWING_PANE", focus: "detail" });
        return;
      }
      if (input === "3") {
        dispatch({ type: "FOCUS_VIEWING_PANE", focus: "log" });
        return;
      }
      if (input === "4") {
        dispatch({ type: "FOCUS_VIEWING_PANE", focus: "events" });
        return;
      }
    }
    // `a` Approve — explicit trigger from RUN keybar (P7-T1). Only fires
    // when at least one pending gate exists in the current viewing context.
    if (input === "a" && state.mode.kind === "viewing") {
      const active = effectiveEngineState.activeRun;
      if (active && active.runId === state.mode.runId) {
        const next = findPendingApproval(active.events);
        if (next) {
          dispatch({
            type: "OVERLAY_OPEN",
            overlay: {
              kind: "approval",
              runId: active.runId,
              nodeId: next.nodeId,
              state: "idle",
            },
          });
          return;
        }
      }
    }
    // `R` Re-run — opens the resume wizard on a terminal-state active run.
    if (input === "R" && state.mode.kind === "viewing" && runResumable) {
      const info = activeRunInfo;
      const active = effectiveEngineState.activeRun;
      if (info && active) {
        const failing = findFailingNode(info, active.events);
        dispatch({
          type: "OVERLAY_OPEN",
          overlay: {
            kind: "resumeWizard",
            runId: active.runId,
            rerun: new Set<string>(failing ? [failing] : []),
            inputs: {},
            state: "idle",
          },
        });
        return;
      }
    }
    // `:` opens command palette (P7-T3).
    if (input === ":") {
      dispatch({
        type: "OVERLAY_OPEN",
        overlay: { kind: "commandPalette", query: "" },
      });
      return;
    }
    // `?` opens help overlay (P7-T3).
    if (input === "?") {
      dispatch({ type: "OVERLAY_OPEN", overlay: { kind: "help" } });
      return;
    }
    if (input === "q") {
      if (state.mode.kind === "viewing") {
        dispatch({ type: "MODE_CLOSE_RUN" });
        return;
      }
      onQuit();
    }
  });

  // ---- Rendering --------------------------------------------------------

  const persist = registryConfig?.persist ?? true;

  const runRows = useMemo<ReadonlyArray<RunsTableRow>>(
    () => initialRunRows ?? [],
    [initialRunRows],
  );
  const rowsById = useMemo<ReadonlySet<string>>(() => {
    const s = new Set<string>();
    for (const r of runRows) s.add(r.id);
    return s;
  }, [runRows]);

  const shellWidth = stdout?.columns ?? 80;
  const shellHeight = stdout?.rows ?? 30;
  // `innerWidth` is the content budget handed to panes. Use `shellWidth`
  // directly so tier pickers (docs/tui/plans/P8-T1.md §3.2 — "At width=90
  // → runs=medium") see the full terminal width. The AppShell box chrome
  // is drawn around the content; Ink's flexbox clips any excess in the
  // grow column.
  const innerWidth = shellWidth;
  const { topRows: topSlotRows, bottomRows: bottomSlotRows } =
    pickFrameSlots(shellHeight);
  const nowMs = Date.now();

  let topSlot: React.ReactNode;
  let bottomSlot: React.ReactNode;
  if (state.mode.kind === "browsing" && state.mode.pane === "workflows") {
    topSlot = (
      <WorkflowBrowser
        registryState={registryState}
        registryConfig={{
          path: registryPath,
          persist,
        }}
        selectedWorkflowId={state.selectedWorkflowId}
        dispatch={dispatch}
        width={stdout?.columns}
        onRemoveEntry={(source) => {
          void onRemoveEntry(source);
        }}
        onStartRun={startRunFromEntry}
        inputDisabled={state.overlay !== null}
      />
    );
    bottomSlot = <Text> </Text>;
  } else if (state.mode.kind === "browsing" && state.mode.pane === "runs") {
    topSlot = (
      <RunsTable
        rows={runRows}
        sort={state.runsSort}
        runsFilter={state.runsFilter}
        runsArchive={state.runsArchive}
        selectedRunId={state.selectedRunId}
        cursor={state.runsCursor}
        width={innerWidth}
        height={topSlotRows}
        nowMs={nowMs}
        dispatch={dispatch}
        onStartRun={runsTableStartRun}
        inputDisabled={state.overlay !== null}
      />
    );
    bottomSlot = (
      <RunDetailPlaceholder
        mode="follow"
        selectedRunId={state.selectedRunId}
        runExists={
          state.selectedRunId !== null && rowsById.has(state.selectedRunId)
        }
        width={innerWidth}
        height={bottomSlotRows}
      />
    );
  } else if (state.mode.kind === "viewing") {
    // Zoom: when focus === "graph" the Graph pane consumes the full canvas
    // (top + bottom). All other focuses keep the split layout — step table
    // on top, focused pane on bottom, panes mounted persistently so
    // pane-local state survives tab switches. (P6-T4)
    if (state.mode.focus === "graph") {
      topSlot = (
        <GraphPanelView
          runId={state.mode.runId}
          selectedStepId={state.selectedStepId}
          engineState={effectiveEngineState}
          width={innerWidth}
          height={topSlotRows + bottomSlotRows}
          nowMs={nowMs}
        />
      );
      bottomSlot = <Text> </Text>;
    } else {
      topSlot = (
        <StepTableView
          runId={state.mode.runId}
          engineState={effectiveEngineState}
          selectedStepId={state.selectedStepId}
          width={innerWidth}
          height={topSlotRows}
          nowMs={nowMs}
        />
      );
      bottomSlot = (
        <ViewingBottomSlot
          focus={state.mode.focus}
          runsDir={runsDir ?? null}
          runId={state.mode.runId}
          selectedStepId={state.selectedStepId}
          engineState={effectiveEngineState}
          width={innerWidth}
          height={bottomSlotRows}
          nowMs={nowMs}
        />
      );
    }
  } else {
    topSlot = <Text>markflow-tui \u00b7 scaffold</Text>;
    bottomSlot = <Text> </Text>;
  }

  const showEmptyKeybar =
    registryState.entries.length === 0 &&
    state.mode.kind === "browsing" &&
    state.mode.pane === "workflows";

  // Pre-overlay keybar snapshot for help overlay (P7-T3). Captures the
  // keybar fixture that was in use the moment before `?` opened the help
  // overlay, so HelpOverlay can render rows derived from exactly that
  // fixture (features.md §5.6 rule 8 — single source of truth).
  const prevFixtureRef = useRef<KeybarSelection | null>(null);
  const currentSelection = selectKeybarFixture({
    mode: state.mode,
    overlay: state.overlay,
    logFollowing: false,
    eventsFollowing: false,
    registryEmpty: registryState.entries.length === 0,
  });
  if (state.overlay?.kind !== "help" && state.overlay?.kind !== "commandPalette") {
    prevFixtureRef.current = currentSelection;
  }

  const approvalOverlayOpen = state.overlay?.kind === "approval";
  const resumeOverlayOpen = state.overlay?.kind === "resumeWizard";
  const commandOverlayOpen = state.overlay?.kind === "commandPalette";
  const helpOverlayOpen = state.overlay?.kind === "help";
  const keybarSlot = approvalOverlayOpen ? (
    <Keybar
      bindings={APPROVAL_KEYBAR}
      ctx={{
        mode: state.mode,
        overlay: state.overlay,
        approvalsPending: true,
        isFollowing: false,
        isWrapped: false,
        toggleState: { pendingApprovalsCount: pendingApprovalsCount },
        pendingApprovalsCount,
        runResumable,
      }}
      width={stdout?.columns ?? 80}
      modePill="APPROVAL"
    />
  ) : resumeOverlayOpen ? (
    <Keybar
      bindings={RESUME_KEYBAR}
      ctx={{
        mode: state.mode,
        overlay: state.overlay,
        approvalsPending: pendingApprovalsCount > 0,
        isFollowing: false,
        isWrapped: false,
        toggleState: { pendingApprovalsCount },
        pendingApprovalsCount,
        runResumable,
      }}
      width={stdout?.columns ?? 80}
      modePill="RESUME"
    />
  ) : commandOverlayOpen ? (
    <Keybar
      bindings={currentSelection.bindings}
      ctx={{
        mode: state.mode,
        overlay: state.overlay,
        approvalsPending: pendingApprovalsCount > 0,
        isFollowing: false,
        isWrapped: false,
        toggleState: { pendingApprovalsCount },
        pendingApprovalsCount,
        runResumable,
      }}
      width={stdout?.columns ?? 80}
      modePill="COMMAND"
      modePillTiers={["full"]}
      modePillGap={{ full: 3 }}
    />
  ) : helpOverlayOpen ? (
    <Keybar
      bindings={currentSelection.bindings}
      ctx={{
        mode: state.mode,
        overlay: state.overlay,
        approvalsPending: pendingApprovalsCount > 0,
        isFollowing: false,
        isWrapped: false,
        toggleState: { pendingApprovalsCount },
        pendingApprovalsCount,
        runResumable,
      }}
      width={stdout?.columns ?? 80}
      modePill="HELP"
      modePillTiers={["full"]}
      modePillGap={{ full: 3 }}
    />
  ) : showEmptyKeybar ? (
    <Keybar
      bindings={WORKFLOWS_EMPTY_KEYBAR}
      ctx={{
        mode: state.mode,
        overlay: state.overlay,
        approvalsPending: pendingApprovalsCount > 0,
        isFollowing: false,
        isWrapped: false,
        toggleState: { pendingApprovalsCount },
        pendingApprovalsCount,
        runResumable,
      }}
      width={stdout?.columns ?? 80}
      modePill="WORKFLOWS"
    />
  ) : null;

  const modalWidth = Math.min(
    Math.max(40, (stdout?.columns ?? 100) - 4),
    90,
  );
  const modalHeight = Math.min(
    Math.max(10, (stdout?.rows ?? 30) - 4),
    18,
  );

  // ---- Narrow single-pane branch (P8-T2) --------------------------------
  // Uses local env+stdout detection to pick the arrow glyph for the
  // breadcrumb separator, mirroring what ThemeProvider would resolve.
  // Capability detection is pure (docs/tui/plans/P3-T3.md §3.3).
  const narrowCaps = detectCapabilities(process.env, {
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  });
  const narrowTheme = buildTheme(narrowCaps);
  let narrowSingleSlot: React.ReactNode = null;
  let narrowBreadcrumb: string = "";
  if (narrowLevel !== null) {
    const narrowRows = stdout?.rows ?? 30;
    const slotRows = Math.max(1, narrowRows - 2);
    if (narrowLevel === "runs") {
      narrowSingleSlot = (
        <RunsTable
          rows={runRows}
          sort={state.runsSort}
          runsFilter={state.runsFilter}
          runsArchive={state.runsArchive}
          selectedRunId={state.selectedRunId}
          cursor={state.runsCursor}
          width={innerWidth}
          height={slotRows}
          nowMs={nowMs}
          dispatch={dispatch}
          onStartRun={runsTableStartRun}
          inputDisabled={state.overlay !== null}
        />
      );
      narrowBreadcrumb = composeBreadcrumb(
        "runs",
        null,
        null,
        narrowTheme.glyphs.arrow,
      );
    } else if (narrowLevel === "steplist" && state.mode.kind === "viewing") {
      narrowSingleSlot = (
        <StepTableView
          runId={state.mode.runId}
          engineState={effectiveEngineState}
          selectedStepId={state.selectedStepId}
          width={innerWidth}
          height={slotRows}
          nowMs={nowMs}
        />
      );
      narrowBreadcrumb = composeBreadcrumb(
        "steplist",
        state.mode.runId.slice(0, 6),
        null,
        narrowTheme.glyphs.arrow,
      );
    } else if (narrowLevel === "stepdetail" && state.mode.kind === "viewing") {
      const tabRow = composeViewingTabRow(
        state.mode.focus as ViewingTabKey,
        innerWidth,
      );
      // Map selectedStepId (= token.id for leaves, or "batch:..." for aggregates)
      // to a breadcrumb label. Prefer the row's nodeId when the selection
      // resolves to a row; fall back to the raw selectedStepId otherwise.
      let breadcrumbStepLabel = state.selectedStepId ?? "";
      {
        const active = effectiveEngineState.activeRun;
        const runId = state.mode.runId;
        const info = active && active.runId === runId
          ? active.info ?? effectiveEngineState.runs.get(runId) ?? null
          : effectiveEngineState.runs.get(runId) ?? null;
        const events = active && active.runId === runId ? active.events : [];
        const snapshot = projectStepsSnapshot(events, info);
        const retryHints = buildRetryHints(events);
        const rows = buildStepRows(snapshot, info, nowMs, retryHints);
        const sel = state.selectedStepId;
        const row = sel ? rows.find((r) => r.id === sel) : rows[0];
        if (row) breadcrumbStepLabel = row.nodeId;
      }
      narrowSingleSlot = (
        <Box flexDirection="column">
          <Box flexDirection="row">
            {tabRow.tokens.map((tok, i) => {
              const sep = i > 0 ? "  " : "";
              return (
                <React.Fragment key={`nt-${i}`}>
                  {sep ? <Text>{sep}</Text> : null}
                  {tok.active ? (
                    <Text inverse bold>{tok.text}</Text>
                  ) : (
                    <Text>{tok.text}</Text>
                  )}
                </React.Fragment>
              );
            })}
          </Box>
          <StepDetailPanelView
            runId={state.mode.runId}
            selectedStepId={state.selectedStepId}
            engineState={effectiveEngineState}
            width={innerWidth}
            height={Math.max(0, slotRows - 1)}
            nowMs={nowMs}
          />
        </Box>
      );
      narrowBreadcrumb = composeBreadcrumb(
        "stepdetail",
        state.mode.runId.slice(0, 6),
        breadcrumbStepLabel,
        narrowTheme.glyphs.arrow,
      );
    }
  }

  const frameWidth = stdout?.columns ?? 80;

  return (
    <ThemeProvider>
      <Box width={frameWidth} flexDirection="column" height={stdout?.rows} overflow="hidden">
      {narrowLevel !== null ? (
        <AppShell
          width={stdout?.columns}
          height={stdout?.rows}
          mode={state.mode}
          selectedRunId={state.selectedRunId}
          modeTabs={null}
          top={null}
          bottom={null}
          narrow={true}
          breadcrumb={narrowBreadcrumb}
          singleSlot={narrowSingleSlot}
          keybar={keybarSlot}
        />
      ) : (
      <AppShell
        width={stdout?.columns}
        height={stdout?.rows}
        mode={state.mode}
        selectedRunId={state.selectedRunId}
        modeTabs={
          <ModeTabs
            mode={state.mode}
            selectedRunId={state.selectedRunId}
            dispatch={dispatch}
          />
        }
        top={topSlot}
        bottom={bottomSlot}
        keybar={keybarSlot}
      />
      )}
      {state.overlay?.kind === "approval" && pendingForActiveRun ? (
        <Box
          position="absolute"
          flexDirection="column"
          alignItems="center"
          width={frameWidth}
        >
          <ApprovalModal
            approval={pendingForActiveRun}
            onDecide={async (choice) => {
              if (!runsDir) {
                return {
                  kind: "error",
                  message: "runsDir is not configured",
                };
              }
              if (state.overlay?.kind === "approval") {
                dispatch({ type: "APPROVAL_SUBMIT" });
              }
              return decide({
                runsDir,
                runId: pendingForActiveRun.runId,
                nodeId: pendingForActiveRun.nodeId,
                choice,
                decidedBy: process.env.USER,
              });
            }}
            onSuspend={() => {
              if (pendingForActiveRun) {
                suppressedTokensRef.current.add(pendingForActiveRun.tokenId);
              }
              dispatch({ type: "OVERLAY_CLOSE" });
            }}
            onCancel={() => {
              if (pendingForActiveRun) {
                suppressedTokensRef.current.add(pendingForActiveRun.tokenId);
              }
              dispatch({ type: "OVERLAY_CLOSE" });
            }}
            width={modalWidth}
            height={modalHeight}
          />
        </Box>
      ) : null}
      {state.overlay?.kind === "resumeWizard" && resumableRun ? (
        <Box
          position="absolute"
          flexDirection="column"
          alignItems="center"
          width={frameWidth}
        >
          <ResumeWizardModal
            run={resumableRun}
            workflow={resumeWorkflow ?? null}
            nodes={rerunNodes}
            inputs={inputRows}
            rerun={state.overlay.rerun}
            inputOverrides={state.overlay.inputs}
            onToggleRerun={(nodeId) =>
              dispatch({ type: "RESUME_WIZARD_TOGGLE_RERUN", nodeId })
            }
            onSetInput={(key, value) =>
              dispatch({ type: "RESUME_WIZARD_SET_INPUT", key, value })
            }
            onConfirm={async () => {
              if (!runsDir) {
                return {
                  kind: "error",
                  message: "runsDir is not configured",
                };
              }
              const ov = state.overlay;
              if (ov?.kind !== "resumeWizard") {
                return { kind: "error", message: "overlay closed" };
              }
              dispatch({ type: "RESUME_WIZARD_SUBMIT_START" });
              const result = await resume({
                runsDir,
                runId: ov.runId,
                rerunNodes: Array.from(ov.rerun),
                inputOverrides: ov.inputs,
              });
              if (result.kind === "ok" || result.kind === "notResumable") {
                dispatch({ type: "RESUME_WIZARD_SUBMIT_DONE" });
              }
              return result;
            }}
            onCancel={() => dispatch({ type: "OVERLAY_CLOSE" })}
            width={modalWidth}
            height={modalHeight}
          />
        </Box>
      ) : null}
      {state.overlay?.kind === "commandPalette" ? (
        <Box position="absolute" flexDirection="column" alignItems="center" width={frameWidth}>
          <CommandPaletteModal
            query={state.overlay.query}
            ctx={{
              mode: state.mode,
              overlay: state.overlay,
              approvalsPending: pendingApprovalsCount > 0,
              isFollowing: false,
              isWrapped: false,
              toggleState: { pendingApprovalsCount },
              pendingApprovalsCount,
              runResumable,
              runActive: false,
              runsDirReady: runsDir != null,
            }}
            exec={{
              state,
              dispatch,
              runsDir: runsDir ?? null,
              runActive: false,
              runResumable,
              pendingApprovalsCount,
              runWorkflow: paletteRunWorkflow,
              resumeRun: async (args): Promise<CommandResult> => {
                if (!runsDir) {
                  return { kind: "error", message: "runsDir not configured" };
                }
                const r = await resume({
                  runsDir,
                  runId: args.runId,
                  rerunNodes: Array.from(args.rerunNodes),
                  inputOverrides: args.inputOverrides,
                });
                if (r.kind === "ok") return { kind: "ok" };
                if (r.kind === "notResumable") {
                  return { kind: "unavailable", message: "run is not resumable" };
                }
                if (r.kind === "locked") {
                  return { kind: "error", message: "resume locked — retry" };
                }
                if (r.kind === "unknownNode") {
                  return {
                    kind: "unavailable",
                    message: `unknown node: ${r.nodeId}`,
                  };
                }
                return { kind: "error", message: r.message };
              },
              cancelRun: async (): Promise<CommandResult> => ({
                kind: "unavailable",
                message: "cancel not yet wired",
              }),
              openApproval: (runId): CommandResult => {
                const pending = findPendingApproval(
                  effectiveEngineState.activeRun?.events ?? [],
                );
                if (!pending) {
                  return { kind: "unavailable", message: "no pending approval" };
                }
                dispatch({
                  type: "OVERLAY_OPEN",
                  overlay: {
                    kind: "approval",
                    runId,
                    nodeId: pending.nodeId,
                    state: "idle",
                  },
                });
                return { kind: "ok" };
              },
              rotateTheme: () => {
                /* theme rotation deferred */
              },
              quit: onQuit,
            } satisfies CommandExecContext}
            onQueryChange={(q) =>
              dispatch({ type: "COMMAND_PALETTE_QUERY", query: q })
            }
            onClose={() => dispatch({ type: "OVERLAY_CLOSE" })}
            width={modalWidth}
            height={modalHeight}
          />
        </Box>
      ) : null}
      {state.overlay?.kind === "help" ? (
        <Box position="absolute" flexDirection="column" alignItems="center" width={frameWidth}>
          <HelpOverlay
            ctx={{
              mode: state.mode,
              overlay: state.overlay,
              approvalsPending: pendingApprovalsCount > 0,
              isFollowing: false,
              isWrapped: false,
              toggleState: { pendingApprovalsCount },
              pendingApprovalsCount,
              runResumable,
            }}
            bindings={prevFixtureRef.current?.bindings ?? []}
            modeLabel={prevFixtureRef.current?.modeLabel ?? ""}
            focusLabel={prevFixtureRef.current?.focusLabel ?? ""}
            onClose={() => dispatch({ type: "OVERLAY_CLOSE" })}
            width={modalWidth}
            height={modalHeight}
          />
        </Box>
      ) : null}
      {state.overlay?.kind === "runInput" ? (
        <Box
          position="absolute"
          flexDirection="column"
          alignItems="center"
          width={frameWidth}
        >
          <InputPromptModal
            workflowName={state.overlay.workflowName}
            sourceFile={state.overlay.sourceFile}
            rows={state.overlay.seedRows}
            onSubmit={async (inputs) => {
              const ov = state.overlay;
              if (ov?.kind !== "runInput") {
                return { kind: "error", message: "overlay closed" };
              }
              dispatch({ type: "RUN_INPUT_SUBMIT_START" });
              const result = await launchRun({
                sourceFile: ov.sourceFile,
                workspaceDir: ov.workspaceDir,
                inputs,
              });
              if (result.kind === "ok") {
                dispatch({ type: "RUN_INPUT_SUBMIT_DONE" });
              }
              return result;
            }}
            onCancel={() => dispatch({ type: "OVERLAY_CLOSE" })}
            width={modalWidth}
            height={modalHeight}
          />
        </Box>
      ) : null}
      {state.overlay?.kind === "addWorkflow" ? (
        <Box
          position="absolute"
          flexDirection="column"
          alignItems="center"
          width={frameWidth}
        >
          <AddWorkflowModal
            tab={state.overlay.tab}
            baseDir={process.cwd()}
            onSubmit={async (source) => {
              dispatch({ type: "OVERLAY_CLOSE" });
              await onAddEntry(source);
            }}
            onCancel={() => dispatch({ type: "OVERLAY_CLOSE" })}
            onTabChange={(tab) =>
              dispatch({ type: "ADD_MODAL_SET_TAB", tab })
            }
            ingestor={urlIngestor}
            width={modalWidth}
            height={modalHeight}
          />
        </Box>
      ) : null}
      </Box>
    </ThemeProvider>
  );
}

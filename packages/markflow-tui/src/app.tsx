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
import { Box, Text, useInput, useStdout } from "ink";
import { ThemeProvider } from "./theme/context.js";
import { AppShell } from "./components/app-shell.js";
import { ModeTabs } from "./components/mode-tabs.js";
import { WorkflowBrowser } from "./components/workflow-browser.js";
import { AddWorkflowModal } from "./components/add-workflow-modal.js";
import { Keybar } from "./components/keybar.js";
import { WORKFLOWS_EMPTY_KEYBAR } from "./components/keybar-fixtures/workflows-empty.js";
import { RunsTable } from "./components/runs-table.js";
import { RunDetailPlaceholder } from "./components/run-detail-placeholder.js";
import { StepTableView } from "./components/step-table-view.js";
import { pickFrameSlots } from "./components/app-shell-layout.js";
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
}

export function App({
  onQuit,
  registryConfig,
  initialLaunchArgs,
  urlIngestor,
  initialRunRows,
  engineState,
}: AppProps): React.ReactElement {
  const effectiveEngineState: EngineState = engineState ?? initialEngineState;
  const [state, dispatch] = useReducer(reducer, initialAppState);
  const { stdout } = useStdout();

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

  // ---- Global key bindings ----------------------------------------------
  //
  // Esc precedence (plan §6.1 / §8):
  //   1. overlay open       → owned by overlay components (this hook returns early).
  //   2. runsFilter.open    → owned by <RunsFilterBar>'s own useInput (LIFO).
  //   3. mode = viewing.*   → dispatch MODE_CLOSE_RUN.
  //   4. otherwise          → no-op.
  //
  // `q` retains its legacy scaffold behaviour (app-quit) in every non-overlay
  // context. Rebinding `q` to "Back" inside RUN mode is a Phase-6 follow-up
  // (see plan §6.2).

  useInput((input, key) => {
    if (state.overlay !== null) return;
    if (state.runsFilter.open) {
      // Filter bar handler runs first via LIFO; this is a belt-and-suspenders
      // guard so a stray Esc never closes RUN mode when the bar is open.
      return;
    }
    if (key.escape && state.mode.kind === "viewing") {
      dispatch({ type: "MODE_CLOSE_RUN" });
      return;
    }
    if (input === "q") {
      onQuit();
    }
  });

  // ---- Rendering --------------------------------------------------------

  const persist = registryConfig?.persist ?? true;

  // Runs-table feed — wired to an empty array for this task. The live
  // adapter subscription lands in P6-T0 (plan §11.4). Tests may seed
  // the feed via the `initialRunRows` prop.
  // TODO(P6-T0): thread `runs.watch()` output through here.
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
  const innerWidth = Math.max(0, shellWidth - 2);
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
    // Zoom: top slot renders the per-run step table; bottom slot keeps the
    // detail-pane placeholder until P6-T2 swaps it for the tabbed pane.
    topSlot = (
      <StepTableView
        runId={state.mode.runId}
        engineState={effectiveEngineState}
        width={innerWidth}
        height={topSlotRows}
        nowMs={nowMs}
      />
    );
    bottomSlot = (
      <RunDetailPlaceholder
        mode="zoom"
        selectedRunId={state.mode.runId}
        runExists={
          rowsById.has(state.mode.runId) ||
          effectiveEngineState.runs.has(state.mode.runId)
        }
        width={innerWidth}
        height={bottomSlotRows}
      />
    );
  } else {
    topSlot = <Text>markflow-tui \u00b7 scaffold</Text>;
    bottomSlot = <Text> </Text>;
  }

  const showEmptyKeybar =
    registryState.entries.length === 0 &&
    state.mode.kind === "browsing" &&
    state.mode.pane === "workflows";

  const keybarSlot = showEmptyKeybar ? (
    <Keybar
      bindings={WORKFLOWS_EMPTY_KEYBAR}
      ctx={{
        mode: state.mode,
        overlay: state.overlay,
        approvalsPending: false,
        isFollowing: false,
        isWrapped: false,
        toggleState: {},
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

  return (
    <ThemeProvider>
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
      {state.overlay?.kind === "addWorkflow" ? (
        <Box
          marginTop={-(stdout?.rows ?? 30)}
          flexDirection="column"
          alignItems="center"
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
    </ThemeProvider>
  );
}

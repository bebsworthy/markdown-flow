// src/components/workflow-browser.tsx
//
// Orchestrator for the workflow browser pane. Owns cursor state, resolves
// registry entries (via `resolveEntries` or an injected resolver for
// tests), and composes the left list + right preview panes inside a split
// <Box flexDirection="row">.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import { WorkflowList } from "./workflow-list.js";
import { WorkflowPreview } from "./workflow-preview.js";
import { WorkflowBrowserEmpty } from "./workflow-browser-empty.js";
import {
  composeListRows,
  formatListFooter,
  formatListTitle,
} from "../browser/list-layout.js";
import { resolveEntries } from "../browser/resolver.js";
import { sortByAddedAt } from "../registry/helpers.js";
import type {
  RegistryConfig,
  RegistryEntry,
  RegistryState,
} from "../registry/types.js";
import type { Action } from "../state/types.js";
import type { ResolvedEntry } from "../browser/types.js";

export interface WorkflowBrowserProps {
  readonly registryState: RegistryState;
  readonly registryConfig: RegistryConfig;
  /** Current selection id from AppState.selectedWorkflowId. */
  readonly selectedWorkflowId: string | null;
  /** Dispatches SELECT_WORKFLOW + add-overlay actions. */
  readonly dispatch: (action: Action) => void;
  /** Pane width override for tests. Defaults to 140. */
  readonly width?: number;
  /** Pane height override for tests. Defaults to 20. */
  readonly height?: number;
  /** Override resolver for tests (injects deterministic resolved entries). */
  readonly resolver?: (
    entries: ReadonlyArray<RegistryEntry>,
  ) => Promise<ReadonlyArray<ResolvedEntry>>;
  /** Base dir for resolver; defaults to cwd. Tests override to point at tmpdir. */
  readonly resolverBaseDir?: string;
  /**
   * Callback fired when the user presses `d` on a selected row.
   * App wires it to `removeEntry` + `saveRegistry`. Optional — browser no-ops
   * if not provided so older call sites (mid-migration) keep working.
   */
  readonly onRemoveEntry?: (source: string) => void;
  /**
   * Callback fired when the user presses `r` on a selected resolvable row.
   * App wires it to the run-entry flow (opens the input-prompt modal when
   * required inputs are declared, otherwise starts the run directly).
   * Silently ignored on rows with `status !== "valid"` — hide-don't-grey.
   */
  readonly onStartRun?: (entry: ResolvedEntry) => void;
  /**
   * Suppress the browser's internal keystroke handling while an overlay
   * (palette, modal, etc.) is mounted. Ink dispatches keystrokes to every
   * mounted `useInput` consumer, so without this guard keys like `r` fire
   * here in addition to the overlay-owned handler.
   */
  readonly inputDisabled?: boolean;
}

const DEFAULT_WIDTH = 140;
const DEFAULT_HEIGHT = 20;
const LEFT_RATIO = 0.55;

function WorkflowBrowserImpl({
  registryState,
  registryConfig,
  selectedWorkflowId,
  dispatch,
  width,
  height,
  resolver,
  resolverBaseDir,
  onRemoveEntry,
  onStartRun,
  inputDisabled,
}: WorkflowBrowserProps): React.ReactElement {
  const theme = useTheme();
  const paneWidth = width ?? DEFAULT_WIDTH;
  const paneHeight = height ?? DEFAULT_HEIGHT;

  const leftWidth = Math.max(20, Math.floor(paneWidth * LEFT_RATIO) - 1);
  const rightWidth = Math.max(20, paneWidth - leftWidth - 1);

  const sortedEntries = useMemo<ReadonlyArray<RegistryEntry>>(
    () => sortByAddedAt(registryState.entries),
    [registryState.entries],
  );

  const [resolved, setResolved] = useState<ReadonlyArray<ResolvedEntry>>([]);
  const [, setLoading] = useState<boolean>(sortedEntries.length > 0);
  const sortedEntriesRef = useRef(sortedEntries);
  sortedEntriesRef.current = sortedEntries;

  useEffect(() => {
    let cancelled = false;
    if (sortedEntries.length === 0) {
      setResolved([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    const baseDir = resolverBaseDir ?? process.cwd();
    const resolveFn =
      resolver ?? ((e) => resolveEntries(e, { baseDir, readLastRun: true }));
    Promise.resolve(resolveFn(sortedEntries))
      .then((out) => {
        if (cancelled) return;
        setResolved(out);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setResolved([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sortedEntries, resolver, resolverBaseDir]);

  // Derive selectedIndex from selectedWorkflowId.
  const selectedIndex = useMemo(() => {
    if (selectedWorkflowId === null) return -1;
    return resolved.findIndex((r) => r.id === selectedWorkflowId);
  }, [resolved, selectedWorkflowId]);

  useInput((input, key) => {
    if (inputDisabled) return;
    // `a` opens the add modal even when the registry is empty — that's the
    // whole point of the empty-state onboarding flow.
    if (input === "a") {
      dispatch({
        type: "OVERLAY_OPEN",
        overlay: { kind: "addWorkflow", tab: "fuzzy" },
      });
      return;
    }
    if (resolved.length === 0) return;
    const curr = selectedIndex < 0 ? 0 : selectedIndex;
    if (key.downArrow || input === "j") {
      const next = Math.min(resolved.length - 1, curr + 1);
      const id = resolved[next]?.id ?? null;
      dispatch({ type: "SELECT_WORKFLOW", workflowId: id });
      return;
    }
    if (key.upArrow || input === "k") {
      const next = Math.max(0, curr - 1);
      const id = resolved[next]?.id ?? null;
      dispatch({ type: "SELECT_WORKFLOW", workflowId: id });
      return;
    }
    if (key.return) {
      const id = resolved[curr]?.id ?? null;
      dispatch({ type: "SELECT_WORKFLOW", workflowId: id });
      return;
    }
    if (input === "d") {
      const row = resolved[curr];
      if (row && onRemoveEntry) onRemoveEntry(row.entry.source);
      return;
    }
    if (input === "r") {
      const row = resolved[curr];
      if (
        row &&
        row.status === "valid" &&
        row.workflow &&
        row.absolutePath !== null &&
        onStartRun
      ) {
        onStartRun(row);
      }
      return;
    }
    // 🟡 TODO future — edit in $EDITOR
    if (input === "e") return;
  });

  // Empty-state branch: no entries registered.
  if (sortedEntries.length === 0) {
    return (
      <WorkflowBrowserEmpty
        persist={registryConfig.persist}
        width={paneWidth}
      />
    );
  }

  const cwd = resolverBaseDir ?? process.cwd();
  const title = formatListTitle(registryConfig.path, cwd);
  const rows = composeListRows(resolved, selectedIndex, leftWidth);
  const footer = formatListFooter(resolved);
  const selectedResolved =
    selectedIndex >= 0 && selectedIndex < resolved.length
      ? resolved[selectedIndex]!
      : null;

  return (
    <Box flexDirection="row" width={paneWidth} height={paneHeight}>
      <WorkflowList
        title={title}
        rows={rows}
        footer={footer}
        width={leftWidth}
        height={paneHeight}
      />
      <Box width={1} height={paneHeight}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {theme.frame.v}
        </Text>
      </Box>
      <WorkflowPreview
        resolved={selectedResolved}
        width={rightWidth}
        height={paneHeight}
      />
    </Box>
  );
}

export const WorkflowBrowser = React.memo(WorkflowBrowserImpl);
WorkflowBrowser.displayName = "WorkflowBrowser";

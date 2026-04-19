// src/components/workflow-browser.tsx
//
// Orchestrator for the workflow browser pane. Owns cursor state, resolves
// registry entries (via `resolveEntries` or an injected resolver for
// tests), and renders the workflow list at full width. The preview pane
// is rendered separately by App in the bottom slot.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useInput } from "ink";
import { WorkflowList } from "./workflow-list.js";
import { WorkflowBrowserEmpty } from "./workflow-browser-empty.js";
import {
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
  /**
   * Reports whether the currently-selected entry is runnable
   * (valid, with a workflow and absolutePath). Fires on cursor
   * movement and after resolution completes.
   */
  readonly onSelectionValidityChange?: (valid: boolean) => void;
  /**
   * Reports the currently-selected resolved entry (or null) so App can
   * render the preview in the bottom pane.
   */
  readonly onSelectedEntryChange?: (entry: ResolvedEntry | null) => void;
  /**
   * Callback fired when the user presses `c` to copy the selected
   * entry's path to clipboard. App handles the actual clipboard write.
   */
  readonly onCopyPath?: (path: string) => void;
}

const DEFAULT_WIDTH = 140;
const DEFAULT_HEIGHT = 20;

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
  onSelectionValidityChange,
  onSelectedEntryChange,
  onCopyPath,
}: WorkflowBrowserProps): React.ReactElement {
  const paneWidth = width ?? DEFAULT_WIDTH;
  const paneHeight = height ?? DEFAULT_HEIGHT;

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

  useEffect(() => {
    if (!onSelectionValidityChange) return;
    const curr = selectedIndex < 0 ? 0 : selectedIndex;
    const row = resolved[curr];
    const valid = Boolean(
      row && row.status === "valid" && row.workflow && row.absolutePath !== null,
    );
    onSelectionValidityChange(valid);
  }, [selectedIndex, resolved, onSelectionValidityChange]);

  useEffect(() => {
    if (!onSelectedEntryChange) return;
    const curr = selectedIndex < 0 ? 0 : selectedIndex;
    const entry = resolved[curr] ?? null;
    onSelectedEntryChange(entry);
  }, [selectedIndex, resolved, onSelectedEntryChange]);

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
    if (input === "g") {
      const id = resolved[0]?.id ?? null;
      dispatch({ type: "SELECT_WORKFLOW", workflowId: id });
      return;
    }
    if (input === "G") {
      const id = resolved[resolved.length - 1]?.id ?? null;
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
    if (input === "c") {
      const row = resolved[curr];
      if (row && row.absolutePath && onCopyPath) {
        onCopyPath(row.absolutePath);
      }
      return;
    }
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
  const footer = formatListFooter(resolved);
  const cursor = selectedIndex < 0 ? 0 : selectedIndex;

  return (
    <WorkflowList
      title={title}
      entries={resolved}
      selectedIndex={cursor}
      footer={footer}
      width={paneWidth}
      height={paneHeight}
      now={Date.now()}
    />
  );
}

// React.memo removed: React 19.2 + useEffectEvent (used by Ink 7's useInput)
// fails to update the effect-event ref for SimpleMemoComponent fibers, so
// useInput closures see stale state.
export const WorkflowBrowser = WorkflowBrowserImpl;

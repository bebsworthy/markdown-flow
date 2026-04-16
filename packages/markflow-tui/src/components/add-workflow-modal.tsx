// src/components/add-workflow-modal.tsx
//
// Top-level add-workflow modal (P4-T3). Composes the fuzzy-find and URL
// sub-tabs inside a bordered frame and owns all keyboard routing while
// open. Everything ephemeral (query text, walker results, URL input,
// ingest in-flight flag, root picker draft) is component-local; only the
// active tab lives in the reducer via `ADD_MODAL_SET_TAB`.
//
// Authoritative references:
//   - docs/tui/mockups.md §2 (Add modal fuzzy-find tab).
//   - docs/tui/plans/P4-T3.md §§5–8.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { stat } from "node:fs/promises";
import { useTheme } from "../theme/context.js";
import { AddModalFuzzyTab } from "./add-modal-fuzzy-tab.js";
import { AddModalUrlTab } from "./add-modal-url-tab.js";
import { rankCandidates } from "../add-modal/fuzzy.js";
import { walkCandidates } from "../add-modal/walker.js";
import { validateCandidate } from "../add-modal/validate-candidate.js";
import { ingestUrl } from "../add-modal/url-ingest.js";
import type {
  AddModalTab,
  Candidate,
  RankedCandidate,
  TruncatedSentinel,
  UrlIngestResult,
  ValidationResult,
  WalkerOptions,
} from "../add-modal/types.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Injection seams for the three non-pure helpers. Tests pass deterministic
 * stand-ins; production code uses the defaults imported at module top.
 */
export type WalkerFn = (
  root: string,
  opts?: WalkerOptions,
) => AsyncIterable<Candidate | TruncatedSentinel>;

export type ValidatorFn = (c: Candidate) => Promise<ValidationResult>;

export type IngestorFn = (
  url: string,
  baseDir: string,
) => Promise<UrlIngestResult>;

export interface AddWorkflowModalProps {
  /** Current tab, driven by the reducer. */
  readonly tab: AddModalTab;
  /** Initial walker root + cwd for launch-arg / URL ingest. */
  readonly baseDir: string;
  /** Called with the chosen source (absolute path or workspace dir). */
  readonly onSubmit: (source: string) => void | Promise<void>;
  /** Called on Esc. */
  readonly onCancel: () => void;
  /** Called when the user presses Tab inside the modal. */
  readonly onTabChange: (tab: AddModalTab) => void;
  /** Test override for the walker. */
  readonly walker?: WalkerFn;
  /** Test override for the validator. */
  readonly validator?: ValidatorFn;
  /** Test override for the URL ingestor. */
  readonly ingestor?: IngestorFn;
  /** Modal width (columns). */
  readonly width: number;
  /** Modal height (rows). */
  readonly height: number;
}

const VISIBLE_ROWS = 10;
const RANK_LIMIT = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tabLabel(tab: AddModalTab): string {
  return tab === "fuzzy" ? "Fuzzy find" : "Path or URL";
}

/**
 * Adapt the default `walkCandidates` async generator into the wider
 * `AsyncIterable` shape tests can match with a plain async generator.
 */
function defaultWalker(
  root: string,
  opts?: WalkerOptions,
): AsyncIterable<Candidate | TruncatedSentinel> {
  return walkCandidates(root, opts);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AddWorkflowModalImpl(
  props: AddWorkflowModalProps,
): React.ReactElement {
  const {
    tab,
    baseDir,
    onSubmit,
    onCancel,
    onTabChange,
    walker = defaultWalker,
    validator = validateCandidate,
    ingestor = ingestUrl,
    width,
    height,
  } = props;

  const theme = useTheme();

  // --- State -----------------------------------------------------------------
  const [root, setRoot] = useState<string>(baseDir);
  const [query, setQuery] = useState<string>("");
  const [candidates, setCandidates] = useState<ReadonlyArray<Candidate>>([]);
  const [walkerTruncated, setWalkerTruncated] = useState<boolean>(false);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [validationByPath, setValidationByPath] = useState<
    ReadonlyMap<string, ValidationResult>
  >(() => new Map());
  const [rootPickerOpen, setRootPickerOpen] = useState<boolean>(false);
  const [rootPickerDraft, setRootPickerDraft] = useState<string>("");
  const [rootPickerError, setRootPickerError] = useState<string | null>(null);

  const [urlInput, setUrlInput] = useState<string>("");
  const [ingesting, setIngesting] = useState<boolean>(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // --- Refs to avoid stale-closure captures in async callbacks ---------------
  const queryRef = useRef(query);
  queryRef.current = query;
  const selectedRef = useRef(selectedRowIndex);
  selectedRef.current = selectedRowIndex;
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const urlInputRef = useRef(urlInput);
  urlInputRef.current = urlInput;
  const ingestingRef = useRef(ingesting);
  ingestingRef.current = ingesting;
  const rootPickerDraftRef = useRef(rootPickerDraft);
  rootPickerDraftRef.current = rootPickerDraft;
  const rootPickerOpenRef = useRef(rootPickerOpen);
  rootPickerOpenRef.current = rootPickerOpen;

  // --- Walker effect ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setCandidates([]);
    setWalkerTruncated(false);
    setSelectedRowIndex(0);

    (async () => {
      const collected: Candidate[] = [];
      let truncated = false;
      try {
        for await (const out of walker(root, { signal: controller.signal })) {
          if (cancelled || controller.signal.aborted) return;
          if (out.kind === "truncated") {
            truncated = true;
            continue;
          }
          collected.push(out);
          if (collected.length % 50 === 0) {
            setCandidates([...collected]);
          }
        }
      } catch {
        // Walker failures are silent; the modal renders whatever it managed
        // to collect.
      }
      if (!cancelled) {
        setCandidates([...collected]);
        setWalkerTruncated(truncated);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [root, walker]);

  // --- Ranked candidates ------------------------------------------------------
  const ranked = useMemo<ReadonlyArray<RankedCandidate>>(
    () => rankCandidates(query, candidates, RANK_LIMIT),
    [query, candidates],
  );

  // Clamp selection when ranked changes.
  useEffect(() => {
    if (ranked.length === 0) {
      if (selectedRowIndex !== 0) setSelectedRowIndex(0);
      return;
    }
    if (selectedRowIndex >= ranked.length) {
      setSelectedRowIndex(Math.max(0, ranked.length - 1));
    }
  }, [ranked, selectedRowIndex]);

  // --- Lazy validation of visible rows ---------------------------------------
  useEffect(() => {
    const visible = ranked.slice(0, VISIBLE_ROWS);
    let cancelled = false;
    (async () => {
      for (const r of visible) {
        const path = r.candidate.absolutePath;
        if (validationByPath.has(path)) continue;
        try {
          const res = await validator(r.candidate);
          if (cancelled) return;
          setValidationByPath((m) => {
            if (m.has(path)) return m;
            const next = new Map(m);
            next.set(path, res);
            return next;
          });
        } catch {
          // swallow — validator is contracted not to throw.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ranked, validator, validationByPath]);

  // --- Key routing -----------------------------------------------------------
  useInput((input, key) => {
    // Esc always routes — root picker closes first, then modal.
    if (key.escape) {
      if (rootPickerOpenRef.current) {
        setRootPickerOpen(false);
        setRootPickerDraft("");
        setRootPickerError(null);
        return;
      }
      onCancel();
      return;
    }

    // Root picker input has priority when open.
    if (rootPickerOpenRef.current) {
      if (key.return) {
        const draft = rootPickerDraftRef.current.trim();
        if (draft.length === 0) {
          setRootPickerError("path is required");
          return;
        }
        (async () => {
          try {
            const st = await stat(draft);
            if (!st.isDirectory()) {
              setRootPickerError("not a directory");
              return;
            }
            setRoot(draft);
            setRootPickerOpen(false);
            setRootPickerDraft("");
            setRootPickerError(null);
          } catch {
            setRootPickerError("path not found");
          }
        })();
        return;
      }
      if (key.backspace || key.delete) {
        setRootPickerDraft((s) => s.slice(0, -1));
        setRootPickerError(null);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setRootPickerDraft((s) => s + input);
        setRootPickerError(null);
        return;
      }
      return;
    }

    // Tab switches tabs.
    if (key.tab) {
      onTabChange(tab === "fuzzy" ? "url" : "fuzzy");
      return;
    }

    if (tab === "fuzzy") {
      if (key.ctrl && key.upArrow) {
        setRootPickerOpen(true);
        setRootPickerDraft(root);
        setRootPickerError(null);
        return;
      }
      if (key.upArrow) {
        setSelectedRowIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedRowIndex((i) => {
          const max = Math.max(0, Math.min(VISIBLE_ROWS, ranked.length) - 1);
          return Math.min(max, i + 1);
        });
        return;
      }
      if (key.return) {
        const row = ranked[selectedRef.current];
        if (!row) return;
        void onSubmit(row.candidate.absolutePath);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((s) => s.slice(0, -1));
        return;
      }
      // Ignore bare `q` so the global app-level quit still fires — we
      // deliberately do NOT trap printable keys when `q` is pressed alone.
      // `q` only appears as a character input here when the user is typing
      // a query containing q; that's fine.
      if (input && !key.ctrl && !key.meta) {
        setQuery((s) => s + input);
      }
      return;
    }

    // URL tab
    if (key.return) {
      if (ingestingRef.current) return;
      const url = urlInputRef.current.trim();
      if (!/^https?:\/\//i.test(url)) {
        setIngestError("expected http:// or https://");
        return;
      }
      setIngestError(null);
      setIngesting(true);
      (async () => {
        const res = await ingestor(url, baseDir);
        setIngesting(false);
        if (!res.ok) {
          setIngestError(res.reason);
          return;
        }
        void onSubmit(res.workspaceDir);
      })();
      return;
    }
    if (key.backspace || key.delete) {
      setUrlInput((s) => s.slice(0, -1));
      setIngestError(null);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setUrlInput((s) => s + input);
      setIngestError(null);
    }
  });

  // --- Render ---------------------------------------------------------------
  const innerWidth = Math.max(10, width - 4);
  const frame = theme.frame;
  const topEdge =
    frame.tl + frame.h.repeat(Math.max(0, width - 2)) + frame.tr;
  const botEdge =
    frame.bl + frame.h.repeat(Math.max(0, width - 2)) + frame.br;

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Top edge with title */}
      <Text>{topEdge}</Text>

      {/* Tab header */}
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        {tab === "fuzzy" ? (
          <Text inverse bold>{`[ ${tabLabel("fuzzy")} ]`}</Text>
        ) : (
          <Text
            color={theme.colors.accent.color}
            dimColor={theme.colors.accent.dim === true}
          >
            {tabLabel("fuzzy")}
          </Text>
        )}
        <Text>   </Text>
        {tab === "url" ? (
          <Text inverse bold>{`[ ${tabLabel("url")} ]`}</Text>
        ) : (
          <Text
            color={theme.colors.accent.color}
            dimColor={theme.colors.accent.dim === true}
          >
            {tabLabel("url")}
          </Text>
        )}
      </Box>

      <Text>{frame.v}</Text>

      {/* Body */}
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        {tab === "fuzzy" ? (
          <AddModalFuzzyTab
            root={root}
            query={query}
            ranked={ranked}
            selectedIndex={selectedRowIndex}
            visibleLimit={VISIBLE_ROWS}
            walkerTruncated={walkerTruncated}
            candidateCount={candidates.length}
            validationByPath={validationByPath}
            rootPickerOpen={rootPickerOpen}
            rootPickerDraft={rootPickerDraft}
            rootPickerError={rootPickerError}
            width={innerWidth}
          />
        ) : (
          <AddModalUrlTab
            url={urlInput}
            ingesting={ingesting}
            error={ingestError}
            width={innerWidth}
          />
        )}
      </Box>

      <Text>{frame.v}</Text>

      {/* Footer */}
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {"Tab  switch input mode    \u23ce  Add    Esc  Cancel"}
        </Text>
      </Box>

      {/* Bottom edge */}
      <Text>{botEdge}</Text>
    </Box>
  );
}

export const AddWorkflowModal = React.memo(AddWorkflowModalImpl);
AddWorkflowModal.displayName = "AddWorkflowModal";

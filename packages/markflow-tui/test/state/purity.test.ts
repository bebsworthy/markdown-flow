// test/state/purity.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// NOTE: this TEST file is allowed to touch node:fs because it's a *lint*.
// The SUT (src/state/*.ts, src/engine/*.ts) must not.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FORBIDDEN = [
  /\bfrom\s+["']ink["']/,
  /\bfrom\s+["']ink\//,
  /\bfrom\s+["']react["']/,
  /\bfrom\s+["']react\//,
  /\bfrom\s+["']fs["']/,
  /\bfrom\s+["']fs\//,
  /\bfrom\s+["']path["']/,
  /\bfrom\s+["']child_process["']/,
  /\bimport\(\s*["']ink["']/,
  /\bimport\(\s*["']react["']/,
];

const files = [
  "../../src/state/reducer.ts",
  "../../src/state/types.ts",
  // Engine adapter + reducer — same no-React rule, but node:path is allowed
  // for adapter.ts only. See NODE_PATH_ONLY below.
  "../../src/engine/types.ts",
  "../../src/engine/reducer.ts",
  "../../src/engine/adapter.ts",
  "../../src/engine/index.ts",
  // Theme pure surface (P3-T3). NOTE: context.tsx is NOT in this list —
  // it is the designated React-boundary file for the theme slice.
  "../../src/theme/tokens.ts",
  "../../src/theme/glyphs.ts",
  "../../src/theme/capabilities.ts",
  "../../src/theme/theme.ts",
  "../../src/theme/index.ts",
  // Keybar pure surface (P3-T4). NOTE: keybar.tsx and components/index.ts
  // are NOT in this list — they import React/Ink by design.
  "../../src/components/types.ts",
  "../../src/components/keybar-layout.ts",
  // App-shell pure surface (P3-T5). NOTE: app-shell.tsx, mode-tabs.tsx are
  // NOT in this list — they import React/Ink by design.
  "../../src/components/app-shell-layout.ts",
  // P8-T1 viewing-pane tab layout — pure tier/label/compose helpers.
  "../../src/components/viewing-pane-tabs-layout.ts",
  // P8-T2 narrow-layout + keybar trailing-hint pure helpers.
  "../../src/components/narrow-layout.ts",
  "../../src/components/keybar-narrow-hint.ts",
  // Registry pure surface (P4-T1). NOTE: store.ts, atomic-write.ts, index.ts
  // are NOT in this list — they import node:fs/path/crypto by design.
  "../../src/registry/types.ts",
  "../../src/registry/helpers.ts",
  // Browser pure surface (P4-T2). NOTE: resolver.ts and index.ts are NOT in
  // this list — resolver imports node:fs/path + engine by design; index.ts
  // re-exports resolver so it is also not pure.
  "../../src/browser/types.ts",
  "../../src/browser/preview-layout.ts",
  "../../src/browser/list-layout.ts",
  // Add-modal pure surface (P4-T3). NOTE: walker.ts, validate-candidate.ts,
  // url-ingest.ts, and index.ts are NOT in this list — they import node:fs/
  // path / engine / global fetch by design.
  "../../src/add-modal/types.ts",
  "../../src/add-modal/fuzzy.ts",
  // Empty-state keybar fixture (P4-T3). Pure declarative array of bindings.
  "../../src/components/keybar-fixtures/workflows-empty.ts",
  // Runs-table pure surface (P5-T1). NOTE: runs/index.ts is a barrel and is
  // NOT scanned (just re-exports), and runs-table*.tsx are Ink by design.
  "../../src/runs/types.ts",
  "../../src/runs/sort.ts",
  "../../src/runs/columns.ts",
  "../../src/runs/derive.ts",
  // P5-T2 pure modules — duration mirror, filter pipeline, virtualisation math.
  "../../src/runs/duration.ts",
  "../../src/runs/filter.ts",
  "../../src/runs/window.ts",
  // P5-T3 pure module — cursor math for the runs table.
  "../../src/runs/cursor.ts",
  // P6-T1 pure modules — step-table surface. NOTE: steps/index.ts is a
  // barrel and is NOT scanned (just re-exports); step-table*.tsx and
  // step-table-view.tsx are Ink by design.
  "../../src/steps/types.ts",
  "../../src/steps/tree.ts",
  "../../src/steps/aggregate.ts",
  "../../src/steps/columns.ts",
  "../../src/steps/derive.ts",
  "../../src/steps/retry.ts",
  "../../src/steps/upstream.ts",
  // P6-T2 pure modules — step detail projection surface.
  "../../src/steps/detail.ts",
  "../../src/steps/detail-types.ts",
  // P6-T3 pure modules — log panel surface.
  "../../src/log/types.ts",
  "../../src/log/ansi.ts",
  "../../src/log/reducer.ts",
  "../../src/log/derive.ts",
  "../../src/log/ingest.ts",
  "../../src/log/select.ts",
  // P6-T3 keybar fixtures — data-only.
  "../../src/components/keybar-fixtures/log.ts",
  // P6-T4 pure modules — events tab surface.
  "../../src/events/types.ts",
  "../../src/events/format.ts",
  "../../src/events/filter.ts",
  "../../src/events/reducer.ts",
  "../../src/events/derive.ts",
  "../../src/events/merge.ts",
  // P6-T4 keybar fixtures — data-only.
  "../../src/components/keybar-fixtures/graph.ts",
  "../../src/components/keybar-fixtures/events.ts",
  // P7-T1 approval pure modules + fixture.
  "../../src/approval/types.ts",
  "../../src/approval/derive.ts",
  "../../src/approval/reducer.ts",
  "../../src/approval/index.ts",
  "../../src/components/keybar-fixtures/approval.ts",
  // P7-T2 resume pure modules + fixture.
  "../../src/resume/types.ts",
  "../../src/resume/derive.ts",
  "../../src/resume/reducer.ts",
  "../../src/resume/index.ts",
  "../../src/components/keybar-fixtures/resume.ts",
  // P7-T3 palette + help pure modules + fixtures + registry.
  "../../src/palette/types.ts",
  "../../src/palette/commands.ts",
  "../../src/palette/fuzzy.ts",
  "../../src/palette/parser.ts",
  "../../src/palette/reducer.ts",
  "../../src/palette/exec.ts",
  "../../src/palette/index.ts",
  "../../src/help/types.ts",
  "../../src/help/derive.ts",
  "../../src/help/reducer.ts",
  "../../src/help/index.ts",
  "../../src/components/keybar-fixtures/command.ts",
  "../../src/components/keybar-fixtures/help.ts",
  "../../src/components/keybar-fixtures/registry.ts",
];

/**
 * Files that are allowed to touch `node:path` (deterministic, side-effect-
 * free). Every other `node:*` import is still forbidden for these modules.
 */
const NODE_PATH_ONLY: ReadonlySet<string> = new Set([
  "../../src/engine/adapter.ts",
]);

const NODE_ANY = /\bfrom\s+["']node:([a-zA-Z_/-]+)["']/g;

describe("pure-module purity", () => {
  for (const rel of files) {
    it(`${rel} has no forbidden imports`, () => {
      const source = readFileSync(resolve(__dirname, rel), "utf8");
      for (const re of FORBIDDEN) {
        expect(source).not.toMatch(re);
      }
      // Scan every `node:*` import: only `node:path` is allowed, and only
      // in files listed in NODE_PATH_ONLY.
      const matches = [...source.matchAll(NODE_ANY)];
      for (const m of matches) {
        const spec = m[1];
        const allowed = NODE_PATH_ONLY.has(rel) && spec === "path";
        expect(
          allowed,
          `${rel} imports node:${spec} which is not in the allowlist`,
        ).toBe(true);
      }
    });
  }

  it("reducer module loads in a Node-only context", async () => {
    const mod = await import("../../src/state/reducer.js");
    expect(typeof mod.reducer).toBe("function");
    expect(mod.initialAppState).toBeDefined();
  });

  it("engine adapter loads without Ink/React", async () => {
    const mod = await import("../../src/engine/adapter.js");
    expect(typeof mod.createEngineAdapter).toBe("function");
  });

  it("engine reducer loads without Ink/React", async () => {
    const mod = await import("../../src/engine/reducer.js");
    expect(typeof mod.engineReducer).toBe("function");
    expect(typeof mod.toEngineAction).toBe("function");
    expect(mod.initialEngineState).toBeDefined();
  });

  it("theme tokens module loads without Ink/React", async () => {
    const mod = await import("../../src/theme/tokens.js");
    expect(mod.COLOR_TABLE).toBeDefined();
    expect(mod.MONOCHROME_COLOR_TABLE).toBeDefined();
  });

  it("theme glyphs module loads without Ink/React", async () => {
    const mod = await import("../../src/theme/glyphs.js");
    expect(mod.UNICODE_GLYPHS).toBeDefined();
    expect(mod.ASCII_GLYPHS).toBeDefined();
    expect(typeof mod.glyphKeyForRole).toBe("function");
  });

  it("theme capabilities module loads without Ink/React", async () => {
    const mod = await import("../../src/theme/capabilities.js");
    expect(typeof mod.detectCapabilities).toBe("function");
  });

  it("theme buildTheme loads without Ink/React", async () => {
    const mod = await import("../../src/theme/theme.js");
    expect(typeof mod.buildTheme).toBe("function");
  });

  it("keybar types module loads without Ink/React", async () => {
    // types.ts is a pure type-only module — importing it should succeed
    // and the import should have no runtime-exported values.
    const mod = await import("../../src/components/types.js");
    expect(Object.keys(mod)).toEqual([]);
  });

  it("keybar-layout module loads without Ink/React", async () => {
    const mod = await import("../../src/components/keybar-layout.js");
    expect(typeof mod.formatKeys).toBe("function");
    expect(typeof mod.pickTier).toBe("function");
    expect(typeof mod.filterBindings).toBe("function");
    expect(typeof mod.groupByCategory).toBe("function");
    expect(typeof mod.renderableLabel).toBe("function");
    expect(typeof mod.sortByOrder).toBe("function");
    expect(typeof mod.countCategories).toBe("function");
  });

  it("app-shell-layout module loads without Ink/React", async () => {
    const mod = await import("../../src/components/app-shell-layout.js");
    expect(typeof mod.activeTabFromMode).toBe("function");
    expect(typeof mod.keyToMode).toBe("function");
    expect(typeof mod.frameTitle).toBe("function");
    expect(typeof mod.composeTopRow).toBe("function");
    expect(typeof mod.pickFrameSlots).toBe("function");
    expect(typeof mod.pickActiveTabStyle).toBe("function");
  });

  it("narrow-layout module loads without Ink/React", async () => {
    const mod = await import("../../src/components/narrow-layout.js");
    expect(typeof mod.pickNarrowLevel).toBe("function");
    expect(typeof mod.composeBreadcrumb).toBe("function");
    expect(typeof mod.NARROW_TIER_MAX).toBe("number");
  });

  it("keybar-narrow-hint module loads without Ink/React", async () => {
    const mod = await import("../../src/components/keybar-narrow-hint.js");
    expect(typeof mod.composeKeybarTrailingHint).toBe("function");
    expect(typeof mod.KEYS_TIER_HINT).toBe("string");
  });

  it("viewing-pane-tabs-layout module loads without Ink/React", async () => {
    const mod = await import(
      "../../src/components/viewing-pane-tabs-layout.js"
    );
    expect(typeof mod.pickViewingTabTier).toBe("function");
    expect(typeof mod.formatViewingTabLabel).toBe("function");
    expect(typeof mod.composeViewingTabRow).toBe("function");
    expect(Array.isArray(mod.VIEWING_TAB_KEYS)).toBe(true);
    expect(typeof mod.VIEWING_TAB_WIDE_MIN).toBe("number");
    expect(typeof mod.VIEWING_TAB_MEDIUM_MIN).toBe("number");
  });

  it("registry types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/registry/types.js");
    // Type-only module — runtime exports empty.
    expect(Object.keys(mod)).toEqual([]);
  });

  it("registry helpers module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/registry/helpers.js");
    expect(typeof mod.parseRegistryJson).toBe("function");
    expect(typeof mod.serializeRegistry).toBe("function");
    expect(typeof mod.addEntry).toBe("function");
    expect(typeof mod.removeEntry).toBe("function");
    expect(typeof mod.isSameSource).toBe("function");
    expect(typeof mod.sortByAddedAt).toBe("function");
    expect(typeof mod.validateEntry).toBe("function");
  });

  it("browser types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/browser/types.js");
    // Type-only module — runtime exports empty.
    expect(Object.keys(mod)).toEqual([]);
  });

  it("browser preview-layout module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/browser/preview-layout.js");
    expect(typeof mod.formatInputsSummary).toBe("function");
    expect(typeof mod.formatFlowSummary).toBe("function");
    expect(typeof mod.formatDiagnostics).toBe("function");
    expect(typeof mod.countSteps).toBe("function");
    expect(typeof mod.formatStepCountLine).toBe("function");
    expect(typeof mod.formatSourceBadge).toBe("function");
    expect(typeof mod.formatStatusFlag).toBe("function");
    expect(typeof mod.formatDurationShort).toBe("function");
    expect(typeof mod.formatEntryId).toBe("function");
  });

  it("browser list-layout module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/browser/list-layout.js");
    expect(typeof mod.composeListRows).toBe("function");
    expect(typeof mod.pickBadgeColumnWidth).toBe("function");
    expect(typeof mod.truncateSource).toBe("function");
    expect(typeof mod.formatListFooter).toBe("function");
    expect(typeof mod.formatListTitle).toBe("function");
  });

  it("add-modal types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/add-modal/types.js");
    // Type-only module — runtime exports empty.
    expect(Object.keys(mod)).toEqual([]);
  });

  it("add-modal fuzzy module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/add-modal/fuzzy.js");
    expect(typeof mod.rankCandidates).toBe("function");
    expect(typeof mod.scoreSubsequence).toBe("function");
  });

  it("workflows-empty keybar fixture loads without Ink/React/fs", async () => {
    const mod = await import(
      "../../src/components/keybar-fixtures/workflows-empty.js"
    );
    expect(Array.isArray(mod.WORKFLOWS_EMPTY_KEYBAR)).toBe(true);
  });

  it("runs types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/types.js");
    // P5-T2 added a single runtime const (`RUNS_ARCHIVE_DEFAULTS`) so the
    // reducer + tests can share the defaults without mocking. Every other
    // export remains type-only.
    expect(Object.keys(mod)).toEqual(["RUNS_ARCHIVE_DEFAULTS"]);
    expect(mod.RUNS_ARCHIVE_DEFAULTS).toBeDefined();
  });

  it("runs sort module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/sort.js");
    expect(typeof mod.attentionCompare).toBe("function");
    expect(typeof mod.compareByKey).toBe("function");
    expect(typeof mod.cycleSortKey).toBe("function");
    expect(typeof mod.sortRows).toBe("function");
  });

  it("runs columns module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/columns.js");
    expect(Array.isArray(mod.COLUMNS_140)).toBe(true);
    expect(Array.isArray(mod.COLUMNS_100)).toBe(true);
    expect(Array.isArray(mod.COLUMNS_80)).toBe(true);
    expect(typeof mod.pickColumnSet).toBe("function");
  });

  it("runs derive module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/derive.js");
    expect(typeof mod.toRunsTableRow).toBe("function");
    expect(typeof mod.deriveStepLabel).toBe("function");
    expect(typeof mod.deriveNote).toBe("function");
    expect(typeof mod.formatElapsed).toBe("function");
  });

  it("runs duration module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/duration.js");
    expect(typeof mod.tryParseDurationMs).toBe("function");
  });

  it("runs filter module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/filter.js");
    expect(typeof mod.parseFilterInput).toBe("function");
    expect(typeof mod.applyFilter).toBe("function");
    expect(typeof mod.applyArchive).toBe("function");
    expect(typeof mod.isArchived).toBe("function");
  });

  it("runs window module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/window.js");
    expect(typeof mod.computeWindow).toBe("function");
    expect(typeof mod.sliceWindow).toBe("function");
    expect(typeof mod.deriveVisibleRows).toBe("function");
  });

  it("runs cursor module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/runs/cursor.js");
    expect(typeof mod.clampCursor).toBe("function");
    expect(typeof mod.moveCursor).toBe("function");
    expect(typeof mod.jumpCursorTo).toBe("function");
    expect(typeof mod.rowIdAtCursor).toBe("function");
    expect(typeof mod.reconcileCursorAfterRowsChange).toBe("function");
  });

  // ---------------------------------------------------------------------
  // P6-T1 step-table pure surface
  // ---------------------------------------------------------------------

  it("steps types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/types.js");
    // Type-only module — runtime exports empty.
    expect(Object.keys(mod)).toEqual([]);
  });

  it("steps tree module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/tree.js");
    expect(typeof mod.buildStepRows).toBe("function");
    expect(typeof mod.indexByParent).toBe("function");
    expect(typeof mod.orderRoots).toBe("function");
    expect(typeof mod.projectStepsSnapshot).toBe("function");
  });

  it("steps aggregate module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/aggregate.js");
    expect(typeof mod.shouldAggregateBatch).toBe("function");
    expect(typeof mod.formatProgressBar).toBe("function");
    expect(typeof mod.aggregateBatchRow).toBe("function");
    expect(typeof mod.deriveAggregateStatus).toBe("function");
    expect(typeof mod.toBatchAggregate).toBe("function");
    expect(typeof mod.formatAggregateNote).toBe("function");
    expect(typeof mod.BATCH_COLLAPSE_THRESHOLD).toBe("number");
  });

  it("steps columns module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/columns.js");
    expect(Array.isArray(mod.STEP_COLUMNS_WIDE)).toBe(true);
    expect(Array.isArray(mod.STEP_COLUMNS_MEDIUM)).toBe(true);
    expect(Array.isArray(mod.STEP_COLUMNS_NARROW)).toBe(true);
    expect(typeof mod.pickStepColumnSet).toBe("function");
    expect(typeof mod.computeStepColumnWidths).toBe("function");
    expect(typeof mod.fitStepCell).toBe("function");
  });

  it("steps derive module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/derive.js");
    expect(typeof mod.tokenToStatus).toBe("function");
    expect(typeof mod.stepStatusToRole).toBe("function");
    expect(typeof mod.stepStatusToGlyphKey).toBe("function");
    expect(typeof mod.stepStatusToLabel).toBe("function");
    expect(typeof mod.toStepStatusCell).toBe("function");
    expect(typeof mod.formatAttempt).toBe("function");
    expect(typeof mod.deriveStepElapsedMs).toBe("function");
    expect(typeof mod.formatStepElapsed).toBe("function");
    expect(typeof mod.formatEdgeNote).toBe("function");
    expect(typeof mod.formatWaitingNote).toBe("function");
  });

  it("steps retry module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/retry.js");
    expect(typeof mod.applyRetryEvent).toBe("function");
    expect(typeof mod.buildRetryHints).toBe("function");
    expect(typeof mod.formatRetryCountdown).toBe("function");
  });

  it("steps upstream module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/upstream.js");
    expect(typeof mod.isUpstreamFailed).toBe("function");
    expect(typeof mod.upstreamNoteLabel).toBe("function");
  });

  // -------------------------------------------------------------------
  // P6-T2 step-detail pure surface
  // -------------------------------------------------------------------

  it("steps detail-types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/detail-types.js");
    // Type-only module — runtime exports empty.
    expect(Object.keys(mod)).toEqual([]);
  });

  // -------------------------------------------------------------------
  // P6-T3 log panel pure surface
  // -------------------------------------------------------------------

  it("log types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/log/types.js");
    expect(Object.keys(mod)).toEqual(["LOG_RING_CAP"]);
    expect(mod.LOG_RING_CAP).toBe(2000);
  });

  it("log ansi module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/log/ansi.js");
    expect(typeof mod.parseAnsi).toBe("function");
    expect(typeof mod.stripAnsi).toBe("function");
    expect(mod.ANSI_PATTERN).toBeInstanceOf(RegExp);
  });

  it("log reducer module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/log/reducer.js");
    expect(typeof mod.logReducer).toBe("function");
    expect(mod.initialLogPanelState).toBeDefined();
    expect(typeof mod.linesSincePause).toBe("function");
  });

  it("log derive module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/log/derive.js");
    expect(typeof mod.deriveLogModel).toBe("function");
    expect(typeof mod.emptyReasonLabel).toBe("function");
    expect(typeof mod.formatHeader).toBe("function");
  });

  it("log ingest module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/log/ingest.js");
    expect(typeof mod.appendEventLines).toBe("function");
    expect(typeof mod.mergeSidecarTail).toBe("function");
    expect(typeof mod.parseSidecarText).toBe("function");
  });

  it("log select module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/log/select.js");
    expect(typeof mod.resolveLogTarget).toBe("function");
  });

  it("log keybar fixture loads without Ink/React/fs", async () => {
    const mod = await import("../../src/components/keybar-fixtures/log.js");
    expect(Array.isArray(mod.LOG_FOLLOWING_KEYBAR)).toBe(true);
    expect(Array.isArray(mod.LOG_PAUSED_KEYBAR)).toBe(true);
  });

  // -------------------------------------------------------------------
  // P6-T4 events tab pure surface
  // -------------------------------------------------------------------

  it("events types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/events/types.js");
    expect(Object.keys(mod)).toEqual([]);
  });

  it("events filter module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/events/filter.js");
    expect(typeof mod.groupForType).toBe("function");
    expect(typeof mod.matchesFilter).toBe("function");
    expect(typeof mod.eventNodeId).toBe("function");
  });

  it("events format module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/events/format.js");
    expect(typeof mod.formatEventRow).toBe("function");
    expect(typeof mod.formatEventTimestamp).toBe("function");
    expect(typeof mod.formatEventKind).toBe("function");
    expect(typeof mod.summariseEvent).toBe("function");
    expect(typeof mod.buildSearchHaystack).toBe("function");
    expect(typeof mod.roleForGroup).toBe("function");
  });

  it("events reducer module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/events/reducer.js");
    expect(typeof mod.eventsReducer).toBe("function");
    expect(mod.initialEventsPanelState).toBeDefined();
    expect(typeof mod.eventsSincePause).toBe("function");
  });

  it("events derive module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/events/derive.js");
    expect(typeof mod.deriveEventsModel).toBe("function");
    expect(typeof mod.emptyReasonLabel).toBe("function");
  });

  it("events merge module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/events/merge.js");
    expect(typeof mod.mergeEventSources).toBe("function");
  });

  it("graph keybar fixture loads without Ink/React/fs", async () => {
    const mod = await import("../../src/components/keybar-fixtures/graph.js");
    expect(Array.isArray(mod.GRAPH_KEYBAR)).toBe(true);
  });

  it("events keybar fixture loads without Ink/React/fs", async () => {
    const mod = await import("../../src/components/keybar-fixtures/events.js");
    expect(Array.isArray(mod.EVENTS_FOLLOWING_KEYBAR)).toBe(true);
    expect(Array.isArray(mod.EVENTS_PAUSED_KEYBAR)).toBe(true);
  });

  // -------------------------------------------------------------------
  // P7-T1 approval pure surface
  // -------------------------------------------------------------------

  it("approval types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/approval/types.js");
    expect(Object.keys(mod)).toEqual([]);
  });

  it("approval derive module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/approval/derive.js");
    expect(typeof mod.derivePendingApprovals).toBe("function");
    expect(typeof mod.countPendingApprovalsByRun).toBe("function");
    expect(typeof mod.findPendingApproval).toBe("function");
  });

  it("approval reducer module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/approval/reducer.js");
    expect(typeof mod.approvalFormReducer).toBe("function");
    expect(typeof mod.initialApprovalFormState).toBe("function");
  });

  it("approval keybar fixture loads without Ink/React/fs", async () => {
    const mod = await import(
      "../../src/components/keybar-fixtures/approval.js"
    );
    expect(Array.isArray(mod.APPROVAL_KEYBAR)).toBe(true);
  });

  // -------------------------------------------------------------------
  // P7-T2 resume pure surface
  // -------------------------------------------------------------------

  it("resume types module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/resume/types.js");
    expect(Object.keys(mod)).toEqual([]);
  });

  it("resume derive module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/resume/derive.js");
    expect(typeof mod.deriveResumableRun).toBe("function");
    expect(typeof mod.deriveRerunNodes).toBe("function");
    expect(typeof mod.deriveInputRows).toBe("function");
    expect(typeof mod.findFailingNode).toBe("function");
    expect(typeof mod.isRunResumable).toBe("function");
  });

  it("resume reducer module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/resume/reducer.js");
    expect(typeof mod.resumeFormReducer).toBe("function");
    expect(typeof mod.initialResumeFormState).toBe("function");
  });

  it("resume keybar fixture loads without Ink/React/fs", async () => {
    const mod = await import("../../src/components/keybar-fixtures/resume.js");
    expect(Array.isArray(mod.RESUME_KEYBAR)).toBe(true);
  });

  it("steps detail module loads without Ink/React/fs", async () => {
    const mod = await import("../../src/steps/detail.js");
    expect(typeof mod.selectStepDetail).toBe("function");
    expect(typeof mod.formatJsonOneLine).toBe("function");
    expect(typeof mod.pickLastLog).toBe("function");
    expect(typeof mod.pickStderrTail).toBe("function");
    expect(typeof mod.pickRouteTarget).toBe("function");
    expect(typeof mod.computeStepTypeLabel).toBe("function");
    expect(typeof mod.computeAttemptLabel).toBe("function");
    expect(typeof mod.computeTimeoutLabel).toBe("function");
  });
});

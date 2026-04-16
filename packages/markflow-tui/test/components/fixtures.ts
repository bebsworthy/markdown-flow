// test/components/fixtures.ts
//
// Reusable Binding[] fixtures and AppContext values for the keybar test
// suites. One pair per §15 row in docs/tui/mockups.md.
//
// Pure — NO React/Ink imports.
//
// Spacing knobs (`gapAfter`, `hideOnTier`, `hideLabelOn`, `narrowSeparator`)
// are chosen to make each binding array render to the EXACT strings in
// mockups.md §15 for all three tiers. Category transitions automatically
// inject a 3sp gap (+CATEGORY header in wide); explicit `gapAfter` covers
// sub-grouping within a single category.

import type { Binding, AppContext } from "../../src/components/types.js";

// ---------------------------------------------------------------------------
// AppContext factories
// ---------------------------------------------------------------------------

export const browsingCtx: AppContext = {
  mode: { kind: "browsing", pane: "workflows" },
  overlay: null,
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

export const runsCtx: AppContext = {
  mode: { kind: "browsing", pane: "runs" },
  overlay: null,
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

export const runGraphCtx: AppContext = {
  mode: { kind: "viewing", runId: "r1", focus: "graph" },
  overlay: null,
  approvalsPending: true,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

export const logFollowCtx: AppContext = {
  mode: { kind: "viewing", runId: "r1", focus: "log" },
  overlay: null,
  approvalsPending: false,
  isFollowing: true,
  isWrapped: false,
  toggleState: { isFollowing: true, isWrapped: false },
};

export const logPausedCtx: AppContext = {
  mode: { kind: "viewing", runId: "r1", focus: "log" },
  overlay: null,
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: { isFollowing: false, isWrapped: false },
};

export const approvalCtx: AppContext = {
  mode: { kind: "viewing", runId: "r1", focus: "detail" },
  overlay: { kind: "approval", runId: "r1", nodeId: "n1", state: "idle" },
  approvalsPending: true,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

export const resumeCtx: AppContext = {
  mode: { kind: "viewing", runId: "r1", focus: "detail" },
  overlay: {
    kind: "resumeWizard",
    runId: "r1",
    rerun: new Set(),
    inputs: {},
  },
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

export const commandCtx: AppContext = {
  mode: { kind: "browsing", pane: "workflows" },
  overlay: { kind: "commandPalette", query: "" },
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

export const findCtx: AppContext = {
  mode: { kind: "browsing", pane: "workflows" },
  overlay: { kind: "commandPalette", query: "" },
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

export const helpCtx: AppContext = {
  mode: { kind: "browsing", pane: "workflows" },
  overlay: { kind: "help" },
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

// ---------------------------------------------------------------------------
// Binding fixtures — one array per §15 row
// ---------------------------------------------------------------------------

const alwaysTrue = (): boolean => true;
const noop = (): void => {};

// --- WORKFLOWS --------------------------------------------------------------
// Wide:   `↑↓ Select  ⏎ Open  r Run  e Edit in $EDITOR     ? Help   q Quit`
// Medium: `↑↓ ⏎ r e    ? q`
// Narrow: `↑↓ ⏎ r e ?`
export const workflowsBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["Up", "Down"], label: "Select", when: alwaysTrue, action: noop },
  { keys: ["Enter"], label: "Open", when: alwaysTrue, action: noop },
  { keys: ["r"], label: "Run", when: alwaysTrue, action: noop },
  {
    keys: ["e"],
    label: "Edit in $EDITOR",
    when: alwaysTrue,
    action: noop,
    // Pre-globals gap: full 5sp (2 base + 3), short 4sp (1 + 3).
    gapAfter: { full: 3, short: 3 },
  },
  {
    keys: ["?"],
    label: "Help",
    when: alwaysTrue,
    action: noop,
    // `? Help   q Quit` (3sp) in full. Medium/narrow use single space.
    gapAfter: { full: 1 },
  },
  {
    keys: ["q"],
    label: "Quit",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
  },
]);

// --- RUNS -------------------------------------------------------------------
// Wide:   `↑↓ Select  ⏎ Open  r Resume  a Approve   s Status  / Search     ? q`
// Medium: `↑↓ ⏎ r a  s /   ? q`
// Narrow: `↑↓ ⏎ r a ?`
export const runsBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["Up", "Down"], label: "Select", when: alwaysTrue, action: noop },
  { keys: ["Enter"], label: "Open", when: alwaysTrue, action: noop },
  { keys: ["r"], label: "Resume", when: alwaysTrue, action: noop },
  {
    keys: ["a"],
    label: "Approve",
    when: alwaysTrue,
    action: noop,
    // Intra-local sub-group gap: full 3sp (2 + 1), short 2sp (1 + 1).
    gapAfter: { full: 1, short: 1 },
  },
  {
    keys: ["s"],
    label: "Status",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
  },
  {
    keys: ["/"],
    label: "Search",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
    // Pre-globals gap: full 5sp (2 + 3), short 3sp (1 + 2).
    gapAfter: { full: 3, short: 2 },
  },
  {
    keys: ["?"],
    label: "Help",
    when: alwaysTrue,
    action: noop,
    // RUNS wide matrix shows `? q` (no labels on globals).
    hideLabelOn: ["full", "short", "keys"],
  },
  {
    keys: ["q"],
    label: "Quit",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
    hideLabelOn: ["full", "short", "keys"],
    // Force 1sp between `?` and `q` in wide tier (overrides 2sp base).
    sepBefore: { full: 1 },
  },
]);

// --- RUN (graph) ------------------------------------------------------------
// Wide:   `↑↓ Step  ⏎ Logs  a Approve  R Re-run  X Cancel   VIEW  m  f  /    ? q`
// Medium: `↑↓ ⏎ a R X   m f /    ? q`
// Narrow: `↑↓ ⏎ R X  | f /  | ? q`
export const runGraphBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["Up", "Down"], label: "Step", when: alwaysTrue, action: noop },
  { keys: ["Enter"], label: "Logs", when: alwaysTrue, action: noop },
  {
    keys: ["a"],
    label: "Approve",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
  },
  { keys: ["R"], label: "Re-run", when: alwaysTrue, action: noop },
  {
    keys: ["X"],
    label: "Cancel",
    destructive: true,
    when: alwaysTrue,
    action: noop,
    // Keys tier `X  | f` = 2sp + "| ". narrowSeparator on `f` handles
    // the pipe; we need 1 extra space (base 1 + 1 = 2sp).
    gapAfter: { keys: 1 },
  },
  {
    keys: ["m"],
    label: "Minimap",
    category: "VIEW",
    when: alwaysTrue,
    action: noop,
    // Wide row renders just `m` (category header present, no per-
    // binding label).
    hideLabelOn: ["full", "short", "keys"],
    hideOnTier: ["keys"],
  },
  {
    keys: ["f"],
    label: "Follow",
    category: "VIEW",
    when: alwaysTrue,
    action: noop,
    hideLabelOn: ["full", "short", "keys"],
    // Narrow tier renders `| f` — pipe replaces the default whitespace
    // prefix.
    narrowSeparator: "| ",
  },
  {
    keys: ["/"],
    label: "Filter",
    category: "VIEW",
    when: alwaysTrue,
    action: noop,
    hideLabelOn: ["full", "short", "keys"],
    // Pre-globals gap: full 4sp (2 + 2), short 4sp (1 + 3), keys 2sp
    // (1 + 1, pipe separator is on `?`).
    gapAfter: { full: 2, short: 3, keys: 1 },
  },
  {
    keys: ["?"],
    label: "Help",
    when: alwaysTrue,
    action: noop,
    // Narrow pipe separator `| ?`; full/medium force 4sp to match §15
    // (VIEW→globals transition auto-picks 3sp, one short of mockup).
    narrowSeparator: "| ",
    sepBefore: { full: 4, short: 4 },
    // §15 RUN-graph wide/medium globals are key-only.
    hideLabelOn: ["full", "short"],
  },
  {
    keys: ["q"],
    label: "Quit",
    when: alwaysTrue,
    action: noop,
    hideLabelOn: ["full", "short"],
    // Full/short tiers render `? q` with 1sp; full tier base is 2sp,
    // short is 1sp. Override full to 1sp to match §15.
    sepBefore: { full: 1 },
  },
]);

// --- LOG (follow) -----------------------------------------------------------
// Wide:   `LOG · following   w Wrap  t Timestamps  1/2/3 streams  / Search    Esc`
// Medium: `LOG follow  w t 1/2/3 /   Esc`
// Narrow: `w t /   Esc`
export const logFollowBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["w"], label: "Wrap", when: alwaysTrue, action: noop },
  { keys: ["t"], label: "Timestamps", when: alwaysTrue, action: noop },
  {
    keys: ["1/2/3"],
    label: "streams",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
  },
  {
    keys: ["/"],
    label: "Search",
    when: alwaysTrue,
    action: noop,
    // Pre-Esc gap: full 4sp (2 + 2), short 3sp (1 + 2), keys 3sp (1 + 2).
    gapAfter: { full: 2, short: 2, keys: 2 },
  },
  { keys: ["Esc"], label: "", when: alwaysTrue, action: noop },
]);

// --- LOG (paused) -----------------------------------------------------------
// Wide:   `LOG · paused   F Resume  G Head  g Top  w Wrap  / Search    Esc`
// Medium: `LOG paused  F G g w /   Esc`
// Narrow: `F G g w /  Esc`
export const logPausedBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["F"], label: "Resume", when: alwaysTrue, action: noop },
  { keys: ["G"], label: "Head", when: alwaysTrue, action: noop },
  { keys: ["g"], label: "Top", when: alwaysTrue, action: noop },
  { keys: ["w"], label: "Wrap", when: alwaysTrue, action: noop },
  {
    keys: ["/"],
    label: "Search",
    when: alwaysTrue,
    action: noop,
    // Pre-Esc gap: full 4sp, short 3sp, keys 2sp.
    gapAfter: { full: 2, short: 2, keys: 1 },
  },
  { keys: ["Esc"], label: "", when: alwaysTrue, action: noop },
]);

// --- APPROVAL ---------------------------------------------------------------
// Wide:   `[APPROVAL]  ⏎ Decide  e Edit inputs  s Suspend-for-later    Esc Cancel  ?`
// Medium: `[APPROVAL] ⏎ e s   Esc ?`
// Narrow: `⏎ e s   Esc`
export const approvalBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["Enter"], label: "Decide", when: alwaysTrue, action: noop },
  { keys: ["e"], label: "Edit inputs", when: alwaysTrue, action: noop },
  {
    keys: ["s"],
    label: "Suspend-for-later",
    when: alwaysTrue,
    action: noop,
    // Pre-Esc gap: full 4sp, short 3sp, keys 3sp.
    gapAfter: { full: 2, short: 2, keys: 2 },
  },
  { keys: ["Esc"], label: "Cancel", when: alwaysTrue, action: noop },
  {
    keys: ["?"],
    label: "Help",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
    hideLabelOn: ["full", "short"],
  },
]);

// --- RESUME -----------------------------------------------------------------
// Wide:   `[RESUME]  ⏎ Resume  Space Toggle  Tab Next  p Preview    Esc    ?`
// Medium: `[RESUME] ⏎ Space Tab p   Esc ?`
// Narrow: `⏎ Space Tab p  Esc`
export const resumeBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["Enter"], label: "Resume", when: alwaysTrue, action: noop },
  { keys: ["Space"], label: "Toggle", when: alwaysTrue, action: noop },
  { keys: ["Tab"], label: "Next", when: alwaysTrue, action: noop },
  {
    keys: ["p"],
    label: "Preview",
    when: alwaysTrue,
    action: noop,
    // Pre-Esc gap: full 4sp, short 3sp, keys 2sp.
    gapAfter: { full: 2, short: 2, keys: 1 },
  },
  {
    keys: ["Esc"],
    label: "",
    when: alwaysTrue,
    action: noop,
    // `Esc    ?` = 4sp on full. Medium is `Esc ?` (1sp).
    gapAfter: { full: 2 },
  },
  {
    keys: ["?"],
    label: "Help",
    when: alwaysTrue,
    action: noop,
    hideOnTier: ["keys"],
    hideLabelOn: ["full", "short"],
  },
]);

// --- COMMAND ----------------------------------------------------------------
// Wide:   `[COMMAND]   ⏎ Run  ↑↓ Select  Tab Complete    Esc Cancel`
// Medium: `⏎ ↑↓ Tab   Esc`  (pill dropped at short tier)
// Narrow: `⏎ ↑↓ Tab  Esc`
export const commandBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["Enter"], label: "Run", when: alwaysTrue, action: noop },
  { keys: ["Up", "Down"], label: "Select", when: alwaysTrue, action: noop },
  {
    keys: ["Tab"],
    label: "Complete",
    when: alwaysTrue,
    action: noop,
    // Pre-Esc gap: full 4sp, short 3sp, keys 2sp.
    gapAfter: { full: 2, short: 2, keys: 1 },
  },
  { keys: ["Esc"], label: "Cancel", when: alwaysTrue, action: noop },
]);

// --- FIND -------------------------------------------------------------------
// Wide:   `[FIND]   ⏎ Open  ↑↓ Select    Esc Cancel`
// Medium: `⏎ ↑↓   Esc`  (pill dropped)
// Narrow: `⏎ ↑↓  Esc`
export const findBindings: ReadonlyArray<Binding> = Object.freeze([
  { keys: ["Enter"], label: "Open", when: alwaysTrue, action: noop },
  {
    keys: ["Up", "Down"],
    label: "Select",
    when: alwaysTrue,
    action: noop,
    // Pre-Esc gap: full 4sp, short 3sp, keys 2sp.
    gapAfter: { full: 2, short: 2, keys: 1 },
  },
  { keys: ["Esc"], label: "Cancel", when: alwaysTrue, action: noop },
]);

// --- HELP -------------------------------------------------------------------
// Wide:   `[HELP]   ↑↓ Navigate   / Search   Esc Close`
// Medium: `↑↓ / Esc`  (pill dropped)
// Narrow: `↑↓ / Esc`
export const helpBindings: ReadonlyArray<Binding> = Object.freeze([
  {
    keys: ["Up", "Down"],
    label: "Navigate",
    when: alwaysTrue,
    action: noop,
    // Navigate→/ 3sp on full; single space on short/keys.
    gapAfter: { full: 1 },
  },
  {
    keys: ["/"],
    label: "Search",
    when: alwaysTrue,
    action: noop,
    // /→Esc 3sp on full; single space on short/keys.
    gapAfter: { full: 1 },
  },
  { keys: ["Esc"], label: "Close", when: alwaysTrue, action: noop },
]);

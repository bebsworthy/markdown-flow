// test/components/mode-tabs.test.tsx
//
// Ink render + key dispatch tests for <ModeTabs>.

import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { ModeTabs } from "../../src/components/mode-tabs.js";
import type { AppState, Action } from "../../src/state/types.js";

const stripAnsi = (s: string): string =>
  s.replace(/\x1b\[[0-9;]*m/g, "");

const BROWSING_WORKFLOWS: AppState["mode"] = {
  kind: "browsing",
  pane: "workflows",
};
const BROWSING_RUNS: AppState["mode"] = { kind: "browsing", pane: "runs" };
const VIEWING_R1: AppState["mode"] = {
  kind: "viewing",
  runId: "r1",
  focus: "graph",
};

function renderTabs(props: {
  mode: AppState["mode"];
  selectedRunId: string | null;
  dispatch?: (a: Action) => void;
  color?: boolean;
  unicode?: boolean;
}): ReturnType<typeof render> {
  const theme = buildTheme({
    color: props.color ?? true,
    unicode: props.unicode ?? true,
  });
  return render(
    <ThemeProvider value={theme}>
      <ModeTabs
        mode={props.mode}
        selectedRunId={props.selectedRunId}
        dispatch={props.dispatch ?? (() => {})}
      />
    </ThemeProvider>,
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ModeTabs — rendering", () => {
  it("renders all three labels in browsing.workflows mode (with a selected run)", () => {
    const { lastFrame } = renderTabs({
      mode: BROWSING_WORKFLOWS,
      selectedRunId: "r1",
      color: false,
    });
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toContain("WORKFLOWS");
    expect(out).toContain("RUNS");
    expect(out).toContain("RUN");
  });

  it("active=WORKFLOWS wraps the WORKFLOWS label in inverse-video brackets", () => {
    const { lastFrame } = renderTabs({
      mode: BROWSING_WORKFLOWS,
      selectedRunId: "r1",
      color: false,
    });
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toContain("[ WORKFLOWS ]");
    expect(out).not.toContain("[ RUNS ]");
    expect(out).not.toContain("[ RUN ]");
  });

  it("active=RUNS wraps the RUNS label in inverse-video brackets", () => {
    const { lastFrame } = renderTabs({
      mode: BROWSING_RUNS,
      selectedRunId: "r1",
      color: false,
    });
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toContain("[ RUNS ]");
    expect(out).not.toContain("[ WORKFLOWS ]");
  });

  it("active=RUN (viewing.) wraps the RUN label in inverse-video brackets", () => {
    const { lastFrame } = renderTabs({
      mode: VIEWING_R1,
      selectedRunId: "r1",
      color: false,
    });
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toContain("[ RUN ]");
    expect(out).not.toContain("[ WORKFLOWS ]");
    expect(out).not.toContain("[ RUNS ]");
  });

  it("RUN tab is omitted entirely when selectedRunId is null and mode is browsing (hide-don't-grey, R5)", () => {
    const { lastFrame } = renderTabs({
      mode: BROWSING_WORKFLOWS,
      selectedRunId: null,
      color: false,
    });
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toContain("WORKFLOWS");
    expect(out).toContain("RUNS");
    expect(out).not.toMatch(/\bRUN\b/);
  });

  it("RUN tab is shown when selectedRunId is set even if mode is browsing", () => {
    const { lastFrame } = renderTabs({
      mode: BROWSING_WORKFLOWS,
      selectedRunId: "r-abc",
      color: false,
    });
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toMatch(/\bRUN\b/);
  });
});

// ---------------------------------------------------------------------------
// Key dispatch
// ---------------------------------------------------------------------------

/** Wait one tick so Ink's useInput handler attaches before we write. */
async function nextTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

// NOTE on F-keys: Ink 5's `useInput` does not expose F-key events at all.
// When a user presses F1 (or an ANSI F-key escape `\x1bOP` is written to
// stdin), Ink's parser collapses the sequence to an empty `input` with no
// flag set on the `Key` record. The keybar spec (features.md §5.6) already
// anticipates this with the "digit fallback" (`1/2/3`), which is the
// binding the component actually delivers today. The pure `keyToMode`
// helper still recognises F-key escape sequences and synthetic `f1/f2/f3`
// flags — that's covered in `app-shell-layout.test.ts`.

describe("ModeTabs — key dispatch", () => {
  it("'1' dispatches MODE_SHOW_WORKFLOWS", async () => {
    const dispatch = vi.fn<(a: Action) => void>();
    const { stdin } = renderTabs({
      mode: BROWSING_RUNS,
      selectedRunId: "r1",
      dispatch,
    });
    await nextTick();
    stdin.write("1");
    expect(dispatch).toHaveBeenCalledWith({ type: "MODE_SHOW_WORKFLOWS" });
  });

  it("'2' dispatches MODE_SHOW_RUNS", async () => {
    const dispatch = vi.fn<(a: Action) => void>();
    const { stdin } = renderTabs({
      mode: BROWSING_WORKFLOWS,
      selectedRunId: "r1",
      dispatch,
    });
    await nextTick();
    stdin.write("2");
    expect(dispatch).toHaveBeenCalledWith({ type: "MODE_SHOW_RUNS" });
  });

  it("'3' with selectedRunId dispatches MODE_OPEN_RUN { runId }", async () => {
    const dispatch = vi.fn<(a: Action) => void>();
    const { stdin } = renderTabs({
      mode: BROWSING_RUNS,
      selectedRunId: "r-42",
      dispatch,
    });
    await nextTick();
    stdin.write("3");
    expect(dispatch).toHaveBeenCalledWith({
      type: "MODE_OPEN_RUN",
      runId: "r-42",
    });
  });

  it("'3' with no selectedRunId does NOT dispatch", async () => {
    const dispatch = vi.fn<(a: Action) => void>();
    const { stdin } = renderTabs({
      mode: BROWSING_RUNS,
      selectedRunId: null,
      dispatch,
    });
    await nextTick();
    stdin.write("3");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("'3' while already viewing does NOT dispatch (no-op)", async () => {
    const dispatch = vi.fn<(a: Action) => void>();
    const { stdin } = renderTabs({
      mode: VIEWING_R1,
      selectedRunId: "r1",
      dispatch,
    });
    await nextTick();
    stdin.write("3");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("digit keys dispatch once per press, not per character group", async () => {
    const dispatch = vi.fn<(a: Action) => void>();
    const { stdin } = renderTabs({
      mode: BROWSING_RUNS,
      selectedRunId: "r1",
      dispatch,
    });
    await nextTick();
    stdin.write("1");
    stdin.write("2");
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "MODE_SHOW_WORKFLOWS" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "MODE_SHOW_RUNS" });
  });

  it("unhandled keys do not dispatch", async () => {
    const dispatch = vi.fn<(a: Action) => void>();
    const { stdin } = renderTabs({
      mode: BROWSING_RUNS,
      selectedRunId: "r1",
      dispatch,
    });
    await nextTick();
    stdin.write("x");
    stdin.write("z");
    expect(dispatch).not.toHaveBeenCalled();
  });
});

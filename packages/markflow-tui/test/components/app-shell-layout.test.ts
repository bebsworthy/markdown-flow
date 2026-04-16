// test/components/app-shell-layout.test.ts
//
// Pure-helper unit tests for src/components/app-shell-layout.ts.
// No Ink render — direct function-level assertions.

import { describe, it, expect } from "vitest";
import {
  activeTabFromMode,
  keyToMode,
  frameTitle,
  pickActiveTabStyle,
  composeTopRow,
  pickFrameSlots,
  type KeyEvent,
} from "../../src/components/app-shell-layout.js";
import { UNICODE_FRAME, ASCII_FRAME } from "../../src/theme/glyphs.js";
import type { AppState } from "../../src/state/types.js";

// ---------------------------------------------------------------------------
// activeTabFromMode
// ---------------------------------------------------------------------------

describe("activeTabFromMode", () => {
  it("returns WORKFLOWS for browsing.workflows", () => {
    const mode: AppState["mode"] = { kind: "browsing", pane: "workflows" };
    expect(activeTabFromMode(mode)).toBe("WORKFLOWS");
  });

  it("returns RUNS for browsing.runs", () => {
    const mode: AppState["mode"] = { kind: "browsing", pane: "runs" };
    expect(activeTabFromMode(mode)).toBe("RUNS");
  });

  it("returns RUN for viewing(...)", () => {
    const mode: AppState["mode"] = {
      kind: "viewing",
      runId: "r1",
      focus: "graph",
    };
    expect(activeTabFromMode(mode)).toBe("RUN");
  });
});

// ---------------------------------------------------------------------------
// keyToMode
// ---------------------------------------------------------------------------

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

function ev(overrides: Partial<KeyEvent> = {}): KeyEvent {
  return { input: "", ...overrides };
}

describe("keyToMode", () => {
  it("F1 → MODE_SHOW_WORKFLOWS", () => {
    const action = keyToMode(ev({ f1: true }), {
      mode: BROWSING_RUNS,
      selectedRunId: null,
    });
    expect(action).toEqual({ type: "MODE_SHOW_WORKFLOWS" });
  });

  it("F2 → MODE_SHOW_RUNS", () => {
    const action = keyToMode(ev({ f2: true }), {
      mode: BROWSING_WORKFLOWS,
      selectedRunId: null,
    });
    expect(action).toEqual({ type: "MODE_SHOW_RUNS" });
  });

  it("'1' → MODE_SHOW_WORKFLOWS", () => {
    const action = keyToMode(ev({ input: "1" }), {
      mode: BROWSING_RUNS,
      selectedRunId: null,
    });
    expect(action).toEqual({ type: "MODE_SHOW_WORKFLOWS" });
  });

  it("'2' → MODE_SHOW_RUNS", () => {
    const action = keyToMode(ev({ input: "2" }), {
      mode: BROWSING_WORKFLOWS,
      selectedRunId: null,
    });
    expect(action).toEqual({ type: "MODE_SHOW_RUNS" });
  });

  it("F3 with selectedRunId → MODE_OPEN_RUN { runId }", () => {
    const action = keyToMode(ev({ f3: true }), {
      mode: BROWSING_RUNS,
      selectedRunId: "run-42",
    });
    expect(action).toEqual({ type: "MODE_OPEN_RUN", runId: "run-42" });
  });

  it("F3 with no selectedRunId → null (hide-don't-grey)", () => {
    const action = keyToMode(ev({ f3: true }), {
      mode: BROWSING_RUNS,
      selectedRunId: null,
    });
    expect(action).toBeNull();
  });

  it("F3 while already viewing → null (no-op)", () => {
    const action = keyToMode(ev({ f3: true }), {
      mode: VIEWING_R1,
      selectedRunId: "r1",
    });
    expect(action).toBeNull();
  });

  it("'3' mirrors F3 behaviour", () => {
    const action1 = keyToMode(ev({ input: "3" }), {
      mode: BROWSING_RUNS,
      selectedRunId: "run-9",
    });
    expect(action1).toEqual({ type: "MODE_OPEN_RUN", runId: "run-9" });

    const action2 = keyToMode(ev({ input: "3" }), {
      mode: BROWSING_RUNS,
      selectedRunId: null,
    });
    expect(action2).toBeNull();

    const action3 = keyToMode(ev({ input: "3" }), {
      mode: VIEWING_R1,
      selectedRunId: "r1",
    });
    expect(action3).toBeNull();
  });

  it("unbound key → null", () => {
    const action = keyToMode(ev({ input: "x" }), {
      mode: BROWSING_WORKFLOWS,
      selectedRunId: "r1",
    });
    expect(action).toBeNull();
  });

  it("raw ANSI F-key escape sequences dispatch the same actions as the f1/f2/f3 flags", () => {
    // xterm-style SS3 F1/F2/F3 sequences.
    expect(
      keyToMode(ev({ input: "\x1bOP" }), {
        mode: BROWSING_RUNS,
        selectedRunId: null,
      }),
    ).toEqual({ type: "MODE_SHOW_WORKFLOWS" });
    expect(
      keyToMode(ev({ input: "\x1bOQ" }), {
        mode: BROWSING_WORKFLOWS,
        selectedRunId: null,
      }),
    ).toEqual({ type: "MODE_SHOW_RUNS" });
    expect(
      keyToMode(ev({ input: "\x1bOR" }), {
        mode: BROWSING_RUNS,
        selectedRunId: "r9",
      }),
    ).toEqual({ type: "MODE_OPEN_RUN", runId: "r9" });
  });
});

// ---------------------------------------------------------------------------
// frameTitle
// ---------------------------------------------------------------------------

describe("frameTitle", () => {
  it("active=WORKFLOWS yields '[ WORKFLOWS ]  RUNS  RUN'", () => {
    expect(frameTitle("WORKFLOWS")).toBe("[ WORKFLOWS ]  RUNS  RUN");
  });

  it("active=RUNS yields 'WORKFLOWS  [ RUNS ]  RUN'", () => {
    expect(frameTitle("RUNS")).toBe("WORKFLOWS  [ RUNS ]  RUN");
  });

  it("active=RUN yields 'WORKFLOWS  RUNS  [ RUN ]'", () => {
    expect(frameTitle("RUN")).toBe("WORKFLOWS  RUNS  [ RUN ]");
  });

  it("hideRun=true omits the RUN tab entirely", () => {
    expect(frameTitle("WORKFLOWS", { hideRun: true })).toBe(
      "[ WORKFLOWS ]  RUNS",
    );
    expect(frameTitle("RUNS", { hideRun: true })).toBe(
      "WORKFLOWS  [ RUNS ]",
    );
  });
});

// ---------------------------------------------------------------------------
// pickActiveTabStyle
// ---------------------------------------------------------------------------

describe("pickActiveTabStyle", () => {
  it("active tab returns { inverse: true, bold: true }", () => {
    expect(pickActiveTabStyle("RUNS", "RUNS")).toEqual({
      inverse: true,
      bold: true,
    });
  });

  it("inactive tabs return { inverse: false, bold: false }", () => {
    expect(pickActiveTabStyle("WORKFLOWS", "RUNS")).toEqual({
      inverse: false,
      bold: false,
    });
    expect(pickActiveTabStyle("RUN", "RUNS")).toEqual({
      inverse: false,
      bold: false,
    });
  });
});

// ---------------------------------------------------------------------------
// composeTopRow
// ---------------------------------------------------------------------------

describe("composeTopRow", () => {
  it("emits glyphs.tl + ' ' + title + ' ' + glyphs.h × pad + glyphs.tr at width=140 (Unicode)", () => {
    const title = "WORKFLOWS  RUNS  RUN";
    const row = composeTopRow(140, title, UNICODE_FRAME);
    expect(row.startsWith("\u2554 WORKFLOWS  RUNS  RUN ")).toBe(true);
    expect(row.endsWith("\u2557")).toBe(true);
    expect(row.length).toBe(140);
    // Verify the fill between the title and the right corner is '═' only.
    const innerEnd = row.slice(`\u2554 ${title} `.length, -1);
    expect(innerEnd).toMatch(/^\u2550+$/);
  });

  it("emits ASCII fallback `+ ... +` at width=140 with ASCII glyphs", () => {
    const title = "WORKFLOWS  RUNS  RUN";
    const row = composeTopRow(140, title, ASCII_FRAME);
    expect(row.startsWith("+ WORKFLOWS  RUNS  RUN ")).toBe(true);
    expect(row.endsWith("+")).toBe(true);
    expect(row.length).toBe(140);
    const innerEnd = row.slice(`+ ${title} `.length, -1);
    expect(innerEnd).toMatch(/^-+$/);
  });

  it("never overflows the requested width", () => {
    for (const w of [20, 40, 60, 80, 100, 140, 200]) {
      const row = composeTopRow(w, "WORKFLOWS  RUNS  RUN", UNICODE_FRAME);
      expect(row.length).toBe(w);
    }
  });

  it("when title length ≥ width-2, truncates the title with '…' (defensive)", () => {
    // Title is 40 chars; at width=20 we have innerWidth=18, maxTitleLen=16,
    // so the rendered title is 15 chars + "…" = 16 chars.
    const title = "A".repeat(40);
    const row = composeTopRow(20, title, UNICODE_FRAME);
    expect(row.length).toBe(20);
    expect(row).toContain("\u2026");
    // First char is left corner, then space, then 16 chars of (truncated title),
    // then space, then no padding (innerWidth=18 - 2 - 16 = 0), then right corner.
    expect(row).toBe(
      `\u2554 ${"A".repeat(15)}\u2026 \u2557`,
    );
  });
});

// ---------------------------------------------------------------------------
// pickFrameSlots
// ---------------------------------------------------------------------------

describe("pickFrameSlots", () => {
  it("rows=30 → topRows=13, bottomRows=13", () => {
    expect(pickFrameSlots(30)).toEqual({ topRows: 13, bottomRows: 13 });
  });

  it("rows=20 → topRows=8, bottomRows=8", () => {
    expect(pickFrameSlots(20)).toEqual({ topRows: 8, bottomRows: 8 });
  });

  it("rows<6 → topRows=1, bottomRows=1 (degenerate clamp)", () => {
    expect(pickFrameSlots(5)).toEqual({ topRows: 1, bottomRows: 1 });
    expect(pickFrameSlots(0)).toEqual({ topRows: 1, bottomRows: 1 });
  });
});

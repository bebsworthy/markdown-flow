// test/components/viewing-panes-medium.test.tsx
//
// P8-T1 §4.2 — <ViewingBottomSlot> tab-header assertions at medium and
// narrow tiers. We don't exercise the inner pane rendering here (covered
// elsewhere); we only assert the tab-row shape via stripAnsi.

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { ViewingBottomSlot } from "../../src/components/viewing-panes.js";
import { initialEngineState } from "../../src/engine/reducer.js";
import type { ViewingFocus } from "../../src/state/types.js";

const COLOR_OFF = buildTheme({ color: false, unicode: true });
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const NOW = Date.parse("2026-04-17T12:00:00Z");

function renderAt(
  focus: ViewingFocus,
  width: number,
  suffix?: string,
): { readonly frame: string; readonly cleanup: () => void } {
  const r = render(
    <ThemeProvider value={COLOR_OFF}>
      <ViewingBottomSlot
        focus={focus}
        runsDir={null}
        runId="r1"
        selectedStepId={null}
        engineState={initialEngineState}
        width={width}
        height={8}
        nowMs={NOW}
        tabSuffix={suffix}
      />
    </ThemeProvider>,
  );
  return {
    frame: stripAnsi(r.lastFrame() ?? ""),
    cleanup: () => r.unmount(),
  };
}

describe("<ViewingBottomSlot> tab header — medium tier (width=90)", () => {
  const FOCI: ReadonlyArray<ViewingFocus> = [
    "graph",
    "detail",
    "log",
    "events",
  ];

  for (const focus of FOCI) {
    it(`focus=${focus} renders letter-bracketed four-tab header`, () => {
      const { frame, cleanup } = renderAt(focus, 90);
      expect(frame).toContain("[G]raph");
      expect(frame).toContain("[D]etail");
      expect(frame).toContain("[L]og");
      expect(frame).toContain("[E]vents");
      cleanup();
    });
  }

  it("suffix is preserved at medium tier", () => {
    const { frame, cleanup } = renderAt("graph", 90, "abcd12 · deploy");
    expect(frame).toContain("abcd12");
    cleanup();
  });
});

describe("<ViewingBottomSlot> tab header — narrow tier (width=60)", () => {
  it("renders bare-letter tab row and drops the suffix", () => {
    const { frame, cleanup } = renderAt("graph", 60, "abcd12 · deploy");
    // Suffix should be dropped.
    expect(frame).not.toContain("abcd12");
    // Expect bare letters on the tab row. Locate the tab row line; at
    // width=60 the letter-bracketed form would contain "[" which it should
    // NOT at narrow.
    const lines = frame.split("\n").filter((l) => l.length > 0);
    const tabLine = lines[0] ?? "";
    expect(tabLine).not.toContain("[");
    expect(tabLine).toContain("G");
    expect(tabLine).toContain("D");
    expect(tabLine).toContain("L");
    expect(tabLine).toContain("E");
    cleanup();
  });
});

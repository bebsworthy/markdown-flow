// test/components/run-detail-placeholder.test.tsx
//
// Tests for <RunDetailPlaceholder> (P5-T3). The bottom-pane placeholder
// renders plain-text messages — no Phase-6 detail tabs, no step table,
// no log pane. Height is padded with blank lines to reserve vertical
// footprint.
//
// References: docs/tui/plans/P5-T3.md §7, §9.5.

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { RunDetailPlaceholder } from "../../src/components/run-detail-placeholder.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderPlaceholder(props: {
  selectedRunId?: string | null;
  runExists?: boolean;
  mode?: "follow" | "zoom";
  width?: number;
  height?: number;
}): { frame: () => string; cleanup: () => void } {
  const rendered = render(
    <ThemeProvider>
      <RunDetailPlaceholder
        selectedRunId={props.selectedRunId ?? null}
        runExists={props.runExists ?? false}
        mode={props.mode ?? "follow"}
        width={props.width ?? 80}
        height={props.height ?? 6}
      />
    </ThemeProvider>,
  );
  return {
    frame: () => stripAnsi(rendered.lastFrame() ?? ""),
    cleanup: () => rendered.unmount(),
  };
}

describe("<RunDetailPlaceholder>", () => {
  it("follow mode with id renders 'selected: <id>'", () => {
    const { frame, cleanup } = renderPlaceholder({
      mode: "follow",
      selectedRunId: "abcd1234",
      runExists: true,
    });
    const f = frame();
    expect(f).toContain("selected: abcd1234");
    cleanup();
  });

  it("follow mode without id renders 'no run selected'", () => {
    const { frame, cleanup } = renderPlaceholder({
      mode: "follow",
      selectedRunId: null,
    });
    const f = frame();
    expect(f).toContain("no run selected");
    cleanup();
  });

  it("zoom mode with id renders 'RUN <id>'", () => {
    const { frame, cleanup } = renderPlaceholder({
      mode: "zoom",
      selectedRunId: "abcd1234",
      runExists: true,
    });
    const f = frame();
    expect(f).toContain("RUN abcd1234");
    cleanup();
  });

  it("zoom mode with runExists=false renders 'no longer exists'", () => {
    const { frame, cleanup } = renderPlaceholder({
      mode: "zoom",
      selectedRunId: "abcd1234",
      runExists: false,
    });
    const f = frame();
    expect(f).toContain("no longer exists");
    cleanup();
  });

  it("height prop reserves that many rows", () => {
    const { frame, cleanup } = renderPlaceholder({
      mode: "follow",
      selectedRunId: "x",
      runExists: true,
      height: 6,
    });
    const lines = frame().split("\n");
    // At least `height` lines worth of output — ink strips a trailing
    // newline so we allow ±1.
    expect(lines.length).toBeGreaterThanOrEqual(5);
    cleanup();
  });

  it("narrow width truncates long runIds with an ellipsis", () => {
    const longId = "x".repeat(200);
    const { frame, cleanup } = renderPlaceholder({
      mode: "follow",
      selectedRunId: longId,
      runExists: true,
      width: 50,
    });
    const f = frame();
    // The full id must not appear; the ellipsis \u2026 must.
    expect(f).not.toContain(longId);
    expect(f).toContain("\u2026");
    cleanup();
  });

  it("does NOT render any Phase-6 detail tab labels", () => {
    const { frame, cleanup } = renderPlaceholder({
      mode: "zoom",
      selectedRunId: "abcd",
      runExists: true,
    });
    const f = frame();
    expect(f).not.toMatch(/\bGraph\b/);
    expect(f).not.toMatch(/\bDetail\b/);
    expect(f).not.toMatch(/\bLog\b/);
    expect(f).not.toMatch(/\bEvents\b/);
    cleanup();
  });

  it("renders nothing crashy at width=0 or height=0", () => {
    const { frame, cleanup } = renderPlaceholder({
      mode: "follow",
      selectedRunId: "x",
      runExists: true,
      width: 0,
      height: 0,
    });
    // Just exercising the branch: frame() should not throw and should
    // return a string.
    expect(typeof frame()).toBe("string");
    cleanup();
  });
});

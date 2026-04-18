// test/components/runs-filter-bar.test.tsx
//
// Component tests for the runs-mode filter bar (P5-T2 §10.6).

import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { RunsFilterBar } from "../../src/components/runs-filter-bar.js";
import { parseFilterInput } from "../../src/runs/filter.js";
import type { RunsFilterState } from "../../src/runs/types.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function emptyFilter(): RunsFilterState {
  return {
    open: true,
    draft: "",
    applied: { raw: "", terms: [] },
  };
}

function renderBar(props: {
  filter?: RunsFilterState;
  dispatch?: ReturnType<typeof vi.fn>;
  width?: number;
  inputDisabled?: boolean;
}) {
  const dispatch = props.dispatch ?? vi.fn();
  const rendered = render(
    <ThemeProvider>
      <RunsFilterBar
        filter={props.filter ?? emptyFilter()}
        dispatch={dispatch as unknown as (action: any) => void}
        width={props.width ?? 140}
        inputDisabled={props.inputDisabled}
      />
    </ThemeProvider>,
  );
  return {
    frame: () => stripAnsi(rendered.lastFrame() ?? ""),
    stdin: rendered.stdin,
    dispatch,
    cleanup: () => rendered.unmount(),
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

describe("<RunsFilterBar> — render", () => {
  it("closed bar renders nothing", () => {
    const { frame, cleanup } = renderBar({
      filter: {
        open: false,
        draft: "hello",
        applied: { raw: "", terms: [] },
      },
      inputDisabled: true,
    });
    expect(frame().trim()).toBe("");
    cleanup();
  });

  it("open bar renders leading `>` + `/` + caret", () => {
    const { frame, cleanup } = renderBar({ inputDisabled: true });
    const f = frame();
    expect(f).toContain(">");
    expect(f).toContain("/");
    expect(f).toContain("_");
    cleanup();
  });

  it("echoes the current draft", () => {
    const { frame, cleanup } = renderBar({
      filter: {
        open: true,
        draft: "status:running",
        applied: { raw: "", terms: [] },
      },
      inputDisabled: true,
    });
    expect(frame()).toContain("status:running");
    cleanup();
  });

  it("renders malformed terms bracketed", () => {
    const { frame, cleanup } = renderBar({
      filter: {
        open: true,
        draft: "status:nope",
        applied: { raw: "", terms: [] },
      },
      inputDisabled: true,
    });
    expect(frame()).toContain("[status:nope]");
    cleanup();
  });

  it("renders a valid term label (status:running)", () => {
    const { frame, cleanup } = renderBar({
      filter: {
        open: true,
        draft: "status:running",
        applied: parseFilterInput("status:running"),
      },
      inputDisabled: true,
    });
    expect(frame()).toContain("status:running");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

describe("<RunsFilterBar> — key handling", () => {
  it("typing 's' dispatches RUNS_FILTER_INPUT(draft + 's')", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderBar({ dispatch });
    await flush();
    stdin.write("s");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({
      type: "RUNS_FILTER_INPUT",
      value: "s",
    });
    cleanup();
  });

  it("forward-Delete does not erase draft (Ink 7 key.delete regression)", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderBar({
      dispatch,
      filter: {
        open: true,
        draft: "abc",
        applied: { raw: "", terms: [] },
      },
    });
    await flush();
    dispatch.mockClear();
    stdin.write("\x1b[3~"); // forward-Delete
    await flush();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "RUNS_FILTER_INPUT" }),
    );
    cleanup();
  });

  it("Enter dispatches RUNS_FILTER_APPLY", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderBar({
      dispatch,
      filter: {
        open: true,
        draft: "status:running",
        applied: { raw: "", terms: [] },
      },
    });
    await flush();
    stdin.write("\r");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ type: "RUNS_FILTER_APPLY" });
    cleanup();
  });

  it("Esc on empty draft dispatches RUNS_FILTER_CLOSE", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderBar({ dispatch });
    await flush();
    stdin.write("\u001b"); // Esc
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ type: "RUNS_FILTER_CLOSE" });
    cleanup();
  });

  it("Esc on non-empty draft dispatches RUNS_FILTER_CLEAR", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderBar({
      dispatch,
      filter: {
        open: true,
        draft: "abc",
        applied: { raw: "", terms: [] },
      },
    });
    await flush();
    stdin.write("\u001b");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ type: "RUNS_FILTER_CLEAR" });
    cleanup();
  });

  it("Backspace dispatches RUNS_FILTER_INPUT with trimmed draft", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderBar({
      dispatch,
      filter: {
        open: true,
        draft: "abc",
        applied: { raw: "", terms: [] },
      },
    });
    await flush();
    stdin.write("\u007f"); // DEL / backspace
    await flush();
    expect(dispatch).toHaveBeenCalledWith({
      type: "RUNS_FILTER_INPUT",
      value: "ab",
    });
    cleanup();
  });

  it("inputDisabled suppresses all dispatches", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderBar({ dispatch, inputDisabled: true });
    await flush();
    stdin.write("abc");
    await flush();
    stdin.write("\r");
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    cleanup();
  });
});

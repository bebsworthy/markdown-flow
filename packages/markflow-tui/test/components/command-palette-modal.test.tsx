// test/components/command-palette-modal.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { CommandPaletteModal } from "../../src/components/command-palette-modal.js";
import type { AppContext } from "../../src/components/types.js";
import type {
  CommandExecContext,
  CommandResult,
} from "../../src/palette/types.js";
import { initialAppState } from "../../src/state/reducer.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
function mkCtx(): AppContext {
  return {
    mode: { kind: "viewing", runId: "r1", focus: "graph" },
    overlay: { kind: "commandPalette", query: "" },
    approvalsPending: false,
    isFollowing: false,
    isWrapped: false,
    toggleState: {},
    pendingApprovalsCount: 1,
    runResumable: true,
    runActive: false,
  };
}

function mkExec(
  overrides: Partial<CommandExecContext> = {},
): CommandExecContext {
  return {
    state: {
      ...initialAppState,
      mode: { kind: "viewing", runId: "r1", focus: "graph" },
    },
    dispatch: vi.fn(),
    runsDir: null,
    runActive: false,
    runResumable: true,
    pendingApprovalsCount: 1,
    runWorkflow: vi.fn(
      async (): Promise<CommandResult> => ({ kind: "ok" }),
    ),
    resumeRun: vi.fn(
      async (): Promise<CommandResult> => ({ kind: "ok" }),
    ),
    cancelRun: vi.fn(
      async (): Promise<CommandResult> => ({ kind: "ok" }),
    ),
    openApproval: vi.fn((): CommandResult => ({ kind: "ok" })),
    rotateTheme: vi.fn(),
    quit: vi.fn(),
    ...overrides,
  };
}

interface Args {
  query?: string;
  ctx?: AppContext;
  exec?: CommandExecContext;
  onQueryChange?: (q: string) => void;
  onClose?: () => void;
}

function renderModal(args: Args = {}): ReturnType<typeof render> {
  return render(
    <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
      <CommandPaletteModal
        query={args.query ?? ""}
        ctx={args.ctx ?? mkCtx()}
        exec={args.exec ?? mkExec()}
        onQueryChange={args.onQueryChange ?? (() => {})}
        onClose={args.onClose ?? (() => {})}
        width={80}
        height={20}
      />
    </ThemeProvider>,
  );
}

describe("<CommandPaletteModal>", () => {
  it("renders COMMAND title and `:` prompt on initial load", () => {
    const out = renderModal();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("COMMAND");
    expect(frame).toContain(":");
  });

  it("lists commands derived from the catalogue", () => {
    const out = renderModal();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("run");
    expect(frame).toContain("resume");
    expect(frame).toContain("quit");
  });

  it("filtering: query `re` lists resume before rerun", () => {
    const out = renderModal({ query: "re" });
    const frame = stripAnsi(out.lastFrame() ?? "");
    const reIdx = frame.indexOf("resume");
    const rrIdx = frame.indexOf("rerun");
    expect(reIdx).toBeGreaterThan(-1);
    expect(rrIdx).toBeGreaterThan(-1);
    expect(reIdx).toBeLessThan(rrIdx);
  });

  it("Esc calls onClose", async () => {
    const onClose = vi.fn();
    const out = renderModal({ onClose });
    await flush();
    out.stdin.write("\x1b");
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("printable char calls onQueryChange with appended input", async () => {
    const onQueryChange = vi.fn();
    const out = renderModal({ onQueryChange, query: "" });
    await flush();
    out.stdin.write("r");
    await flush();
    expect(onQueryChange).toHaveBeenCalledWith("r");
  });

  it("Enter on :quit triggers exec.quit and dispatches OVERLAY_CLOSE", async () => {
    const exec = mkExec();
    const out = renderModal({ query: "quit", exec });
    await flush();
    out.stdin.write("\r");
    await flush(5);
    expect(exec.quit).toHaveBeenCalledTimes(1);
    expect(exec.dispatch).toHaveBeenCalledWith({ type: "OVERLAY_CLOSE" });
  });

  it("forward-Delete does not erase query (Ink 7 key.delete regression)", async () => {
    const onQueryChange = vi.fn();
    const out = renderModal({ onQueryChange, query: "abc" });
    await flush();
    out.stdin.write("\x1b[3~"); // forward-Delete
    await flush();
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("empty match shows 'no commands match'", () => {
    const out = renderModal({ query: "zzzzzz" });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("no commands match");
  });
});

// test/components/help-overlay.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { HelpOverlay } from "../../src/components/help-overlay.js";
import { GRAPH_KEYBAR } from "../../src/components/keybar-fixtures/graph.js";
import type { AppContext } from "../../src/components/types.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
function mkCtx(overrides: Partial<AppContext> = {}): AppContext {
  return {
    mode: { kind: "viewing", runId: "r1", focus: "graph" },
    overlay: { kind: "help" },
    approvalsPending: true,
    isFollowing: false,
    isWrapped: false,
    toggleState: {},
    pendingApprovalsCount: 1,
    runResumable: true,
    ...overrides,
  };
}

interface Args {
  ctx?: AppContext;
  onClose?: () => void;
  modeLabel?: string;
  focusLabel?: string;
}

function renderOverlay(args: Args = {}): ReturnType<typeof render> {
  return render(
    <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
      <HelpOverlay
        ctx={args.ctx ?? mkCtx()}
        bindings={GRAPH_KEYBAR}
        modeLabel={args.modeLabel ?? "RUN"}
        focusLabel={args.focusLabel ?? "graph"}
        onClose={args.onClose ?? (() => {})}
        width={90}
        height={24}
      />
    </ThemeProvider>,
  );
}

describe("<HelpOverlay>", () => {
  it("renders title with mode + focus", () => {
    const out = renderOverlay();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("HELP");
    expect(frame).toContain("mode: RUN");
    expect(frame).toContain("focus: graph");
  });

  it("shows approve annotation when pendingApprovalsCount > 0", () => {
    const out = renderOverlay();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Approve (1)");
    expect(frame).toContain("(1 available)");
  });

  it("omits approve entirely when pendingApprovalsCount = 0", () => {
    const out = renderOverlay({
      ctx: mkCtx({ pendingApprovalsCount: 0 }),
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toMatch(/Approve/);
  });

  it("Esc calls onClose", async () => {
    const onClose = vi.fn();
    const out = renderOverlay({ onClose });
    await flush();
    out.stdin.write("\x1b");
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("? closes overlay", async () => {
    const onClose = vi.fn();
    const out = renderOverlay({ onClose });
    await flush();
    out.stdin.write("?");
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("/ enters search mode and filters", async () => {
    const out = renderOverlay();
    await flush();
    out.stdin.write("/");
    await flush();
    out.stdin.write("a");
    out.stdin.write("p");
    out.stdin.write("p");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Approve");
    expect(frame).not.toContain("Cancel");
  });

  it("renders VIEW category section", () => {
    const out = renderOverlay();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("VIEW");
  });
});

// test/components/keybar-keys-hint.test.tsx
//
// P8-T2 §4.2 — Keybar keys-tier hint rendering.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { Keybar } from "../../src/components/keybar.js";
import { GRAPH_KEYBAR } from "../../src/components/keybar-fixtures/graph.js";
import type { AppContext } from "../../src/components/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const ctx: AppContext = {
  mode: { kind: "viewing", runId: "r1", focus: "graph", runsDir: "/tmp/runs" },
  overlay: null,
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: { pendingApprovalsCount: 0 },
  pendingApprovalsCount: 0,
  runResumable: false,
};

function renderAt(width: number): string {
  const theme = buildTheme({ color: false, unicode: true });
  const r = render(
    <ThemeProvider value={theme}>
      <Keybar bindings={GRAPH_KEYBAR} ctx={ctx} width={width} />
    </ThemeProvider>,
  );
  const frame = stripAnsi(r.lastFrame() ?? "");
  r.unmount();
  return frame;
}

describe("Keybar keys-tier hint (P8-T2 §4.2)", () => {
  it("width=52 (keys tier) shows '? for labels' on the right", () => {
    const frame = renderAt(52);
    expect(frame).toContain("? for labels");
  });

  it("width=120 (full tier) does NOT show '? for labels'", () => {
    const frame = renderAt(120);
    expect(frame).not.toContain("? for labels");
  });

  it("width=30 (extremely narrow) drops the hint — no '? for labels'", () => {
    const frame = renderAt(30);
    expect(frame).not.toContain("? for labels");
  });
});

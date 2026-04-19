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
import type { AppContext, Binding } from "../../src/components/types.js";

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

const alwaysTrue = (): boolean => true;
const noop = (): void => {};

// Bindings with enough short-tier width to force keys tier at moderate
// widths, while keys tier is compact enough to leave room for the hint.
// short ≈ 44 chars, keys = 9 chars. At width=30: short>30 → keys; 30-9-4=17≥12 → hint fits.
const hintBindings: ReadonlyArray<Binding> = [
  { keys: ["a"], label: "Alpha", shortLabel: "Do-Alpha", when: alwaysTrue, action: noop },
  { keys: ["b"], label: "Beta", shortLabel: "Do-Beta", when: alwaysTrue, action: noop },
  { keys: ["c"], label: "Gamma", shortLabel: "Do-Gamma", when: alwaysTrue, action: noop },
  { keys: ["d"], label: "Delta", shortLabel: "Do-Delta", when: alwaysTrue, action: noop },
  { keys: ["?"], label: "Help", when: alwaysTrue, action: noop },
];

function renderAt(width: number, bindings: ReadonlyArray<Binding> = GRAPH_KEYBAR): string {
  const theme = buildTheme({ color: false, unicode: true });
  const r = render(
    <ThemeProvider value={theme}>
      <Keybar bindings={bindings} ctx={ctx} width={width} />
    </ThemeProvider>,
  );
  const frame = stripAnsi(r.lastFrame() ?? "");
  r.unmount();
  return frame;
}

describe("Keybar keys-tier hint (P8-T2 §4.2)", () => {
  it("keys tier shows '? for labels' when slack is sufficient", () => {
    const frame = renderAt(30, hintBindings);
    expect(frame).toContain("? for labels");
  });

  it("full tier does NOT show '? for labels'", () => {
    const frame = renderAt(120);
    expect(frame).not.toContain("? for labels");
  });

  it("extremely narrow width drops the hint — no '? for labels'", () => {
    // At width=15 even keys tier has no room for the hint.
    const frame = renderAt(15, hintBindings);
    expect(frame).not.toContain("? for labels");
  });
});

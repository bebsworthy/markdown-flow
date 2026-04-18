// test/components/keybar.test.tsx
//
// Rule-coverage tests for the Keybar primitive. One or more `it` per rule
// R1..R10 from features.md §5.6. Uses ink-testing-library + <ThemeProvider>.
//
// Color assertions rely on the fact that Ink emits ANSI SGR codes in
// lastFrame() when the theme has colors. A mono-theme render has no SGR
// codes; a colored render does. See R4 / R10 below.

import React from "react";
import { describe, it, expect, vi } from "vitest";

// Module-level spy list — populated by the mocked `ink.Text` below each
// render. Declared before `vi.mock` because the factory is hoisted.
interface CapturedTextProps {
  readonly props: {
    readonly color?: string;
    readonly dimColor?: boolean;
    readonly bold?: boolean;
    readonly inverse?: boolean;
  };
  readonly text: string;
}
const __CAPTURED: CapturedTextProps[] = [];

function flattenChildrenToString(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenChildrenToString).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const kids = (node as { props?: { children?: unknown } }).props?.children;
    return flattenChildrenToString(kids);
  }
  return "";
}

vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink");
  const OriginalText = actual.Text;
  const TextSpy = (
    props: Parameters<typeof OriginalText>[0] & {
      readonly children?: React.ReactNode;
    },
  ): React.ReactElement => {
    __CAPTURED.push({
      props: {
        color: (props as { color?: string }).color,
        dimColor: (props as { dimColor?: boolean }).dimColor,
        bold: (props as { bold?: boolean }).bold,
        inverse: (props as { inverse?: boolean }).inverse,
      },
      text: flattenChildrenToString(
        (props as { children?: React.ReactNode }).children,
      ),
    });
    return React.createElement(OriginalText, props);
  };
  return { ...actual, Text: TextSpy };
});

import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { Keybar, type KeybarProps } from "../../src/components/keybar.js";
import type { Binding, AppContext } from "../../src/components/types.js";
import {
  workflowsBindings,
  browsingCtx,
  runGraphBindings,
  runGraphCtx,
  logFollowCtx,
  logPausedCtx,
  approvalBindings,
  approvalCtx,
  helpBindings,
  helpCtx,
} from "./fixtures.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderWithTheme(
  props: KeybarProps,
  opts: { color?: boolean; unicode?: boolean } = {},
): ReturnType<typeof render> {
  const theme = buildTheme({
    color: opts.color ?? true,
    unicode: opts.unicode ?? true,
  });
  return render(
    <ThemeProvider value={theme}>
      <Keybar {...props} />
    </ThemeProvider>,
  );
}

/**
 * Structural inspection: records the props passed to every `<Text>`
 * component during one render pass, then finds the first Text whose
 * children (flattened) include `needle`.
 *
 * Implemented via the vi.mock of "ink" at the top of the file — the
 * spy Text pushes into __CAPTURED each time it renders.
 */
function findTextNodeContaining(
  element: React.ReactElement,
  needle: string,
): CapturedTextProps | null {
  __CAPTURED.length = 0;
  render(element);
  for (const c of __CAPTURED) {
    if (c.text.includes(needle)) return c;
  }
  return null;
}

describe("Keybar — rule coverage (features.md §5.6)", () => {
  // R1 — always visible: ? help, q quit top-level; Esc back inside detail.
  it("R1: '?' help and 'q' quit are present at width 120, WORKFLOWS mode", () => {
    const out = renderWithTheme({
      bindings: workflowsBindings,
      ctx: browsingCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("? Help");
    expect(frame).toContain("q Quit");
  });

  it("R1: 'Esc' back is present inside an overlay (APPROVAL)", () => {
    const out = renderWithTheme({
      bindings: approvalBindings,
      ctx: approvalCtx,
      width: 120,
      modePill: "APPROVAL",
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Esc");
  });

  // R2 — category headers (muted bold), max two categories per line.
  it("R2: renders category header ('VIEW') in RUN-graph wide fixture", () => {
    const out = renderWithTheme({
      bindings: runGraphBindings,
      ctx: runGraphCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("VIEW");
  });

  it("R2: three-category fixture at width 120 drops to short tier (ambiguity 3 default)", () => {
    const alwaysTrue = () => true;
    const noop = () => {};
    // VIEW is class 1 (toggle); RUN & LOGS are class 0 (local). Stable
    // sort yields [a, c, b] by input order within class.
    const bindings: Binding[] = [
      { keys: ["a"], label: "A", category: "RUN", when: alwaysTrue, action: noop },
      { keys: ["b"], label: "B", category: "VIEW", when: alwaysTrue, action: noop },
      { keys: ["c"], label: "C", category: "LOGS", when: alwaysTrue, action: noop },
    ];
    const out = renderWithTheme({ bindings, ctx: browsingCtx, width: 120 });
    const frame = stripAnsi(out.lastFrame() ?? "");
    // Short tier produces keys-only. Groups separated by 3 spaces.
    // Order: locals (a, c) first, then VIEW (b).
    expect(frame).toBe("a   c   b");
  });

  // R3 — ordering: locals → toggles (VIEW) → globals.
  it("R3: ordering is locals → VIEW → globals for a RUN-mode fixture", () => {
    const out = renderWithTheme({
      bindings: runGraphBindings,
      ctx: runGraphCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    const idxStep = frame.indexOf("Step");
    const idxVIEW = frame.indexOf("VIEW");
    // Globals (?, q) per §15 RUN-graph wide are key-only — hidden labels.
    // Locate `q` as the final token of the line.
    const idxQ = frame.lastIndexOf("q");
    expect(idxStep).toBeGreaterThanOrEqual(0);
    expect(idxVIEW).toBeGreaterThan(idxStep);
    expect(idxQ).toBeGreaterThan(idxVIEW);
  });

  // R4 — destructive actions in red.
  //
  // ink-testing-library strips ANSI codes in lastFrame(), so the color
  // assertion is structural: we inspect the React element tree produced
  // by <Keybar> for a <Text color="red"> wrapping the destructive label.
  it("R4: destructive binding renders with theme.colors.danger color prop", () => {
    const element = findTextNodeContaining(
      <ThemeProvider value={buildTheme({ color: true, unicode: true })}>
        <Keybar bindings={runGraphBindings} ctx={runGraphCtx} width={120} />
      </ThemeProvider>,
      "X Cancel",
    );
    expect(element).not.toBeNull();
    // The danger role is "red" in the default color table.
    expect(element?.props.color).toBe("red");
  });

  it("R4: non-destructive binding does NOT use the danger color", () => {
    const element = findTextNodeContaining(
      <ThemeProvider value={buildTheme({ color: true, unicode: true })}>
        <Keybar bindings={workflowsBindings} ctx={browsingCtx} width={120} />
      </ThemeProvider>,
      "Run",
    );
    expect(element).not.toBeNull();
    expect(element?.props.color).not.toBe("red");
  });

  // R5 — hide, don't grey: bindings with when()===false are absent.
  it("R5: when(ctx) === false binding is absent from lastFrame (not dimmed)", () => {
    const alwaysTrue = () => true;
    const noop = () => {};
    const bindings: Binding[] = [
      { keys: ["a"], label: "Apple", when: alwaysTrue, action: noop },
      { keys: ["b"], label: "Banana", when: () => false, action: noop },
      { keys: ["c"], label: "Cherry", when: alwaysTrue, action: noop },
    ];
    const out = renderWithTheme({ bindings, ctx: browsingCtx, width: 120 });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Apple");
    expect(frame).not.toContain("Banana");
    expect(frame).toContain("Cherry");
  });

  // R6 — toggle labels flip based on state.
  it("R6: toggle label flips when ctx.toggleState.isFollowing flips", () => {
    const alwaysTrue = () => true;
    const noop = () => {};
    const follow: Binding = {
      keys: ["f"],
      label: "Follow",
      toggleLabel: (s) =>
        (s as { isFollowing?: boolean }).isFollowing ? "Unfollow" : "Follow",
      when: alwaysTrue,
      action: noop,
    };
    // Use a non-log ctx — plan §6.4 overrides caller bindings when ctx
    // is viewing.*/focus=log, which would swallow the single-binding
    // fixture this test exercises.
    const baseCtx: AppContext = { ...browsingCtx, isFollowing: true };
    const onCtx: AppContext = { ...baseCtx, toggleState: { isFollowing: true } };
    const offCtx: AppContext = {
      ...baseCtx,
      toggleState: { isFollowing: false },
    };

    const onFrame = stripAnsi(
      renderWithTheme({ bindings: [follow], ctx: onCtx, width: 120 }).lastFrame() ?? "",
    );
    const offFrame = stripAnsi(
      renderWithTheme({ bindings: [follow], ctx: offCtx, width: 120 }).lastFrame() ?? "",
    );
    expect(onFrame).toContain("Unfollow");
    expect(offFrame).toContain("Follow");
    expect(offFrame).not.toContain("Unfollow");
  });

  it("R6: toggle flip only applies in full tier (short/keys tier suppresses label)", () => {
    const alwaysTrue = () => true;
    const noop = () => {};
    const follow: Binding = {
      keys: ["f"],
      label: "Follow",
      toggleLabel: (s) =>
        (s as { isFollowing?: boolean }).isFollowing ? "Unfollow" : "Follow",
      when: alwaysTrue,
      action: noop,
    };
    // Non-log ctx — see sibling R6 test above for rationale.
    const onCtx: AppContext = {
      ...browsingCtx,
      isFollowing: true,
      toggleState: { isFollowing: true },
    };
    const shortFrame = stripAnsi(
      renderWithTheme({ bindings: [follow], ctx: onCtx, width: 80 }).lastFrame() ?? "",
    );
    expect(shortFrame).not.toContain("Unfollow");
    expect(shortFrame).not.toContain("Follow");
    expect(shortFrame).toContain("f");
  });

  // R7 — width tiers.
  it("R7: width 120 produces full labels", () => {
    const out = renderWithTheme({
      bindings: workflowsBindings,
      ctx: browsingCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Select");
    expect(frame).toContain("Open");
    expect(frame).toContain("Edit in $EDITOR");
  });

  it("R7: width 80 produces short-tier output (no labels where shortLabel absent)", () => {
    const out = renderWithTheme({
      bindings: workflowsBindings,
      ctx: browsingCtx,
      width: 80,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("Select");
    expect(frame).not.toContain("Open");
    expect(frame).toContain("\u2191\u2193"); // arrow glyph for Up/Down
  });

  it("R7: width 40 produces keys-only output", () => {
    const out = renderWithTheme({
      bindings: workflowsBindings,
      ctx: browsingCtx,
      width: 40,
      keysTierHint: "",
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("Select");
    expect(frame).not.toContain("Help");
    expect(frame).not.toContain("Quit");
    // `q` is filtered out in narrow tier; `?` remains.
    expect(frame).toContain("?");
    expect(frame).not.toContain("q");
  });

  it("R7: <60 tier appends '? for labels' right-aligned by default (P8-T2)", () => {
    const out = renderWithTheme({
      bindings: workflowsBindings,
      ctx: browsingCtx,
      width: 52,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("? for labels");
    // Should NOT include the legacy "press ? for labels" copy.
    expect(frame).not.toContain("press ? for labels");
  });

  // R8 — mode pill (reverse video).
  it("R8: modePill='APPROVAL' renders '[APPROVAL]' with <Text inverse>", () => {
    // Text content present
    const out = renderWithTheme({
      bindings: approvalBindings,
      ctx: approvalCtx,
      width: 120,
      modePill: "APPROVAL",
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("[APPROVAL]");
    // Structural: the [APPROVAL] text node is wrapped in inverse={true}.
    const node = findTextNodeContaining(
      <ThemeProvider value={buildTheme({ color: true, unicode: true })}>
        <Keybar
          bindings={approvalBindings}
          ctx={approvalCtx}
          width={120}
          modePill="APPROVAL"
        />
      </ThemeProvider>,
      "[APPROVAL]",
    );
    expect(node).not.toBeNull();
    expect(node?.props.inverse).toBe(true);
  });

  it("R8: no mode pill absent modePill prop", () => {
    const out = renderWithTheme({
      bindings: helpBindings,
      ctx: helpCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("[HELP]");
    expect(frame).not.toContain("[APPROVAL]");
  });

  // R9 — single keymap array (structural).
  it("R9: component accepts only (bindings, ctx, width, modePill?, prefix?, keysTierHint?)", () => {
    // Structural — if the Keybar type gains a required prop beyond these,
    // this call fails to compile. Kept as a smoke assertion.
    const props: KeybarProps = {
      bindings: workflowsBindings,
      ctx: browsingCtx,
      width: 120,
    };
    expect(() => renderWithTheme(props)).not.toThrow();
  });

  // R10 — theme-driven colors, no literals.
  //
  // Under the monochrome theme every ColorRole resolves to undefined;
  // the Keybar therefore passes `color={undefined}` on every Text. This
  // proves that the component is not hard-coding color names — the same
  // text comes out of either theme because color is driven by the theme
  // token table, not by component code.
  it("R10: monochrome theme renders with undefined color props on key/label/danger text nodes", () => {
    const element = (
      <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
        <Keybar bindings={runGraphBindings} ctx={runGraphCtx} width={120} />
      </ThemeProvider>
    );
    const xCancel = findTextNodeContaining(element, "X Cancel");
    expect(xCancel).not.toBeNull();
    expect(xCancel?.props.color).toBeUndefined();
    const runLabel = findTextNodeContaining(element, "Step");
    expect(runLabel).not.toBeNull();
    expect(runLabel?.props.color).toBeUndefined();
  });

  it("R10: colored theme resolves the danger role to 'red' via the theme token table", () => {
    const element = (
      <ThemeProvider value={buildTheme({ color: true, unicode: true })}>
        <Keybar bindings={runGraphBindings} ctx={runGraphCtx} width={120} />
      </ThemeProvider>
    );
    const xCancel = findTextNodeContaining(element, "X Cancel");
    expect(xCancel).not.toBeNull();
    expect(xCancel?.props.color).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// Plan §6.4: LOG-fixture auto-switch based on ctx.
// When ctx.mode === "viewing" + focus === "log", the Keybar overrides the
// caller's bindings with LOG_FOLLOWING_KEYBAR / LOG_PAUSED_KEYBAR based on
// ctx.isFollowing. Other focuses (detail / graph) render caller-supplied
// bindings verbatim.
// ---------------------------------------------------------------------------

describe("Keybar — LOG fixture auto-switch (plan §6.4)", () => {
  const runDetailCtx: AppContext = {
    mode: { kind: "viewing", runId: "r1", focus: "detail", runsDir: "/tmp/runs" },
    overlay: null,
    approvalsPending: false,
    isFollowing: false,
    isWrapped: false,
    toggleState: {},
  };

  it("focus === 'log' + isFollowing=true renders LOG_FOLLOWING_KEYBAR", () => {
    const out = renderWithTheme({
      // Pass a non-log fixture; the keybar should ignore it in favour of LOG_FOLLOWING.
      bindings: runGraphBindings,
      ctx: logFollowCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    // Follow fixture contents (per src/components/keybar-fixtures/log.ts).
    expect(frame).toContain("LOG \u00b7 following");
    expect(frame).toContain("w Wrap");
    expect(frame).toContain("t Timestamps");
    expect(frame).toContain("Esc Back to graph");
    // Paused-only keys must not appear.
    expect(frame).not.toContain("F Resume follow");
    expect(frame).not.toContain("Jump to top");
  });

  it("focus === 'log' + isFollowing=false renders LOG_PAUSED_KEYBAR", () => {
    const out = renderWithTheme({
      bindings: runGraphBindings,
      ctx: logPausedCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("LOG \u00b7 paused");
    expect(frame).toContain("F Resume follow");
    expect(frame).toContain("G Jump to head");
    expect(frame).toContain("g Jump to top");
    // Follow-only keys must not appear.
    expect(frame).not.toContain("t Timestamps");
  });

  it("focus === 'detail' does NOT trigger LOG override — caller bindings win", () => {
    const out = renderWithTheme({
      bindings: runGraphBindings,
      ctx: runDetailCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("LOG \u00b7 following");
    expect(frame).not.toContain("LOG \u00b7 paused");
    // runGraphBindings includes "X Cancel".
    expect(frame).toContain("X Cancel");
  });

  it("focus === 'graph' still renders the base viewing fixture (no override)", () => {
    const out = renderWithTheme({
      bindings: runGraphBindings,
      ctx: runGraphCtx,
      width: 120,
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("LOG \u00b7 following");
    expect(frame).not.toContain("LOG \u00b7 paused");
    expect(frame).toContain("X Cancel");
  });
});

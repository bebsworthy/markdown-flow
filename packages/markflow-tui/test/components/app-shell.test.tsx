// test/components/app-shell.test.tsx
//
// Ink render tests for <AppShell>. Uses a color=false theme so the byte-
// exact chrome comparisons are stable (no ANSI SGR codes to strip around
// color boundaries).
//
// Width note: `ink-testing-library`'s default Stdout reports
// `columns = 100`, which forces Ink to wrap any longer `<Text>` line.
// Since the AppShell renders 140-column frames as single-line chrome
// strings, the tests here bypass the default harness and call `ink.render`
// directly with a custom Stdout whose `columns` is set to the desired
// width. This is the same pattern the future E2E suite (P9-T1) will use
// via node-pty; we keep it local to these tests for now.

import React from "react";
import { describe, it, expect } from "vitest";
import { render as inkRender } from "ink";
import { Text } from "ink";
import { EventEmitter } from "node:events";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { AppShell } from "../../src/components/app-shell.js";
import type { AppState } from "../../src/state/types.js";

// ---------------------------------------------------------------------------
// Wide-terminal test harness
// ---------------------------------------------------------------------------

class WideStdout extends EventEmitter {
  public readonly columns: number;
  public readonly rows: number;
  private lastFrameValue: string | undefined;
  public readonly frames: string[] = [];

  constructor(cols: number, rows: number) {
    super();
    this.columns = cols;
    this.rows = rows;
  }

  write = (frame: string): void => {
    this.frames.push(frame);
    this.lastFrameValue = frame;
  };

  lastFrame(): string | undefined {
    return this.lastFrameValue;
  }
}

class WideStdin extends EventEmitter {
  public readonly isTTY = true;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): null {
    return null;
  }
}

function renderWide(tree: React.ReactElement, cols: number, rows: number): {
  lastFrame: () => string;
  unmount: () => void;
} {
  const stdout = new WideStdout(cols, rows);
  const stdin = new WideStdin();
  const stderr = new WideStdout(cols, rows);

  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return {
    lastFrame: () => stdout.lastFrame() ?? "",
    unmount: () => instance.unmount(),
  };
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderShell(props: {
  width?: number;
  height?: number;
  color?: boolean;
  unicode?: boolean;
  modeTabs?: React.ReactNode;
  top?: React.ReactNode;
  bottom?: React.ReactNode;
  keybar?: React.ReactNode;
  mode?: AppState["mode"];
  selectedRunId?: string | null;
}): { lastFrame: () => string; unmount: () => void } {
  const theme = buildTheme({
    color: props.color ?? false,
    unicode: props.unicode ?? true,
  });
  const width = props.width ?? 140;
  const height = props.height ?? 30;
  return renderWide(
    <ThemeProvider value={theme}>
      <AppShell
        width={width}
        height={height}
        modeTabs={props.modeTabs ?? <Text>WORKFLOWS  RUNS  RUN</Text>}
        top={props.top ?? <Text> </Text>}
        bottom={props.bottom ?? <Text> </Text>}
        {...(props.keybar !== undefined ? { keybar: props.keybar } : {})}
        {...(props.mode !== undefined ? { mode: props.mode } : {})}
        {...(props.selectedRunId !== undefined
          ? { selectedRunId: props.selectedRunId }
          : {})}
      />
    </ThemeProvider>,
    width,
    height,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AppShell", () => {
  it("renders the frame top edge with '\u2554' and '\u2557' at width=140 (Unicode)", () => {
    const { lastFrame, unmount } = renderShell({ width: 140, height: 10 });
    const out = stripAnsi(lastFrame());
    unmount();
    const firstLine = out.split("\n")[0] ?? "";
    expect(firstLine.startsWith("\u2554")).toBe(true);
    expect(firstLine.endsWith("\u2557")).toBe(true);
  });

  it("renders the frame top edge with '+' corners at width=140 under ASCII theme", () => {
    const { lastFrame, unmount } = renderShell({
      width: 140,
      height: 10,
      unicode: false,
    });
    const out = stripAnsi(lastFrame());
    unmount();
    const firstLine = out.split("\n")[0] ?? "";
    expect(firstLine.startsWith("+")).toBe(true);
    expect(firstLine.endsWith("+")).toBe(true);
  });

  it("renders the splitter row '\u2560...\u2563' at the half-way point for 30 rows", () => {
    const { lastFrame, unmount } = renderShell({ width: 140, height: 30 });
    const out = stripAnsi(lastFrame());
    unmount();
    const lines = out.split("\n");
    const splitterLines = lines.filter(
      (l) => l.startsWith("\u2560") && l.endsWith("\u2563"),
    );
    expect(splitterLines.length).toBe(1);
  });

  it("renders the bottom edge '\u255A...\u255D'", () => {
    const { lastFrame, unmount } = renderShell({ width: 140, height: 10 });
    const out = stripAnsi(lastFrame());
    unmount();
    const lines = out.split("\n").filter((l) => l.length > 0);
    const bottomIdx = lines.findIndex((l) => l.startsWith("\u255A"));
    expect(bottomIdx).toBeGreaterThan(0);
    const bottomLine = lines[bottomIdx] ?? "";
    expect(bottomLine.endsWith("\u255D")).toBe(true);
  });

  it("renders the modeTabs node inside the top frame edge text", () => {
    const { lastFrame, unmount } = renderShell({
      width: 140,
      height: 10,
      modeTabs: <Text>MODE-TABS-MARKER</Text>,
    });
    const out = stripAnsi(lastFrame());
    unmount();
    const firstLine = out.split("\n")[0] ?? "";
    expect(firstLine).toContain("MODE-TABS-MARKER");
  });

  it("renders the top slot content inside the top half", () => {
    const { lastFrame, unmount } = renderShell({
      width: 140,
      height: 12,
      top: <Text>TOP-SLOT-CONTENT</Text>,
      bottom: <Text>BOTTOM-SLOT-CONTENT</Text>,
    });
    const out = stripAnsi(lastFrame());
    unmount();
    const lines = out.split("\n");
    const splitterIdx = lines.findIndex((l) => l.startsWith("\u2560"));
    expect(splitterIdx).toBeGreaterThan(0);
    const topHalf = lines.slice(0, splitterIdx).join("\n");
    expect(topHalf).toContain("TOP-SLOT-CONTENT");
    expect(topHalf).not.toContain("BOTTOM-SLOT-CONTENT");
  });

  it("renders the bottom slot content inside the bottom half", () => {
    const { lastFrame, unmount } = renderShell({
      width: 140,
      height: 12,
      top: <Text>TOP-SLOT-CONTENT</Text>,
      bottom: <Text>BOTTOM-SLOT-CONTENT</Text>,
    });
    const out = stripAnsi(lastFrame());
    unmount();
    const lines = out.split("\n");
    const splitterIdx = lines.findIndex((l) => l.startsWith("\u2560"));
    const bottomIdx = lines.findIndex((l) => l.startsWith("\u255A"));
    expect(splitterIdx).toBeGreaterThan(0);
    expect(bottomIdx).toBeGreaterThan(splitterIdx);
    const bottomHalf = lines.slice(splitterIdx + 1, bottomIdx).join("\n");
    expect(bottomHalf).toContain("BOTTOM-SLOT-CONTENT");
    expect(bottomHalf).not.toContain("TOP-SLOT-CONTENT");
  });

  it("renders the keybar below the frame on its own row", () => {
    const { lastFrame, unmount } = renderShell({
      width: 140,
      height: 12,
      keybar: <Text>KEYBAR-MARKER</Text>,
    });
    const out = stripAnsi(lastFrame());
    unmount();
    const lines = out.split("\n").filter((l) => l.length > 0);
    const bottomIdx = lines.findIndex((l) => l.startsWith("\u255A"));
    expect(bottomIdx).toBeGreaterThan(0);
    const afterFrame = lines.slice(bottomIdx + 1).join("\n");
    expect(afterFrame).toContain("KEYBAR-MARKER");
  });

  it("byte-exact frame chrome at 140x8 matches the canonical Unicode shell (frame only — slots empty)", () => {
    const { lastFrame, unmount } = renderShell({
      width: 140,
      height: 8,
      modeTabs: <Text>WORKFLOWS  RUNS  RUN</Text>,
      top: <Text> </Text>,
      bottom: <Text> </Text>,
    });
    const out = stripAnsi(lastFrame());
    unmount();
    const lines = out.split("\n");

    // Top edge with mode-tabs baked in: `╔ WORKFLOWS  RUNS  RUN ═══…╗`.
    const topLine = lines[0] ?? "";
    expect(topLine).toMatch(
      /^\u2554 WORKFLOWS  RUNS  RUN \u2550+\u2557$/,
    );
    expect(topLine.length).toBe(140);

    // Splitter: `╠═══…╣`.
    const splitterIdx = lines.findIndex((l) => l.startsWith("\u2560"));
    expect(splitterIdx).toBeGreaterThan(0);
    const splitterLine = lines[splitterIdx] ?? "";
    expect(splitterLine).toMatch(/^\u2560\u2550+\u2563$/);
    expect(splitterLine.length).toBe(140);

    // Bottom edge: `╚═══…╝`.
    const bottomIdx = lines.findIndex((l) => l.startsWith("\u255A"));
    expect(bottomIdx).toBeGreaterThan(splitterIdx);
    const bottomLine = lines[bottomIdx] ?? "";
    expect(bottomLine).toMatch(/^\u255A\u2550+\u255D$/);
    expect(bottomLine.length).toBe(140);

    // Interior rows (top half + bottom half) each start with ║.
    for (let i = 1; i < splitterIdx; i++) {
      expect((lines[i] ?? "").startsWith("\u2551")).toBe(true);
    }
    for (let i = splitterIdx + 1; i < bottomIdx; i++) {
      expect((lines[i] ?? "").startsWith("\u2551")).toBe(true);
    }
  });

  // -------- P5-T3: title pill in different modes ------------------------
  //
  // The baked-in title text in the top edge is computed from `mode` +
  // `selectedRunId` via the pure `frameTitle` / `activeTabFromMode`
  // helpers, which are covered byte-exact in
  // `test/components/app-shell-layout.test.ts`. The visual overlay by
  // `<ModeTabs>` then paints over the same columns with inverse video —
  // so at the Ink render layer here we cannot observe the pill text
  // directly (any placeholder overlay we pass repaints the same cells).
  //
  // Instead, the integration-layer coverage for mode-driven title
  // changes lives in `test/app/mode-transitions.test.tsx`, where the
  // whole `<App>` is rendered end-to-end (including the real
  // `<ModeTabs>` subtree). The pill behaviour across
  // browsing.workflows / browsing.runs (hide-RUN) / viewing (RUN pill)
  // is asserted there.

  it("byte-exact ASCII frame chrome at 140x8 matches the fallback shell (no box drawing)", () => {
    const { lastFrame, unmount } = renderShell({
      width: 140,
      height: 8,
      unicode: false,
      modeTabs: <Text>WORKFLOWS  RUNS  RUN</Text>,
      top: <Text> </Text>,
      bottom: <Text> </Text>,
    });
    const out = stripAnsi(lastFrame());
    unmount();
    const lines = out.split("\n");

    const topLine = lines[0] ?? "";
    expect(topLine).toMatch(/^\+ WORKFLOWS  RUNS  RUN -+\+$/);
    expect(topLine.length).toBe(140);

    // Splitter: a row of `+-----+` that does NOT contain WORKFLOWS.
    const splitterIdx = lines.findIndex(
      (l, i) =>
        i > 0 &&
        l.startsWith("+") &&
        l.endsWith("+") &&
        !l.includes("WORKFLOWS") &&
        /^\+-+\+$/.test(l),
    );
    expect(splitterIdx).toBeGreaterThan(0);
    expect((lines[splitterIdx] ?? "").length).toBe(140);

    // Bottom edge: matches the same `+-----+` shape.
    const bottomIdx = lines.findIndex(
      (l, i) => i > splitterIdx && /^\+-+\+$/.test(l),
    );
    expect(bottomIdx).toBeGreaterThan(splitterIdx);
    expect((lines[bottomIdx] ?? "").length).toBe(140);

    // No Unicode box-drawing code points anywhere in the ASCII frame.
    for (const l of lines) {
      expect(l).not.toMatch(/[\u2500-\u257F]/);
    }
  });
});

// test/components/app-shell-narrow.test.tsx
//
// P8-T2 §4.2 — AppShell narrow branch render.

import React from "react";
import { describe, it, expect } from "vitest";
import { render as inkRender } from "ink";
import { Text } from "ink";
import { EventEmitter } from "node:events";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { AppShell } from "../../src/components/app-shell.js";

class SizedStdout extends EventEmitter {
  public readonly columns: number;
  public readonly rows: number;
  private last: string | undefined;
  constructor(cols: number, rows: number) {
    super();
    this.columns = cols;
    this.rows = rows;
  }
  write = (f: string): void => {
    this.last = f;
  };
  lastFrame = (): string | undefined => this.last;
}

class InertStdin extends EventEmitter {
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

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderNarrow(opts: {
  readonly width: number;
  readonly height: number;
  readonly breadcrumb: string;
  readonly unicode: boolean;
}): { readonly lastFrame: () => string; readonly unmount: () => void } {
  const stdout = new SizedStdout(opts.width, opts.height);
  const stderr = new SizedStdout(opts.width, opts.height);
  const stdin = new InertStdin();
  const theme = buildTheme({ color: false, unicode: opts.unicode });
  const instance = inkRender(
    <ThemeProvider value={theme}>
      <AppShell
        width={opts.width}
        height={opts.height}
        narrow={true}
        breadcrumb={opts.breadcrumb}
        singleSlot={<Text>body-content</Text>}
        modeTabs={<Text>WORKFLOWS  RUNS  RUN</Text>}
        top={<Text>old-top</Text>}
        bottom={<Text>old-bottom</Text>}
        keybar={null}
      />
    </ThemeProvider>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  return {
    lastFrame: () => stdout.lastFrame() ?? "",
    unmount: () => instance.unmount(),
  };
}

describe("AppShell narrow branch (P8-T2 §4.2)", () => {
  it("unicode: top edge is ╔ + breadcrumb + ═ fill + ╗, exact width=52", () => {
    const { lastFrame, unmount } = renderNarrow({
      width: 52,
      height: 22,
      breadcrumb: "Runs \u203A ijkl56 \u203A deploy-us",
      unicode: true,
    });
    const frame = stripAnsi(lastFrame());
    const firstLine = frame.split("\n")[0] ?? "";
    expect(firstLine.length).toBe(52);
    expect(firstLine.startsWith("\u2554")).toBe(true);
    expect(firstLine.endsWith("\u2557")).toBe(true);
    expect(firstLine).toContain("Runs \u203A ijkl56 \u203A deploy-us");
    unmount();
  });

  it("unicode: no splitter ╠═…═╣ row present", () => {
    const { lastFrame, unmount } = renderNarrow({
      width: 52,
      height: 22,
      breadcrumb: "Runs",
      unicode: true,
    });
    const frame = stripAnsi(lastFrame());
    const lines = frame.split("\n");
    const hasSplitter = lines.some(
      (l) => l.startsWith("\u2560") && l.endsWith("\u2563"),
    );
    expect(hasSplitter).toBe(false);
    unmount();
  });

  it("unicode: bottom edge is ╚ + ═ fill + ╝", () => {
    const { lastFrame, unmount } = renderNarrow({
      width: 52,
      height: 22,
      breadcrumb: "Runs",
      unicode: true,
    });
    const frame = stripAnsi(lastFrame());
    const lines = frame.split("\n").filter((l) => l.length > 0);
    const lastLine = lines[lines.length - 1] ?? "";
    expect(lastLine.startsWith("\u255A")).toBe(true);
    expect(lastLine.endsWith("\u255D")).toBe(true);
    unmount();
  });

  it("unicode: mode-tabs are NOT rendered (no WORKFLOWS pill)", () => {
    const { lastFrame, unmount } = renderNarrow({
      width: 52,
      height: 22,
      breadcrumb: "Runs",
      unicode: true,
    });
    const frame = stripAnsi(lastFrame());
    expect(frame).not.toContain("WORKFLOWS");
    expect(frame).not.toContain("[ RUNS ]");
    unmount();
  });

  it("ASCII: top edge is + / - / + and contains ASCII breadcrumb with '->'", () => {
    const { lastFrame, unmount } = renderNarrow({
      width: 52,
      height: 22,
      breadcrumb: "Runs -> ijkl56 -> deploy-us",
      unicode: false,
    });
    const frame = stripAnsi(lastFrame());
    const firstLine = frame.split("\n")[0] ?? "";
    expect(firstLine.startsWith("+")).toBe(true);
    expect(firstLine.endsWith("+")).toBe(true);
    expect(firstLine).toContain("Runs -> ijkl56 -> deploy-us");
    expect(frame).not.toContain("\u2554");
    expect(frame).not.toContain("\u255A");
    unmount();
  });
});

// test/app/command-palette.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../../src/app.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

async function flush(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

describe("app command palette wiring", () => {
  it(": opens the command palette overlay", async () => {
    const onQuit = vi.fn();
    const out = render(
      <App
        onQuit={onQuit}
        registryConfig={{ listPath: null, persist: false }}
      />,
    );
    await flush();
    out.stdin.write(":");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("COMMAND");
  });

  it(": is a no-op while another overlay is open", async () => {
    // Open help first, then press `:` — stays on help.
    const onQuit = vi.fn();
    const out = render(
      <App
        onQuit={onQuit}
        registryConfig={{ listPath: null, persist: false }}
      />,
    );
    await flush();
    out.stdin.write("?");
    await flush();
    out.stdin.write(":");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("HELP");
    expect(frame).not.toContain("COMMAND");
  });

  it("Esc closes the palette without side-effects", async () => {
    const onQuit = vi.fn();
    const out = render(
      <App
        onQuit={onQuit}
        registryConfig={{ listPath: null, persist: false }}
      />,
    );
    await flush();
    out.stdin.write(":");
    await flush();
    out.stdin.write("\x1b");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("COMMAND");
    expect(onQuit).not.toHaveBeenCalled();
  });

  it(":quit + Enter invokes onQuit", async () => {
    const onQuit = vi.fn();
    const out = render(
      <App
        onQuit={onQuit}
        registryConfig={{ listPath: null, persist: false }}
      />,
    );
    await flush();
    out.stdin.write(":");
    await flush();
    for (const ch of "quit") out.stdin.write(ch);
    await flush();
    out.stdin.write("\r");
    await flush(8);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

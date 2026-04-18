// test/app/help-overlay.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../../src/app.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
describe("app help overlay wiring", () => {
  it("? opens the help overlay", async () => {
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
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("HELP");
  });

  it("Esc closes the help overlay", async () => {
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
    out.stdin.write("\x1b");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("HELP");
  });

  it("? while in help overlay closes it", async () => {
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
    out.stdin.write("?");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("HELP");
  });
});

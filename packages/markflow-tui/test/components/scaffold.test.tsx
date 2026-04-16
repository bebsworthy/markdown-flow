import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../../src/app.js";

describe("scaffold App", () => {
  it("renders the scaffold text", () => {
    const { lastFrame } = render(<App onQuit={() => {}} />);
    expect(lastFrame()).toContain("markflow-tui · scaffold");
  });

  it("calls onQuit when q is pressed", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(<App onQuit={onQuit} />);
    // Allow Ink's useEffect (which attaches the 'readable' listener via raw mode)
    // to run before we write to stdin.
    await new Promise((resolve) => setImmediate(resolve));
    stdin.write("q");
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

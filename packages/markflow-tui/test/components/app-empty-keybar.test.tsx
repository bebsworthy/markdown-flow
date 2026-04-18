// test/components/app-empty-keybar.test.tsx
//
// Integration tests that assert the restricted 3-key keybar (`a Add  ?
// Help  q Quit`) renders beneath the app-shell when the registry is empty
// and the user is in browsing.workflows mode.
//
// Authoritative reference: mockups.md §2 line 92, plan P4-T3 §4.2.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../../src/app.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
describe("App — empty-state keybar", () => {
  it("renders the restricted keybar under the shell when the registry is empty", async () => {
    const { lastFrame } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
      />,
    );
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    // Labels come from WORKFLOWS_EMPTY_KEYBAR (plan §4.2 / mockups §2 L92).
    expect(frame).toContain("Add");
    expect(frame).toContain("Help");
    expect(frame).toContain("Quit");
    // Mode pill from mockups.md §2 line 92.
    expect(frame).toContain("WORKFLOWS");
  });

  it("still renders the empty-state panel alongside the keybar", async () => {
    const { lastFrame } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
      />,
    );
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("No workflows registered yet.");
  });
});

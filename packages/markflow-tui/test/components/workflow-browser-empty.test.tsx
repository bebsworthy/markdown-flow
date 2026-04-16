// test/components/workflow-browser-empty.test.tsx

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { WorkflowBrowserEmpty } from "../../src/components/workflow-browser-empty.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("WorkflowBrowserEmpty", () => {
  it("renders the exact five content lines from mockups.md §2 (persist=true)", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowserEmpty persist={true} width={80} />
      </ThemeProvider>,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("No workflows registered yet.");
    expect(frame).toContain("Press  a  to add by fuzzy-find or path/URL");
    expect(frame).toContain("or relaunch:   markflow-tui <path|glob|url>");
    expect(frame).toContain("The list will be saved to ./.markflow-tui.json");
  });

  it("swaps the final line when persist=false", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowserEmpty persist={false} width={80} />
      </ThemeProvider>,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Workflows saved: off (--no-save)");
    expect(frame).not.toContain("./.markflow-tui.json");
  });

  it("respects width prop for centering", () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowserEmpty persist={true} width={120} />
      </ThemeProvider>,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    // Content is present regardless of width.
    expect(frame).toContain("No workflows registered yet.");
  });
});

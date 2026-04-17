// test/components/add-modal-url-tab.test.tsx
//
// Pure rendering tests for `<AddModalUrlTab>`. The component owns no
// input — the parent modal routes every key and passes down display state
// only.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { AddModalUrlTab } from "../../src/components/add-modal-url-tab.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderTab(p: {
  url?: string;
  ingesting?: boolean;
  error?: string | null;
  width?: number;
} = {}): string {
  const { lastFrame } = render(
    <ThemeProvider>
      <AddModalUrlTab
        url={p.url ?? ""}
        ingesting={p.ingesting ?? false}
        error={p.error ?? null}
        width={p.width ?? 70}
      />
    </ThemeProvider>,
  );
  return stripAnsi(lastFrame() ?? "");
}

describe("AddModalUrlTab", () => {
  it("renders the prompt and empty input field", () => {
    const frame = renderTab({});
    expect(frame).toContain("Enter a path, glob, or URL");
    expect(frame).toContain("path:");
  });

  it("echoes the current URL text back to the user", () => {
    const frame = renderTab({ url: "https://example.com/flow.md" });
    expect(frame).toContain("https://example.com/flow.md");
  });

  it("does not show prefix hint for path-like input", () => {
    const frame = renderTab({ url: "/some/path.md" });
    expect(frame).not.toContain("expected http");
  });

  it("does not show prefix hint for URL input", () => {
    const frame = renderTab({ url: "http://example.com/flow.md" });
    expect(frame).not.toContain("expected http");
  });

  it("renders 'Fetching…' while ingesting=true", () => {
    const frame = renderTab({
      url: "https://example.com/flow.md",
      ingesting: true,
    });
    expect(frame).toContain("Fetching");
  });

  it("renders the error message when `error` is non-null", () => {
    const frame = renderTab({
      url: "https://example.com/flow.md",
      error: "fetch failed: 404",
    });
    expect(frame).toContain("fetch failed: 404");
  });
});

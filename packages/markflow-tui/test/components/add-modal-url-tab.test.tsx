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
  it("renders the prompt and empty URL field", () => {
    const frame = renderTab({});
    expect(frame).toContain("Paste a workflow URL");
    expect(frame).toContain("url:");
  });

  it("echoes the current URL text back to the user", () => {
    const frame = renderTab({ url: "https://example.com/flow.md" });
    expect(frame).toContain("https://example.com/flow.md");
  });

  it("shows the prefix hint when the URL lacks http:// or https://", () => {
    const frame = renderTab({ url: "ftp://nope" });
    expect(frame).toContain("expected http:// or https://");
  });

  it("hides the prefix hint once the URL starts with http://", () => {
    const frame = renderTab({ url: "http://example.com/flow.md" });
    expect(frame).not.toContain("expected http:// or https://");
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

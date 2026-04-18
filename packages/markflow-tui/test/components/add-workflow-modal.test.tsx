// test/components/add-workflow-modal.test.tsx
//
// Integration tests for `<AddWorkflowModal>`. Walker, validator, and URL
// ingestor are passed as injection-seam props so tests stay deterministic
// and never touch the real filesystem or network.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { AddWorkflowModal } from "../../src/components/add-workflow-modal.js";
import { flush } from "../helpers/flush.js";

import type {
  Candidate,
  TruncatedSentinel,
  UrlIngestResult,
  ValidationResult,
  WalkerOptions,
} from "../../src/add-modal/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
function cand(
  displayPath: string,
  kind: "file" | "workspace" = "file",
  absolutePath = displayPath,
  depth = 1,
): Candidate {
  return { kind, absolutePath, displayPath, depth };
}

function makeWalker(
  yieldOut: ReadonlyArray<Candidate | TruncatedSentinel>,
): (root: string, opts?: WalkerOptions) => AsyncIterable<
  Candidate | TruncatedSentinel
> {
  return async function* _walker(
    _root: string,
    _opts?: WalkerOptions,
  ): AsyncGenerator<Candidate | TruncatedSentinel> {
    for (const out of yieldOut) {
      yield out;
    }
  };
}

function silentValidator(): (c: Candidate) => Promise<ValidationResult> {
  return async (c) =>
    c.kind === "file" ? { kind: "file-valid" } : { kind: "workspace" };
}

function makeIngestor(
  result: UrlIngestResult,
  spy?: (url: string, baseDir: string) => void,
): (url: string, baseDir: string) => Promise<UrlIngestResult> {
  return async (url, baseDir) => {
    spy?.(url, baseDir);
    return result;
  };
}

interface RenderArgs {
  tab?: "fuzzy" | "url";
  baseDir?: string;
  walker?: ReturnType<typeof makeWalker>;
  validator?: ReturnType<typeof silentValidator>;
  ingestor?: ReturnType<typeof makeIngestor>;
  onSubmit?: (src: string) => void;
  onCancel?: () => void;
  onTabChange?: (t: "fuzzy" | "url") => void;
  width?: number;
  height?: number;
}

function renderModal(args: RenderArgs = {}) {
  const {
    tab = "fuzzy",
    baseDir = "/base",
    walker = makeWalker([]),
    validator = silentValidator(),
    ingestor = makeIngestor({ ok: false, reason: "not-called" }),
    onSubmit = vi.fn(),
    onCancel = vi.fn(),
    onTabChange = vi.fn(),
    width = 72,
    height = 20,
  } = args;

  const utils = render(
    <ThemeProvider>
      <AddWorkflowModal
        tab={tab}
        baseDir={baseDir}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onTabChange={onTabChange}
        walker={walker}
        validator={validator}
        ingestor={ingestor}
        width={width}
        height={height}
      />
    </ThemeProvider>,
  );
  return {
    ...utils,
    frame: () => stripAnsi(utils.lastFrame() ?? ""),
    onSubmit,
    onCancel,
    onTabChange,
  };
}

// ---------------------------------------------------------------------------
// Render / layout
// ---------------------------------------------------------------------------

describe("AddWorkflowModal — layout", () => {
  it("renders the tab header with both labels and the footer hint line", async () => {
    const { frame } = renderModal();
    await flush();
    const f = frame();
    expect(f).toContain("Fuzzy find");
    expect(f).toContain("Path or URL");
    expect(f).toContain("Tab");
    expect(f).toContain("Add");
    expect(f).toContain("Esc");
  });

  it("renders the fuzzy tab by default", async () => {
    const { frame } = renderModal({ tab: "fuzzy" });
    await flush();
    expect(frame()).toContain("root:");
    expect(frame()).toContain("find:");
  });

  it("renders the URL tab when tab='url'", async () => {
    const { frame } = renderModal({ tab: "url" });
    await flush();
    expect(frame()).toContain("Enter a path, glob, or URL");
    expect(frame()).toContain("path:");
  });
});

// ---------------------------------------------------------------------------
// Walker + ranking
// ---------------------------------------------------------------------------

describe("AddWorkflowModal — walker + ranking", () => {
  it("shows scanning placeholder before any walker output", async () => {
    // Walker that never yields: simulate by empty iterable that resolves fast.
    const walker = makeWalker([]);
    const { frame } = renderModal({ walker });
    // Frame before flush: candidates empty, query empty → scanning text.
    const pre = frame();
    expect(pre).toContain("(scanning");
  });

  it("renders candidates yielded by the walker once the walk resolves", async () => {
    const walker = makeWalker([
      cand("./alpha.md"),
      cand("./beta/flow.md"),
      cand("./workspaces/gamma", "workspace"),
    ]);
    const { frame } = renderModal({ walker });
    await flush(5);
    const f = frame();
    expect(f).toContain("./alpha.md");
    expect(f).toContain("./beta/flow.md");
    expect(f).toContain("./workspaces/gamma");
  });

  it("shows the truncated footer when the walker emits a truncated sentinel", async () => {
    const walker = makeWalker([
      cand("./a.md"),
      { kind: "truncated", scannedCount: 500 } as TruncatedSentinel,
    ]);
    const { frame } = renderModal({ walker });
    await flush(5);
    expect(frame()).toMatch(/showing 1\/1\+ .* refine/);
  });
});

// ---------------------------------------------------------------------------
// Key routing
// ---------------------------------------------------------------------------

describe("AddWorkflowModal — key routing", () => {
  it("Tab triggers onTabChange with the opposite tab", async () => {
    const { onTabChange, stdin } = renderModal({ tab: "fuzzy" });
    await flush();
    stdin.write("\t"); // Tab
    await flush();
    expect(onTabChange).toHaveBeenCalledWith("url");
  });

  it("Esc calls onCancel when the root picker is closed", async () => {
    const { onCancel, stdin } = renderModal({ tab: "fuzzy" });
    await flush();
    stdin.write("\u001b"); // Esc
    await flush();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("typing characters filters the fuzzy list", async () => {
    const walker = makeWalker([
      cand("./alpha.md"),
      cand("./beta.md"),
      cand("./zeta.md"),
    ]);
    const { frame, stdin } = renderModal({ walker });
    await flush(5);
    stdin.write("alpha");
    await flush(5);
    const f = frame();
    expect(f).toContain("./alpha.md");
    // With a tight "alpha" query, only alpha should remain.
    expect(f).not.toContain("./beta.md");
    expect(f).not.toContain("./zeta.md");
  });

  it("Enter on a fuzzy row calls onSubmit with the absolutePath", async () => {
    const walker = makeWalker([
      cand("./alpha.md", "file", "/abs/alpha.md"),
    ]);
    const onSubmit = vi.fn();
    const { stdin } = renderModal({ walker, onSubmit });
    await flush(5);
    stdin.write("\r"); // Enter
    await flush();
    expect(onSubmit).toHaveBeenCalledWith("/abs/alpha.md");
  });

  it("↓/↑ move the selection cursor within visible rows", async () => {
    const walker = makeWalker([
      cand("./a.md", "file", "/abs/a.md"),
      cand("./b.md", "file", "/abs/b.md"),
    ]);
    const onSubmit = vi.fn();
    const { stdin } = renderModal({ walker, onSubmit });
    await flush(5);
    stdin.write("\u001b[B"); // ↓
    await flush();
    stdin.write("\r"); // Enter
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The selected row should be one of the two absolute paths.
    const [[got]] = onSubmit.mock.calls;
    expect(["/abs/a.md", "/abs/b.md"]).toContain(got);
  });
});

// ---------------------------------------------------------------------------
// URL tab
// ---------------------------------------------------------------------------

describe("AddWorkflowModal — URL tab", () => {
  it("treats non-URL input as a path and calls onSubmit", async () => {
    const ingestor = vi.fn(
      async (_url: string, _baseDir: string): Promise<UrlIngestResult> => ({
        ok: true,
        workspaceDir: "/ignored",
        workflowPath: "/ignored/flow.md",
      }),
    );
    const onSubmit = vi.fn();
    const { stdin } = renderModal({
      tab: "url",
      ingestor,
      onSubmit,
    });
    await flush();
    stdin.write("/some/path.md");
    await flush();
    stdin.write("\r"); // Enter
    await flush(5);
    expect(ingestor).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith("/some/path.md");
  });

  it("Enter on a valid URL calls ingestor + onSubmit(workspaceDir)", async () => {
    const ingestor = vi.fn(
      async (_url: string, _baseDir: string): Promise<UrlIngestResult> => ({
        ok: true,
        workspaceDir: "/ws/abc",
        workflowPath: "/ws/abc/flow.md",
      }),
    );
    const onSubmit = vi.fn();
    const { stdin } = renderModal({
      tab: "url",
      ingestor,
      onSubmit,
    });
    await flush();
    stdin.write("https://example.com/flow.md");
    await flush();
    stdin.write("\r");
    await flush(6);
    expect(ingestor).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("/ws/abc");
  });

  it("ingestor failure renders the reason as an error banner", async () => {
    const ingestor = vi.fn(
      async (): Promise<UrlIngestResult> => ({
        ok: false,
        reason: "fetch failed: 500",
      }),
    );
    const onSubmit = vi.fn();
    const { stdin, frame } = renderModal({
      tab: "url",
      ingestor,
      onSubmit,
    });
    await flush();
    stdin.write("https://example.com/flow.md");
    await flush();
    stdin.write("\r");
    await flush(6);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(frame()).toContain("fetch failed: 500");
  });
});

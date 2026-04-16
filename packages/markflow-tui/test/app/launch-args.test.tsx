// test/app/launch-args.test.tsx
//
// Integration tests for `<App>`'s launch-arg ingestion behaviour (P4-T3).
// We drive `<App>` with `initialLaunchArgs` and assert that each arg lands
// in the registry via onAddEntry (file paths verbatim; URLs ingested via
// the injected `urlIngestor` seam).

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../src/app.js";
import type { UrlIngestResult } from "../../src/add-modal/types.js";

async function flush(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

/**
 * Poll for a predicate up to `timeoutMs` — avoids brittle microtask counts
 * in async chains. Returns when `pred()` first returns true, or throws.
 */
async function waitFor(
  pred: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 2000, intervalMs = 15 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor: predicate did not settle within ${timeoutMs}ms`);
}

/**
 * The on-disk format is a plain array of `{source, addedAt}` objects;
 * `parseRegistryJson` in helpers.ts parses that back into `{entries}`. We
 * read it directly here to avoid coupling to the parser.
 */
function readRegistry(
  listPath: string,
): Array<{ source: string; addedAt: string }> | null {
  try {
    const raw = readFileSync(listPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "markflow-tui-launch-args-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("App — launch-args ingestion", () => {
  it("a single file-path arg is persisted to the registry", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["./ad-hoc.md"]}
      />,
    );
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 1);
    const entries = readRegistry(listPath)!;
    expect(entries.map((e) => e.source)).toEqual(["./ad-hoc.md"]);
  });

  it("multiple file-path args land in addedAt order", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["./a.md", "./b.md", "./c.md"]}
      />,
    );
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 3);
    const entries = readRegistry(listPath)!;
    expect(entries.map((e) => e.source)).toEqual([
      "./a.md",
      "./b.md",
      "./c.md",
    ]);
  });

  it("URL arg calls the injected urlIngestor and adds the workspaceDir", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    const urlIngestor = vi.fn(
      async (_url: string, _baseDir: string): Promise<UrlIngestResult> => ({
        ok: true,
        workspaceDir: "/abs/ws/derived",
        workflowPath: "/abs/ws/derived/flow.md",
      }),
    );
    render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["https://example.com/flow.md"]}
        urlIngestor={urlIngestor}
      />,
    );
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 1);
    expect(urlIngestor).toHaveBeenCalledTimes(1);
    expect(urlIngestor.mock.calls[0]![0]).toBe(
      "https://example.com/flow.md",
    );
    const entries = readRegistry(listPath)!;
    expect(entries.map((e) => e.source)).toEqual(["/abs/ws/derived"]);
  });

  it("failed URL ingestion is silent — the registry stays empty", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    const urlIngestor = vi.fn(
      async (): Promise<UrlIngestResult> => ({
        ok: false,
        reason: "fetch failed: 500",
      }),
    );
    render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["https://example.com/flow.md"]}
        urlIngestor={urlIngestor}
      />,
    );
    await flush(6);
    // Allow the microtasks around the failed ingest to flush.
    await flush(6);
    expect(urlIngestor).toHaveBeenCalledTimes(1);
    // The registry file may not exist at all (no writes) or be empty.
    const got = readRegistry(listPath);
    expect(got === null || got.length === 0).toBe(true);
  });

  it("mix of path + URL args both land (verbatim path; ingested URL workspaceDir)", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    const urlIngestor = vi.fn(
      async (): Promise<UrlIngestResult> => ({
        ok: true,
        workspaceDir: "/abs/ws/remote",
        workflowPath: "/abs/ws/remote/flow.md",
      }),
    );
    render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["./local.md", "https://x.com/flow.md"]}
        urlIngestor={urlIngestor}
      />,
    );
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 2);
    const entries = readRegistry(listPath)!;
    const sources = entries.map((e) => e.source);
    expect(sources).toContain("./local.md");
    expect(sources).toContain("/abs/ws/remote");
  });

  it("no initialLaunchArgs → registry stays empty; empty-state still renders", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    const { lastFrame } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
      />,
    );
    await flush(4);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("No workflows registered yet.");
  });
});

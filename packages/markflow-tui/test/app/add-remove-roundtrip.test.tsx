// test/app/add-remove-roundtrip.test.tsx
//
// End-to-end integration: add via launch-args, then exercise `d` in the
// browser to remove the entry and verify that the registry file on disk
// reflects the change.

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../src/app.js";

async function waitFor(
  pred: () => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 2000, intervalMs = 15 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor: predicate did not settle within ${timeoutMs}ms`);
}

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

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "markflow-tui-roundtrip-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("App — add/remove roundtrip", () => {
  it("launch-arg ingestion persists across remount", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");

    const first = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["./alpha.md"]}
      />,
    );
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 1);
    first.unmount();

    // Remount a fresh <App> against the same path → initial registry
    // state should be the persisted entry.
    const { lastFrame } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
      />,
    );
    // Wait for the async loadRegistry + resolver to settle.
    await new Promise<void>((r) => setTimeout(r, 80));
    const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("./alpha.md");
    // File still has exactly one entry.
    const got = readRegistry(listPath)!;
    expect(got.map((e) => e.source)).toEqual(["./alpha.md"]);
  });

  it("pressing 'd' in the browser removes the selected entry from the registry file", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    const { stdin } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["./alpha.md", "./beta.md"]}
      />,
    );
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 2);

    // The browser's selectedIndex defaults to 0 (first row). Default sort
    // is by addedAt desc, so the first row is the most-recently-added —
    // "./beta.md". Pressing `d` should remove it.
    stdin.write("d");
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 1);

    const remaining = readRegistry(listPath)!;
    expect(remaining.map((e) => e.source)).toEqual(["./alpha.md"]);
  });

  it("removing the only entry empties the registry file", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    const { stdin } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: true }}
        initialLaunchArgs={["./solo.md"]}
      />,
    );
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 1);

    stdin.write("d");
    await waitFor(() => (readRegistry(listPath)?.length ?? 0) === 0);

    const remaining = readRegistry(listPath)!;
    expect(remaining).toEqual([]);
  });

  it("persist=false never writes a registry file on the disk", async () => {
    const listPath = join(sandbox, ".markflow-tui.json");
    render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath, persist: false }}
        initialLaunchArgs={["./a.md", "./b.md"]}
      />,
    );
    // Give the launch-arg loop a chance to run. We then assert the file
    // never materialised — persist=false short-circuits saveRegistry.
    await new Promise<void>((r) => setTimeout(r, 120));
    expect(readRegistry(listPath)).toBeNull();
  });
});

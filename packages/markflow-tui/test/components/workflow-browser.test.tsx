// test/components/workflow-browser.test.tsx

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { WorkflowBrowser } from "../../src/components/workflow-browser.js";
import type {
  RegistryConfig,
  RegistryEntry,
  RegistryState,
} from "../../src/registry/types.js";
import type { ResolvedEntry } from "../../src/browser/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function makeResolved(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    entry: { source: "./x.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./x.md",
    sourceKind: "file",
    absolutePath: "/abs/x.md",
    status: "valid",
    title: "demo",
    workflow: {
      name: "demo",
      description: "demo description",
      inputs: [],
      graph: { nodes: new Map(), edges: [] },
      steps: new Map(),
      sourceFile: "/abs/x.md",
    },
    diagnostics: [],
    lastRun: null,
    errorReason: null,
    ...overrides,
  };
}

function makeEntries(sources: string[]): RegistryEntry[] {
  return sources.map((s, i) => ({
    source: s,
    addedAt: new Date(2026, 3, 1 + i).toISOString(),
  }));
}

function makeRegistry(entries: RegistryEntry[]): RegistryState {
  return { entries };
}

const config: RegistryConfig = {
  path: "/home/me/.markflow-tui.json",
  persist: true,
};

const noSaveConfig: RegistryConfig = {
  path: null,
  persist: false,
};

function staticResolver(resolved: ReadonlyArray<ResolvedEntry>) {
  return (): Promise<ReadonlyArray<ResolvedEntry>> =>
    Promise.resolve(resolved);
}

async function flush(): Promise<void> {
  // Allow microtasks (resolver promise + effects) to settle.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("WorkflowBrowser", () => {
  it("renders empty-state when registryState.entries is empty", () => {
    const dispatch = vi.fn();
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry([])}
          registryConfig={config}
          selectedWorkflowId={null}
          dispatch={dispatch}
          width={80}
          height={15}
          resolver={staticResolver([])}
        />
      </ThemeProvider>,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("No workflows registered yet.");
  });

  it("swaps the empty-state last line when persist=false", () => {
    const dispatch = vi.fn();
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry([])}
          registryConfig={noSaveConfig}
          selectedWorkflowId={null}
          dispatch={dispatch}
          width={80}
          height={15}
          resolver={staticResolver([])}
        />
      </ThemeProvider>,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Workflows saved: off (--no-save)");
  });

  it("does NOT render empty-state when registryState.entries has items", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={null}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toContain("No workflows registered yet.");
  });

  it("renders both list and preview panes after resolution completes", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[0]!.source}
          dispatch={dispatch}
          width={140}
          height={20}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("./a.md");
    expect(frame).toContain("# demo");
  });

  it("'↓' moves the cursor and dispatches SELECT_WORKFLOW", async () => {
    const entries = makeEntries(["./a.md", "./b.md"]);
    // sortByAddedAt sorts desc by addedAt; b comes first.
    const resolved = [
      makeResolved({ entry: entries[1]!, id: entries[1]!.source }),
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[1]!.source}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    stdin.write("\x1b[B"); // down arrow
    await flush();
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT_WORKFLOW",
      workflowId: entries[0]!.source,
    });
  });

  it("'↑' does not underflow past index 0", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[0]!.source}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    stdin.write("\x1b[A"); // up arrow
    await flush();
    // Dispatch should still fire, but with the same workflowId (index 0).
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT_WORKFLOW",
      workflowId: entries[0]!.source,
    });
  });

  it("'Enter' dispatches SELECT_WORKFLOW with current row id", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[0]!.source}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    stdin.write("\r");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT_WORKFLOW",
      workflowId: entries[0]!.source,
    });
  });

  it("'a' dispatches OVERLAY_OPEN with addWorkflow overlay", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[0]!.source}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    dispatch.mockClear();
    stdin.write("a");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({
      type: "OVERLAY_OPEN",
      overlay: { kind: "addWorkflow", tab: "fuzzy" },
    });
  });

  it("'a' opens the add overlay even when the registry is empty", async () => {
    const dispatch = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry([])}
          registryConfig={config}
          selectedWorkflowId={null}
          dispatch={dispatch}
          width={80}
          height={15}
          resolver={staticResolver([])}
        />
      </ThemeProvider>,
    );
    await flush();
    dispatch.mockClear();
    stdin.write("a");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({
      type: "OVERLAY_OPEN",
      overlay: { kind: "addWorkflow", tab: "fuzzy" },
    });
  });

  it("'d' calls onRemoveEntry with the selected row's source", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const onRemoveEntry = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[0]!.source}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
          onRemoveEntry={onRemoveEntry}
        />
      </ThemeProvider>,
    );
    await flush();
    stdin.write("d");
    await flush();
    expect(onRemoveEntry).toHaveBeenCalledWith("./a.md");
  });

  it("'d' is a no-op when onRemoveEntry is not provided", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[0]!.source}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    dispatch.mockClear();
    expect(() => stdin.write("d")).not.toThrow();
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("'r' is captured but dispatches nothing (P5 stub)", async () => {
    const entries = makeEntries(["./a.md"]);
    const resolved = [
      makeResolved({ entry: entries[0]!, id: entries[0]!.source }),
    ];
    const dispatch = vi.fn();
    const { stdin } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={entries[0]!.source}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={staticResolver(resolved)}
        />
      </ThemeProvider>,
    );
    await flush();
    dispatch.mockClear();
    stdin.write("r");
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("uses the injected resolver prop in tests (no fs I/O)", async () => {
    // This test asserts the resolver prop path is exercised — if we needed fs
    // I/O with no files present, the browser would render error flags instead.
    const entries = makeEntries(["./missing.md", "./absent.md"]);
    const fakeResolved = [
      makeResolved({
        entry: entries[1]!,
        id: entries[1]!.source,
        status: "missing",
        workflow: null,
        errorReason: "404",
      }),
      makeResolved({
        entry: entries[0]!,
        id: entries[0]!.source,
      }),
    ];
    const resolver = vi.fn().mockResolvedValue(fakeResolved);
    const dispatch = vi.fn();
    const { lastFrame } = render(
      <ThemeProvider>
        <WorkflowBrowser
          registryState={makeRegistry(entries)}
          registryConfig={config}
          selectedWorkflowId={null}
          dispatch={dispatch}
          width={100}
          height={15}
          resolver={resolver}
        />
      </ThemeProvider>,
    );
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("./missing.md");
    expect(frame).toContain("./absent.md");
  });
});

// test/app/run-entry.test.tsx
//
// App-level integration tests for the run-entry flow (P9-T1). Exercises
// the two paths that are reachable via documented test seams:
//
//   1. `:run <workflow>` palette command — uses `runRegistryLookup` to
//      supply resolved entries and `runWorkflow` to observe the bridge.
//   2. Runs-table `r` key — navigates to the runs pane via `F2` / "2",
//      seeds rows via `initialRunRows`, and asserts hide-don't-grey
//      semantics on active rows.
//
// The browser-`r` path is covered by the component-level test in
// `components/workflow-browser.test.tsx` (prop-level `onStartRun` seam).
// Full on-disk integration (writing a real .md file + waiting for the
// resolver) is out of scope here.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { WorkflowDefinition, RunInfo } from "markflow";
import { App } from "../../src/app.js";
import type { ResolvedEntry } from "../../src/browser/types.js";
import type { RunsTableRow } from "../../src/runs/types.js";
import type { RunWorkflowResult } from "../../src/runStart/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const ENTER = "\r";
const ESC = "\x1b";

async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

async function type(
  stdin: { write: (chunk: string) => unknown },
  text: string,
): Promise<void> {
  for (const ch of text) {
    stdin.write(ch);
    await flush(1);
  }
}

function makeWorkflow(
  name: string,
  inputs: WorkflowDefinition["inputs"] = [],
): WorkflowDefinition {
  return {
    name,
    description: "",
    inputs,
    graph: { nodes: new Map(), edges: [] },
    steps: new Map(),
    sourceFile: `/abs/${name}.md`,
  };
}

function makeResolved(
  workflow: WorkflowDefinition,
  absolutePath: string,
): ResolvedEntry {
  return {
    entry: { source: absolutePath, addedAt: "2026-01-01T00:00:00Z" },
    id: absolutePath,
    sourceKind: "file",
    absolutePath,
    status: "valid",
    title: workflow.name,
    workflow,
    diagnostics: [],
    lastRun: null,
    errorReason: null,
  };
}

function makeRunRow(overrides: Partial<RunInfo> & Pick<RunInfo, "id">): RunsTableRow {
  const info: RunInfo = {
    id: overrides.id,
    workflowName: overrides.workflowName ?? "deploy",
    sourceFile: overrides.sourceFile ?? "/abs/deploy.md",
    status: overrides.status ?? "complete",
    startedAt: overrides.startedAt ?? "2026-01-01T00:00:00Z",
    steps: overrides.steps ?? [],
  };
  return {
    id: info.id,
    idShort: info.id.slice(0, 6),
    workflow: info.workflowName,
    statusLabel: info.status,
    statusCell: {
      glyph: "✓",
      label: info.status,
      role: "complete",
      glyphKey: "ok",
    },
    step: "",
    elapsed: "",
    elapsedMs: 0,
    started: info.startedAt,
    note: "",
    info,
  };
}

describe("App — run-entry flow (P9-T1)", () => {
  it(":run <name> with no inputs calls runWorkflow and transitions to viewing", async () => {
    const wf = makeWorkflow("deploy", []);
    const resolved = [makeResolved(wf, "/abs/deploy.md")];
    const runWorkflow = vi.fn(
      async (args: {
        readonly onRunStart?: (runId: string) => void;
      }): Promise<RunWorkflowResult> => {
        args.onRunStart?.("r-ok");
        return { kind: "ok", runId: "r-ok" };
      },
    );
    const out = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        runsDir="/tmp/runs"
        runRegistryLookup={resolved}
        runWorkflow={runWorkflow}
      />,
    );
    await flush();
    // Open the palette, type `run deploy`, submit.
    out.stdin.write(":");
    await flush();
    await type(out.stdin, "run deploy");
    await flush();
    out.stdin.write(ENTER);
    await flush(12);

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    const call = runWorkflow.mock.calls[0]![0] as {
      readonly sourceFile: string;
      readonly inputs: Readonly<Record<string, string>>;
    };
    expect(call.sourceFile).toBe("/abs/deploy.md");
    expect(call.inputs).toEqual({});
  });

  it(":run <name> with required inputs opens the run-input modal", async () => {
    const wf = makeWorkflow("deploy", [
      { name: "env", required: true, description: "target env" },
    ]);
    const resolved = [makeResolved(wf, "/abs/deploy.md")];
    const runWorkflow = vi.fn(
      async (): Promise<RunWorkflowResult> => ({ kind: "ok", runId: "x" }),
    );
    const out = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        runsDir="/tmp/runs"
        runRegistryLookup={resolved}
        runWorkflow={runWorkflow}
      />,
    );
    await flush();
    out.stdin.write(":");
    await flush();
    await type(out.stdin, "run deploy");
    await flush();
    out.stdin.write(ENTER);
    await flush(12);

    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("RUN");
    expect(frame).toContain("deploy");
    expect(frame).toContain("* env");
    // Bridge must NOT have been called yet — modal is up.
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it(":run <prefix> ambiguous returns usage (no bridge call, no modal)", async () => {
    const a = makeWorkflow("deploy-a", []);
    const b = makeWorkflow("deploy-b", []);
    const resolved = [
      makeResolved(a, "/abs/a.md"),
      makeResolved(b, "/abs/b.md"),
    ];
    const runWorkflow = vi.fn(
      async (): Promise<RunWorkflowResult> => ({ kind: "ok", runId: "x" }),
    );
    const out = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        runsDir="/tmp/runs"
        runRegistryLookup={resolved}
        runWorkflow={runWorkflow}
      />,
    );
    await flush();
    out.stdin.write(":");
    await flush();
    await type(out.stdin, "run deploy");
    await flush();
    out.stdin.write(ENTER);
    await flush(12);

    expect(runWorkflow).not.toHaveBeenCalled();
    const frame = stripAnsi(out.lastFrame() ?? "");
    // Palette should still be open with an error/usage banner — modal
    // did not mount.
    expect(frame).not.toContain("* env");
  });

  it("Esc on run-input modal closes it without invoking the bridge", async () => {
    const wf = makeWorkflow("deploy", [
      { name: "env", required: true, description: "" },
    ]);
    const resolved = [makeResolved(wf, "/abs/deploy.md")];
    const runWorkflow = vi.fn(
      async (): Promise<RunWorkflowResult> => ({ kind: "ok", runId: "x" }),
    );
    const out = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        runsDir="/tmp/runs"
        runRegistryLookup={resolved}
        runWorkflow={runWorkflow}
      />,
    );
    await flush();
    out.stdin.write(":");
    await flush();
    await type(out.stdin, "run deploy");
    await flush();
    out.stdin.write(ENTER);
    await flush(12);
    // Modal open — press Esc.
    out.stdin.write(ESC);
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("* env");
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("RunLockedError surfaces in-modal; modal stays open", async () => {
    const wf = makeWorkflow("deploy", [
      { name: "env", required: true, description: "", default: "prod" },
    ]);
    const resolved = [makeResolved(wf, "/abs/deploy.md")];
    const runWorkflow = vi.fn(
      async (): Promise<RunWorkflowResult> => ({
        kind: "locked",
        runId: "r1",
        lockPath: "/tmp/runs/r1/.lock",
      }),
    );
    const out = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        runsDir="/tmp/runs"
        runRegistryLookup={resolved}
        runWorkflow={runWorkflow}
      />,
    );
    await flush();
    out.stdin.write(":");
    await flush();
    await type(out.stdin, "run deploy");
    await flush();
    out.stdin.write(ENTER);
    await flush(12);
    // Modal is up (required row has a placeholder, so canSubmit=true).
    // Press Enter to submit.
    out.stdin.write(ENTER);
    await flush(12);
    expect(runWorkflow).toHaveBeenCalled();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Run is locked");
    // Modal still mounted.
    expect(frame).toContain("deploy");
  });

  it("runs-table r on an active (running) row is a silent no-op", async () => {
    const wf = makeWorkflow("deploy", []);
    const resolved = [makeResolved(wf, "/abs/deploy.md")];
    const runningRow = makeRunRow({
      id: "r-running",
      workflowName: "deploy",
      sourceFile: "/abs/deploy.md",
      status: "running",
    });
    const runWorkflow = vi.fn(
      async (): Promise<RunWorkflowResult> => ({ kind: "ok", runId: "x" }),
    );
    const out = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        runsDir="/tmp/runs"
        runRegistryLookup={resolved}
        initialRunRows={[runningRow]}
        runWorkflow={runWorkflow}
      />,
    );
    await flush();
    // Switch to runs pane, then press `r`.
    out.stdin.write("2");
    await flush();
    out.stdin.write("r");
    await flush(6);
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("runs-table r on a terminal (complete) row triggers a fresh run", async () => {
    const wf = makeWorkflow("deploy", []);
    const resolved = [makeResolved(wf, "/abs/deploy.md")];
    const terminalRow = makeRunRow({
      id: "r-done",
      workflowName: "deploy",
      sourceFile: "/abs/deploy.md",
      status: "complete",
    });
    const runWorkflow = vi.fn(
      async (args: {
        readonly onRunStart?: (runId: string) => void;
      }): Promise<RunWorkflowResult> => {
        args.onRunStart?.("r-new");
        return { kind: "ok", runId: "r-new" };
      },
    );
    const out = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        runsDir="/tmp/runs"
        runRegistryLookup={resolved}
        initialRunRows={[terminalRow]}
        runWorkflow={runWorkflow}
      />,
    );
    await flush();
    out.stdin.write("2");
    await flush();
    out.stdin.write("r");
    await flush(8);
    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });
});

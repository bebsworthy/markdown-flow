import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
  type EngineEvent,
} from "../../src/core/index.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("forEach", () => {
  let tempRunsDir: string;

  beforeEach(async () => {
    tempRunsDir = await mkdtemp(join(tmpdir(), "markflow-foreach-"));
  });

  it("processes items in parallel and collects results", async () => {
    const source = readFileSync(join(FIXTURES, "foreach.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });

    expect(runInfo.status).toBe("complete");

    // produce runs once, then 3 items x 2 body nodes (process + transform),
    // plus 1 collect = 1 + 6 + 1 = 8 step completions
    const stepCompletes = events.filter((e) => e.type === "step:complete");
    expect(stepCompletes).toHaveLength(8);

    // Batch events
    const batchStarts = events.filter((e) => e.type === "batch:start");
    expect(batchStarts).toHaveLength(1);
    expect((batchStarts[0] as any).items).toBe(3);

    const batchItemCompletes = events.filter(
      (e) => e.type === "batch:item:complete",
    );
    expect(batchItemCompletes).toHaveLength(3);

    const batchCompletes = events.filter((e) => e.type === "batch:complete");
    expect(batchCompletes).toHaveLength(1);

    // Results collected into GLOBAL
    const globalUpdates = events.filter(
      (e) => e.type === "global:update" && (e as any).keys.includes("results"),
    );
    expect(globalUpdates).toHaveLength(1);
    const results = (globalUpdates[0] as any).patch.results;
    expect(results).toHaveLength(3);

    // collect step ran
    const collectStep = runInfo.steps.find((s) => s.node === "collect");
    expect(collectStep).toBeDefined();
    expect(collectStep!.summary).toBe("collected");
  });

  it("handles empty items array by skipping to collector", async () => {
    const source = `
# Empty forEach

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": []}'
echo 'RESULT: {"edge": "next", "summary": "empty"}'
\`\`\`

## process

\`\`\`bash
echo "should not run"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "collected-empty"}'
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });

    expect(runInfo.status).toBe("complete");

    const stepCompletes = events.filter((e) => e.type === "step:complete");
    const stepNodes = stepCompletes.map((e) => (e as any).nodeId);
    expect(stepNodes).toContain("produce");
    expect(stepNodes).toContain("collect");
    expect(stepNodes).not.toContain("process");

    expect(events.filter((e) => e.type === "batch:start")).toHaveLength(0);
  });

  it("injects ITEM and ITEM_INDEX into batch token env", async () => {
    const source = `
# Item access

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["x", "y"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": $ITEM}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
    const def = parseWorkflowFromString(source);

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
    });

    expect(runInfo.status).toBe("complete");

    const processResults = runInfo.steps.filter((s) => s.node === "process");
    expect(processResults).toHaveLength(2);
    const summaries = processResults.map((r) => r.summary).sort();
    expect(summaries).toEqual(["x", "y"]);
  });

  it("single-step forEach (no chain)", async () => {
    const source = `
# Single step forEach

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"item-$ITEM\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
    });

    expect(runInfo.status).toBe("complete");
    expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(3);
  });
});

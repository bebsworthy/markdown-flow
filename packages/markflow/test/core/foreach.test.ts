import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
  validateWorkflow,
  type EngineEvent,
} from "../../src/core/index.js";
import { replay } from "../../src/core/replay.js";

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

  it("results are ordered by itemIndex regardless of completion order", async () => {
    // Items finish out of order: item 1 sleeps longest, item 0 shortest.
    // GLOBAL.results must still be [0, 1, 2] by input position.
    const source = `
# Ordering

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": [10, 11, 12]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
# item 11 sleeps longest, item 10 shortest → reversed completion order
case "$ITEM" in
  10) sleep 0.05 ;;
  11) sleep 0.6 ;;
  12) sleep 0.3 ;;
esac
echo "LOCAL: {\\"i\\": $ITEM}"
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"i-$ITEM\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];
    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });
    expect(runInfo.status).toBe("complete");

    const update = events.find(
      (e) => e.type === "global:update" && (e as any).keys.includes("results"),
    );
    const results = (update as any).patch.results as Array<{
      itemIndex: number;
      ok: boolean;
    }>;
    expect(results).toHaveLength(3);
    // Regardless of completion order, each entry's position must equal its itemIndex.
    expect(results.map((r) => r.itemIndex)).toEqual([0, 1, 2]);
    expect(results.every((r) => r.ok)).toBe(true);

    // Items completed out of input order — assert on the batch:item:complete
    // stream so the ordering guarantee is meaningful (if they happened to
    // complete in order the test would be vacuous).
    const itemCompletes = events.filter(
      (e) => e.type === "batch:item:complete",
    ) as any[];
    const completionOrder = itemCompletes.map((e) => e.itemIndex);
    expect(completionOrder).not.toEqual([0, 1, 2]);
  });

  it("fail-fast: first failing item aborts the batch and skips the collector", async () => {
    const source = `
# Fail fast

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
if [ "$ITEM" = "2" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "boom"}'
  exit 1
fi
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"ok-$ITEM\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "collected"}'
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];
    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });

    // Collector should NOT have run.
    expect(runInfo.steps.find((s) => s.node === "collect")).toBeUndefined();

    const batchComplete = events.find((e) => e.type === "batch:complete") as any;
    expect(batchComplete).toBeDefined();
    expect(batchComplete.status).toBe("error");
    expect(batchComplete.failed).toBe(1);
    expect(batchComplete.succeeded).toBe(2);

    const itemCompletes = events.filter(
      (e) => e.type === "batch:item:complete",
    ) as any[];
    const failed = itemCompletes.filter((e) => !e.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0].edge).toBe("fail");
  });

  it("continue: all items run and collector sees both ok and failed entries", async () => {
    const source = `
# Continue mode

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  onItemError: continue
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
if [ "$ITEM" = "2" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "boom"}'
  exit 1
fi
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"ok-$ITEM\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "collected"}'
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];
    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });
    expect(runInfo.status).toBe("complete");

    // Collector ran.
    expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();

    const batchComplete = events.find((e) => e.type === "batch:complete") as any;
    expect(batchComplete.status).toBe("ok");
    expect(batchComplete.failed).toBe(1);
    expect(batchComplete.succeeded).toBe(2);

    const update = events.find(
      (e) => e.type === "global:update" && (e as any).keys.includes("results"),
    ) as any;
    const results = update.patch.results as Array<{
      ok: boolean;
      edge: string;
    }>;
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].edge).toBe("fail");
    expect(results[2].ok).toBe(true);
  });

  it("replay folds v2 batch events back to the live snapshot", async () => {
    const source = readFileSync(join(FIXTURES, "foreach.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];
    await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });

    // Filter out non-persisted events (step:output) — replay rejects them.
    const persisted = events.filter((e) => e.type !== "step:output");
    const snap = replay(persisted);
    const batches = [...snap.batches.values()];
    expect(batches).toHaveLength(1);
    expect(batches[0].done).toBe(true);
    expect(batches[0].status).toBe("ok");
    expect(batches[0].succeeded).toBe(3);
    expect(batches[0].failed).toBe(0);
    expect(batches[0].results.every((r) => r?.ok)).toBe(true);
  });

  it("validator rejects a forEach chain with no collector", () => {
    const source = `
# No collector

# Flow

\`\`\`mermaid
flowchart TD
  produce([produce]) ==>|each: items| process ==> transform
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
echo done
\`\`\`

## transform

\`\`\`bash
echo done
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const diags = validateWorkflow(def);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("FOREACH_NO_COLLECTOR");
  });

  it("validator rejects `each:` label with missing key", () => {
    const source = `
# Missing key

# Flow

\`\`\`mermaid
flowchart TD
  produce([produce]) ==>|each: | process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo ok
\`\`\`

## process

\`\`\`bash
echo ok
\`\`\`

## collect

\`\`\`bash
echo ok
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const diags = validateWorkflow(def);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("FOREACH_LABEL_MISSING_KEY");
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

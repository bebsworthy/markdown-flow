import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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

  afterEach(async () => {
    await rm(tempRunsDir, { recursive: true, force: true });
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
  10) sleep 0.15 ;;
  11) sleep 1.8 ;;
  12) sleep 0.9 ;;
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

  describe("maxConcurrency", () => {
    it("maxConcurrency: 1 runs items serially in index order", async () => {
      const source = `
# Serial forEach

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["a", "b", "c", "d"]}'
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
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(4);

      // With maxConcurrency: 1, items complete in sequential order.
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes.map((e) => e.itemIndex)).toEqual([0, 1, 2, 3]);

      // batch:start records maxConcurrency
      const batchStart = events.find((e) => e.type === "batch:start") as any;
      expect(batchStart.maxConcurrency).toBe(1);
    });

    it("maxConcurrency: 2 limits concurrent execution", async () => {
      const source = `
# Concurrency limited

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 2
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3, 4, 5]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
sleep 0.05
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"item-$ITEM\\"}"
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
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(5);

      // Verify concurrency was limited: track running tokens over time.
      let running = 0;
      let maxRunning = 0;
      for (const e of events) {
        if (e.type === "token:state" && (e as any).to === "running") {
          const tok = (e as any).tokenId;
          // Only count batch tokens (process node)
          const created = events.find(
            (ev) =>
              ev.type === "token:created" &&
              (ev as any).tokenId === tok &&
              (ev as any).batchId != null,
          );
          if (created) {
            running++;
            maxRunning = Math.max(maxRunning, running);
          }
        }
        if (e.type === "token:state" && (e as any).to === "complete") {
          const tok = (e as any).tokenId;
          const created = events.find(
            (ev) =>
              ev.type === "token:created" &&
              (ev as any).tokenId === tok &&
              (ev as any).batchId != null,
          );
          if (created) running--;
        }
      }
      expect(maxRunning).toBeLessThanOrEqual(2);
      expect(maxRunning).toBeGreaterThan(0);
    });

    it("maxConcurrency: 0 means unlimited (all spawn upfront)", async () => {
      const source = `
# Unlimited

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 0
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"ok\\"}"
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

      // All 3 tokens created before any batch:item:complete
      const tokenCreates = events.filter(
        (e) => e.type === "token:created" && (e as any).batchId != null,
      );
      const firstItemComplete = events.findIndex(
        (e) => e.type === "batch:item:complete",
      );
      const lastCreate = events.lastIndexOf(
        tokenCreates[tokenCreates.length - 1],
      );
      expect(lastCreate).toBeLessThan(firstItemComplete);
    });

    it("maxConcurrency >= items.length degenerates to unlimited", async () => {
      const source = `
# Large concurrency

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 100
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"ok\\"}"
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

      // All 3 tokens created before any item completes (same as unlimited)
      const tokenCreates = events.filter(
        (e) => e.type === "token:created" && (e as any).batchId != null,
      );
      expect(tokenCreates).toHaveLength(3);
    });

    it("maxConcurrency: 2 + fail-fast stops spawning on failure", async () => {
      const source = `
# Fail fast with concurrency

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 2
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3, 4, 5]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
if [ "$ITEM" = "1" ]; then
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

      // Collector should NOT run (fail-fast).
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeUndefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete.status).toBe("error");

      // Only items 0 and 1 were spawned (maxConcurrency: 2), items 2-4 never ran.
      const tokenCreates = events.filter(
        (e) => e.type === "token:created" && (e as any).batchId != null,
      );
      expect(tokenCreates.length).toBeLessThanOrEqual(2);

      // Total completed should be 2 (both initial items drained)
      expect(batchComplete.succeeded + batchComplete.failed).toBe(2);
    });

    it("maxConcurrency: 1 + fail-fast stops immediately", async () => {
      const source = `
# Serial fail fast

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3, 4, 5]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
if [ "$ITEM" = "1" ]; then
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

      expect(runInfo.steps.find((s) => s.node === "collect")).toBeUndefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete.status).toBe("error");
      expect(batchComplete.failed).toBe(1);
      expect(batchComplete.succeeded).toBe(0);

      // Only 1 token ever created (serial, first item failed)
      const tokenCreates = events.filter(
        (e) => e.type === "token:created" && (e as any).batchId != null,
      );
      expect(tokenCreates).toHaveLength(1);
    });

    it("maxConcurrency: 2 + continue runs all items despite failure", async () => {
      const source = `
# Continue with concurrency

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
  maxConcurrency: 2
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3, 4]}'
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
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete.status).toBe("ok");
      expect(batchComplete.failed).toBe(1);
      expect(batchComplete.succeeded).toBe(3);

      // All 4 items ran despite failure
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      );
      expect(itemCompletes).toHaveLength(4);
    });

    it("results ordered by itemIndex with maxConcurrency", async () => {
      const source = `
# Ordering with concurrency

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 2
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["a", "b", "c", "d"]}'
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
      const events: EngineEvent[] = [];
      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      const update = events.find(
        (e) => e.type === "global:update" && (e as any).keys.includes("results"),
      ) as any;
      const results = update.patch.results as Array<{ itemIndex: number }>;
      expect(results.map((r) => r.itemIndex)).toEqual([0, 1, 2, 3]);
    });

    it("multi-node body chain with maxConcurrency: 1", async () => {
      const source = `
# Serial chain

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| step1 ==> step2 --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["x", "y", "z"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## step1

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"s1-$ITEM\\"}"
\`\`\`

## step2

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"s2-$ITEM\\"}"
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

      // Each item traverses both body nodes before next starts.
      // With serial execution, step completions alternate: s1-x, s2-x, s1-y, s2-y, s1-z, s2-z
      const stepCompletes = events
        .filter(
          (e) =>
            e.type === "step:complete" &&
            ((e as any).nodeId === "step1" || (e as any).nodeId === "step2"),
        )
        .map((e) => (e as any).nodeId);

      // Serial guarantees: step2 for item N completes before step1 for item N+1
      // Pattern: [step1, step2, step1, step2, step1, step2]
      expect(stepCompletes).toEqual([
        "step1",
        "step2",
        "step1",
        "step2",
        "step1",
        "step2",
      ]);
    });

    it("replay roundtrip preserves maxConcurrency and spawned", async () => {
      const source = `
# Replay with concurrency

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 2
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1, 2, 3]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## process

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"ok\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];
      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      const persisted = events.filter((e) => e.type !== "step:output");
      const snap = replay(persisted);
      const batches = [...snap.batches.values()];
      expect(batches).toHaveLength(1);
      expect(batches[0].maxConcurrency).toBe(2);
      expect(batches[0].spawned).toBe(3);
      expect(batches[0].done).toBe(true);
      expect(batches[0].status).toBe("ok");
    });

    it("parser rejects invalid maxConcurrency values", () => {
      const negativeSource = `
# Negative

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: -1
\`\`\`

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
      expect(() => parseWorkflowFromString(negativeSource)).toThrow(
        /maxConcurrency/,
      );

      const floatSource = `
# Float

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 2.5
\`\`\`

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
      expect(() => parseWorkflowFromString(floatSource)).toThrow(
        /maxConcurrency/,
      );
    });

    it("empty array with maxConcurrency skips to collector", async () => {
      const source = `
# Empty with concurrency

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 2
\`\`\`

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
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
      expect(runInfo.steps.find((s) => s.node === "process")).toBeUndefined();
      expect(events.filter((e) => e.type === "batch:start")).toHaveLength(0);
    });
  });
});

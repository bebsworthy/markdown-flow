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
import { getForEachScope } from "../../src/core/graph.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("forEach complex topologies", () => {
  let tempRunsDir: string;

  beforeEach(async () => {
    tempRunsDir = await mkdtemp(join(tmpdir(), "markflow-foreach-complex-"));
  });

  afterEach(async () => {
    await rm(tempRunsDir, { recursive: true, force: true });
  });

  describe("diamond pattern (branch + reconverge)", () => {
    it("scope detection finds all body nodes in the diamond", () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-diamond.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const scope = getForEachScope(def.graph, "produce");

      expect(scope).toBeDefined();
      expect(scope!.key).toBe("items");
      expect(scope!.entryNode).toBe("validate");
      expect(scope!.bodyNodes).toEqual(
        new Set(["validate", "transform", "notify", "merge"]),
      );
      expect(scope!.exitNodes).toEqual(["merge"]);
      expect(scope!.collectorNode).toBe("collect");
    });

    it("items independently branch based on their result", async () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-diamond.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];

      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // "good" and "good2" take the pass→transform→merge path
      // "bad" takes the fail→notify→merge path
      const transformSteps = runInfo.steps.filter(
        (s) => s.node === "transform",
      );
      expect(transformSteps).toHaveLength(2);
      expect(
        transformSteps.map((s) => s.summary).sort(),
      ).toEqual(["transformed-good", "transformed-good2"]);

      const notifySteps = runInfo.steps.filter((s) => s.node === "notify");
      expect(notifySteps).toHaveLength(1);
      expect(notifySteps[0].summary).toBe("notified-bad");

      // All 3 items merge
      const mergeSteps = runInfo.steps.filter((s) => s.node === "merge");
      expect(mergeSteps).toHaveLength(3);

      // Collector ran
      const collectStep = runInfo.steps.find((s) => s.node === "collect");
      expect(collectStep).toBeDefined();
      expect(collectStep!.summary).toBe("collected");
    });

    it("all items taking the same branch works", async () => {
      const source = `
# All pass diamond

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["a", "b"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
echo 'RESULT: {"edge": "pass", "summary": "valid"}'
\`\`\`

## transform

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"transformed-$ITEM\\"}"
\`\`\`

## notify

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "notified"}'
\`\`\`

## merge

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "merged"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");
      expect(runInfo.steps.filter((s) => s.node === "transform")).toHaveLength(
        2,
      );
      expect(runInfo.steps.filter((s) => s.node === "notify")).toHaveLength(0);
      expect(runInfo.steps.filter((s) => s.node === "merge")).toHaveLength(2);
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });

    it("diamond with maxConcurrency: 1 runs items serially", async () => {
      const source = `
# Serial diamond

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["x", "y"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "y" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "bad"}'
else
  echo 'RESULT: {"edge": "pass", "summary": "good"}'
fi
\`\`\`

## transform

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "transformed"}'
\`\`\`

## notify

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "notified"}'
\`\`\`

## merge

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "merged"}'
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

      // Serial: item 0 completes before item 1 starts
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes.map((e) => e.itemIndex)).toEqual([0, 1]);

      // item 0 → transform, item 1 → notify
      expect(runInfo.steps.filter((s) => s.node === "transform")).toHaveLength(
        1,
      );
      expect(runInfo.steps.filter((s) => s.node === "notify")).toHaveLength(1);
    });

    it("results ordered by itemIndex with diamond branching", async () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-diamond.md"),
        "utf-8",
      );
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
      expect(results.map((r) => r.itemIndex)).toEqual([0, 1, 2]);
    });
  });

  describe("conditional skip", () => {
    it("scope detection includes all reachable body nodes via thick edges", () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-skip.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const scope = getForEachScope(def.graph, "produce");

      expect(scope).toBeDefined();
      expect(scope!.entryNode).toBe("step1");
      expect(scope!.bodyNodes).toEqual(new Set(["step1", "step2", "step3"]));
      expect(scope!.exitNodes).toEqual(["step3"]);
      expect(scope!.collectorNode).toBe("collect");
    });

    it("items can skip intermediate steps", async () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-skip.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];

      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // "full" and "full2" go through step1→step2→step3
      // "skip" goes step1→step3 (bypasses step2)
      const step2Runs = runInfo.steps.filter((s) => s.node === "step2");
      expect(step2Runs).toHaveLength(2);
      expect(step2Runs.map((s) => s.summary).sort()).toEqual([
        "s2-full",
        "s2-full2",
      ]);

      const step3Runs = runInfo.steps.filter((s) => s.node === "step3");
      expect(step3Runs).toHaveLength(3);

      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });

    it("all items skipping works", async () => {
      const source = `
# All skip

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| step1
  step1 ==> step2 ==> step3 --> collect
  step1 ==>|skip| step3
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["a", "b"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## step1

\`\`\`bash
echo 'RESULT: {"edge": "skip", "summary": "skipping"}'
\`\`\`

## step2

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "should-not-run"}'
\`\`\`

## step3

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"s3-$ITEM\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");
      expect(runInfo.steps.filter((s) => s.node === "step2")).toHaveLength(0);
      expect(runInfo.steps.filter((s) => s.node === "step3")).toHaveLength(2);
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });

    it("skip with maxConcurrency: 1 runs serially", async () => {
      const source = `
# Serial skip

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| step1
  step1 ==> step2 ==> step3 --> collect
  step1 ==>|skip| step3
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["full", "skip", "full2"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## step1

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "skip" ]; then
  echo 'RESULT: {"edge": "skip", "summary": "skipping"}'
else
  echo 'RESULT: {"edge": "next", "summary": "continuing"}'
fi
\`\`\`

## step2

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "s2"}'
\`\`\`

## step3

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "s3"}'
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

      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes.map((e) => e.itemIndex)).toEqual([0, 1, 2]);
    });
  });

  describe("retry loop within forEach body", () => {
    it("scope detection includes retry self-loop node", () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-retry.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const scope = getForEachScope(def.graph, "produce");

      expect(scope).toBeDefined();
      expect(scope!.entryNode).toBe("attempt");
      expect(scope!.bodyNodes).toEqual(
        new Set(["attempt", "handle-failure", "process"]),
      );
      expect(scope!.exitNodes).toEqual(["process"]);
      expect(scope!.collectorNode).toBe("collect");
    });

    it("item succeeds on first attempt", async () => {
      const source = `
# First try success

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| attempt
  attempt ==>|fail max:3| attempt
  attempt ==>|fail:max| handle-failure
  attempt ==> process
  handle-failure ==> process
  process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["ok"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## attempt

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "passed"}'
\`\`\`

## handle-failure

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "handled"}'
\`\`\`

## process

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "processed"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");
      expect(runInfo.steps.filter((s) => s.node === "attempt")).toHaveLength(1);
      expect(
        runInfo.steps.filter((s) => s.node === "handle-failure"),
      ).toHaveLength(0);
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(1);
    });

    it("item retries then succeeds within budget", async () => {
      const counterFile = join(tempRunsDir, "retry-counter");
      const source = `
# Retry then succeed

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| attempt
  attempt ==>|fail max:3| attempt
  attempt ==>|fail:max| handle-failure
  attempt ==> process
  handle-failure ==> process
  process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["retry-twice"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## attempt

\`\`\`bash
COUNTER_FILE="COUNTER_PLACEHOLDER"
if [ ! -f "$COUNTER_FILE" ]; then
  echo "0" > "$COUNTER_FILE"
fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
if [ "$COUNT" -le 2 ]; then
  echo "RESULT: {\\"edge\\": \\"fail\\", \\"summary\\": \\"fail-$COUNT\\"}"
  exit 1
fi
rm -f "$COUNTER_FILE"
echo 'RESULT: {"edge": "next", "summary": "finally-passed"}'
\`\`\`

## handle-failure

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "handled"}'
\`\`\`

## process

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "processed"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(
        source.replace("COUNTER_PLACEHOLDER", counterFile),
      );
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");
      // 2 fails + 1 success = 3 attempts
      expect(runInfo.steps.filter((s) => s.node === "attempt")).toHaveLength(3);
      expect(
        runInfo.steps.filter((s) => s.node === "handle-failure"),
      ).toHaveLength(0);
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(1);

      // Verify retry:increment events
      const retryIncs = events.filter((e) => e.type === "retry:increment");
      expect(retryIncs).toHaveLength(2);
    });

    it("item exhausts retry budget and routes to handler", async () => {
      const source = `
# Exhaust retries

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| attempt
  attempt ==>|fail max:2| attempt
  attempt ==>|fail:max| handle-failure
  attempt ==> process
  handle-failure ==> process
  process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["always-fails"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## attempt

\`\`\`bash
echo 'RESULT: {"edge": "fail", "summary": "boom"}'
exit 1
\`\`\`

## handle-failure

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "gracefully-handled"}'
\`\`\`

## process

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "processed-after-failure"}'
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
      // max:2 means 2 retries allowed, so 3 total attempts (1 original + 2 retries)
      expect(runInfo.steps.filter((s) => s.node === "attempt")).toHaveLength(3);
      expect(
        runInfo.steps.filter((s) => s.node === "handle-failure"),
      ).toHaveLength(1);
      expect(
        runInfo.steps.find((s) => s.node === "handle-failure")!.summary,
      ).toBe("gracefully-handled");
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(1);

      // Verify exhausted event
      const exhausted = events.filter((e) => e.type === "retry:exhausted");
      expect(exhausted).toHaveLength(1);
    });

    it("per-item retry isolation: items have independent budgets", async () => {
      const source = `
# Per-item retry isolation

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| attempt
  attempt ==>|fail max:2| attempt
  attempt ==>|fail:max| handle-failure
  attempt ==> process
  handle-failure ==> process
  process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["pass", "exhaust"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## attempt

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "exhaust" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "always-fails"}'
  exit 1
fi
echo 'RESULT: {"edge": "next", "summary": "passed"}'
\`\`\`

## handle-failure

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "handled"}'
\`\`\`

## process

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"processed-$ITEM\\"}"
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

      // item "pass" succeeds on first attempt (1 attempt step)
      // item "exhaust" fails 3 times and hits handler (3 attempt steps + 1 handler)
      const attemptSteps = runInfo.steps.filter((s) => s.node === "attempt");
      expect(attemptSteps).toHaveLength(4); // 1 + 3

      // Only item "exhaust" hits the handler
      const handlerSteps = runInfo.steps.filter(
        (s) => s.node === "handle-failure",
      );
      expect(handlerSteps).toHaveLength(1);

      // Both items reach process
      const processSteps = runInfo.steps.filter((s) => s.node === "process");
      expect(processSteps).toHaveLength(2);

      // Verify retry:increment events carry batchId/itemIndex
      const retryIncs = events.filter(
        (e) => e.type === "retry:increment",
      ) as any[];
      expect(retryIncs.length).toBeGreaterThan(0);
      expect(retryIncs.every((e: any) => e.batchId != null)).toBe(true);
      expect(retryIncs.every((e: any) => e.itemIndex != null)).toBe(true);
      // All retry events are for item 1 (the "exhaust" item)
      expect(retryIncs.every((e: any) => e.itemIndex === 1)).toBe(true);
    });
  });

  describe("feature interactions (stress tests)", () => {
    it("diamond + fail-fast: batch aborts when exit node fails", async () => {
      // fail-fast triggers based on the EXIT node result (merge), not
      // intermediate branch steps. merge must emit fail edge.
      const source = `
# Diamond fail-fast

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["ok1", "ok2", "bad"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "bad" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "invalid"}'
else
  echo 'RESULT: {"edge": "pass", "summary": "valid"}'
fi
\`\`\`

## transform

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "transformed"}'
\`\`\`

## notify

\`\`\`bash
echo 'LOCAL: {"was_notified": true}'
echo 'RESULT: {"edge": "next", "summary": "notified"}'
\`\`\`

## merge

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "bad" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "merge-fail"}'
  exit 1
fi
echo 'RESULT: {"edge": "next", "summary": "merge-ok"}'
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

      // fail-fast should abort the batch — collector should NOT run
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeUndefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete).toBeDefined();
      expect(batchComplete.status).toBe("error");
      expect(batchComplete.failed).toBeGreaterThanOrEqual(1);
    });

    it("diamond + continue: failed items still complete and collector runs", async () => {
      // Item failure is determined at the exit node (merge).
      // The "bad" item reaches merge which fails — but continue mode runs all.
      const source = `
# Diamond continue

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  onItemError: continue
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["ok", "bad", "ok2"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "bad" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "invalid"}'
else
  echo 'RESULT: {"edge": "pass", "summary": "valid"}'
fi
\`\`\`

## transform

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "transformed"}'
\`\`\`

## notify

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "notified"}'
\`\`\`

## merge

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "bad" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "merge-fail"}'
  exit 1
fi
echo 'RESULT: {"edge": "next", "summary": "merge-ok"}'
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
      // All 3 items should complete (merge fails for "bad" but continue mode)
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes).toHaveLength(3);

      // Collector ran
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete.status).toBe("ok");
      expect(batchComplete.failed).toBe(1);
      expect(batchComplete.succeeded).toBe(2);
    });

    it("diamond + maxConcurrency: 2 with mixed branches", async () => {
      const source = `
# Diamond concurrent

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 2
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["ok1", "bad", "ok2", "ok3"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "bad" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "invalid"}'
else
  echo 'RESULT: {"edge": "pass", "summary": "valid"}'
fi
\`\`\`

## transform

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"transformed-$ITEM\\"}"
\`\`\`

## notify

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"notified-$ITEM\\"}"
\`\`\`

## merge

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"merged-$ITEM\\"}"
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

      // All 4 items complete
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes).toHaveLength(4);

      // Results ordered by index
      const update = events.find(
        (e) =>
          e.type === "global:update" && (e as any).keys.includes("results"),
      ) as any;
      const results = update.patch.results as Array<{ itemIndex: number }>;
      expect(results.map((r) => r.itemIndex)).toEqual([0, 1, 2, 3]);

      // Verify branching: 3 transforms (ok items), 1 notify (bad item)
      expect(runInfo.steps.filter((s) => s.node === "transform")).toHaveLength(
        3,
      );
      expect(runInfo.steps.filter((s) => s.node === "notify")).toHaveLength(1);
      // All 4 merge
      expect(runInfo.steps.filter((s) => s.node === "merge")).toHaveLength(4);
    });

    it("skip + fail-fast: exit node failure aborts batch", async () => {
      // Fail-fast triggers when the EXIT node (step3) fails.
      // "full-fail" item: step1 → step2 → step3 (fails at step3)
      // "skip-ok" item: step1 → step3 (succeeds)
      const source = `
# Skip + fail-fast

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| step1
  step1 ==> step2 ==> step3 --> collect
  step1 ==>|skip| step3
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["skip-ok", "full-fail", "never-runs"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## step1

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "skip-ok" ]; then
  echo 'RESULT: {"edge": "skip", "summary": "skipping"}'
else
  echo 'RESULT: {"edge": "next", "summary": "continuing"}'
fi
\`\`\`

## step2

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "s2"}'
\`\`\`

## step3

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "full-fail" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "step3-fail"}'
  exit 1
fi
echo 'RESULT: {"edge": "next", "summary": "s3-ok"}'
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

      // fail-fast: collector should not run
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeUndefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete).toBeDefined();
      expect(batchComplete.status).toBe("error");
      expect(batchComplete.failed).toBeGreaterThanOrEqual(1);
    });

    it("retry + diamond: item retries at branch point then takes alternate path", async () => {
      const counterFile = join(tempRunsDir, "retry-branch-counter");
      const source = `
# Retry at branch point

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| check
  check ==>|fail max:2| check
  check ==>|fail:max| fallback
  check ==> process
  fallback ==> done
  process ==> done
  done --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["will-retry"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## check

\`\`\`bash
COUNTER_FILE="COUNTER_PLACEHOLDER"
if [ ! -f "$COUNTER_FILE" ]; then
  echo "0" > "$COUNTER_FILE"
fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
if [ "$COUNT" -le 3 ]; then
  echo "RESULT: {\\"edge\\": \\"fail\\", \\"summary\\": \\"fail-$COUNT\\"}"
  exit 1
fi
echo 'RESULT: {"edge": "next", "summary": "passed"}'
\`\`\`

## fallback

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "fallback-used"}'
\`\`\`

## process

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "processed"}'
\`\`\`

## done

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "collected"}'
\`\`\`
`;
      const def = parseWorkflowFromString(
        source.replace("COUNTER_PLACEHOLDER", counterFile),
      );
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // 3 retries + 1 budget exhaustion = routes to fallback
      // max:2 means 2 retries allowed = 3 total attempts
      // After 3 fails, exhausts budget → fallback → done
      const checkSteps = runInfo.steps.filter((s) => s.node === "check");
      expect(checkSteps).toHaveLength(3);

      // Fallback ran (budget exhausted)
      expect(
        runInfo.steps.filter((s) => s.node === "fallback"),
      ).toHaveLength(1);

      // process did NOT run (took fallback path)
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(0);

      // done and collect ran
      expect(runInfo.steps.filter((s) => s.node === "done")).toHaveLength(1);
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });

    it("replay roundtrip preserves state for diamond topology", async () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-diamond.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];
      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      // Import replay
      const { replay } = await import("../../src/core/replay.js");
      const persisted = events.filter((e) => e.type !== "step:output");
      const snap = replay(persisted);

      // Batch completed successfully
      const batches = [...snap.batches.values()];
      expect(batches).toHaveLength(1);
      expect(batches[0].done).toBe(true);
      expect(batches[0].status).toBe("ok");
      expect(batches[0].succeeded).toBe(3);
      expect(batches[0].failed).toBe(0);
      expect(batches[0].results).toHaveLength(3);
      expect(batches[0].results.every((r) => r?.ok)).toBe(true);
    });

    it("replay roundtrip preserves per-item retry state", async () => {
      const source = `
# Replay retry

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| attempt
  attempt ==>|fail max:2| attempt
  attempt ==>|fail:max| handle-failure
  attempt ==> process
  handle-failure ==> process
  process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["always-fails"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## attempt

\`\`\`bash
echo 'RESULT: {"edge": "fail", "summary": "boom"}'
exit 1
\`\`\`

## handle-failure

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "handled"}'
\`\`\`

## process

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "processed"}'
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

      const { replay } = await import("../../src/core/replay.js");
      const persisted = events.filter((e) => e.type !== "step:output");
      const snap = replay(persisted);

      // Per-item retry budgets should be tracked
      const retryKeys = [...snap.retryBudgets.keys()];
      const perItemKeys = retryKeys.filter((k) => k.startsWith("batch-"));
      expect(perItemKeys.length).toBeGreaterThan(0);

      // Verify the count reached max (2 retries = count 3 which exceeds max 2)
      const budget = snap.retryBudgets.get(perItemKeys[perItemKeys.length - 1]);
      expect(budget).toBeDefined();
      expect(budget!.count).toBeGreaterThan(budget!.max);
    });

    it("empty items with complex topology skips to collector", async () => {
      const source = `
# Empty diamond

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": []}'
echo 'RESULT: {"edge": "next", "summary": "empty"}'
\`\`\`

## validate

\`\`\`bash
echo 'RESULT: {"edge": "pass", "summary": "valid"}'
\`\`\`

## transform

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "transformed"}'
\`\`\`

## notify

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "notified"}'
\`\`\`

## merge

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "merged"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "collected-empty"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");
      // No body nodes should execute
      expect(runInfo.steps.filter((s) => s.node === "validate")).toHaveLength(
        0,
      );
      expect(runInfo.steps.filter((s) => s.node === "transform")).toHaveLength(
        0,
      );
      // Collector runs
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
      expect(runInfo.steps.find((s) => s.node === "collect")!.summary).toBe(
        "collected-empty",
      );
    });

    it("many items with diamond + concurrency exercises sliding window", async () => {
      const source = `
# Many items diamond

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| check
  check ==>|pass| fast
  check ==>|fail| slow
  fast ==> join
  slow ==> join
  join --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 3
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [1,2,3,4,5,6,7,8]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## check

\`\`\`bash
if [ $(( ITEM % 2 )) -eq 0 ]; then
  echo 'RESULT: {"edge": "pass", "summary": "even"}'
else
  echo 'RESULT: {"edge": "fail", "summary": "odd"}'
fi
\`\`\`

## fast

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"fast-$ITEM\\"}"
\`\`\`

## slow

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"slow-$ITEM\\"}"
\`\`\`

## join

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"joined-$ITEM\\"}"
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

      // All 8 items complete
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes).toHaveLength(8);

      // Verify branching: even items (2,4,6,8) → fast, odd (1,3,5,7) → slow
      expect(runInfo.steps.filter((s) => s.node === "fast")).toHaveLength(4);
      expect(runInfo.steps.filter((s) => s.node === "slow")).toHaveLength(4);
      expect(runInfo.steps.filter((s) => s.node === "join")).toHaveLength(8);

      // Results ordered
      const update = events.find(
        (e) =>
          e.type === "global:update" && (e as any).keys.includes("results"),
      ) as any;
      const results = update.patch.results as Array<{ itemIndex: number }>;
      expect(results.map((r) => r.itemIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

      // Verify concurrency was limited
      const batchStart = events.find((e) => e.type === "batch:start") as any;
      expect(batchStart.maxConcurrency).toBe(3);
    });
  });

  describe("fan-out within forEach body (unlabeled thick edges)", () => {
    it("scope detection finds fan-out branches and merge node", () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-fanout.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const scope = getForEachScope(def.graph, "produce");

      expect(scope).toBeDefined();
      expect(scope!.entryNode).toBe("dispatch");
      expect(scope!.bodyNodes).toEqual(
        new Set(["dispatch", "branch-a", "branch-b", "join"]),
      );
      expect(scope!.exitNodes).toEqual(["join"]);
      expect(scope!.collectorNode).toBe("collect");
    });

    it("both branches execute for every item", async () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-fanout.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];

      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // 3 items × 2 branches = 6 branch steps
      const branchASteps = runInfo.steps.filter((s) => s.node === "branch-a");
      expect(branchASteps).toHaveLength(3);
      const branchBSteps = runInfo.steps.filter((s) => s.node === "branch-b");
      expect(branchBSteps).toHaveLength(3);

      // join fires once per item (not twice — dedup)
      const joinSteps = runInfo.steps.filter((s) => s.node === "join");
      expect(joinSteps).toHaveLength(3);

      // Collector ran
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();

      // All 3 items completed
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes).toHaveLength(3);
    });

    it("fan-out with maxConcurrency: 1 runs items serially", async () => {
      const source = `
# Fan-out serial

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| dispatch
  dispatch ==> branch-a
  dispatch ==> branch-b
  branch-a ==> join
  branch-b ==> join
  join --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["x", "y"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## dispatch

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "dispatched"}'
\`\`\`

## branch-a

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"a-$ITEM\\"}"
\`\`\`

## branch-b

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"b-$ITEM\\"}"
\`\`\`

## join

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "joined"}'
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

      // Serial: item 0 completes before item 1 starts
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes.map((e: any) => e.itemIndex)).toEqual([0, 1]);

      // Both branches executed for both items
      expect(runInfo.steps.filter((s) => s.node === "branch-a")).toHaveLength(2);
      expect(runInfo.steps.filter((s) => s.node === "branch-b")).toHaveLength(2);
      expect(runInfo.steps.filter((s) => s.node === "join")).toHaveLength(2);
    });
  });

  describe("nested diamond (double branch/merge)", () => {
    it("items traverse two sequential branch+merge layers", async () => {
      const source = `
# Nested diamond

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| gate1
  gate1 ==>|a| path-a
  gate1 ==>|b| path-b
  path-a ==> mid
  path-b ==> mid
  mid ==>|x| path-x
  mid ==>|y| path-y
  path-x ==> final
  path-y ==> final
  final --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["alpha", "beta", "gamma"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## gate1

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "beta" ]; then
  echo 'RESULT: {"edge": "b", "summary": "route-b"}'
else
  echo 'RESULT: {"edge": "a", "summary": "route-a"}'
fi
\`\`\`

## path-a

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"a-$ITEM\\"}"
\`\`\`

## path-b

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"b-$ITEM\\"}"
\`\`\`

## mid

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "gamma" ]; then
  echo 'RESULT: {"edge": "y", "summary": "route-y"}'
else
  echo 'RESULT: {"edge": "x", "summary": "route-x"}'
fi
\`\`\`

## path-x

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"x-$ITEM\\"}"
\`\`\`

## path-y

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"y-$ITEM\\"}"
\`\`\`

## final

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"final-$ITEM\\"}"
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

      // First diamond: alpha, gamma → path-a; beta → path-b
      expect(runInfo.steps.filter((s) => s.node === "path-a")).toHaveLength(2);
      expect(runInfo.steps.filter((s) => s.node === "path-b")).toHaveLength(1);

      // mid fires once per item
      expect(runInfo.steps.filter((s) => s.node === "mid")).toHaveLength(3);

      // Second diamond: gamma → path-y; alpha, beta → path-x
      expect(runInfo.steps.filter((s) => s.node === "path-x")).toHaveLength(2);
      expect(runInfo.steps.filter((s) => s.node === "path-y")).toHaveLength(1);

      // final fires once per item
      expect(runInfo.steps.filter((s) => s.node === "final")).toHaveLength(3);

      // All items complete
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes).toHaveLength(3);

      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });
  });

  describe("mixed skip + retry in same body", () => {
    it("items independently skip, retry, or exhaust within same scope", async () => {
      const counterFile = join(tempRunsDir, "mixed-counter");
      const source = `
# Mixed skip + retry

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| check
  check ==>|skip| finish
  check ==>|fail max:2| check
  check ==>|fail:max| recover
  check ==> process
  recover ==> finish
  process ==> finish
  finish --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 1
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": ["skip-me", "retry-then-pass", "always-fail"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## check

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "skip-me" ]; then
  echo 'RESULT: {"edge": "skip", "summary": "skipping"}'
  exit 0
fi
if [ "$item" = "always-fail" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "fail"}'
  exit 1
fi
# retry-then-pass: fail twice, then pass
COUNTER_FILE="COUNTER_PLACEHOLDER"
if [ ! -f "$COUNTER_FILE" ]; then
  echo "0" > "$COUNTER_FILE"
fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
if [ "$COUNT" -le 2 ]; then
  echo "RESULT: {\\"edge\\": \\"fail\\", \\"summary\\": \\"retry-$COUNT\\"}"
  exit 1
fi
rm -f "$COUNTER_FILE"
echo 'RESULT: {"edge": "next", "summary": "passed-after-retries"}'
\`\`\`

## process

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"processed-$ITEM\\"}"
\`\`\`

## recover

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"recovered-$ITEM\\"}"
\`\`\`

## finish

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"finished-$ITEM\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(
        source.replace("COUNTER_PLACEHOLDER", counterFile),
      );
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // skip-me: check(skip) → finish (1 check step)
      // retry-then-pass: check(fail) × 2 + check(pass) → process → finish (3 check steps)
      // always-fail: check(fail) × 3 → recover → finish (3 check steps)
      const checkSteps = runInfo.steps.filter((s) => s.node === "check");
      expect(checkSteps).toHaveLength(7); // 1 + 3 + 3

      // Only retry-then-pass hits process
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(1);

      // Only always-fail hits recover
      expect(runInfo.steps.filter((s) => s.node === "recover")).toHaveLength(1);

      // All 3 reach finish
      expect(runInfo.steps.filter((s) => s.node === "finish")).toHaveLength(3);

      // All 3 items complete
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes).toHaveLength(3);

      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });
  });

  describe("routing error within forEach body", () => {
    it("unmatched edge label in body step errors the workflow", async () => {
      const source = `
# Routing error in body

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["x"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
echo 'RESULT: {"edge": "unknown", "summary": "oops"}'
\`\`\`

## transform

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "t"}'
\`\`\`

## notify

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "n"}'
\`\`\`

## merge

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "m"}'
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

      expect(runInfo.status).toBe("error");
      expect(events.some((e) => e.type === "workflow:error")).toBe(true);
    });
  });

  describe("single item through complex topologies", () => {
    it("single item through diamond branches correctly", async () => {
      const source = `
# Single item diamond

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["only"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
echo 'RESULT: {"edge": "pass", "summary": "valid"}'
\`\`\`

## transform

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "transformed"}'
\`\`\`

## notify

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "notified"}'
\`\`\`

## merge

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "merged"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");
      expect(runInfo.steps.filter((s) => s.node === "transform")).toHaveLength(1);
      expect(runInfo.steps.filter((s) => s.node === "notify")).toHaveLength(0);
      expect(runInfo.steps.filter((s) => s.node === "merge")).toHaveLength(1);
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });

    it("single item that skips works", async () => {
      const source = `
# Single skip

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| step1
  step1 ==> step2 ==> step3 --> collect
  step1 ==>|skip| step3
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["only"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## step1

\`\`\`bash
echo 'RESULT: {"edge": "skip", "summary": "skipping"}'
\`\`\`

## step2

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "should-not-run"}'
\`\`\`

## step3

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "s3"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");
      expect(runInfo.steps.filter((s) => s.node === "step2")).toHaveLength(0);
      expect(runInfo.steps.filter((s) => s.node === "step3")).toHaveLength(1);
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });
  });

  describe("result content verification", () => {
    it("GLOBAL.results contains summary, ok, edge from exit node", async () => {
      const source = `
# Result content

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["good", "bad"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "bad" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "invalid"}'
else
  echo 'RESULT: {"edge": "pass", "summary": "valid"}'
fi
\`\`\`

## transform

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "transformed"}'
\`\`\`

## notify

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "notified"}'
\`\`\`

## merge

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"merged-$item\\"}"
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
      const results = update.patch.results as Array<{
        itemIndex: number;
        ok: boolean;
        edge: string;
        summary?: string;
        local?: Record<string, unknown>;
      }>;

      // Both items succeed at merge (exit node) — "bad" only fails at validate,
      // not at the exit node
      expect(results[0].ok).toBe(true);
      expect(results[0].edge).toBe("next");
      expect(results[0].summary).toBe("merged-good");

      expect(results[1].ok).toBe(true);
      expect(results[1].edge).toBe("next");
      expect(results[1].summary).toBe("merged-bad");
    });
  });

  describe("ITEM env propagation", () => {
    it("ITEM is accessible in all body nodes of a diamond", async () => {
      const source = `
# ITEM propagation

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["alpha"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"pass\\", \\"summary\\": \\"validate-$ITEM\\"}"
\`\`\`

## transform

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"transform-$ITEM\\"}"
\`\`\`

## notify

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"notify-$ITEM\\"}"
\`\`\`

## merge

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"merge-$ITEM\\"}"
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");

      // Every body node's summary should contain the ITEM value
      const validate = runInfo.steps.find((s) => s.node === "validate");
      expect(validate!.summary).toContain("alpha");

      const transform = runInfo.steps.find((s) => s.node === "transform");
      expect(transform!.summary).toContain("alpha");

      const merge = runInfo.steps.find((s) => s.node === "merge");
      expect(merge!.summary).toContain("alpha");
    });
  });

  describe("validator coverage", () => {
    it("FOREACH_MULTI_COLLECTOR rejects multiple exit targets", () => {
      const source = `
# Multi collector

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| check
  check ==>|pass| ok-path
  check ==>|fail| fail-path
  ok-path --> collector-a
  fail-path --> collector-b
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## check

\`\`\`bash
echo 'RESULT: {"edge": "pass", "summary": "ok"}'
\`\`\`

## ok-path

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## fail-path

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## collector-a

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## collector-b

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const diagnostics = validateWorkflow(def);
      const multiCollector = diagnostics.find(
        (d) => d.code === "FOREACH_MULTI_COLLECTOR",
      );
      expect(multiCollector).toBeDefined();
      expect(multiCollector!.severity).toBe("error");
    });

    it("complex topologies pass validation with no errors", () => {
      for (const fixture of [
        "foreach-diamond.md",
        "foreach-skip.md",
        "foreach-retry.md",
        "foreach-fanout.md",
      ]) {
        const source = readFileSync(join(FIXTURES, fixture), "utf-8");
        const def = parseWorkflowFromString(source);
        const diagnostics = validateWorkflow(def);
        const errors = diagnostics.filter((d) => d.severity === "error");
        expect(errors, `${fixture} should have no validation errors`).toEqual(
          [],
        );
      }
    });
  });

  describe("synonym routing within forEach body", () => {
    it("'ok' result matches 'pass' edge via synonym group", async () => {
      const source = `
# Synonym routing

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| validate
  validate ==>|pass| transform
  validate ==>|fail| notify
  transform ==> merge
  notify ==> merge
  merge --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["a", "b"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## validate

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "b" ]; then
  echo 'RESULT: {"edge": "error", "summary": "synonym-fail"}'
else
  echo 'RESULT: {"edge": "ok", "summary": "synonym-pass"}'
fi
\`\`\`

## transform

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"transformed-$ITEM\\"}"
\`\`\`

## notify

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"notified-$ITEM\\"}"
\`\`\`

## merge

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "merged"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

      expect(runInfo.status).toBe("complete");
      // "a" emits "ok" → matches "pass" edge → transform
      expect(runInfo.steps.filter((s) => s.node === "transform")).toHaveLength(1);
      // "b" emits "error" → matches "fail" edge → notify
      expect(runInfo.steps.filter((s) => s.node === "notify")).toHaveLength(1);
      expect(runInfo.steps.filter((s) => s.node === "merge")).toHaveLength(2);
    });
  });

  describe("sequential forEach (two batches)", () => {
    it("two forEach batches in sequence complete independently", async () => {
      const source = `
# Sequential forEach

# Flow

\`\`\`mermaid
flowchart TD
  produce1 ==>|each: items| process1 --> collect1
  collect1 --> produce2
  produce2 ==>|each: items| process2 --> collect2
\`\`\`

# Steps

## produce1

\`\`\`bash
echo 'LOCAL: {"items": ["a", "b"]}'
echo 'RESULT: {"edge": "next", "summary": "batch1-produced"}'
\`\`\`

## process1

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"batch1-$ITEM\\"}"
\`\`\`

## collect1

\`\`\`bash
echo 'LOCAL: {"items": ["x", "y", "z"]}'
echo 'RESULT: {"edge": "next", "summary": "batch1-collected"}'
\`\`\`

## produce2

\`\`\`bash
echo 'LOCAL: {"items": ["x", "y", "z"]}'
echo 'RESULT: {"edge": "next", "summary": "batch2-produced"}'
\`\`\`

## process2

\`\`\`bash
echo "RESULT: {\\"edge\\": \\"next\\", \\"summary\\": \\"batch2-$ITEM\\"}"
\`\`\`

## collect2

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "batch2-collected"}'
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // Batch 1: 2 items
      expect(runInfo.steps.filter((s) => s.node === "process1")).toHaveLength(2);
      expect(runInfo.steps.find((s) => s.node === "collect1")).toBeDefined();

      // Batch 2: 3 items
      expect(runInfo.steps.filter((s) => s.node === "process2")).toHaveLength(3);
      expect(runInfo.steps.find((s) => s.node === "collect2")).toBeDefined();

      // Two separate batch:start events with different batchIds
      const batchStarts = events.filter(
        (e) => e.type === "batch:start",
      ) as any[];
      expect(batchStarts).toHaveLength(2);
      expect(batchStarts[0].batchId).not.toBe(batchStarts[1].batchId);

      // GLOBAL.results reflects batch2 (last batch to complete)
      const globalUpdates = events.filter(
        (e) =>
          e.type === "global:update" && (e as any).keys.includes("results"),
      ) as any[];
      const lastResults = globalUpdates[globalUpdates.length - 1].patch.results;
      expect(lastResults).toHaveLength(3);
    });
  });

  describe("fan-out + fail-fast", () => {
    it("failed item at join node triggers batch abort", async () => {
      const source = `
# Fan-out fail-fast

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| dispatch
  dispatch ==> branch-a
  dispatch ==> branch-b
  branch-a ==> join
  branch-b ==> join
  join --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["ok", "bad"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## dispatch

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "dispatched"}'
\`\`\`

## branch-a

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "a"}'
\`\`\`

## branch-b

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "b"}'
\`\`\`

## join

\`\`\`bash
item=$(echo "$ITEM" | tr -d '"')
if [ "$item" = "bad" ]; then
  echo 'RESULT: {"edge": "fail", "summary": "join-fail"}'
  exit 1
fi
echo 'RESULT: {"edge": "next", "summary": "join-ok"}'
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

      expect(runInfo.steps.find((s) => s.node === "collect")).toBeUndefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete).toBeDefined();
      expect(batchComplete.status).toBe("error");
    });
  });

  describe("step-level retry within forEach body", () => {
    it("body step with retry config retries in-place", async () => {
      const counterFile = join(tempRunsDir, "step-retry-counter");
      const source = `
# Step-level retry in body

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| flaky ==> finish --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": ["x"]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## flaky

\`\`\`config
retry:
  max: 2
  delay: 1s
\`\`\`

\`\`\`bash
COUNTER_FILE="COUNTER_PLACEHOLDER"
if [ ! -f "$COUNTER_FILE" ]; then
  echo "0" > "$COUNTER_FILE"
fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
if [ "$COUNT" -le 2 ]; then
  echo "RESULT: {\\"edge\\": \\"fail\\", \\"summary\\": \\"fail-$COUNT\\"}"
  exit 1
fi
rm -f "$COUNTER_FILE"
echo 'RESULT: {"edge": "next", "summary": "passed-after-retry"}'
\`\`\`

## finish

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "finished"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(
        source.replace("COUNTER_PLACEHOLDER", counterFile),
      );
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // step:retry events confirm in-place retries (2 retries before success)
      const retryEvents = events.filter((e) => e.type === "step:retry");
      expect(retryEvents).toHaveLength(2);

      // Step-level retry produces a single step:complete (not multiple steps)
      const flakySteps = runInfo.steps.filter((s) => s.node === "flaky");
      expect(flakySteps).toHaveLength(1);
      expect(flakySteps[0].summary).toBe("passed-after-retry");

      expect(runInfo.steps.find((s) => s.node === "finish")).toBeDefined();
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();
    });
  });

  describe("replay roundtrip for fan-out", () => {
    it("replay reconstructs batch state from fan-out events", async () => {
      const source = readFileSync(
        join(FIXTURES, "foreach-fanout.md"),
        "utf-8",
      );
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];
      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      const { replay } = await import("../../src/core/replay.js");
      const persisted = events.filter((e) => e.type !== "step:output");
      const snap = replay(persisted);

      const batches = [...snap.batches.values()];
      expect(batches).toHaveLength(1);
      expect(batches[0].done).toBe(true);
      expect(batches[0].status).toBe("ok");
      expect(batches[0].succeeded).toBe(3);
      expect(batches[0].failed).toBe(0);
      expect(batches[0].results).toHaveLength(3);
      expect(batches[0].results.every((r) => r?.ok)).toBe(true);
    });
  });

  describe("stress: many items with retry + concurrency", () => {
    it("10 items, maxConcurrency:3, mixed retry counts all complete", async () => {
      const counterDir = join(tempRunsDir, "stress-counters");
      const source = `
# Stress retry + concurrency

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| attempt
  attempt ==>|fail max:5| attempt
  attempt ==>|fail:max| fallback
  attempt ==> process
  fallback ==> process
  process --> collect
\`\`\`

# Steps

## produce

\`\`\`config
foreach:
  maxConcurrency: 3
  onItemError: continue
\`\`\`

\`\`\`bash
echo 'LOCAL: {"items": [0, 1, 0, 2, 0, 3, 1, 0, 2, 0]}'
echo 'RESULT: {"edge": "next", "summary": "ok"}'
\`\`\`

## attempt

\`\`\`bash
# ITEM value = number of failures before success. 0 = pass immediately.
item=$ITEM
COUNTER_DIR="COUNTER_DIR_PLACEHOLDER"
mkdir -p "$COUNTER_DIR"
COUNTER_FILE="$COUNTER_DIR/item-$ITEM_INDEX"
if [ ! -f "$COUNTER_FILE" ]; then
  echo "0" > "$COUNTER_FILE"
fi
COUNT=$(cat "$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
if [ "$item" -ge "$COUNT" ]; then
  echo "RESULT: {\\"edge\\": \\"fail\\", \\"summary\\": \\"fail-$COUNT\\"}"
  exit 1
fi
echo 'RESULT: {"edge": "next", "summary": "passed"}'
\`\`\`

## fallback

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "fallback"}'
\`\`\`

## process

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "processed"}'
\`\`\`

## collect

\`\`\`bash
echo 'RESULT: {"edge": "next", "summary": "done"}'
\`\`\`
`;
      const def = parseWorkflowFromString(
        source.replace("COUNTER_DIR_PLACEHOLDER", counterDir),
      );
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");

      // All 10 items complete
      const itemCompletes = events.filter(
        (e) => e.type === "batch:item:complete",
      ) as any[];
      expect(itemCompletes).toHaveLength(10);

      // No items should hit fallback (max retry budget is 5, max item value is 3)
      expect(runInfo.steps.filter((s) => s.node === "fallback")).toHaveLength(0);

      // All 10 reach process
      expect(runInfo.steps.filter((s) => s.node === "process")).toHaveLength(10);

      // Collector ran
      expect(runInfo.steps.find((s) => s.node === "collect")).toBeDefined();

      const batchComplete = events.find(
        (e) => e.type === "batch:complete",
      ) as any;
      expect(batchComplete.succeeded).toBe(10);
      expect(batchComplete.failed).toBe(0);
    });
  });
});

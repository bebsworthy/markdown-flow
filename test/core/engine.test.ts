import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
  type EngineEvent,
  type BeforeStepContext,
} from "../../src/core/index.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("WorkflowEngine", () => {
  let tempRunsDir: string;

  beforeEach(async () => {
    tempRunsDir = await mkdtemp(join(tmpdir(), "markflow-runs-"));
  });

  it("executes a linear workflow end-to-end", async () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });

    expect(runInfo.status).toBe("complete");
    expect(runInfo.steps).toHaveLength(3);
    expect(runInfo.steps.map((s) => s.node)).toEqual([
      "setup",
      "build",
      "report",
    ]);

    // All steps should have exit code 0
    for (const step of runInfo.steps) {
      expect(step.exit_code).toBe(0);
    }

    // Check events
    const stepStarts = events.filter((e) => e.type === "step:start");
    expect(stepStarts).toHaveLength(3);

    const completeEvent = events.find((e) => e.type === "workflow:complete");
    expect(completeEvent).toBeDefined();
  });

  it("executes a parallel workflow with fan-out and fan-in", async () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
    });

    expect(runInfo.status).toBe("complete");
    // start + lint + test + typecheck + merge = 5
    expect(runInfo.steps).toHaveLength(5);

    // merge should be last
    const lastStep = runInfo.steps[runInfo.steps.length - 1];
    expect(lastStep.node).toBe("merge");
  });

  it("throws on missing required inputs", async () => {
    const source = `# Test Workflow

# Inputs

- \`ISSUE_NUMBER\` (required): The issue number
- \`REPO\` (default: "owner/repo"): The repo

# Flow

\`\`\`mermaid
flowchart TD
  step --> done
\`\`\`

# Steps

## step

\`\`\`bash
echo "issue: $ISSUE_NUMBER repo: $REPO"
\`\`\`

## done

\`\`\`bash
echo ok
\`\`\``;

    const def = parseWorkflowFromString(source);

    // No inputs provided — ISSUE_NUMBER is required
    await expect(
      executeWorkflow(def, { runsDir: tempRunsDir }),
    ).rejects.toThrow("Missing required workflow inputs: ISSUE_NUMBER");
  });

  it("resolves inputs: injects defaults and provided values into script env", async () => {
    const source = `# Test Workflow

# Inputs

- \`GREETING\` (required): A greeting word
- \`NAME\` (default: "World"): A name

# Flow

\`\`\`mermaid
flowchart TD
  greet --> done
\`\`\`

# Steps

## greet

\`\`\`bash
echo "$GREETING $NAME"
\`\`\`

## done

\`\`\`bash
echo ok
\`\`\``;

    const def = parseWorkflowFromString(source);
    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      inputs: { GREETING: "Hello" },
    });

    expect(runInfo.status).toBe("complete");
    const greetStep = runInfo.steps.find((s) => s.node === "greet")!;
    expect(greetStep.summary).toContain("Hello World");
  });

  describe("beforeStep hook", () => {
    const RETRY_WITH_START = `# Retry Loop

# Flow

\`\`\`mermaid
flowchart TD
  start --> check
  check -->|pass| done
  check -->|fail max:3| check
  check -->|fail:max| abort
\`\`\`

# Steps

## start
\`\`\`bash
echo "begin"
\`\`\`

## check
\`\`\`bash
echo "check"
\`\`\`

## done
\`\`\`bash
echo "done"
\`\`\`

## abort
\`\`\`bash
echo "abort" >&2
\`\`\`
`;

    it("fires with correct context for each step", async () => {
      const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
      const def = parseWorkflowFromString(source);
      const contexts: BeforeStepContext[] = [];

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: (ctx) => {
          contexts.push(ctx);
        },
      });

      expect(contexts.map((c) => c.nodeId)).toEqual(["setup", "build", "report"]);
      for (const ctx of contexts) {
        expect(ctx.callCount).toBe(1);
        expect(ctx.step).toBeDefined();
        expect(Array.isArray(ctx.outgoingEdges)).toBe(true);
      }
    });

    it("injects MARKFLOW_ env vars with correct values", async () => {
      const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
      const def = parseWorkflowFromString(source);
      const contexts: BeforeStepContext[] = [];

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        workspaceDir: "/tmp/fake-workspace",
        beforeStep: (ctx) => {
          contexts.push(ctx);
        },
      });

      // First step: setup
      const setup = contexts[0];
      expect(setup.env.MARKFLOW_STEP).toBe("setup");
      expect(setup.env.MARKFLOW_RUNDIR).toContain(tempRunsDir);
      expect(setup.env.MARKFLOW_WORKDIR).toContain("workdir");
      expect(setup.env.MARKFLOW_WORKSPACE).toBe("/tmp/fake-workspace");
      expect(setup.env.MARKFLOW_PREV_STEP).toBeUndefined();
      expect(setup.env.MARKFLOW_PREV_EDGE).toBeUndefined();
      expect(setup.env.MARKFLOW_PREV_SUMMARY).toBeUndefined();

      // Second step: build — has PREV_ vars from setup
      const build = contexts[1];
      expect(build.env.MARKFLOW_STEP).toBe("build");
      expect(build.env.MARKFLOW_PREV_STEP).toBe("setup");
      expect(build.env.MARKFLOW_PREV_EDGE).toBeDefined();
      expect(build.env.MARKFLOW_PREV_SUMMARY).toBeDefined();

      // Third step: report — has PREV_ vars from build
      const report = contexts[2];
      expect(report.env.MARKFLOW_STEP).toBe("report");
      expect(report.env.MARKFLOW_PREV_STEP).toBe("build");
    });

    it("omits MARKFLOW_WORKSPACE when no workspaceDir provided", async () => {
      const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
      const def = parseWorkflowFromString(source);
      let env: Record<string, string> | undefined;

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: (ctx) => {
          if (!env) env = ctx.env;
        },
      });

      expect(env!.MARKFLOW_WORKSPACE).toBeUndefined();
      expect(env!.MARKFLOW_WORKDIR).toBeDefined();
    });

    it("void directive lets the step run normally", async () => {
      const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
      const def = parseWorkflowFromString(source);

      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: () => {
          return; // void
        },
      });

      expect(runInfo.status).toBe("complete");
      // Real script execution produces exit_code 0
      for (const step of runInfo.steps) {
        expect(step.exit_code).toBe(0);
      }
    });

    it("mock directive short-circuits execution", async () => {
      const source = readFileSync(join(FIXTURES, "branch.md"), "utf-8");
      const def = parseWorkflowFromString(source);

      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: (ctx) => {
          if (ctx.nodeId === "check") {
            return { edge: "fail", summary: "mocked-fail" };
          }
          return;
        },
      });

      expect(runInfo.status).toBe("complete");
      const checkStep = runInfo.steps.find((s) => s.node === "check")!;
      expect(checkStep.edge).toBe("fail");
      expect(checkStep.summary).toBe("mocked-fail");
      expect(checkStep.exit_code).toBe(1); // script + edge="fail" default
      // fail routes to notify, not deploy
      expect(runInfo.steps.map((s) => s.node)).toContain("notify");
    });

    it("callCount increments across multiple invocations", async () => {
      const def = parseWorkflowFromString(RETRY_WITH_START);
      const counts: number[] = [];
      let n = 0;

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: (ctx) => {
          if (ctx.nodeId === "check") {
            counts.push(ctx.callCount);
            n++;
            return n < 3 ? { edge: "fail" } : { edge: "pass" };
          }
          return;
        },
      });

      expect(counts).toEqual([1, 2, 3]);
    });

    it("exposes retryBudgets with correct counts across retries", async () => {
      const def = parseWorkflowFromString(RETRY_WITH_START);
      const budgets: Array<BeforeStepContext["retryBudgets"]> = [];
      let n = 0;

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: (ctx) => {
          if (ctx.nodeId === "check") {
            budgets.push(ctx.retryBudgets);
            n++;
            return n < 3 ? { edge: "fail" } : { edge: "pass" };
          }
          return;
        },
      });

      // check has "fail max:3" edge — budget should appear
      expect(budgets).toHaveLength(3);

      // First call: no retries consumed yet
      expect(budgets[0]).toEqual([{ label: "fail", count: 0, max: 3 }]);
      // Second call: 1 retry consumed
      expect(budgets[1]).toEqual([{ label: "fail", count: 1, max: 3 }]);
      // Third call: 2 retries consumed
      expect(budgets[2]).toEqual([{ label: "fail", count: 2, max: 3 }]);
    });

    it("retryBudgets is empty for nodes without retry edges", async () => {
      const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
      const def = parseWorkflowFromString(source);
      const allBudgets: Array<BeforeStepContext["retryBudgets"]> = [];

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: (ctx) => {
          allBudgets.push(ctx.retryBudgets);
        },
      });

      for (const budgets of allBudgets) {
        expect(budgets).toEqual([]);
      }
    });

    it("emits retry:increment events during retry loop", async () => {
      const def = parseWorkflowFromString(RETRY_WITH_START);
      const events: EngineEvent[] = [];
      let n = 0;

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
        beforeStep: (ctx) => {
          if (ctx.nodeId === "check") {
            n++;
            return n < 3 ? { edge: "fail" } : { edge: "pass" };
          }
          return;
        },
      });

      const retryEvents = events.filter((e) => e.type === "retry:increment");
      expect(retryEvents).toHaveLength(2);
    });

    it("pre-assembles prompt for agent steps", async () => {
      const source = `# Agent Workflow

# Flow

\`\`\`mermaid
flowchart TD
  think --> done
\`\`\`

# Steps

## think

Analyze the situation and return a decision.

## done

\`\`\`bash
echo ok
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const captured: Record<string, string | undefined> = {};

      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        beforeStep: (ctx) => {
          captured[ctx.nodeId] = ctx.prompt;
          return { edge: ctx.step.type === "agent" ? "done" : "pass" };
        },
      });

      expect(captured.think).toBeDefined();
      expect(captured.think).toContain("Analyze");
      expect(captured.done).toBeUndefined();
    });
  });

  it("routes correctly based on exit code", async () => {
    const source = readFileSync(join(FIXTURES, "branch.md"), "utf-8");
    const def = parseWorkflowFromString(source);

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
    });

    expect(runInfo.status).toBe("complete");
    // check exits 0 → pass → deploy
    expect(runInfo.steps).toHaveLength(2);
    expect(runInfo.steps[0].node).toBe("check");
    expect(runInfo.steps[1].node).toBe("deploy");
  });

  it("propagates top-level ```config block onto WorkflowDefinition", () => {
    const source = `# Config Propagation

\`\`\`config
agent: sonnet
flags:
  - -p
parallel: false
max_retries_default: 2
\`\`\`

# Flow

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

# Steps

## A

\`\`\`bash
echo a
\`\`\`

## B

\`\`\`bash
echo b
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    expect(def.configDefaults).toEqual({
      agent: "sonnet",
      agentFlags: ["-p"],
      parallel: false,
      maxRetriesDefault: 2,
    });
  });

  describe("step timeout", () => {
    it("times out a slow step and routes to fail", async () => {
      const source = `# Timeout Test

# Flow

\`\`\`mermaid
flowchart TD
  slow --> done
  slow -->|fail| recover
  recover --> done
\`\`\`

# Steps

## slow

\`\`\`config
timeout: 1s
\`\`\`

\`\`\`bash
sleep 10
\`\`\`

## recover

\`\`\`bash
echo recovered
\`\`\`

## done

\`\`\`bash
echo done
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      expect(runInfo.status).toBe("complete");
      const slow = runInfo.steps.find((s) => s.node === "slow")!;
      expect(slow.edge).toBe("fail");
      expect(slow.summary).toContain("timeout");

      const timeoutEvent = events.find((e) => e.type === "step:timeout");
      expect(timeoutEvent).toBeDefined();
      expect(timeoutEvent).toMatchObject({
        type: "step:timeout",
        nodeId: "slow",
        limitMs: 1000,
      });

      // Recovery path ran
      expect(runInfo.steps.some((s) => s.node === "recover")).toBe(true);
    }, 15_000);

    it("applies workflow-level timeout_default when step has none", async () => {
      const source = `# Timeout Default

\`\`\`config
timeout_default: 1s
\`\`\`

# Flow

\`\`\`mermaid
flowchart TD
  slow --> done
  slow -->|fail| done
\`\`\`

# Steps

## slow

\`\`\`bash
sleep 10
\`\`\`

## done

\`\`\`bash
echo done
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];
      const runInfo = await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });

      const timeoutEvent = events.find((e) => e.type === "step:timeout");
      expect(timeoutEvent).toBeDefined();
      const slow = runInfo.steps.find((s) => s.node === "slow")!;
      expect(slow.edge).toBe("fail");
    }, 15_000);

    it("per-step timeout overrides workflow default", async () => {
      const source = `# Override

\`\`\`config
timeout_default: 1h
\`\`\`

# Flow

\`\`\`mermaid
flowchart TD
  slow --> done
  slow -->|fail| done
\`\`\`

# Steps

## slow

\`\`\`config
timeout: 1s
\`\`\`

\`\`\`bash
sleep 10
\`\`\`

## done

\`\`\`bash
echo done
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const events: EngineEvent[] = [];
      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        onEvent: (e) => events.push(e),
      });
      const timeoutEvent = events.find((e) => e.type === "step:timeout");
      expect(timeoutEvent).toMatchObject({ nodeId: "slow", limitMs: 1000 });
    }, 15_000);

    it("does not emit step:timeout when user signal aborts", async () => {
      const source = `# Abort

# Flow

\`\`\`mermaid
flowchart TD
  slow --> done
\`\`\`

# Steps

## slow

\`\`\`config
timeout: 1h
\`\`\`

\`\`\`bash
sleep 10
\`\`\`

## done

\`\`\`bash
echo done
\`\`\`
`;
      const def = parseWorkflowFromString(source);
      const controller = new AbortController();
      const events: EngineEvent[] = [];
      setTimeout(() => controller.abort(), 200);
      await executeWorkflow(def, {
        runsDir: tempRunsDir,
        signal: controller.signal,
        onEvent: (e) => events.push(e),
      });
      const timeoutEvent = events.find((e) => e.type === "step:timeout");
      expect(timeoutEvent).toBeUndefined();
    }, 15_000);
  });
});

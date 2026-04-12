import { describe, it, expect } from "vitest";
import { WorkflowTest } from "../../src/testing/index.js";
import { parseWorkflowFromString } from "../../src/core/index.js";
import { assembleAgentPrompt } from "../../src/core/runner/agent.js";
import type { BeforeStepContext, StepResult } from "../../src/core/types.js";

const LINEAR_WORKFLOW = `# Data Passing

# Flow

\`\`\`mermaid
flowchart TD
  step_a --> step_b
  step_b --> step_c
\`\`\`

# Steps

## step_a
\`\`\`bash
echo "a"
\`\`\`

## step_b
\`\`\`bash
echo "b"
\`\`\`

## step_c
\`\`\`bash
echo "c"
\`\`\`
`;

const LOOP_WORKFLOW = `# Loop Test

# Flow

\`\`\`mermaid
flowchart TD
  fetch --> review
  review --> post
  post -->|remaining| review
  post -->|done| finish
\`\`\`

# Steps

## fetch
\`\`\`bash
echo "fetch"
\`\`\`

## review
\`\`\`bash
echo "review"
\`\`\`

## post
\`\`\`bash
echo "post"
\`\`\`

## finish
\`\`\`bash
echo "finish"
\`\`\`
`;

describe("Step data", () => {
  it("emits and persists step data", async () => {
    const def = parseWorkflowFromString(LINEAR_WORKFLOW);
    const wft = new WorkflowTest(def);
    wft.mock("step_a", { edge: "pass", data: { items: [1, 2, 3], cursor: 0 } });
    wft.mock("step_b", { edge: "pass" });
    wft.mock("step_c", { edge: "pass" });

    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.stepData("step_a")).toEqual({ items: [1, 2, 3], cursor: 0 });
    expect(result.stepData("step_b")).toBeUndefined();
  });

  it("provides MARKFLOW_STEPS_JSON to downstream steps", async () => {
    const def = parseWorkflowFromString(LINEAR_WORKFLOW);
    const captured: Record<string, string>[] = [];

    const wft = new WorkflowTest(def);
    wft.mock("step_a", { edge: "pass", data: { color: "blue" } });
    wft.mock("step_b", { edge: "pass" });
    wft.mock("step_c", { edge: "pass" });

    // Use raw executeWorkflow to capture env via beforeStep
    const { executeWorkflow } = await import("../../src/core/index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const runsDir = await mkdtemp(join(tmpdir(), "markflow-test-"));

    await executeWorkflow(def, {
      runsDir,
      beforeStep: (ctx: BeforeStepContext) => {
        captured.push({ ...ctx.env });
        if (ctx.nodeId === "step_a") {
          return { edge: "pass", data: { color: "blue" } };
        }
        return { edge: "pass" };
      },
    });

    // step_b should see step_a's data in MARKFLOW_STEPS_JSON
    const stepBEnv = captured.find((e) => e.MARKFLOW_STEP === "step_b");
    expect(stepBEnv).toBeDefined();
    const stepsJson = JSON.parse(stepBEnv!.MARKFLOW_STEPS_JSON);
    expect(stepsJson.step_a.data).toEqual({ color: "blue" });

    // Flattened env var
    expect(stepBEnv!.MARKFLOW_DATA_STEP_A_COLOR).toBe("blue");
  });
});

describe("Global context", () => {
  it("merges global context from steps", async () => {
    const def = parseWorkflowFromString(LINEAR_WORKFLOW);
    const contexts: BeforeStepContext[] = [];

    const { executeWorkflow } = await import("../../src/core/index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const runsDir = await mkdtemp(join(tmpdir(), "markflow-test-"));

    await executeWorkflow(def, {
      runsDir,
      beforeStep: (ctx: BeforeStepContext) => {
        contexts.push({ ...ctx, env: { ...ctx.env } });
        if (ctx.nodeId === "step_a") {
          return { edge: "pass", global: { api_base: "https://example.com" } };
        }
        if (ctx.nodeId === "step_b") {
          return { edge: "pass", global: { token: "abc123" } };
        }
        return { edge: "pass" };
      },
    });

    // step_b sees step_a's global
    const stepBCtx = contexts.find((c) => c.nodeId === "step_b");
    expect(stepBCtx!.globalContext).toEqual({ api_base: "https://example.com" });

    // step_c sees both globals
    const stepCCtx = contexts.find((c) => c.nodeId === "step_c");
    expect(stepCCtx!.globalContext).toEqual({
      api_base: "https://example.com",
      token: "abc123",
    });

    // MARKFLOW_GLOBAL_JSON env var
    const globalJson = JSON.parse(stepCCtx!.env.MARKFLOW_GLOBAL_JSON);
    expect(globalJson).toEqual({
      api_base: "https://example.com",
      token: "abc123",
    });

    // Flattened global env vars
    expect(stepCCtx!.env.MARKFLOW_GLOBAL_API_BASE).toBe("https://example.com");
    expect(stepCCtx!.env.MARKFLOW_GLOBAL_TOKEN).toBe("abc123");
  });

  it("later steps overwrite global keys", async () => {
    const def = parseWorkflowFromString(LINEAR_WORKFLOW);
    const contexts: BeforeStepContext[] = [];

    const { executeWorkflow } = await import("../../src/core/index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const runsDir = await mkdtemp(join(tmpdir(), "markflow-test-"));

    await executeWorkflow(def, {
      runsDir,
      beforeStep: (ctx: BeforeStepContext) => {
        contexts.push({ ...ctx, env: { ...ctx.env } });
        if (ctx.nodeId === "step_a") {
          return { edge: "pass", global: { mode: "draft" } };
        }
        if (ctx.nodeId === "step_b") {
          return { edge: "pass", global: { mode: "final" } };
        }
        return { edge: "pass" };
      },
    });

    const stepCCtx = contexts.find((c) => c.nodeId === "step_c");
    expect(stepCCtx!.globalContext.mode).toBe("final");
  });
});

describe("Back-edge loop with step data", () => {
  it("iterates through items using data cursor", async () => {
    const def = parseWorkflowFromString(LOOP_WORKFLOW);
    const wft = new WorkflowTest(def);
    const items = ["issue-1", "issue-2", "issue-3"];

    wft.mock("fetch", { edge: "pass", data: { issues: items } });
    wft.mock("review", { edge: "pass" });
    wft.mock("post", [
      { edge: "remaining", data: { cursor: 1 } },
      { edge: "remaining", data: { cursor: 2 } },
      { edge: "done", data: { cursor: 3 } },
    ]);
    wft.mock("finish", { edge: "pass" });

    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.callCount("review")).toBe(3);
    expect(result.callCount("post")).toBe(3);
    expect(result.callCount("finish")).toBe(1);

    // Each post invocation advanced the cursor
    expect(result.stepData("post", 1)).toEqual({ cursor: 1 });
    expect(result.stepData("post", 2)).toEqual({ cursor: 2 });
    expect(result.stepData("post", 3)).toEqual({ cursor: 3 });
  });

  it("makes loop data visible via MARKFLOW_STEPS_JSON", async () => {
    const def = parseWorkflowFromString(LOOP_WORKFLOW);
    const capturedEnvs: Record<string, Record<string, string>> = {};

    const { executeWorkflow } = await import("../../src/core/index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const runsDir = await mkdtemp(join(tmpdir(), "markflow-test-"));

    let reviewCount = 0;
    let postCount = 0;

    await executeWorkflow(def, {
      runsDir,
      beforeStep: (ctx: BeforeStepContext) => {
        if (ctx.nodeId === "fetch") {
          return { edge: "pass", data: { issues: ["a", "b"] } };
        }
        if (ctx.nodeId === "review") {
          reviewCount++;
          capturedEnvs[`review_${reviewCount}`] = { ...ctx.env };
          return { edge: "pass" };
        }
        if (ctx.nodeId === "post") {
          postCount++;
          if (postCount < 2) {
            return { edge: "remaining", data: { cursor: postCount } };
          }
          return { edge: "done", data: { cursor: postCount } };
        }
        return { edge: "pass" };
      },
    });

    // On second review iteration, MARKFLOW_STEPS_JSON should have post's data from iteration 1
    const stepsJson = JSON.parse(capturedEnvs.review_2.MARKFLOW_STEPS_JSON);
    expect(stepsJson.post.data).toEqual({ cursor: 1 });
    expect(stepsJson.fetch.data).toEqual({ issues: ["a", "b"] });
  });
});

describe("Agent prompt includes step data", () => {
  it("shows data in context section", () => {
    const context: StepResult[] = [
      {
        node: "fetch",
        type: "script",
        edge: "pass",
        summary: "fetched 3 issues",
        data: { count: 3, source: "github" },
        started_at: "2024-01-01T00:00:00Z",
        completed_at: "2024-01-01T00:00:01Z",
        exit_code: 0,
      },
    ];

    const prompt = assembleAgentPrompt(
      { id: "review", type: "agent", content: "Review the issues" },
      context,
      ["pass", "fail"],
      "/tmp/workdir",
    );

    expect(prompt).toContain("fetch (script): fetched 3 issues");
    expect(prompt).toContain('Data: {"count":3,"source":"github"}');
  });
});

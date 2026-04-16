import { describe, it, expect } from "vitest";
import { WorkflowTest } from "../../src/testing/index.js";
import { parseWorkflowFromString } from "../../src/core/index.js";
import { assembleAgentPrompt } from "../../src/core/runner/agent.js";
import type { BeforeStepContext, StepResult } from "../../src/core/types.js";

const LINEAR_WORKFLOW = `# Local/Global Passing

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

describe("Step-local state", () => {
  it("emits and persists step-local state", async () => {
    const def = parseWorkflowFromString(LINEAR_WORKFLOW);
    const wft = new WorkflowTest(def);
    wft.mock("step_a", { edge: "pass", local: { items: [1, 2, 3], cursor: 0 } });
    wft.mock("step_b", { edge: "pass" });
    wft.mock("step_c", { edge: "pass" });

    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.stepLocal("step_a")).toEqual({ items: [1, 2, 3], cursor: 0 });
    expect(result.stepLocal("step_b")).toBeUndefined();
  });

  it("provides $STEPS to downstream steps", async () => {
    const def = parseWorkflowFromString(LINEAR_WORKFLOW);
    const captured: Record<string, string>[] = [];

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
          return { edge: "pass", local: { color: "blue" } };
        }
        return { edge: "pass" };
      },
    });

    const stepBEnv = captured.find((e) => e.MARKFLOW_STEP === "step_b");
    expect(stepBEnv).toBeDefined();
    const stepsJson = JSON.parse(stepBEnv!.STEPS);
    expect(stepsJson.step_a.local).toEqual({ color: "blue" });

    expect(stepBEnv!.MARKFLOW_DATA_STEP_A_COLOR).toBeUndefined();
    expect(stepBEnv!.LOCAL).toBe("{}");
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

    const stepBCtx = contexts.find((c) => c.nodeId === "step_b");
    expect(stepBCtx!.globalContext).toEqual({ api_base: "https://example.com" });

    const stepCCtx = contexts.find((c) => c.nodeId === "step_c");
    expect(stepCCtx!.globalContext).toEqual({
      api_base: "https://example.com",
      token: "abc123",
    });

    const globalJson = JSON.parse(stepCCtx!.env.GLOBAL);
    expect(globalJson).toEqual({
      api_base: "https://example.com",
      token: "abc123",
    });
    expect(stepCCtx!.env.MARKFLOW_GLOBAL_API_BASE).toBeUndefined();
    expect(stepCCtx!.env.MARKFLOW_GLOBAL_TOKEN).toBeUndefined();
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

describe("Back-edge loop with step-local state", () => {
  it("iterates through items using local cursor", async () => {
    const def = parseWorkflowFromString(LOOP_WORKFLOW);
    const wft = new WorkflowTest(def);
    const items = ["issue-1", "issue-2", "issue-3"];

    wft.mock("fetch", { edge: "pass", local: { issues: items } });
    wft.mock("review", { edge: "pass" });
    wft.mock("post", [
      { edge: "remaining", local: { cursor: 1 } },
      { edge: "remaining", local: { cursor: 2 } },
      { edge: "done", local: { cursor: 3 } },
    ]);
    wft.mock("finish", { edge: "pass" });

    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.callCount("review")).toBe(3);
    expect(result.callCount("post")).toBe(3);
    expect(result.callCount("finish")).toBe(1);

    expect(result.stepLocal("post", 1)).toEqual({ cursor: 1 });
    expect(result.stepLocal("post", 2)).toEqual({ cursor: 2 });
    expect(result.stepLocal("post", 3)).toEqual({ cursor: 3 });
  });

  it("injects $LOCAL with prior local state on self-reentry", async () => {
    const def = parseWorkflowFromString(LOOP_WORKFLOW);
    const capturedEnvs: Record<string, Record<string, string>> = {};

    const { executeWorkflow } = await import("../../src/core/index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const runsDir = await mkdtemp(join(tmpdir(), "markflow-test-"));

    let postCount = 0;

    await executeWorkflow(def, {
      runsDir,
      beforeStep: (ctx: BeforeStepContext) => {
        if (ctx.nodeId === "post") {
          postCount++;
          capturedEnvs[`post_${postCount}`] = { ...ctx.env };
          if (postCount < 3) {
            return { edge: "remaining", local: { cursor: postCount } };
          }
          return { edge: "done", local: { cursor: postCount } };
        }
        if (ctx.nodeId === "fetch") {
          return { edge: "pass", local: { issues: ["a", "b", "c"] } };
        }
        return { edge: "pass" };
      },
    });

    expect(capturedEnvs.post_1.LOCAL).toBe("{}");
    expect(JSON.parse(capturedEnvs.post_2.LOCAL)).toEqual({ cursor: 1 });
    expect(JSON.parse(capturedEnvs.post_3.LOCAL)).toEqual({ cursor: 2 });
  });

  it("exposes loop state via $STEPS", async () => {
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
          return { edge: "pass", local: { issues: ["a", "b"] } };
        }
        if (ctx.nodeId === "review") {
          reviewCount++;
          capturedEnvs[`review_${reviewCount}`] = { ...ctx.env };
          return { edge: "pass" };
        }
        if (ctx.nodeId === "post") {
          postCount++;
          if (postCount < 2) {
            return { edge: "remaining", local: { cursor: postCount } };
          }
          return { edge: "done", local: { cursor: postCount } };
        }
        return { edge: "pass" };
      },
    });

    const stepsJson = JSON.parse(capturedEnvs.review_2.STEPS);
    expect(stepsJson.post.local).toEqual({ cursor: 1 });
    expect(stepsJson.fetch.local).toEqual({ issues: ["a", "b"] });
  });
});

describe("Streaming LOCAL/GLOBAL via script stdout", () => {
  const MERGE_WORKFLOW = `# Merge

# Flow

\`\`\`mermaid
flowchart TD
  emit --> done
\`\`\`

# Steps

## emit
\`\`\`bash
echo 'LOCAL: {"a": 1}'
echo 'LOCAL: {"b": 2}'
echo 'LOCAL: {"a": "x", "c": 3}'
echo 'GLOBAL: {"region": "eu"}'
echo 'GLOBAL: {"tier": "pro"}'
echo 'RESULT: {"edge": "pass"}'
\`\`\`

## done
\`\`\`bash
echo "done"
\`\`\`
`;

  it("shallow-merges multiple LOCAL lines (later keys win)", async () => {
    const def = parseWorkflowFromString(MERGE_WORKFLOW);
    const wft = new WorkflowTest(def);
    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.stepLocal("emit")).toEqual({ a: "x", b: 2, c: 3 });
  });

  it("propagates GLOBAL to subsequent steps via $GLOBAL", async () => {
    const def = parseWorkflowFromString(`# Merge

# Flow

\`\`\`mermaid
flowchart TD
  emit --> done
\`\`\`

# Steps

## emit
\`\`\`bash
echo 'GLOBAL: {"region": "eu"}'
echo 'GLOBAL: {"tier": "pro"}'
echo 'RESULT: {"edge": "pass"}'
\`\`\`

## done
\`\`\`bash
echo "done"
\`\`\`
`);

    const capturedEnv: Record<string, string> = {};

    const { executeWorkflow } = await import("../../src/core/index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const runsDir = await mkdtemp(join(tmpdir(), "markflow-test-"));

    await executeWorkflow(def, {
      runsDir,
      beforeStep: (ctx: BeforeStepContext) => {
        if (ctx.nodeId === "done") {
          Object.assign(capturedEnv, ctx.env);
          return { edge: "pass" };
        }
        return;
      },
    });

    expect(JSON.parse(capturedEnv.GLOBAL)).toEqual({
      region: "eu",
      tier: "pro",
    });
  });

  it("hard-errors when RESULT carries a local key", async () => {
    const ERR_WORKFLOW = `# Bad

# Flow

\`\`\`mermaid
flowchart TD
  emit --> done
\`\`\`

# Steps

## emit
\`\`\`bash
echo 'RESULT: {"edge": "pass", "local": {"x": 1}}'
\`\`\`

## done
\`\`\`bash
echo "done"
\`\`\`
`;
    const def = parseWorkflowFromString(ERR_WORKFLOW);
    const wft = new WorkflowTest(def);
    const result = await wft.run();
    const emit = result.stepResult("emit");
    expect(emit.exit_code).not.toBe(0);
  });
});

describe("Agent prompt template access to prior step-local state", () => {
  const context: StepResult[] = [
    {
      node: "fetch",
      type: "script",
      edge: "pass",
      summary: "fetched 3 issues",
      local: { count: 3, source: "github" },
      started_at: "2024-01-01T00:00:00Z",
      completed_at: "2024-01-01T00:00:01Z",
      exit_code: 0,
    },
  ];

  it("does NOT auto-inject a workflow context section", () => {
    const prompt = assembleAgentPrompt(
      { id: "review", type: "agent", content: "Review the issues" },
      context,
      ["pass", "fail"],
      "/tmp/workdir",
    );
    expect(prompt).not.toContain("fetch (script)");
    expect(prompt).not.toContain("Workflow Context");
  });

  it("substitutes {{ STEPS.<id>.local.* }} paths in the prompt body", () => {
    const prompt = assembleAgentPrompt(
      {
        id: "review",
        type: "agent",
        content: "There are {{ STEPS.fetch.local.count }} issues from {{ STEPS.fetch.local.source }}.",
      },
      context,
      ["pass", "fail"],
      "/tmp/workdir",
    );
    expect(prompt).toContain("There are 3 issues from github.");
  });

  it("substitutes {{ STEPS.<id>.summary }} and {{ STEPS.<id>.edge }}", () => {
    const prompt = assembleAgentPrompt(
      {
        id: "review",
        type: "agent",
        content: "Fetch said '{{ STEPS.fetch.summary }}' and took edge {{ STEPS.fetch.edge }}.",
      },
      context,
      ["pass", "fail"],
      "/tmp/workdir",
    );
    expect(prompt).toContain("Fetch said 'fetched 3 issues' and took edge pass.");
  });

  it("substitutes {{ GLOBAL.* }} paths", () => {
    const prompt = assembleAgentPrompt(
      {
        id: "review",
        type: "agent",
        content: "Using {{ GLOBAL.api_base }}",
      },
      context,
      ["pass"],
      "/tmp/workdir",
      {},
      { api_base: "https://example.com" },
    );
    expect(prompt).toContain("Using https://example.com");
  });

  it("iterates over a STEPS.<id>.local.* array with {% for %}", () => {
    const ctxWithArray: StepResult[] = [
      {
        node: "fetch",
        type: "script",
        edge: "pass",
        summary: "",
        local: { labels: [{ name: "Bug" }, { name: "Feature" }] },
        started_at: "",
        completed_at: "",
        exit_code: 0,
      },
    ];
    const prompt = assembleAgentPrompt(
      {
        id: "review",
        type: "agent",
        content:
          "Labels:\n{% for l in STEPS.fetch.local.labels %}- {{ l.name }}\n{% endfor %}",
      },
      ctxWithArray,
      ["pass"],
      "/tmp/workdir",
    );
    expect(prompt).toContain("- Bug\n- Feature\n");
  });

  it("errors on unresolved STEPS path", () => {
    expect(() =>
      assembleAgentPrompt(
        {
          id: "review",
          type: "agent",
          content: "{{ STEPS.nonexistent.local.x }}",
        },
        context,
        ["pass"],
        "/tmp/workdir",
      ),
    ).toThrow(/STEPS\.nonexistent/);
  });
});

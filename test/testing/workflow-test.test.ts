import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkflowTest } from "../../src/testing/index.js";
import { parseWorkflowFromString } from "../../src/core/index.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

async function loadDef(name: string) {
  const source = await readFile(join(FIXTURES, name), "utf-8");
  return parseWorkflowFromString(source);
}

// Retry fixture with a proper start node so the engine can execute it.
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

describe("WorkflowTest", () => {
  it("runs an unmocked workflow for real", async () => {
    const def = await loadDef("linear.md");
    const wft = new WorkflowTest(def);
    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.stepsRan).toEqual(["setup", "build", "report"]);
  });

  it("mocks a single step — all calls return the same result", async () => {
    const def = await loadDef("branch.md");
    const wft = new WorkflowTest(def);
    wft.mock("check", { edge: "fail" });
    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.stepsRan).toEqual(["check", "notify"]);
    expect(result.edgeTaken("check")).toBe("fail");
  });

  it("supports sequential mocks — each call consumes the next entry, last repeats", async () => {
    const def = parseWorkflowFromString(RETRY_WITH_START);
    const wft = new WorkflowTest(def);
    wft.mock("check", [
      { edge: "fail" },
      { edge: "fail" },
      { edge: "pass" },
    ]);
    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.callCount("check")).toBe(3);
    expect(result.edgeTaken("check", 1)).toBe("fail");
    expect(result.edgeTaken("check", 2)).toBe("fail");
    expect(result.edgeTaken("check", 3)).toBe("pass");
    expect(result.stepsRan).toEqual(["start", "check", "check", "check", "done"]);
  });

  it("retry:increment events fire during retry loop", async () => {
    const def = parseWorkflowFromString(RETRY_WITH_START);
    const wft = new WorkflowTest(def);
    wft.mock("check", [{ edge: "fail" }, { edge: "fail" }, { edge: "pass" }]);
    const result = await wft.run();
    const retryEvents = result.events.filter(
      (e) => e.type === "retry:increment",
    );
    expect(retryEvents).toHaveLength(2);
  });

  it("failure path: exhausted retries route to :max handler", async () => {
    const def = parseWorkflowFromString(RETRY_WITH_START);
    const wft = new WorkflowTest(def);
    wft.mock("check", { edge: "fail" }); // always fails → exhaust retries
    const result = await wft.run();
    expect(result.stepsRan).toContain("abort");
    const exhausted = result.events.filter(
      (e) => e.type === "retry:exhausted",
    );
    expect(exhausted).toHaveLength(1);
  });

  it("workspaceSetup seeds files before first step", async () => {
    const def = await loadDef("linear.md");
    const wft = new WorkflowTest(def);
    let seededDir: string | undefined;
    await wft.run({
      workspaceSetup: async (dir) => {
        seededDir = dir;
      },
    });
    expect(seededDir).toBeDefined();
    expect(seededDir).toContain("markflow-test-");
  });

  it("keepRunsDir preserves the output directory", async () => {
    const def = await loadDef("linear.md");
    const wft = new WorkflowTest(def);
    const result = await wft.run({ keepRunsDir: true });
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(result.runsDir);
    expect(entries.length).toBeGreaterThan(0);
    // cleanup
    const { rm } = await import("node:fs/promises");
    await rm(result.runsDir, { recursive: true, force: true });
  });

  it("callCount returns 0 for nodes that never fired", async () => {
    const def = await loadDef("branch.md");
    const wft = new WorkflowTest(def);
    wft.mock("check", { edge: "pass" });
    const result = await wft.run();
    expect(result.callCount("notify")).toBe(0);
    expect(result.callCount("deploy")).toBe(1);
  });

  it("stepResult throws for nodes that never fired", async () => {
    const def = await loadDef("branch.md");
    const wft = new WorkflowTest(def);
    wft.mock("check", { edge: "pass" });
    const result = await wft.run();
    expect(() => result.stepResult("notify")).toThrow(/only fired 0/);
  });

  it("defaults edge to 'pass' for scripts, 'done' for agents", async () => {
    const def = await loadDef("linear.md");
    const wft = new WorkflowTest(def);
    wft.mock("setup", {}); // no edge — scripts default to "pass"
    wft.mock("build", {});
    wft.mock("report", {});
    const result = await wft.run();
    expect(result.status).toBe("complete");
    expect(result.edgeTaken("setup")).toBe("pass");
  });

  it("fromFile parses a workflow from disk", async () => {
    const wft = await WorkflowTest.fromFile(join(FIXTURES, "linear.md"));
    const result = await wft.run();
    expect(result.status).toBe("complete");
  });
});

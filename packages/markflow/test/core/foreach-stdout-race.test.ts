import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
} from "../../src/core/index.js";

describe("forEach stdout race condition", () => {
  let tempRunsDir: string;

  beforeEach(async () => {
    tempRunsDir = await mkdtemp(join(tmpdir(), "markflow-race-"));
  });

  afterEach(async () => {
    await rm(tempRunsDir, { recursive: true, force: true });
  });

  it("all concurrent forEach items capture stdout reliably", async () => {
    const itemCount = 20;
    const items = Array.from({ length: itemCount }, (_, i) => i).join(",");
    const source = `
# Stdout race test

# Flow

\`\`\`mermaid
flowchart TD
  produce ==>|each: items| process --> collect
\`\`\`

# Steps

## produce

\`\`\`bash
echo 'LOCAL: {"items": [${items}]}'
echo "RESULT: next | ok"
\`\`\`

## process

\`\`\`bash
echo "RESULT: next | item-$ITEM"
\`\`\`

## collect

\`\`\`bash
echo "RESULT: next | done"
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });

    expect(runInfo.status).toBe("complete");
    const processResults = runInfo.steps.filter((s) => s.node === "process");
    expect(processResults).toHaveLength(itemCount);

    const summaries = processResults.map((r) => r.summary);
    for (let i = 0; i < itemCount; i++) {
      expect(summaries).toContain(`item-${i}`);
    }
    expect(summaries.every((s) => s && s.length > 0)).toBe(true);
  });
});

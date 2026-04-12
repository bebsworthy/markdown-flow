import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkflowFromString } from "../../src/core/index.js";
import {
  getStartNodes,
  getTerminalNodes,
  isMergeNode,
  getUpstreamNodes,
  getFanOutTargets,
} from "../../src/core/graph.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("graph utilities", () => {
  it("finds start nodes in linear workflow", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    expect(getStartNodes(def.graph)).toEqual(["setup"]);
  });

  it("finds terminal nodes in linear workflow", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    expect(getTerminalNodes(def.graph)).toEqual(["report"]);
  });

  it("detects merge nodes in parallel workflow", () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    expect(isMergeNode(def.graph, "merge")).toBe(true);
    expect(isMergeNode(def.graph, "lint")).toBe(false);
  });

  it("finds upstream nodes", () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const upstreams = getUpstreamNodes(def.graph, "merge");
    expect(upstreams).toContain("lint");
    expect(upstreams).toContain("test");
    expect(upstreams).toContain("typecheck");
  });

  it("detects fan-out targets", () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const targets = getFanOutTargets(def.graph, "start");
    expect(targets).toContain("lint");
    expect(targets).toContain("test");
    expect(targets).toContain("typecheck");
    expect(targets).toHaveLength(3);
  });

  it("prefers explicitly-marked start nodes over topology", () => {
    const source = `# Loop

# Flow

\`\`\`mermaid
flowchart TD
  emit([Start]) -->|next| check
  check --> emit
\`\`\`

# Steps

## emit
\`\`\`bash
echo "emit"
\`\`\`

## check
\`\`\`bash
echo "check"
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    expect(getStartNodes(def.graph)).toEqual(["emit"]);
  });

  it("does NOT treat labeled-edge convergence as a merge node", () => {
    // A node with multiple labeled incoming edges is an or-join (any one token fires it),
    // not an and-join (parallel merge). This was a deadlock bug: the error node in
    // plane-ticket-analysis had two labeled incoming edges (|fail| from fetch-ticket and
    // |fail:max| from post-comment). The engine was waiting for both upstreams before
    // firing — but when one upstream routed to error, the other never ran.
    const source = `# Branch Convergence Test

# Flow

\`\`\`mermaid
flowchart TD
  stepA -->|fail| error
  stepB -->|fail| error
  stepA -->|pass| done
  stepB -->|pass| done
\`\`\`

# Steps

## stepA
\`\`\`bash
echo "RESULT: {\"edge\": \"pass\"}"
\`\`\`

## stepB
\`\`\`bash
echo "RESULT: {\"edge\": \"pass\"}"
\`\`\`

## done
\`\`\`bash
echo "done"
\`\`\`

## error
\`\`\`bash
echo "error" >&2
exit 1
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    // error has two labeled incoming edges — must be or-join, not and-join
    expect(isMergeNode(def.graph, "error")).toBe(false);
    // done also has two labeled incoming edges
    expect(isMergeNode(def.graph, "done")).toBe(false);
  });
});

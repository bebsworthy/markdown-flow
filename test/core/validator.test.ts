import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkflowFromString, validateWorkflow } from "../../src/core/index.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("validateWorkflow", () => {
  it("passes for a valid linear workflow", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("passes for a valid retry workflow", () => {
    const source = readFileSync(join(FIXTURES, "retry.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("detects missing step definition", () => {
    const source = readFileSync(
      join(FIXTURES, "invalid/missing-step.md"),
      "utf-8",
    );
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("deploy");
  });

  it("detects missing retry handler", () => {
    const source = readFileSync(
      join(FIXTURES, "invalid/bad-retry.md"),
      "utf-8",
    );
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("fail:max");
  });

  it("warns on orphan steps", () => {
    const source = `# Test

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

## orphan

\`\`\`bash
echo orphan
\`\`\``;

    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain("orphan");
  });

  it("warns on mixed labelled/unlabelled edges", () => {
    const source = readFileSync(
      join(FIXTURES, "invalid/mixed-edges.md"),
      "utf-8",
    );
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.some((w) => w.message.includes("labelled and unlabelled"))).toBe(true);
  });

  it("warns on unreachable nodes", () => {
    const source = readFileSync(
      join(FIXTURES, "invalid/unreachable-node.md"),
      "utf-8",
    );
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    const unreachable = warnings.filter((w) => w.message.includes("unreachable"));
    expect(unreachable.length).toBeGreaterThan(0);
    expect(unreachable.some((w) => w.nodeId === "orphan")).toBe(true);
    expect(unreachable.some((w) => w.nodeId === "nowhere")).toBe(true);
  });

  it("detects duplicate input names", () => {
    const source = `# Test

# Inputs

- \`FOO\` (required): First
- \`FOO\` (required): Second

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
\`\`\``;

    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.some((e) => e.message.includes('Input "FOO"'))).toBe(true);
  });

  it("includes source file on diagnostics", () => {
    const source = readFileSync(
      join(FIXTURES, "invalid/missing-step.md"),
      "utf-8",
    );
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors[0].source).toBe("<string>");
  });

  it("includes line numbers on orphan step diagnostics", () => {
    const source = `# Test

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

## orphan

\`\`\`bash
echo orphan
\`\`\``;

    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const warnings = diagnostics.filter((d) => d.severity === "warning" && d.nodeId === "orphan");
    expect(warnings.length).toBe(1);
    expect(warnings[0].line).toBeTypeOf("number");
    expect(warnings[0].line).toBeGreaterThan(0);
  });

  it("errors on multiple start nodes", () => {
    const source = `# Test

# Flow

\`\`\`mermaid
flowchart TD
  A --> C
  B --> C
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

## C

\`\`\`bash
echo c
\`\`\``;

    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.some((e) => e.message.includes("2 start nodes"))).toBe(true);
    expect(errors.some((e) => e.message.includes("A"))).toBe(true);
    expect(errors.some((e) => e.message.includes("B"))).toBe(true);
  });

  it("detects duplicate edge labels", () => {
    const source = `# Test

# Flow

\`\`\`mermaid
flowchart TD
  A -->|pass| B
  A -->|pass| C
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

## C

\`\`\`bash
echo c
\`\`\``;

    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("pass");
  });

  it("warns when a step has both `retry` config and edge-level `max:N`", () => {
    const source = `# Dual Retry
# Flow
\`\`\`mermaid
flowchart TD
  tryit([tryit]) --> done
  tryit -->|fail max:3| tryit
  tryit -->|fail:max| handler
\`\`\`
# Steps
## tryit
\`\`\`config
retry:
  max: 5
\`\`\`
\`\`\`bash
exit 1
\`\`\`
## done
\`\`\`bash
echo ok
\`\`\`
## handler
\`\`\`bash
echo handled
\`\`\`
`;
    const def = parseWorkflowFromString(source);
    const diagnostics = validateWorkflow(def);
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    const dualWarning = warnings.find((d) =>
      d.message.includes("both a `retry` config"),
    );
    expect(dualWarning).toBeDefined();
    expect(dualWarning!.nodeId).toBe("tryit");
  });
});

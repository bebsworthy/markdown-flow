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
});

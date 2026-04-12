import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdownSections } from "../../../src/core/parser/markdown.js";

const FIXTURES = join(import.meta.dirname, "../../fixtures");

describe("parseMarkdownSections", () => {
  it("parses a linear workflow", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const sections = parseMarkdownSections(source);

    expect(sections.name).toBe("Simple Pipeline");
    expect(sections.description).toContain("basic linear workflow");
    expect(sections.mermaidSource).toContain("setup --> build");
    expect(sections.steps).toHaveLength(3);
  });

  it("extracts step types correctly", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const sections = parseMarkdownSections(source);

    for (const step of sections.steps) {
      expect(step.type).toBe("script");
      expect(step.lang).toBe("bash");
      expect(step.content).toBeTruthy();
    }
  });

  it("parses a retry workflow", () => {
    const source = readFileSync(join(FIXTURES, "retry.md"), "utf-8");
    const sections = parseMarkdownSections(source);

    expect(sections.name).toBe("Retry Workflow");
    expect(sections.steps).toHaveLength(4);
    const stepIds = sections.steps.map((s) => s.id);
    expect(stepIds).toContain("test");
    expect(stepIds).toContain("fix");
    expect(stepIds).toContain("done");
    expect(stepIds).toContain("abort");
  });

  it("throws on missing Flow section", () => {
    const source = `# Test\n# Steps\n## a\n\`\`\`bash\necho hi\n\`\`\``;
    expect(() => parseMarkdownSections(source)).toThrow("# Flow");
  });

  it("throws on missing Steps section", () => {
    const source = `# Test\n# Flow\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\``;
    expect(() => parseMarkdownSections(source)).toThrow("# Steps");
  });

  it("parses an Inputs section", () => {
    const source = `# My Workflow

# Inputs

- \`ISSUE_NUMBER\` (required): The GitHub issue number
- \`REPO\` (default: \`owner/repo\`): Repository in owner/repo format
- \`LABEL\` (optional): Filter by label

# Flow

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

# Steps

## A

\`\`\`bash
echo hi
\`\`\`

## B

\`\`\`bash
echo done
\`\`\``;

    const sections = parseMarkdownSections(source);
    expect(sections.inputs).toHaveLength(3);

    const [req, def, opt] = sections.inputs;
    expect(req).toEqual({ name: "ISSUE_NUMBER", required: true, description: "The GitHub issue number" });
    expect(def).toEqual({ name: "REPO", required: false, default: "owner/repo", description: "Repository in owner/repo format" });
    expect(opt).toEqual({ name: "LABEL", required: false, description: "Filter by label" });
  });

  it("returns empty inputs array when no Inputs section exists", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const sections = parseMarkdownSections(source);
    expect(sections.inputs).toEqual([]);
  });

  it("parses a config block in an agent step", () => {
    const source = `# My Workflow

# Flow

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

# Steps

## A

\`\`\`config
agent: gpt4
flags:
  - --temperature
  - "0.2"
\`\`\`

Analyze the issue and summarize.

## B

\`\`\`bash
echo done
\`\`\``;

    const sections = parseMarkdownSections(source);
    const stepA = sections.steps.find((s) => s.id === "A")!;
    expect(stepA.type).toBe("agent");
    expect(stepA.content).toContain("Analyze the issue");
    expect(stepA.agentConfig).toEqual({ agent: "gpt4", flags: ["--temperature", '"0.2"'] });

    const stepB = sections.steps.find((s) => s.id === "B")!;
    expect(stepB.type).toBe("script");
    expect(stepB.agentConfig).toBeUndefined();
  });

  it("throws on unsupported code block language", () => {
    const source = `# Test

# Flow

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

# Steps

## A

\`\`\`ruby
puts "hello"
\`\`\`

## B

\`\`\`bash
echo hi
\`\`\``;
    expect(() => parseMarkdownSections(source)).toThrow("unsupported language");
  });

  it("preserves the full agent step body verbatim (lists, headings, nested fences, quotes)", () => {
    const source = `# T

# Flow

\`\`\`mermaid
flowchart TD
  classify([start]) --> done
\`\`\`

# Steps

## classify

\`\`\`config
agent: claude
flags:
  - -p
\`\`\`

Pick exactly one label:

- \`Bug\` — something is broken
- \`Improvement\` — feature request
- \`Other\` — anything else

### Output format

Emit:

\`\`\`
STATE: {"label": "<choice>"}
\`\`\`

> Note: avoid guessing.

## done

\`\`\`bash
echo done
\`\`\`
`;
    const sections = parseMarkdownSections(source);
    const classify = sections.steps.find((s) => s.id === "classify")!;
    expect(classify.type).toBe("agent");
    expect(classify.content).toContain("Pick exactly one label");
    expect(classify.content).toContain("- `Bug` — something is broken");
    expect(classify.content).toContain("- `Improvement` — feature request");
    expect(classify.content).toContain("### Output format");
    expect(classify.content).toContain('STATE: {"label": "<choice>"}');
    expect(classify.content).toContain("> Note: avoid guessing.");
    // The config block itself must not leak into the prompt body.
    expect(classify.content).not.toContain("agent: claude");
    expect(classify.content).not.toContain("```config");
  });

  it("preserves prose agent step (no config block) verbatim", () => {
    const source = `# T

# Flow

\`\`\`mermaid
flowchart TD
  a([s]) --> b
\`\`\`

# Steps

## a

Review the PR.

1. Check tests
2. Check lint

End.

## b

\`\`\`bash
echo ok
\`\`\`
`;
    const sections = parseMarkdownSections(source);
    const a = sections.steps.find((s) => s.id === "a")!;
    expect(a.type).toBe("agent");
    expect(a.content).toContain("Review the PR.");
    expect(a.content).toContain("1. Check tests");
    expect(a.content).toContain("2. Check lint");
    expect(a.content).toContain("End.");
  });
});

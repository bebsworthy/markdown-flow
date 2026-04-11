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
});

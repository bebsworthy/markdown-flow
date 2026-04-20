import { describe, it, expect } from "vitest";
import { parseEnvContent } from "../../src/core/env.js";

describe("parseEnvContent", () => {
  it("parses simple KEY=VALUE pairs", () => {
    const result = parseEnvContent("FOO=bar\nBAZ=qux");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips double-quoted values", () => {
    const result = parseEnvContent('KEY="hello world"');
    expect(result).toEqual({ KEY: "hello world" });
  });

  it("strips single-quoted values", () => {
    const result = parseEnvContent("KEY='hello world'");
    expect(result).toEqual({ KEY: "hello world" });
  });

  it("skips comment lines and blank lines", () => {
    const result = parseEnvContent("# comment\n\nFOO=bar\n# another");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("skips lines without an equals sign", () => {
    const result = parseEnvContent("INVALID\nGOOD=yes");
    expect(result).toEqual({ GOOD: "yes" });
  });

  it("handles empty values", () => {
    const result = parseEnvContent("EMPTY=");
    expect(result).toEqual({ EMPTY: "" });
  });

  // Protects against: mismatched quotes passing through unstripped
  it("does not strip mismatched quotes", () => {
    const result = parseEnvContent('KEY="hello\'');
    expect(result).toEqual({ KEY: '"hello\'' });
  });

  // Protects against: empty key being accepted as a valid variable
  it("skips entries with empty key (=value)", () => {
    const result = parseEnvContent("=value\nGOOD=yes");
    expect(result).toEqual({ GOOD: "yes" });
  });

  // Protects against: values with = signs being split incorrectly
  it("preserves equals signs within the value", () => {
    const result = parseEnvContent("URL=https://host?a=1&b=2");
    expect(result).toEqual({ URL: "https://host?a=1&b=2" });
  });
});

describe("input layer resolution (engine)", () => {
  it("env file overrides process.env, --input overrides env file", async () => {
    const { parseWorkflowFromString, executeWorkflow } = await import(
      "../../src/core/index.js"
    );
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const source = `# Layer Test

# Inputs

- \`A\` (required): first var
- \`B\` (required): second var
- \`C\` (required): third var

# Flow

\`\`\`mermaid
flowchart TD
  check --> done
\`\`\`

# Steps

## check

\`\`\`bash
echo "$A $B $C"
\`\`\`

## done

\`\`\`bash
echo ok
\`\`\``;

    const runsDir = await mkdtemp(join(tmpdir(), "markflow-env-test-"));
    const envFilePath = join(runsDir, "extra.env");
    await writeFile(envFilePath, "B=from-envfile\nC=from-envfile");

    const def = parseWorkflowFromString(source);

    // A comes from process.env, B is overridden by envFile, C by --input
    const runInfo = await executeWorkflow(def, {
      runsDir,
      inputs: { A: "from-process", B: "from-process", C: "from-input" },
      envFile: envFilePath,
    });

    // C should be "from-input" (--input wins)
    const step = runInfo.steps.find((s) => s.node === "check")!;
    expect(step.summary).toContain("from-input");
  });
});

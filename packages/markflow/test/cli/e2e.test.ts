import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const exec = promisify(execFile);
const CLI = join(import.meta.dirname, "../../src/cli/index.ts");
const FIXTURES = join(import.meta.dirname, "../fixtures");

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCLI(args: string[], cwd?: string): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await exec(
      "npx",
      ["tsx", CLI, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1" }, timeout: 30_000 },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

describe("CLI E2E", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "markflow-e2e-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("runs a linear workflow successfully", async () => {
    const result = await runCLI(
      ["run", join(FIXTURES, "linear.md"), "-w", tempDir],
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("complete");
  });

  it("runs a branching workflow (exit 0 routes to pass)", async () => {
    const result = await runCLI(
      ["run", join(FIXTURES, "branch.md"), "-w", tempDir],
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("deploy");
  });

  it("exits 1 on validation failure", async () => {
    const result = await runCLI(
      ["run", join(FIXTURES, "invalid/missing-step.md"), "-w", tempDir],
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("exits 1 on parse error for bad markdown", async () => {
    const badFile = join(tempDir, "bad.md");
    await writeFile(badFile, "no heading here\njust text\n");
    const result = await runCLI(["run", badFile, "-w", join(tempDir, "ws")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Parse error");
  });

  it("supports --dry-run", async () => {
    const result = await runCLI(
      ["run", join(FIXTURES, "linear.md"), "-w", tempDir, "--dry-run"],
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Dry run complete");
  });

  it("exits 1 when required input is missing", async () => {
    const wfFile = join(tempDir, "needs-input.md");
    await writeFile(
      wfFile,
      `# Needs Input

# Inputs

- \`API_KEY\` (required): An API key

# Flow

\`\`\`mermaid
flowchart TD
  start --> done
\`\`\`

# Steps

## start

\`\`\`bash
echo "ok"
\`\`\`

## done

\`\`\`bash
echo "done"
\`\`\`
`,
    );
    const result = await runCLI(
      ["run", wfFile, "-w", join(tempDir, "ws")],
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Missing required");
  });

  it("exits 1 when a workflow has a routing error", async () => {
    const wfFile = join(tempDir, "routing-fail.md");
    await writeFile(
      wfFile,
      `# Routing Fail

# Flow

\`\`\`mermaid
flowchart TD
  check -->|alpha| ok
  check -->|beta| also_ok
\`\`\`

# Steps

## check

\`\`\`bash
exit 1
\`\`\`

## ok

\`\`\`bash
echo "ok"
\`\`\`

## also_ok

\`\`\`bash
echo "also ok"
\`\`\`
`,
    );
    const result = await runCLI(
      ["run", wfFile, "-w", join(tempDir, "ws")],
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("error");
  });

  it("supports --json output", async () => {
    const result = await runCLI(
      ["run", join(FIXTURES, "linear.md"), "-w", tempDir, "--json"],
    );
    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toBeDefined();
    }

    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.status).toBe("complete");
    expect(last.workflowName).toBe("Simple Pipeline");
  });

  it("ls --json outputs run list", async () => {
    await runCLI(
      ["run", join(FIXTURES, "linear.md"), "-w", tempDir],
    );
    const result = await runCLI(["ls", tempDir, "--json"]);
    expect(result.exitCode).toBe(0);
    const runs = JSON.parse(result.stdout);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("complete");
  });
});

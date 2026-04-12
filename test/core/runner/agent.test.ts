import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../../src/core/runner/agent.js";
import type { StepDefinition, MarkflowConfig } from "../../../src/core/types.js";

const config: MarkflowConfig = {
  agent: process.execPath, // node binary
  agentFlags: ["-e", "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ console.log('ARGV:'+JSON.stringify(process.argv.slice(1))); console.log('STDIN_START'); process.stdout.write(d); console.log('\\nSTDIN_END'); })"],
  parallel: false,
};

const step: StepDefinition = {
  id: "think",
  type: "agent",
  content: "Say hello and finish.",
};

describe("runAgent prompt delivery", () => {
  it("writes the assembled prompt to stdin, not argv", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "markflow-agent-"));
    try {
      const out = await runAgent(step, [], ["done"], workspace, config, {});
      expect(out.exitCode).toBe(0);

      // argv echoed first — must not contain the prompt text
      const argvLine = out.stdout.split("\n").find((l) => l.startsWith("ARGV:"))!;
      expect(argvLine).toBeDefined();
      expect(argvLine).not.toContain("Say hello");
      expect(argvLine).not.toContain("--prompt");

      // stdin block must contain the assembled prompt
      const stdinStart = out.stdout.indexOf("STDIN_START\n") + "STDIN_START\n".length;
      const stdinEnd = out.stdout.indexOf("\nSTDIN_END");
      const delivered = out.stdout.slice(stdinStart, stdinEnd);
      expect(delivered).toContain("Say hello and finish.");
      expect(delivered).toContain("Your Task");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("delivers prompts that start with a dash without argv-flag confusion", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "markflow-agent-"));
    try {
      const dashStep: StepDefinition = {
        ...step,
        content: "--do-not-parse-me-as-a-flag please",
      };
      const out = await runAgent(dashStep, [], ["done"], workspace, config, {});
      expect(out.exitCode).toBe(0);
      expect(out.stdout).toContain("--do-not-parse-me-as-a-flag");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

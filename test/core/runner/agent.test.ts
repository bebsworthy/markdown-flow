import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent, assembleAgentPrompt } from "../../../src/core/runner/agent.js";
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
      expect(delivered).toContain("RESULT:");
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

describe("assembleAgentPrompt templating", () => {
  it("substitutes ${VAR} references in agent prompt", () => {
    const templatedStep: StepDefinition = {
      id: "review",
      type: "agent",
      content: "Review ${REPO_PATH} for ${CRITERIA}.",
    };
    const prompt = assembleAgentPrompt(
      templatedStep,
      [],
      ["done"],
      "/workspace",
      { REPO_PATH: "/src", CRITERIA: "security" },
    );
    expect(prompt).toContain("Review /src for security.");
    expect(prompt).not.toContain("${REPO_PATH}");
    expect(prompt).not.toContain("${CRITERIA}");
  });

  it("does not include a Workflow Inputs section", () => {
    const prompt = assembleAgentPrompt(
      step,
      [],
      ["done"],
      "/workspace",
      { FOO: "bar", BAZ: "qux" },
    );
    expect(prompt).not.toContain("Workflow Inputs");
  });

  it("includes MARKFLOW_PREV_ variables when referenced", () => {
    const prevStep: StepDefinition = {
      id: "summarize",
      type: "agent",
      content: "Previous step said: ${MARKFLOW_PREV_SUMMARY}",
    };
    const prompt = assembleAgentPrompt(
      prevStep,
      [],
      ["done"],
      "/workspace",
      { MARKFLOW_PREV_SUMMARY: "built successfully", MARKFLOW_PREV_STEP: "build", MARKFLOW_PREV_EDGE: "done" },
    );
    expect(prompt).toContain("Previous step said: built successfully");
  });
});

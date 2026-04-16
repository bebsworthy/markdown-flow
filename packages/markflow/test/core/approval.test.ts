import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  validateWorkflow,
  executeWorkflow,
  createRunManager,
  readEventLog,
  replay,
  type EngineEvent,
} from "../../src/core/index.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");
const APPROVAL = readFileSync(join(FIXTURES, "approval.md"), "utf-8");

describe("approval nodes — parser & validator", () => {
  it("parses an approval step with prompt and options", () => {
    const def = parseWorkflowFromString(APPROVAL);
    const step = def.steps.get("approve_deploy");
    expect(step).toBeDefined();
    expect(step!.type).toBe("approval");
    expect(step!.approvalConfig).toEqual({
      prompt: "Deploy to production?",
      options: ["approve", "reject"],
    });
  });

  it("rejects an approval step missing prompt", () => {
    const src = APPROVAL.replace("prompt: Deploy to production?", "");
    expect(() => parseWorkflowFromString(src)).toThrow(/prompt/);
  });

  it("rejects an approval step with an unknown option not on any edge", () => {
    const src = APPROVAL.replace(
      "  - reject",
      "  - reject\n  - maybe",
    );
    const def = parseWorkflowFromString(src);
    const diags = validateWorkflow(def);
    expect(
      diags.some(
        (d) =>
          d.severity === "error" &&
          /option "maybe"/.test(d.message),
      ),
    ).toBe(true);
  });

  it("rejects an outgoing edge not listed in options", () => {
    const src = APPROVAL.replace(
      "  approve_deploy -->|reject| rollback",
      "  approve_deploy -->|reject| rollback\n  approve_deploy -->|hold| rollback",
    );
    const def = parseWorkflowFromString(src);
    const diags = validateWorkflow(def);
    expect(
      diags.some(
        (d) =>
          d.severity === "error" &&
          /outgoing edge "hold"/.test(d.message),
      ),
    ).toBe(true);
  });

  it("rejects an approval step that carries a script body", () => {
    const src = APPROVAL.replace(
      "Reviewer notes: ensure CI is green.",
      "```bash\necho nope\n```",
    );
    expect(() => parseWorkflowFromString(src)).toThrow(/must not contain a code block/);
  });
});

describe("approval nodes — engine suspend/resume", () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "markflow-approval-"));
  });

  it("suspends at an approval node with status=suspended and emits step:waiting", async () => {
    const def = parseWorkflowFromString(APPROVAL);
    const events: EngineEvent[] = [];

    const info = await executeWorkflow(def, {
      runsDir,
      onEvent: (e) => events.push(e),
    });

    expect(info.status).toBe("suspended");
    const waiting = events.filter((e) => e.type === "step:waiting");
    expect(waiting).toHaveLength(1);
    expect(waiting[0].type === "step:waiting" && waiting[0].nodeId).toBe(
      "approve_deploy",
    );
    expect(events.some((e) => e.type === "workflow:complete")).toBe(false);

    // Persisted status in meta.json reflects the suspend.
    const manager = createRunManager(runsDir);
    const runInfo = await manager.getRun(info.id);
    expect(runInfo?.status).toBe("suspended");
    expect(runInfo?.completedAt).toBeUndefined();
  });

  it("resumes via approvalDecision and completes downstream", async () => {
    const def = parseWorkflowFromString(APPROVAL);
    const info = await executeWorkflow(def, { runsDir });
    expect(info.status).toBe("suspended");

    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(info.id);
    const resumed = await executeWorkflow(def, {
      runsDir,
      resumeFrom: handle,
      approvalDecision: { nodeId: "approve_deploy", choice: "approve", decidedBy: "alice" },
    });

    expect(resumed.status).toBe("complete");
    expect(resumed.steps.map((s) => s.node)).toEqual([
      "build",
      "approve_deploy",
      "deploy",
    ]);

    const events = await readEventLog(join(runsDir, info.id));
    const decided = events.filter((e) => e.type === "approval:decided");
    expect(decided).toHaveLength(1);
    if (decided[0].type === "approval:decided") {
      expect(decided[0].choice).toBe("approve");
      expect(decided[0].decidedBy).toBe("alice");
    }
  });

  it("resuming with a non-option choice throws", async () => {
    const def = parseWorkflowFromString(APPROVAL);
    const info = await executeWorkflow(def, { runsDir });
    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(info.id);

    const result = await executeWorkflow(def, {
      runsDir,
      resumeFrom: handle,
      approvalDecision: { nodeId: "approve_deploy", choice: "maybe" },
    });
    // executeWorkflow catches engine errors and returns status=error
    expect(result.status).toBe("error");
  });

  it("replay of resumed log folds to status=complete with the decided edge", async () => {
    const def = parseWorkflowFromString(APPROVAL);
    const info = await executeWorkflow(def, { runsDir });
    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(info.id);
    await executeWorkflow(def, {
      runsDir,
      resumeFrom: handle,
      approvalDecision: { nodeId: "approve_deploy", choice: "reject" },
    });

    const events = await readEventLog(join(runsDir, info.id));
    const snap = replay(events);
    expect(snap.status).toBe("complete");
    expect(
      snap.completedResults.find((r) => r.node === "approve_deploy")?.edge,
    ).toBe("reject");
    // rollback ran, deploy did not.
    expect(snap.completedResults.map((r) => r.node)).toContain("rollback");
    expect(snap.completedResults.map((r) => r.node)).not.toContain("deploy");
  });

  it("replay of a mid-suspend log reports status=suspended", async () => {
    const def = parseWorkflowFromString(APPROVAL);
    const info = await executeWorkflow(def, { runsDir });
    const events = await readEventLog(join(runsDir, info.id));
    const snap = replay(events);
    expect(snap.status).toBe("suspended");
    const waitingTokens = [...snap.tokens.values()].filter(
      (t) => t.state === "waiting",
    );
    expect(waitingTokens).toHaveLength(1);
    expect(waitingTokens[0].nodeId).toBe("approve_deploy");
  });
});

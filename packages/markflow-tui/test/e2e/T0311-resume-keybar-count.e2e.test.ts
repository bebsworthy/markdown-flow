// test/e2e/T0311-resume-keybar-count.e2e.test.ts
//
// T0311 — `r Resume (N)` keybar count reflects the number of suspended
// rows; vanishes when N=0 (hide-don't-grey).
// Refs: mockups.md §1, §3.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { DEFAULT_READY_MS, spawnTui, type TuiSession } from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";
import { writeEventLog } from "./fixtures/event-log.js";

const WORKFLOW_MD = [
  "# Deploy",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  build --> review",
  "```",
  "",
  "# Steps",
  "",
  "## build",
  "",
  "```bash",
  'echo "build"',
  "```",
  "",
  "## review",
  "",
  "```bash",
  'echo "review"',
  "```",
].join("\n");

describe.skipIf(process.platform === "win32")(
  "T0311 resume keybar count",
  () => {
    let session: TuiSession | undefined;
    let scratch: ScratchEnv | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
      if (scratch) {
        await scratch.cleanup();
        scratch = undefined;
      }
    });

    test("r Resume (N) shows suspended count and vanishes at zero", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      const now = Date.now();
      const HOUR = 60 * 60 * 1000;

      // run-susp1: suspended (step:waiting)
      await writeEventLog(scratch.runsDir, {
        runId: "susp01",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - HOUR).toISOString(),
        events: [
          { type: "token:created", v: 1, tokenId: "t-1", nodeId: "review", generation: 1 },
          { type: "token:state", v: 1, tokenId: "t-1", from: "pending", to: "running" },
          { type: "token:state", v: 1, tokenId: "t-1", from: "running", to: "waiting" },
          {
            type: "step:waiting",
            v: 1,
            nodeId: "review",
            tokenId: "t-1",
            prompt: "approve deploy?",
            options: ["approve", "reject"],
          },
        ],
      });

      // run-susp2: also suspended
      await writeEventLog(scratch.runsDir, {
        runId: "susp02",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 2 * HOUR).toISOString(),
        events: [
          { type: "token:created", v: 1, tokenId: "t-1", nodeId: "review", generation: 1 },
          { type: "token:state", v: 1, tokenId: "t-1", from: "pending", to: "running" },
          { type: "token:state", v: 1, tokenId: "t-1", from: "running", to: "waiting" },
          {
            type: "step:waiting",
            v: 1,
            nodeId: "review",
            tokenId: "t-1",
            prompt: "approve deploy?",
            options: ["approve", "reject"],
          },
        ],
      });

      // run-ok: complete (no suspended state)
      await writeEventLog(scratch.runsDir, {
        runId: "cmprun",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 3 * HOUR).toISOString(),
        events: [{ type: "workflow:complete" }],
      });

      session = await spawnTui({ scratch, args: [wfPath], cols: 140 });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Switch to RUNS mode
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      // Keybar should show "r Resume (2)" because there are 2 suspended runs
      await session.waitForText("Resume (2)", DEFAULT_READY_MS);
      const snap = session.snapshot();
      expect(snap).toContain("Resume (2)");
    });

    test("r Resume vanishes when no suspended runs exist", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      const now = Date.now();
      const HOUR = 60 * 60 * 1000;

      // Only complete and running runs — no suspended
      await writeEventLog(scratch.runsDir, {
        runId: "actrun",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - HOUR).toISOString(),
        events: [],
      });

      await writeEventLog(scratch.runsDir, {
        runId: "cmprun",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 2 * HOUR).toISOString(),
        events: [{ type: "workflow:complete" }],
      });

      session = await spawnTui({ scratch, args: [wfPath], cols: 140 });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);
      await session.waitForText("2 shown", DEFAULT_READY_MS);

      // Keybar should NOT show "Resume" at all (hide-don't-grey)
      const snap = session.snapshot();
      expect(snap).not.toMatch(/Resume/);
    });
  },
);

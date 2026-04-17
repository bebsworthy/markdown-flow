// test/e2e/T0300-runs-mode-columns.e2e.test.ts
//
// T0300 — F2 (or `2`) switches to RUNS mode; the runs-table renders
// the expected columns (ID · WORKFLOW · STATUS · STEP · ELAPSED · STARTED · NOTE).
// Refs: mockups.md §1, §12; features.md §3.2.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { DEFAULT_READY_MS, spawnTui, type TuiSession } from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";
import { writeEventLog } from "./fixtures/event-log.js";

const WORKFLOW_MD = [
  "# Deploy",
  "",
  "A deploy workflow.",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  build --> deploy",
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
  "## deploy",
  "",
  "```bash",
  'echo "deploy"',
  "```",
].join("\n");

describe.skipIf(process.platform === "win32")(
  "T0300 RUNS mode column headers",
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

    test("pressing 2 switches to RUNS mode and shows expected column headers", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");

      await scratch.writeRegistry([{ source: wfPath }]);

      await writeEventLog(scratch.runsDir, {
        runId: "run001",
        workflowName: "Deploy",
        sourceFile: wfPath,
        events: [{ type: "workflow:complete" }],
      });

      session = await spawnTui({ scratch, args: [wfPath], cols: 140 });

      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("2");

      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      const snap = session.snapshot();

      expect(snap).toContain("ID");
      expect(snap).toContain("WORKFLOW");
      expect(snap).toContain("STATUS");
      expect(snap).toContain("STEP");
      expect(snap).toContain("ELAPSED");
      expect(snap).toContain("STARTED");
      expect(snap).toContain("NOTE");
    });
  },
);

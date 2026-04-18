// test/e2e/T0305-filter-status-running.e2e.test.ts
//
// T0305 — `/` opens the filter input; typing `status:running` narrows
// the table to running rows.
// Refs: features.md §3.2.

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
  "T0305 filter status:running",
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

    test("/ opens filter bar and status:running narrows to running rows", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      const now = Date.now();
      const HOUR = 60 * 60 * 1000;

      // run-act: running
      await writeEventLog(scratch.runsDir, {
        runId: "actrun",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - HOUR).toISOString(),
        events: [],
      });

      // run-ok: complete (recent, within 24h so it's shown)
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

      // Both runs shown initially
      await session.waitForText("2 shown", DEFAULT_READY_MS);

      // Open filter bar with `/`
      session.write("/");
      await session.waitForText("/", DEFAULT_READY_MS);

      // Type the filter query
      session.write("status:running");

      // Submit with Enter
      session.write("\r");

      // After filtering, only the running run should be shown
      await session.waitForText("1 shown", DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toContain("actrun");
      expect(snap).not.toContain("cmprun");
    });
  },
);

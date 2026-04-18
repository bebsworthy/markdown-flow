// test/e2e/T0303-archive-default.e2e.test.ts
//
// T0303 — Archive default hides terminal runs older than 24 h (ok) / 7 d
// (failed); footer reads `N shown · M archived`.
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
  "T0303 archive default",
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

    test("hides stale terminal runs and shows correct footer counts", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      // "now" for the TUI is real wall-clock time. We seed runs relative
      // to that so archive thresholds are deterministic.
      const now = Date.now();
      const HOUR = 60 * 60 * 1000;
      const DAY = 24 * HOUR;

      // run-a: complete, finished 2 h ago → within 24 h → SHOWN
      await writeEventLog(scratch.runsDir, {
        runId: "run-a1",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 3 * HOUR).toISOString(),
        events: [{ type: "workflow:complete" }],
      });

      // run-b: complete, finished 25 h ago → beyond 24 h → ARCHIVED
      await writeEventLog(scratch.runsDir, {
        runId: "run-b2",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 26 * HOUR).toISOString(),
        events: [{ type: "workflow:complete" }],
      });

      // run-c: failed, finished 3 d ago → within 7 d → SHOWN
      await writeEventLog(scratch.runsDir, {
        runId: "run-c3",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 3 * DAY - HOUR).toISOString(),
        events: [{ type: "workflow:error", error: "boom" }],
      });

      // run-d: failed, finished 8 d ago → beyond 7 d → ARCHIVED
      await writeEventLog(scratch.runsDir, {
        runId: "run-d4",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 8 * DAY - HOUR).toISOString(),
        events: [{ type: "workflow:error", error: "boom" }],
      });

      // run-e: still running → never archived → SHOWN
      await writeEventLog(scratch.runsDir, {
        runId: "run-e5",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 10 * DAY).toISOString(),
        events: [],
      });

      session = await spawnTui({ scratch, args: [wfPath], cols: 140 });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Switch to RUNS mode
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      // Default view: 3 shown (run-a1, run-c3, run-e5), 2 archived (run-b2, run-d4)
      await session.waitForText("3 shown", DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toContain("2 archived");

      // Shown runs should be visible
      expect(snap).toContain("run-a1");
      expect(snap).toContain("run-c3");
      expect(snap).toContain("run-e5");

      // Archived runs should NOT be visible
      expect(snap).not.toContain("run-b2");
      expect(snap).not.toContain("run-d4");
    });
  },
);

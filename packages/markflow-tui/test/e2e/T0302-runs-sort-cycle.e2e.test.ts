// test/e2e/T0302-runs-sort-cycle.e2e.test.ts
//
// T0302 — `s` cycles sort columns; the header indicator moves and rows
// reorder.
// Refs: features.md §3.2; mockups.md §1.

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
  "T0302 sort column cycling",
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

    test("pressing s cycles the sort indicator and reorders rows", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      // Seed 3 runs with different started timestamps so "attention"
      // and "started" sort produce the same order (all are running,
      // active bucket), but "id" sort produces a different order.
      //
      // run-aaa: started earliest (Jan 1), still running
      // run-bbb: started middle   (Jan 2), completed (terminal)
      // run-ccc: started latest   (Jan 3), still running

      await writeEventLog(scratch.runsDir, {
        runId: "run-aaa",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: "2026-01-01T00:00:00Z",
        events: [],
      });

      await writeEventLog(scratch.runsDir, {
        runId: "run-bbb",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: "2026-01-02T00:00:00Z",
        events: [{ type: "workflow:complete" }],
      });

      await writeEventLog(scratch.runsDir, {
        runId: "run-ccc",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: "2026-01-03T00:00:00Z",
        events: [],
      });

      session = await spawnTui({ scratch, args: [wfPath], cols: 140 });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Switch to RUNS mode
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      // Show all runs (toggle archive to include terminal run-bbb)
      await session.waitForText("2 shown", DEFAULT_READY_MS);
      session.write("a");
      await session.waitForText("3 shown", DEFAULT_READY_MS);

      // Default sort indicator should show "attention"
      const snap0 = session.snapshot();
      expect(snap0).toContain("sort: attention");

      // Press `s` once → should cycle to "started"
      session.write("s");
      await session.waitForText("sort: started", DEFAULT_READY_MS);

      // Under "started desc", order is: run-ccc (Jan 3), run-bbb (Jan 2), run-aaa (Jan 1)
      // IDs are truncated to 6 chars: run-cc, run-bb, run-aa
      const snap1 = session.snapshot();
      const idxCcc1 = snap1.indexOf("run-cc");
      const idxBbb1 = snap1.indexOf("run-bb");
      const idxAaa1 = snap1.indexOf("run-aa");
      expect(idxCcc1, "run-cc should appear").toBeGreaterThan(-1);
      expect(idxBbb1, "run-bb should appear").toBeGreaterThan(-1);
      expect(idxAaa1, "run-aa should appear").toBeGreaterThan(-1);
      expect(idxCcc1, "run-cc before run-bb (started desc)").toBeLessThan(
        idxBbb1,
      );
      expect(idxBbb1, "run-bb before run-aa (started desc)").toBeLessThan(
        idxAaa1,
      );

      // Press `s` again → "ended"
      session.write("s");
      await session.waitForText("sort: ended", DEFAULT_READY_MS);

      // Press `s` again → "elapsed"
      session.write("s");
      await session.waitForText("sort: elapsed", DEFAULT_READY_MS);

      // Press `s` again → "status"
      session.write("s");
      await session.waitForText("sort: status", DEFAULT_READY_MS);

      // Press `s` again → "workflow"
      session.write("s");
      await session.waitForText("sort: workflow", DEFAULT_READY_MS);

      // Press `s` again → "id"
      session.write("s");
      await session.waitForText("sort: id", DEFAULT_READY_MS);

      // Under "id" sort, order is: run-aaa, run-bbb, run-ccc (ascending)
      const snap2 = session.snapshot();
      const idxAaa2 = snap2.indexOf("run-aa");
      const idxBbb2 = snap2.indexOf("run-bb");
      const idxCcc2 = snap2.indexOf("run-cc");
      expect(idxAaa2, "run-aa before run-bb (id sort)").toBeLessThan(idxBbb2);
      expect(idxBbb2, "run-bb before run-cc (id sort)").toBeLessThan(idxCcc2);

      // Press `s` again → wraps back to "attention"
      session.write("s");
      await session.waitForText("sort: attention", DEFAULT_READY_MS);
    });
  },
);

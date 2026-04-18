// test/e2e/T0314-q-returns-to-runs.e2e.test.ts
//
// T0314 — `q` inside RUN mode returns to RUNS mode (not all the way out).
// Refs: mockups.md §15.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { DEFAULT_READY_MS, spawnTui, type TuiSession } from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";
import { writeEventLog } from "./fixtures/event-log.js";

const WORKFLOW = [
  "# Wf",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  s1 --> s2",
  "```",
  "",
  "# Steps",
  "",
  "## s1",
  "",
  "```bash",
  'echo "s1"',
  "```",
  "",
  "## s2",
  "",
  "```bash",
  'echo "s2"',
  "```",
].join("\n");

describe.skipIf(process.platform === "win32")(
  "T0314 q returns to RUNS mode",
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

    test("q in RUN mode returns to RUNS, not exit", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "wf.md");
      await writeFile(wfPath, WORKFLOW, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      await writeEventLog(scratch.runsDir, {
        runId: "run-aaa",
        workflowName: "Wf",
        sourceFile: wfPath,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        events: [{ type: "workflow:complete" }],
      });

      session = await spawnTui({
        scratch,
        args: [wfPath],
        cols: 140,
        rows: 30,
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Navigate: WORKFLOWS → RUNS → RUN
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      session.write("\r");
      await session.waitForRegex(/\[ RUN \]/, DEFAULT_READY_MS);

      // Press q — should return to RUNS, not exit
      session.write("q");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toMatch(/\[ RUNS \]/);
      expect(snap).not.toMatch(/\[ RUN \]/);
    });
  },
);

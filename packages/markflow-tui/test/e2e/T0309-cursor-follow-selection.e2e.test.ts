// test/e2e/T0309-cursor-follow-selection.e2e.test.ts
//
// T0309 — Cursor follow-selection: moving the cursor updates the
// bottom tabbed pane live (wide tier).
// Refs: mockups.md §1.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, test } from "vitest";

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

async function seedRuns(
  scratch: import("./tmp.js").ScratchEnv,
  wfPath: string,
): Promise<void> {
  const now = Date.now();
  const MIN = 60 * 1000;

  await writeEventLog(scratch.runsDir, {
    runId: "run-aaa",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 1 * MIN).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "run-bbb",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 2 * MIN).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "run-ccc",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 3 * MIN).toISOString(),
    events: [],
  });
}

describe.skipIf(process.platform === "win32")(
  "T0309 cursor follow-selection",
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

    test("moving cursor with j updates the bottom pane's selected run", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "wf.md");
      await writeFile(wfPath, WORKFLOW, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedRuns(scratch, wfPath);

      session = await spawnTui({
        scratch,
        args: [wfPath],
        cols: 140,
        rows: 30,
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Switch to runs mode
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);
      await session.waitForText("3 shown", DEFAULT_READY_MS);

      // Cursor starts on the first row (run-aaa, most recent).
      // Bottom pane should show "selected: run-aaa".
      await session.waitForText("selected: run-aaa", DEFAULT_READY_MS);

      // Move cursor down — bottom pane must follow to run-bbb.
      session.write("j");
      await session.waitForText("selected: run-bbb", DEFAULT_READY_MS);

      // Move back up — bottom pane follows back to run-aaa.
      session.write("k");
      await session.waitForText("selected: run-aaa", DEFAULT_READY_MS);
    });
  },
);

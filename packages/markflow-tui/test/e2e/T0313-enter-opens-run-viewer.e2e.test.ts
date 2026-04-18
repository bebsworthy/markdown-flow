// test/e2e/T0313-enter-opens-run-viewer.e2e.test.ts
//
// T0313 — `Enter` on a terminal (complete/error) row opens the zoomed
// run viewer (RUN mode); keybar flips from RUNS to RUN.
// Refs: mockups.md §1, §4, §6.

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

async function seedTerminalRuns(
  scratch: import("./tmp.js").ScratchEnv,
  wfPath: string,
): Promise<void> {
  const now = Date.now();
  const MIN = 60 * 1000;

  // Complete run
  await writeEventLog(scratch.runsDir, {
    runId: "run-ok",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 1 * MIN).toISOString(),
    events: [{ type: "workflow:complete" }],
  });

  // Error run
  await writeEventLog(scratch.runsDir, {
    runId: "run-err",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 2 * MIN).toISOString(),
    events: [{ type: "workflow:error", error: "boom" }],
  });
}

describe.skipIf(process.platform === "win32")(
  "T0313 Enter opens run viewer",
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

    test("Enter on a complete row opens RUN mode with [ RUN ] in header", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "wf.md");
      await writeFile(wfPath, WORKFLOW, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedTerminalRuns(scratch, wfPath);

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
      await session.waitForText("2 shown", DEFAULT_READY_MS);

      // Cursor is on the first row (run-ok, most recent). Press Enter.
      session.write("\r");
      await session.waitForRegex(/\[ RUN \]/, DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toMatch(/\[ RUN \]/);
      expect(snap).not.toMatch(/\[ RUNS \]/);
    });

    test("Enter on an error row also opens RUN mode", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "wf.md");
      await writeFile(wfPath, WORKFLOW, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedTerminalRuns(scratch, wfPath);

      session = await spawnTui({
        scratch,
        args: [wfPath],
        cols: 140,
        rows: 30,
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);
      await session.waitForText("2 shown", DEFAULT_READY_MS);

      // Move to second row (run-err)
      session.write("j");
      // Press Enter
      session.write("\r");
      await session.waitForRegex(/\[ RUN \]/, DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toMatch(/\[ RUN \]/);
    });
  },
);

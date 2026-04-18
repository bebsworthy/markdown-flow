// test/e2e/T0308-g-G-filter-view.e2e.test.ts
//
// T0308 — `g`/`G` jump to top/bottom respect the current filter view.
// Refs: features.md §5.5.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { DEFAULT_READY_MS, spawnTui, type TuiSession } from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";
import { writeEventLog } from "./fixtures/event-log.js";

const WORKFLOW_A = [
  "# Alpha",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  a1 --> a2",
  "```",
  "",
  "# Steps",
  "",
  "## a1",
  "",
  "```bash",
  'echo "a1"',
  "```",
  "",
  "## a2",
  "",
  "```bash",
  'echo "a2"',
  "```",
].join("\n");

const WORKFLOW_B = [
  "# Bravo",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  b1 --> b2",
  "```",
  "",
  "# Steps",
  "",
  "## b1",
  "",
  "```bash",
  'echo "b1"',
  "```",
  "",
  "## b2",
  "",
  "```bash",
  'echo "b2"',
  "```",
].join("\n");

async function seedRuns(
  scratch: import("./tmp.js").ScratchEnv,
  wfAPath: string,
  wfBPath: string,
): Promise<void> {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;

  // Three Alpha runs (recent) + one Bravo run
  await writeEventLog(scratch.runsDir, {
    runId: "alpha-1",
    workflowName: "Alpha",
    sourceFile: wfAPath,
    startedAt: new Date(now - 0.3 * HOUR).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "alpha-2",
    workflowName: "Alpha",
    sourceFile: wfAPath,
    startedAt: new Date(now - 0.4 * HOUR).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "alpha-3",
    workflowName: "Alpha",
    sourceFile: wfAPath,
    startedAt: new Date(now - 0.5 * HOUR).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "bravo-1",
    workflowName: "Bravo",
    sourceFile: wfBPath,
    startedAt: new Date(now - 0.2 * HOUR).toISOString(),
    events: [],
  });
}

describe.skipIf(process.platform === "win32")(
  "T0308 g/G respect filtered view",
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

    test("g/G navigate within the filtered row set", async () => {
      scratch = await createScratchEnv();
      const wfAPath = path.join(scratch.dir, "alpha.md");
      const wfBPath = path.join(scratch.dir, "bravo.md");
      await writeFile(wfAPath, WORKFLOW_A, "utf8");
      await writeFile(wfBPath, WORKFLOW_B, "utf8");
      await scratch.writeRegistry([
        { source: wfAPath },
        { source: wfBPath },
      ]);
      await seedRuns(scratch, wfAPath, wfBPath);

      session = await spawnTui({
        scratch,
        args: [wfAPath, wfBPath],
        cols: 140,
      });
      await session.waitForText("2 entries", DEFAULT_READY_MS);

      // Switch to runs mode
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);
      await session.waitForText("4 shown", DEFAULT_READY_MS);

      // Apply workflow:Alpha filter — should narrow to 3 rows
      session.write("/");
      await session.waitForText("/", DEFAULT_READY_MS);
      session.write("workflow:Alpha");
      session.write("\r");
      await session.waitForText("3 shown", DEFAULT_READY_MS);

      // Jump to bottom with G
      session.write("G");
      // The cursor should land on the last Alpha row (alpha-3, oldest).
      // The highlight/selection row should contain alpha-3.
      await session.waitForText("alpha-3", DEFAULT_READY_MS);

      // Bravo rows must NOT be visible in filtered view
      const snapBottom = session.snapshot();
      expect(snapBottom).not.toContain("bravo-1");
      expect(snapBottom).toContain("alpha-3");

      // Jump back to top with g
      session.write("g");
      // The cursor should land on the first Alpha row (alpha-1, most recent).
      await session.waitForText("alpha-1", DEFAULT_READY_MS);

      const snapTop = session.snapshot();
      expect(snapTop).not.toContain("bravo-1");
      expect(snapTop).toContain("alpha-1");
    });
  },
);

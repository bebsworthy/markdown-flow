// test/e2e/T0310-status-badge-glyphs.e2e.test.ts
//
// T0310 — Status badge glyphs match the table in §1 (`▶`, `⏸`, `✗`, `✓`, `○`)
// with paired color.
// Refs: features.md §5.10.

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

async function seedRuns(
  scratch: import("./tmp.js").ScratchEnv,
  wfPath: string,
): Promise<void> {
  const now = Date.now();
  const MIN = 60 * 1000;

  // Running run
  await writeEventLog(scratch.runsDir, {
    runId: "r-running",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 1 * MIN).toISOString(),
    events: [],
  });

  // Suspended (waiting) run — write meta.json with suspended status
  await writeEventLog(scratch.runsDir, {
    runId: "r-waiting",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 2 * MIN).toISOString(),
    events: [],
  });
  // Overwrite meta.json to mark as suspended
  await writeFile(
    path.join(scratch.runsDir, "r-waiting", "meta.json"),
    JSON.stringify({
      id: "r-waiting",
      workflowName: "Wf",
      sourceFile: wfPath,
      startedAt: new Date(now - 2 * MIN).toISOString(),
      status: "suspended",
    }),
    "utf8",
  );

  // Failed run
  await writeEventLog(scratch.runsDir, {
    runId: "r-failed",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 3 * MIN).toISOString(),
    events: [{ type: "workflow:error", error: "boom" }],
  });

  // Complete run
  await writeEventLog(scratch.runsDir, {
    runId: "r-ok",
    workflowName: "Wf",
    sourceFile: wfPath,
    startedAt: new Date(now - 4 * MIN).toISOString(),
    events: [{ type: "workflow:complete" }],
  });
}

describe.skipIf(process.platform === "win32")(
  "T0310 status badge glyphs",
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

    test("runs table shows correct status glyphs for each state", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "wf.md");
      await writeFile(wfPath, WORKFLOW, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedRuns(scratch, wfPath);

      session = await spawnTui({
        scratch,
        args: [wfPath],
        cols: 140,
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Switch to runs mode
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);
      await session.waitForText("4 shown", DEFAULT_READY_MS);

      const snap = session.snapshot();

      // Harness pins MARKFLOW_ASCII=1 so glyphs are ASCII fallbacks.
      // §5.10 mapping: running→[run], waiting→[wait], failed→[fail], ok→[ok].
      // Status column may truncate labels, so match on the glyph bracket.
      expect(snap).toContain("[run]");
      expect(snap).toContain("[wait]");
      expect(snap).toContain("[fail]");
      expect(snap).toContain("[ok]");
    });

    test("unicode mode renders §5.10 glyphs (▶ ⏸ ✗ ✓)", async () => {
      scratch = await createScratchEnv();
      // Enable Unicode by clearing the ASCII override
      delete scratch.env.MARKFLOW_ASCII;
      delete scratch.env.NO_COLOR;
      scratch.env.FORCE_COLOR = "1";

      const wfPath = path.join(scratch.dir, "wf.md");
      await writeFile(wfPath, WORKFLOW, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedRuns(scratch, wfPath);

      session = await spawnTui({
        scratch,
        args: [wfPath],
        cols: 140,
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("2");
      await session.waitForRegex(/RUNS/, DEFAULT_READY_MS);
      await session.waitForText("4 shown", DEFAULT_READY_MS);

      // Raw screen preserves Unicode glyphs
      const raw = session.screen();
      expect(raw).toContain("▶");
      expect(raw).toContain("⏸");
      expect(raw).toContain("✗");
      expect(raw).toContain("✓");
    });
  },
);

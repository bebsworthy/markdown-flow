// test/e2e/T0304-archive-toggle.e2e.test.ts
//
// T0304 — `a` toggles archive visibility; table size grows/shrinks
// accordingly.
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
  "T0304 archive toggle",
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

    test("a toggles archive visibility and table size changes", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      const now = Date.now();
      const HOUR = 60 * 60 * 1000;

      // run-vis: complete, finished 1 h ago → SHOWN
      await writeEventLog(scratch.runsDir, {
        runId: "runvis",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 2 * HOUR).toISOString(),
        events: [{ type: "workflow:complete" }],
      });

      // run-old: complete, finished 25 h ago → ARCHIVED
      await writeEventLog(scratch.runsDir, {
        runId: "runold",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: new Date(now - 26 * HOUR).toISOString(),
        events: [{ type: "workflow:complete" }],
      });

      session = await spawnTui({ scratch, args: [wfPath], cols: 140 });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      // Default: 1 shown, 1 archived
      await session.waitForText("1 shown", DEFAULT_READY_MS);
      let snap = session.snapshot();
      expect(snap).toContain("1 archived");
      expect(snap).toContain("runvis");
      expect(snap).not.toContain("runold");

      // Press `a` → show archived (2 shown)
      session.write("a");
      await session.waitForText("2 shown", DEFAULT_READY_MS);

      snap = session.snapshot();
      expect(snap).toContain("runvis");
      expect(snap).toContain("runold");

      // Press `a` again → hide archived (back to 1 shown)
      session.write("a");
      await session.waitForText("1 shown", DEFAULT_READY_MS);

      snap = session.snapshot();
      expect(snap).toContain("runvis");
      expect(snap).not.toContain("runold");
    });
  },
);

// test/e2e/T0301-runs-default-sort.e2e.test.ts
//
// T0301 — Default sort is "attention": active (▶/⏸) first by `started`
// desc, then terminal (✗/✓) by `ended` desc.
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
  "T0301 default attention sort",
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

    test("active runs appear first (by started desc), then terminal runs (by ended desc)", async () => {
      scratch = await createScratchEnv();

      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);

      // Seed 4 runs with distinct timestamps so sort order is deterministic.
      // Active runs: running-old (started earlier), running-new (started later)
      // Terminal runs: failed-old (ended earlier), ok-new (ended later)

      // running-old: started 2026-01-01T00:00:00Z, still running
      await writeEventLog(scratch.runsDir, {
        runId: "actold",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: "2026-01-01T00:00:00Z",
        events: [],
      });

      // running-new: started 2026-01-02T00:00:00Z, still running
      await writeEventLog(scratch.runsDir, {
        runId: "actnew",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: "2026-01-02T00:00:00Z",
        events: [],
      });

      // failed-old: started 2026-01-01T12:00:00Z, ended shortly after
      await writeEventLog(scratch.runsDir, {
        runId: "trmold",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: "2026-01-01T12:00:00Z",
        events: [
          { type: "workflow:error", error: "build failed" },
        ],
      });

      // ok-new: started 2026-01-02T12:00:00Z, ended shortly after
      await writeEventLog(scratch.runsDir, {
        runId: "trmnew",
        workflowName: "Deploy",
        sourceFile: wfPath,
        startedAt: "2026-01-02T12:00:00Z",
        events: [
          { type: "workflow:complete" },
        ],
      });

      session = await spawnTui({ scratch, args: [wfPath], cols: 140 });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Switch to RUNS mode
      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      // Wait for data to appear, then toggle archive to show all 4 runs
      await session.waitForText("2 shown", DEFAULT_READY_MS);
      session.write("a");
      await session.waitForText("4 shown", DEFAULT_READY_MS);

      const snap = session.snapshot();

      // Expected order (attention sort):
      // 1. actnew (active, started later)   → idShort "actnew"
      // 2. actold (active, started earlier)  → idShort "actold"
      // 3. trmnew (terminal, ended later)    → idShort "trmnew"
      // 4. trmold (terminal, ended earlier)  → idShort "trmold"
      const idActNew = snap.indexOf("actnew");
      const idActOld = snap.indexOf("actold");
      const idTrmNew = snap.indexOf("trmnew");
      const idTrmOld = snap.indexOf("trmold");

      expect(idActNew, "actnew should appear in snapshot").toBeGreaterThan(-1);
      expect(idActOld, "actold should appear in snapshot").toBeGreaterThan(-1);
      expect(idTrmNew, "trmnew should appear in snapshot").toBeGreaterThan(-1);
      expect(idTrmOld, "trmold should appear in snapshot").toBeGreaterThan(-1);

      // Active bucket before terminal bucket
      expect(idActNew, "actnew before actold").toBeLessThan(idActOld);
      expect(idActOld, "actold before trmnew").toBeLessThan(idTrmNew);
      expect(idTrmNew, "trmnew before trmold").toBeLessThan(idTrmOld);
    });
  },
);

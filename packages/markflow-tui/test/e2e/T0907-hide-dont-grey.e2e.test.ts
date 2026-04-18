// test/e2e/T0907-hide-dont-grey.e2e.test.ts
//
// T0907 — Hide-don't-grey: bindings whose `when(ctx)` is false never
// appear, regardless of tier.
// Refs: features.md §5.6 rule 5.

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

async function seedNonSuspendedRuns(
  scratch: import("./tmp.js").ScratchEnv,
  wfPath: string,
): Promise<void> {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;

  await writeEventLog(scratch.runsDir, {
    runId: "actrun",
    workflowName: "Deploy",
    sourceFile: wfPath,
    startedAt: new Date(now - HOUR).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "cmprun",
    workflowName: "Deploy",
    sourceFile: wfPath,
    startedAt: new Date(now - 2 * HOUR).toISOString(),
    events: [{ type: "workflow:complete" }],
  });
}

describe.skipIf(process.platform === "win32")(
  "T0907 hide-don't-grey",
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

    test("r Resume hidden at full tier (≥100 cols) when no suspended runs", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedNonSuspendedRuns(scratch, wfPath);

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

      const snap = session.snapshot();
      expect(snap).not.toMatch(/Resume/);
      // Other bindings should still be present
      expect(snap).toContain("Select");
      expect(snap).toContain("Open");
    });

    test("r Resume hidden at short tier (80 cols) when no suspended runs", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedNonSuspendedRuns(scratch, wfPath);

      session = await spawnTui({
        scratch,
        args: [wfPath],
        cols: 80,
        rows: 30,
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);
      await session.waitForText("actrun", DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).not.toMatch(/Resume/);
    });

    test("r Resume hidden at keys-only tier (<60 cols) when no suspended runs", async () => {
      scratch = await createScratchEnv();
      const wfPath = path.join(scratch.dir, "deploy.md");
      await writeFile(wfPath, WORKFLOW_MD, "utf8");
      await scratch.writeRegistry([{ source: wfPath }]);
      await seedNonSuspendedRuns(scratch, wfPath);

      session = await spawnTui({
        scratch,
        args: [wfPath],
        cols: 50,
        rows: 30,
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("2");
      await session.waitForText("actrun", DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).not.toMatch(/Resume/);
    });
  },
);

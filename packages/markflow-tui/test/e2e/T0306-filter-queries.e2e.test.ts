// test/e2e/T0306-filter-queries.e2e.test.ts
//
// T0306 — Filter supports `workflow:<name>`, `since:<duration>`,
// free-text id prefix.
// Refs: features.md §3.2.

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

  await writeEventLog(scratch.runsDir, {
    runId: "aa-run",
    workflowName: "Alpha",
    sourceFile: wfAPath,
    startedAt: new Date(now - 0.5 * HOUR).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "bb-run",
    workflowName: "Bravo",
    sourceFile: wfBPath,
    startedAt: new Date(now - 0.5 * HOUR).toISOString(),
    events: [],
  });

  await writeEventLog(scratch.runsDir, {
    runId: "cc-old",
    workflowName: "Alpha",
    sourceFile: wfAPath,
    startedAt: new Date(now - 48 * HOUR).toISOString(),
    events: [{ type: "workflow:complete" }],
  });
}

describe.skipIf(process.platform === "win32")(
  "T0306 filter query types",
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

    test("workflow: filter narrows to matching workflow", async () => {
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

      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      // Show archived
      session.write("a");
      await session.waitForText("3 shown", DEFAULT_READY_MS);

      // Apply workflow:Alpha
      session.write("/");
      await session.waitForText("/", DEFAULT_READY_MS);
      session.write("workflow:Alpha");
      session.write("\r");

      await session.waitForText("2 shown", DEFAULT_READY_MS);
      const snap = session.snapshot();
      expect(snap).toContain("aa-run");
      expect(snap).toContain("cc-old");
      expect(snap).not.toContain("bb-run");
    });

    test("id prefix filter narrows to matching run", async () => {
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

      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      session.write("a");
      await session.waitForText("3 shown", DEFAULT_READY_MS);

      // Apply id prefix "bb"
      session.write("/");
      await session.waitForText("/", DEFAULT_READY_MS);
      session.write("bb");
      session.write("\r");

      await session.waitForText("1 shown", DEFAULT_READY_MS);
      const snap = session.snapshot();
      expect(snap).toContain("bb-run");
      expect(snap).not.toContain("aa-run");
    });

    test("since: filter narrows to recent runs", async () => {
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

      session.write("2");
      await session.waitForRegex(/\[ RUNS \]/, DEFAULT_READY_MS);

      session.write("a");
      await session.waitForText("3 shown", DEFAULT_READY_MS);

      // Apply since:1h
      session.write("/");
      await session.waitForText("/", DEFAULT_READY_MS);
      session.write("since:1h");
      session.write("\r");

      await session.waitForText("2 shown", DEFAULT_READY_MS);
      const snap = session.snapshot();
      expect(snap).toContain("aa-run");
      expect(snap).toContain("bb-run");
      expect(snap).not.toContain("cc-old");
    });
  },
);

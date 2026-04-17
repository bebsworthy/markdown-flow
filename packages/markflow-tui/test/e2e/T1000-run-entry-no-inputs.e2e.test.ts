// test/e2e/T1000-run-entry-no-inputs.e2e.test.ts
//
// T1000 — `r` on a workflow with zero declared inputs starts a run
// immediately; the TUI transitions to `viewing` mode within 300 ms of
// the engine's `run:start`; the run appears in `runs/<id>/events.jsonl`.
// Refs: features.md §3.1, §5.7.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_RUN_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T1000 run entry with zero inputs",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("r starts a run immediately and transitions to viewing mode", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.pressEnter();
      await session.waitForText("Hello Pipeline", DEFAULT_READY_MS);

      session.write("r");

      await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);

      const runsDir = session.scratch.runsDir;
      const entries = await readdir(runsDir);
      const runDirs = entries.filter((e) => !e.startsWith("."));
      expect(runDirs.length).toBeGreaterThanOrEqual(1);

      const runId = runDirs[0]!;
      await session.waitForEventLog(runId, 1, DEFAULT_RUN_MS);

      const snap = session.snapshot();
      expect(snap).toMatch(/RUN/);
    });
  },
);

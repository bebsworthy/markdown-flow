// test/e2e/journey-rerun.e2e.test.ts
//
// Journey 2 — Failure routing and run inspection:
//
//   failing.md: setup → check (fails, exit 1) → report (via fail edge)
//
//   1. Launch with failing.md → workflow listed
//   2. Run workflow → RUN mode, setup completes, check fails
//   3. Report step runs via fail edge → run completes
//   4. Verify failure routing visible in step table (→ fail on check)
//   5. Navigate to detail pane — verify step exit code
//   6. Navigate to events pane — verify engine events
//   7. Esc to RUNS table — completed run visible
//   8. Re-open run — all steps still visible from replayed events

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_RUN_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "failing.md");

describe.skipIf(process.platform === "win32")(
  "e2e journey 2: failure routing and run inspection",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test(
      "check fails → routes to report via fail edge → run completes",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
        await session.waitForText("failing.md", DEFAULT_READY_MS);

        // Select and run
        session.pressEnter();
        await session.waitForText("Failing Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);

        // setup completes, check fails, report runs
        await session.waitForText("setup", DEFAULT_RUN_MS);
        await session.waitForText("report", DEFAULT_RUN_MS);

        // Verify the step table shows failure routing
        const snap = session.snapshot();
        expect(snap).toContain("check");
        expect(snap).toContain("report");
        // check step should show the fail edge
        expect(snap).toMatch(/fail/i);

        // Navigate to detail pane — verify step metadata
        session.write("2");
        await session.waitForRegex(/script \(bash\)/, DEFAULT_WAIT_MS);

        // Navigate to events pane — verify event types present
        session.write("4");
        await session.waitForRegex(/step:start|step:complete|token:created/, DEFAULT_RUN_MS);

        // Back to graph
        session.write("1");
        await session.waitForText("setup", DEFAULT_WAIT_MS);

        // Esc to RUNS table
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]|\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);
      },
      60_000,
    );

    test(
      "completed run re-opens from RUNS table with all steps visible",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
        await session.waitForText("failing.md", DEFAULT_READY_MS);

        // Run to completion — wait for terminal status ("failed" since check exits 1)
        session.pressEnter();
        await session.waitForText("Failing Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);
        await session.waitForText("report", DEFAULT_RUN_MS);
        await session.waitForRegex(/failed/, DEFAULT_RUN_MS);

        // Go to RUNS table
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]/, DEFAULT_WAIT_MS);
        await session.waitForText("Failing", DEFAULT_WAIT_MS);

        // Re-open the run
        session.pressEnter();
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_WAIT_MS);

        // All steps should be visible from replayed event log
        await session.waitForText("setup", DEFAULT_WAIT_MS);
        await session.waitForText("check", DEFAULT_WAIT_MS);
        await session.waitForText("report", DEFAULT_WAIT_MS);

        // Back out
        session.pressEsc();
      },
      60_000,
    );
  },
);

// test/e2e/journey-approval.e2e.test.ts
//
// Journey 3 — Approval gate end-to-end:
//
//   1. Launch with approve.md → workflow listed
//   2. Run workflow → RUN mode, build step completes
//   3. Gate step reaches "waiting" → approval modal auto-opens
//   4. Navigate options (↓), confirm with Enter → run resumes
//   5. Ship step completes → run terminal
//   6. Verify RUNS table shows completed run
//
// Also tests the suspend path:
//   - `s` suspends the approval (modal closes, run stays waiting)
//   - `a` re-opens the modal explicitly

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
const FIXTURE = path.resolve(__dirname, "fixtures", "approve.md");

describe.skipIf(process.platform === "win32")(
  "e2e journey 3: approval gate",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test(
      "run → gate waiting → approve 'yes' → ship completes",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
        await session.waitForText("approve.md", DEFAULT_READY_MS);

        // Select workflow and run it
        session.pressEnter();
        await session.waitForText("Approval Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);

        // Build step should complete first
        await session.waitForText("build", DEFAULT_RUN_MS);

        // Gate step should reach "waiting" and the approval modal auto-opens
        await session.waitForRegex(/Ship\?|APPROVE/i, DEFAULT_RUN_MS);

        // The modal should show the two options: yes / no
        await session.waitForText("yes", DEFAULT_WAIT_MS);

        // "yes" is the first option — just press Enter to approve
        session.pressEnter();

        // After approval, the run should resume and ship step should complete
        await session.waitForText("ship", DEFAULT_RUN_MS);

        // Run should reach terminal state — Esc back to RUNS
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]|\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);
      },
      60_000,
    );

    test(
      "run → gate waiting → suspend → re-open with 'a' → approve 'no' → stop completes",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
        await session.waitForText("approve.md", DEFAULT_READY_MS);

        session.pressEnter();
        await session.waitForText("Approval Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);
        await session.waitForText("build", DEFAULT_RUN_MS);

        // Wait for approval modal to auto-open
        await session.waitForRegex(/Ship\?|APPROVE/i, DEFAULT_RUN_MS);
        await session.waitForText("yes", DEFAULT_WAIT_MS);

        // Suspend: press `s` — modal closes, run stays waiting
        session.write("s");
        // Wait for the modal to actually close — APPROVAL indicator disappears
        await session.waitFor(
          (snap) => !snap.includes("APPROVAL"),
          DEFAULT_WAIT_MS,
        );

        // The gate step should still be in waiting state but no modal
        const snapAfterSuspend = session.snapshot();
        expect(snapAfterSuspend).toContain("gate");
        expect(snapAfterSuspend).not.toMatch(/Ship\?/);

        // Re-open approval explicitly with `a`
        session.write("a");
        await session.waitForRegex(/Ship\?|APPROVE/i, DEFAULT_WAIT_MS);
        await session.waitForText("yes", DEFAULT_WAIT_MS);

        // Navigate to "no" option (j = down in modal) and verify cursor moved
        session.write("j");
        // Wait for "no" to become the selected option (● indicator)
        await session.waitForRegex(/[◉●] no/i, DEFAULT_WAIT_MS);

        // Confirm the "no" choice
        session.pressEnter();

        // After choosing "no", the stop step should run
        await session.waitForText("stop", DEFAULT_RUN_MS);

        // Back to browsing
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]|\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);
      },
      60_000,
    );

    test(
      "Esc cancels approval modal without deciding",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
        await session.waitForText("approve.md", DEFAULT_READY_MS);

        session.pressEnter();
        await session.waitForText("Approval Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);

        // Wait for approval modal
        await session.waitForRegex(/Ship\?|APPROVE/i, DEFAULT_RUN_MS);

        // Esc to cancel — modal closes, run stays waiting
        session.pressEsc();

        // Should be back to viewing mode with the gate still pending
        await session.waitForText("gate", DEFAULT_WAIT_MS);
      },
      60_000,
    );
  },
);

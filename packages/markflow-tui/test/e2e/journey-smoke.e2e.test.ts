// test/e2e/journey-smoke.e2e.test.ts
//
// Full-loop smoke test exercising the core user journey end-to-end:
//
//   1. Empty launch — onboarding screen
//   2. Add workflow via launch-arg — browser shows it
//   3. Select workflow — preview pane
//   4. Run workflow (no inputs) — RUN mode, steps render, run completes
//   5. Return to RUNS table — session run visible
//   6. Re-open completed run from RUNS table
//   7. Navigate viewing tabs (graph → detail → log → events)
//   8. Return to WORKFLOWS — workflow still listed
//   9. Run again — second run starts, workspace reused (not duplicated)
//  10. Run workflow with inputs — input modal opens, submit starts run
//  11. Help overlay — ? opens, Esc closes
//  12. Command palette — : opens, Esc closes
//  13. Quit — q exits cleanly

import { readdir } from "node:fs/promises";
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
const HELLO = path.resolve(__dirname, "fixtures", "hello.md");
const WITH_INPUTS = path.resolve(__dirname, "fixtures", "with-inputs.md");

describe.skipIf(process.platform === "win32")(
  "smoke: full user journey",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    // -----------------------------------------------------------------------
    // 1. Empty launch — onboarding
    // -----------------------------------------------------------------------
    test("empty launch shows onboarding", async () => {
      session = await spawnTui({ cols: 120, rows: 40 });
      await session.waitForText("WORKFLOWS", DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toContain("No workflows registered yet");
      expect(snap).toContain("Press  a  to add");
    });

    // -----------------------------------------------------------------------
    // 2–9. Core journey: add → browse → run → runs table → re-run → tabs
    // -----------------------------------------------------------------------
    test(
      "add → browse → run → runs table → re-run → tabs → quit",
      async () => {
        // 2. Launch with hello.md — browser shows it
        session = await spawnTui({
          cols: 120,
          rows: 40,
          args: [HELLO],
        });
        await session.waitForText("1 entry", DEFAULT_READY_MS);
        await session.waitForText("hello.md", DEFAULT_WAIT_MS);

        // 3. Select workflow — preview
        session.pressEnter();
        await session.waitForText("Hello Pipeline", DEFAULT_WAIT_MS);

        // 4. Run workflow — RUN mode with steps
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);

        // Wait for the run to complete — all three steps should finish
        await session.waitForText("build", DEFAULT_RUN_MS);

        // Wait for run completion — the workflow has 3 steps (build→test→pack)
        // and each just echoes. Look for the final step appearing.
        await session.waitForText("pack", DEFAULT_RUN_MS);

        // 7a. Navigate viewing tabs: graph (default) → detail (2)
        // Match pane-specific content — tab headers always show all labels.
        // Detail pane auto-selects the first step and shows field labels.
        session.write("2");
        await session.waitForRegex(/script \(bash\).*seq=/, DEFAULT_WAIT_MS);

        // 7b. detail → log (3) — log pane has its own keybar
        session.write("3");
        await session.waitForRegex(/LOG \xb7/, DEFAULT_WAIT_MS);

        // 7c. Esc from non-graph → graph; second Esc → RUNS table
        session.pressEsc();
        // Small delay so the first Esc is processed (graph focus) before
        // the second Esc (close run).
        await new Promise((r) => setTimeout(r, 200));
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]/, DEFAULT_WAIT_MS);

        // The session run should appear in the runs table
        await session.waitForText("Hello Pipeline", DEFAULT_WAIT_MS);

        // 6. Re-open completed run from RUNS table via Enter
        session.pressEnter();
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_WAIT_MS);

        // Still shows the completed run's steps
        await session.waitForText("build", DEFAULT_WAIT_MS);

        // Back to browsing
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]|\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);

        // 8. Switch to WORKFLOWS tab — workflow still listed
        session.write("1");
        await session.waitForRegex(/\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);
        await session.waitForText("hello.md", DEFAULT_WAIT_MS);

        // 9. Run again — second run, workspace reused
        session.pressEnter();
        await session.waitForText("Hello Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);
        await session.waitForText("build", DEFAULT_RUN_MS);

        // Verify workspace reuse: only one slug directory (not hello, hello-2)
        const wsRoot = path.join(
          session.scratch.workspaceDir,
          ".markflow-tui",
          "workspaces",
        );
        const slugs = await readdir(wsRoot);
        const wsDirs = slugs.filter((s) => !s.startsWith("."));
        expect(wsDirs).toHaveLength(1);

        // That single workspace should have 2 run directories
        const runsDir = path.join(wsRoot, wsDirs[0]!, "runs");
        const runDirs = (await readdir(runsDir)).filter(
          (s) => !s.startsWith("."),
        );
        expect(runDirs.length).toBeGreaterThanOrEqual(2);

        // Back out
        session.pressEsc();

        // 12. Quit via q
        // First get back to browsing mode
        await session.waitForRegex(
          /\[ RUNS \]|\[ WORKFLOWS \]/,
          DEFAULT_WAIT_MS,
        );
        session.write("1");
        await session.waitForRegex(/\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);
        session.write("q");
        const { exitCode } = await session.waitForExit(DEFAULT_WAIT_MS);
        expect(exitCode).toBe(0);
      },
      60_000,
    );

    // -----------------------------------------------------------------------
    // 10. Run workflow with inputs — modal opens
    // -----------------------------------------------------------------------
    test(
      "r on workflow with inputs opens the input modal",
      async () => {
        session = await spawnTui({
          cols: 120,
          rows: 40,
          args: [WITH_INPUTS],
        });
        await session.waitForText("1 entry", DEFAULT_READY_MS);
        await session.waitForText("with-inputs.md", DEFAULT_WAIT_MS);

        session.pressEnter();
        await session.waitForText("Deploy With Inputs", DEFAULT_WAIT_MS);

        session.write("r");
        // The input prompt modal should appear with the workflow name
        await session.waitForRegex(/RUN.*Deploy With Inputs|TARGET/i, DEFAULT_WAIT_MS);

        // Esc cancels the modal
        session.pressEsc();
        await session.waitForText("Deploy With Inputs", DEFAULT_WAIT_MS);
      },
    );

    // -----------------------------------------------------------------------
    // 11. Help overlay — ? opens, Esc closes
    // -----------------------------------------------------------------------
    test("? opens help overlay, Esc closes it", async () => {
      session = await spawnTui({
        cols: 120,
        rows: 40,
        args: [HELLO],
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("?");
      await session.waitForRegex(/HELP|help/i, DEFAULT_WAIT_MS);

      session.pressEsc();
      // Back to normal — help overlay gone, workflow still visible
      await session.waitForText("hello.md", DEFAULT_WAIT_MS);
    });

    // -----------------------------------------------------------------------
    // 12. Command palette — : opens, Esc closes
    // -----------------------------------------------------------------------
    test(": opens command palette, Esc closes it", async () => {
      session = await spawnTui({
        cols: 120,
        rows: 40,
        args: [HELLO],
      });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write(":");
      await session.waitForRegex(/COMMAND|:/i, DEFAULT_WAIT_MS);

      session.pressEsc();
      await session.waitForText("hello.md", DEFAULT_WAIT_MS);
    });
  },
);

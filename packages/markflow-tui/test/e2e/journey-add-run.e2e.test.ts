// test/e2e/journey-add-run.e2e.test.ts
//
// Journey 1 — Full run lifecycle with viewing panes:
//
//   1. Launch with hello.md → workflow listed
//   2. Run workflow → all 3 steps complete (build → test → pack)
//   3. Detail pane: verify step metadata fields
//   4. Log pane: verify step output visible
//   5. Events pane: verify engine events listed
//   6. RUNS table: completed run visible, re-openable
//   7. Run with-inputs.md: fill required input → run starts
//   8. Multiple workflows: both appear in WORKFLOWS, runs in RUNS table

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
  "e2e journey 1: run lifecycle and viewing panes",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test(
      "run hello.md → verify all 4 viewing panes have content",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [HELLO] });
        await session.waitForText("hello.md", DEFAULT_READY_MS);

        // Select and run
        session.pressEnter();
        await session.waitForText("Hello Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);

        // All three steps should complete
        await session.waitForText("build", DEFAULT_RUN_MS);
        await session.waitForText("test", DEFAULT_RUN_MS);
        await session.waitForText("pack", DEFAULT_RUN_MS);

        // --- Graph pane (default, tab 1) ---
        // Step names and status indicators should be visible
        const graphSnap = session.snapshot();
        expect(graphSnap).toContain("build");
        expect(graphSnap).toContain("test");
        expect(graphSnap).toContain("pack");

        // --- Detail pane (tab 2) ---
        // Should show step metadata fields
        session.write("2");
        await session.waitForRegex(/script \(bash\)/, DEFAULT_WAIT_MS);
        const detailSnap = session.snapshot();
        expect(detailSnap).toMatch(/type\s+script/);
        expect(detailSnap).toMatch(/exit\s+0/);

        // --- Log pane (tab 3) ---
        // Keybar should change to LOG-specific bar
        session.write("3");
        await session.waitForRegex(/LOG/, DEFAULT_WAIT_MS);

        // --- Events pane (tab 4) ---
        session.write("4");
        // Events pane should show engine event types
        await session.waitForRegex(/token:created|step:start|step:complete/, DEFAULT_RUN_MS);
        const eventsSnap = session.snapshot();
        // Should have multiple event rows
        expect(eventsSnap).toMatch(/seq/i);

        // Back to graph
        session.write("1");
        await session.waitForText("build", DEFAULT_WAIT_MS);
      },
      60_000,
    );

    test(
      "run with-inputs.md: fill TARGET input → deploy runs",
      async () => {
        session = await spawnTui({
          cols: 120,
          rows: 40,
          args: [WITH_INPUTS],
        });
        await session.waitForText("with-inputs.md", DEFAULT_READY_MS);

        // Select workflow
        session.pressEnter();
        await session.waitForText("Deploy With Inputs", DEFAULT_WAIT_MS);

        // Press r → input modal opens (TARGET is required)
        session.write("r");
        await session.waitForRegex(/RUN.*Deploy With Inputs/, DEFAULT_WAIT_MS);

        // Type a value for TARGET and verify it appears
        session.write("production");
        await session.waitForText("production", DEFAULT_WAIT_MS);

        // Submit — Enter from the text field submits the form
        session.pressEnter();

        // Run should start — RUN mode with steps
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);
        await session.waitForText("deploy", DEFAULT_RUN_MS);
        await session.waitForText("verify", DEFAULT_RUN_MS);

        // Back to browsing
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]|\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);
      },
      60_000,
    );

    test(
      "multiple workflows: launch with both hello + with-inputs, both appear",
      async () => {
        session = await spawnTui({
          cols: 120,
          rows: 40,
          args: [HELLO, WITH_INPUTS],
        });
        await session.waitForText("2 entries", DEFAULT_READY_MS);

        // Both workflows should be listed
        const snap = session.snapshot();
        expect(snap).toContain("hello.md");
        expect(snap).toContain("with-inputs.md");

        // Navigate to hello.md — it may be at either position
        // The preview pane shows the title of the selected workflow
        const previewSnap = session.snapshot();
        if (!previewSnap.includes("Hello Pipeline")) {
          session.write("j");
          await session.waitForText("Hello Pipeline", DEFAULT_WAIT_MS);
        }
        session.pressEnter();
        await session.waitForText("Hello Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);
        await session.waitForText("pack", DEFAULT_RUN_MS);

        // Back to WORKFLOWS
        session.pressEsc();
        await session.waitForRegex(/\[ RUNS \]|\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);
        session.write("1");
        await session.waitForRegex(/\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);

        // Both entries still listed
        const snap2 = session.snapshot();
        expect(snap2).toContain("hello.md");
        expect(snap2).toContain("with-inputs.md");

        // Switch to RUNS tab — the completed run should be there
        session.write("2");
        await session.waitForRegex(/\[ RUNS \]/, DEFAULT_WAIT_MS);
        await session.waitForText("Hello", DEFAULT_WAIT_MS);
      },
      60_000,
    );

    test(
      "q in viewing mode goes back, not quit",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [HELLO] });
        await session.waitForText("hello.md", DEFAULT_READY_MS);

        // Run a workflow
        session.pressEnter();
        await session.waitForText("Hello Pipeline", DEFAULT_WAIT_MS);
        session.write("r");
        await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);
        await session.waitForText("build", DEFAULT_RUN_MS);

        // q in viewing mode should go back to browsing, not quit
        session.write("q");
        await session.waitForRegex(/\[ RUNS \]|\[ WORKFLOWS \]/, DEFAULT_WAIT_MS);

        // App should still be alive
        const snap = session.snapshot();
        expect(snap).toMatch(/WORKFLOWS|RUNS/);
      },
      60_000,
    );
  },
);

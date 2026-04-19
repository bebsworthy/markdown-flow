// test/e2e/T1006-submit-inputs-starts-run.e2e.test.ts
//
// T1006 — Submitting valid inputs calls the engine bridge; `run:start`
// fires with the inputs; the modal closes exactly once.
// Refs: P9-T1 plan.

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
const FIXTURE = path.resolve(__dirname, "fixtures", "with-inputs.md");

describe.skipIf(process.platform === "win32")(
  "T1006 submit inputs starts a run",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("filling required input and pressing Enter starts a run", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("1 entry", DEFAULT_READY_MS);
      session.pressEnter();
      await session.waitForText("Deploy With Inputs", DEFAULT_READY_MS);

      session.write("r");
      await session.waitForRegex(/RUN.*Deploy With Inputs/, DEFAULT_READY_MS);

      // Type value for the required TARGET input
      session.write("staging");
      await session.waitForText("staging", DEFAULT_READY_MS);

      // Submit the form
      session.pressEnter();

      // Should transition to RUN/viewing mode
      await session.waitForRegex(/\[ RUN \]/, DEFAULT_RUN_MS);

      // Verify a run was created in the per-workflow workspace (not MARKFLOW_RUNS_DIR)
      const wsRoot = path.join(
        session.scratch.workspaceDir,
        ".markflow-tui",
        "workspaces",
      );
      const slugs = await readdir(wsRoot);
      expect(slugs.length).toBeGreaterThanOrEqual(1);
      const wsRunsDir = path.join(wsRoot, slugs[0]!, "runs");
      const runDirs = (await readdir(wsRunsDir)).filter(
        (e) => !e.startsWith("."),
      );
      expect(runDirs.length).toBeGreaterThanOrEqual(1);

      // Verify event log has run:start with inputs
      const runId = runDirs[0]!;
      const eventsPath = path.join(wsRunsDir, runId, "events.jsonl");
      const events = await session.waitForEventLogAt(
        eventsPath,
        1,
        DEFAULT_RUN_MS,
      );
      const runStart = events.find(
        (e) => (e as { type?: string }).type === "run:start",
      );
      expect(runStart).toBeDefined();

      // Verify inputs were passed
      const inputs = (runStart as { inputs?: Record<string, string> })?.inputs;
      expect(inputs?.TARGET).toBe("staging");
    });
  },
);

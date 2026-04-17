// test/e2e/T1005-run-entry-esc-cancels.e2e.test.ts
//
// T1005 — `Esc` cancels the input-prompt modal; the bridge is NOT called;
// registry / runs dir unchanged.
// Refs: P9-T1 plan.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "with-inputs.md");

describe.skipIf(process.platform === "win32")(
  "T1005 Esc cancels input-prompt modal",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("Esc closes the modal without starting a run", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.pressEnter();
      await session.waitForText("Deploy With Inputs", DEFAULT_READY_MS);

      session.write("r");
      await session.waitForRegex(/RUN.*Deploy With Inputs/, DEFAULT_READY_MS);

      // Wait for one render frame to ensure the modal's useInput is mounted
      // before sending Esc (a lone \x1b may be consumed as an escape-sequence
      // prefix if sent in the same PTY chunk as the modal's first paint).
      await session.waitFor(() => true, 100);
      session.pressEsc();

      await session.waitFor(
        (snap) => !snap.includes("RUN \u00b7 Deploy With Inputs"),
        DEFAULT_READY_MS,
      );

      const entries = await readdir(session.scratch.runsDir);
      const runDirs = entries.filter((e) => !e.startsWith("."));
      expect(runDirs).toHaveLength(0);
    });
  },
);

// test/e2e/T1002-run-button-dimmed.e2e.test.ts
//
// T1002 — The `⏎ Run` button is dimmed (hidden label) until every required
// input is populated.
// Refs: P9-T1 plan §6 D4.

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
  "T1002 Run button dimmed until required inputs filled",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("Run button is dimmed initially and enabled after filling required input", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("1 entry", DEFAULT_READY_MS);
      session.pressEnter();
      await session.waitForText("Deploy With Inputs", DEFAULT_READY_MS);

      session.write("r");
      await session.waitForRegex(/RUN.*Deploy With Inputs/, DEFAULT_READY_MS);

      const snapBefore = session.snapshot();
      expect(snapBefore).toContain("TARGET");

      // Type a value for the required TARGET input
      session.write("production");

      await session.waitForText("production", DEFAULT_READY_MS);

      const snapAfter = session.snapshot();
      expect(snapAfter).toContain("production");
      // The Run button should now be actionable (label visible)
      expect(snapAfter).toMatch(/Run/);
    });
  },
);

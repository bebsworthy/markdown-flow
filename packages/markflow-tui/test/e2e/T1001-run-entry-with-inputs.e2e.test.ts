// test/e2e/T1001-run-entry-with-inputs.e2e.test.ts
//
// T1001 — `r` on a workflow with ≥1 required input opens the input-prompt
// modal. Title reads `RUN · <workflow>`.
// Refs: features.md §5.7.

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
  "T1001 run entry with required inputs",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("r opens the input-prompt modal with correct title", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.pressEnter();
      await session.waitForText("Deploy With Inputs", DEFAULT_READY_MS);

      session.write("r");

      await session.waitForRegex(/RUN.*Deploy With Inputs/, DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toContain("TARGET");
      expect(snap).toContain("REGION");
    });
  },
);

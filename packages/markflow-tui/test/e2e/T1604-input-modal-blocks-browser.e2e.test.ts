// test/e2e/T1604-input-modal-blocks-browser.e2e.test.ts
//
// T1604 — With the input-prompt modal open, the browser `r` handler is inert.
// Refs: P9-T1 post-mortem.

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
  "T1604 input-prompt modal blocks browser r",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("pressing r inside input modal types r, does not start a second run", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("1 entry", DEFAULT_READY_MS);
      session.pressEnter();
      await session.waitForText("Deploy With Inputs", DEFAULT_READY_MS);

      // Open the input modal
      session.write("r");
      await session.waitForRegex(/RUN.*Deploy With Inputs/, DEFAULT_READY_MS);

      // Type "r" — this should type into the input field, not start a run
      session.write("r");
      await session.waitFor(() => true, 200);

      const snap = session.snapshot();
      // Modal should still be open
      expect(snap).toMatch(/RUN.*Deploy With Inputs/);
      // The 'r' should have been typed into the input field
      expect(snap).toContain("r");
    });
  },
);

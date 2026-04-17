// test/e2e/T1602-help-overlay-blocks-input.e2e.test.ts
//
// T1602 — With the help overlay open, no underlying pane handler fires
// on any keystroke except `Esc` or `q`.
// Refs: features.md §3.10.

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
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T1602 help overlay blocks underlying input",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("keys like r, a, : do not fire while help is open", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);
      session.pressEnter();
      await session.waitForText("Hello Pipeline", DEFAULT_READY_MS);

      // Open help
      session.write("?");
      await session.waitForRegex(/HELP|Help/i, DEFAULT_READY_MS);

      // Press r — should NOT open a run
      session.write("r");
      await session.waitFor(() => true, 200);
      let snap = session.snapshot();
      expect(snap).not.toMatch(/\[ RUN \]/);

      // Press a — should NOT open the add-workflow modal
      session.write("a");
      await session.waitFor(() => true, 200);
      snap = session.snapshot();
      expect(snap).not.toContain("Add workflow");

      // Press : — should NOT open the palette
      session.write(":");
      await session.waitFor(() => true, 200);
      snap = session.snapshot();
      expect(snap).not.toContain("COMMAND");

      // Help should still be visible
      expect(snap).toMatch(/HELP|Help/i);
    });
  },
);

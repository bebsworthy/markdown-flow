// test/e2e/T0809-help-overlay.e2e.test.ts
//
// T0809 — `?` opens the help overlay with key binding categories.
// Refs: features.md §3.10; mockups.md §11.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T0809 help overlay",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("? opens the help overlay with key bindings", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write("?");

      // Wait for the help overlay's keybar hint — unique to the overlay
      await session.waitForText("Esc Close", DEFAULT_WAIT_MS);

      const snap = session.snapshot();
      expect(snap).toMatch(/HELP.*mode/);
    });
  },
);

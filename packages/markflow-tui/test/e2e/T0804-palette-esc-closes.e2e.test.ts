// test/e2e/T0804-palette-esc-closes.e2e.test.ts
//
// T0804 — `Esc` closes the palette without executing; any typed text
// is discarded.
// Refs: mockups.md §10.

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
  "T0804 Esc closes palette",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("Esc closes the palette and discards text", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write(":");
      await session.waitForText("COMMAND", DEFAULT_READY_MS);

      session.write("quit");
      await session.waitForText("quit", DEFAULT_READY_MS);

      await session.waitFor(() => true, 100);
      session.pressEsc();

      await session.waitFor(
        (snap) => !snap.includes("COMMAND"),
        DEFAULT_READY_MS,
      );

      const snap = session.snapshot();
      expect(snap).not.toContain("COMMAND");
      expect(snap).toContain("WORKFLOWS");
    });
  },
);

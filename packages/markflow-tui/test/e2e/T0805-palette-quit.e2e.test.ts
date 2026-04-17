// test/e2e/T0805-palette-quit.e2e.test.ts
//
// T0805 — `:quit` exits the TUI cleanly.
// Refs: features.md §3.10.

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
  "T0805 :quit exits cleanly",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test(":quit exits the TUI with code 0", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write(":");
      await session.waitForText("COMMAND", DEFAULT_READY_MS);

      session.write("quit");
      session.pressEnter();

      const { exitCode } = await session.waitForExit(DEFAULT_WAIT_MS);
      expect(exitCode).toBe(0);
    });
  },
);

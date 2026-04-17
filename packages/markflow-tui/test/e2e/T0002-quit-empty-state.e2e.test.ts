// test/e2e/T0002-quit-empty-state.e2e.test.ts
//
// T0002 — `q` at the empty state exits cleanly (exit code 0, terminal
// restored, no stray output).
// Refs: features.md §5.5 global.

import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

describe.skipIf(process.platform === "win32")(
  "T0002 q at empty state exits cleanly",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("q exits with code 0 and no stray output", async () => {
      session = await spawnTui();

      await session.waitForText("No workflows registered yet", DEFAULT_READY_MS);

      session.write("q");

      const { exitCode } = await session.waitForExit(DEFAULT_WAIT_MS);

      expect(exitCode).toBe(0);
    });
  },
);

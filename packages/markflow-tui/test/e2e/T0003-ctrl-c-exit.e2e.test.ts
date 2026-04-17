// test/e2e/T0003-ctrl-c-exit.e2e.test.ts
//
// T0003 — Ctrl-C from any mode tears down the PTY and exits 130; no dangling
// child processes.
// Refs: features.md §6.2.

import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

describe.skipIf(process.platform === "win32")(
  "T0003 Ctrl-C tears down cleanly",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("Ctrl-C at empty state exits with code 130", async () => {
      session = await spawnTui();

      await session.waitForText("No workflows registered yet", DEFAULT_READY_MS);

      session.pressCtrlC();

      const { exitCode } = await session.waitForExit(DEFAULT_WAIT_MS);

      // SIGINT convention: 128 + signal number (2) = 130
      expect(exitCode).toBe(130);
    });
  },
);

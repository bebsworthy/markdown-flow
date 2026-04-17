// test/e2e/T0808-unknown-command.e2e.test.ts
//
// T0808 — Unknown command → inline `unknown command` message, palette
// stays open.
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
  "T0808 unknown command error",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("unknown command shows error and palette stays open", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      session.write(":");
      await session.waitForText("COMMAND", DEFAULT_READY_MS);

      session.write("foobar");

      await session.waitForRegex(
        /no commands match/i,
        DEFAULT_READY_MS,
      );

      const snap = session.snapshot();
      expect(snap).toContain("COMMAND");
    });
  },
);

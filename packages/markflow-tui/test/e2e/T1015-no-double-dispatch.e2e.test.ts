// test/e2e/T1015-no-double-dispatch.e2e.test.ts
//
// T1015 — With the palette open, the browser's `r` binding does not also
// fire on the `r` character of `:run` — no double-dispatch.
// Refs: B3 audit.

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
  "T1015 no double-dispatch with palette open",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("typing r in palette does not trigger browser r binding", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("1 entry", DEFAULT_READY_MS);
      session.pressEnter();
      await session.waitForText("Hello Pipeline", DEFAULT_READY_MS);

      // Open palette
      session.write(":");
      await session.waitForText(":", DEFAULT_READY_MS);

      // Type "run" — the 'r' should NOT trigger the browser's run binding
      session.write("run");
      await session.waitForText("run", DEFAULT_READY_MS);

      const snap = session.snapshot();
      // Should still have the palette open, not have started a run
      expect(snap).not.toMatch(/\[ RUN \]/);
      // Palette input should contain "run"
      expect(snap).toContain(":run");
    });
  },
);

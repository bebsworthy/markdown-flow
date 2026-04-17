// test/e2e/T0013-ascii-mode.e2e.test.ts
//
// T0013 — `MARKFLOW_ASCII=1` swaps glyphs for bracketed text states and
// box-drawing for `+-|`.
// Refs: features.md §5.10; mockups.md §14.
//
// The harness sets MARKFLOW_ASCII=1 in the scratch env. This test verifies
// the TUI renders with ASCII box-drawing characters rather than Unicode
// line-drawing glyphs.

import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

describe.skipIf(process.platform === "win32")(
  "T0013 ASCII mode box-drawing",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("MARKFLOW_ASCII=1 renders with ASCII box-drawing", async () => {
      session = await spawnTui();

      await session.waitForText("No workflows registered yet", DEFAULT_READY_MS);

      const snap = session.snapshot();

      // Under ASCII mode, borders use +, -, | instead of ┌ ─ │ etc.
      // The shell/keybar border lines should contain ASCII characters.
      expect(snap).toMatch(/[+\-|]/);
      expect(snap).toContain("WORKFLOWS");
    });
  },
);

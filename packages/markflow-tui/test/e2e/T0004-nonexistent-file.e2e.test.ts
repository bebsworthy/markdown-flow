// test/e2e/T0004-nonexistent-file.e2e.test.ts
//
// T0004 — `markflow-tui nonexistent.md` reports the resolve failure inline
// in the registry list with `✗` badge and does not crash.
// Refs: mockups.md §2.

import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

describe.skipIf(process.platform === "win32")(
  "T0004 nonexistent file shows error badge",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("nonexistent.md renders with failure badge and no crash", async () => {
      session = await spawnTui({ args: ["nonexistent.md"] });

      await session.waitForText("nonexistent.md", DEFAULT_READY_MS);

      const snap = session.snapshot();

      expect(snap).toContain("nonexistent.md");
      expect(snap).toMatch(/✗/);
      expect(snap).toContain("WORKFLOWS");
    });
  },
);

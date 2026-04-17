// test/e2e/T0110-empty-state-hint.e2e.test.ts
//
// T0110 — Empty-state hint (§2 empty mockup) appears exactly when the
// registry is empty and the launch command had no positional args.
// Refs: mockups.md §2 empty.

import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

describe.skipIf(process.platform === "win32")(
  "T0110 empty-state hint",
  () => {
    let session: TuiSession | undefined;
    let scratch: ScratchEnv | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
      if (scratch) {
        await scratch.cleanup();
        scratch = undefined;
      }
    });

    test("empty registry with no args shows empty-state hint", async () => {
      scratch = await createScratchEnv();

      session = await spawnTui({ scratch, args: [] });

      // Wait for the empty-state hint to render.
      await session.waitFor(
        () => session!.screen().includes("add"),
        DEFAULT_READY_MS,
      );

      const snap = session.snapshot();

      // Should show the empty-state guidance text.
      expect(snap).toMatch(/No workflows|add/i);

      // Should show the restricted keybar: a Add, ? Help, q Quit.
      expect(snap).toContain("Add");
      expect(snap).toContain("Help");
      expect(snap).toContain("Quit");

      // Should NOT show "entries" — there are none.
      expect(snap).not.toMatch(/\d+ entr/);
    });
  },
);

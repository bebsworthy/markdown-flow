// test/e2e/T0001-empty-state-hint.e2e.test.ts
//
// T0001 — Starting markflow-tui with no args on an empty working dir renders
// the empty-state hint with keybar reduced to `a Add · ? Help · q Quit`.
// Refs: mockups.md §2 empty-state; features.md §3.1.

import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

describe.skipIf(process.platform === "win32")(
  "T0001 empty-state hint on empty working dir",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("renders empty-state hint text and reduced keybar", async () => {
      session = await spawnTui();

      await session.waitForText("No workflows registered yet", DEFAULT_READY_MS);

      const snap = session.snapshot();

      expect(snap).toContain("No workflows registered yet");
      expect(snap).toContain("Press  a  to add by fuzzy-find or path/URL");
      expect(snap).toContain("markflow-tui <path|glob|url>");
      expect(snap).toContain(".markflow-tui.json");

      // Keybar shows only Add, Help, Quit — no Select/Open/Run
      expect(snap).toMatch(/a\s+Add/);
      expect(snap).toMatch(/\?\s+Help/);
      expect(snap).toMatch(/q\s+Quit/);

      // Mode indicator present
      expect(snap).toContain("WORKFLOWS");
    });
  },
);

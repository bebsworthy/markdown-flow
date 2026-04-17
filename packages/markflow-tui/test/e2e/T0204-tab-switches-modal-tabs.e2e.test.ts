// test/e2e/T0204-tab-switches-modal-tabs.e2e.test.ts
//
// T0204 — `Tab` switches between the Fuzzy find and Path or URL tabs;
// focus moves to the other input.
// Refs: mockups.md §2 add-modal.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";
import { keys } from "./ansi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T0204 tab switches modal tabs",
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

    test("Tab toggles between Fuzzy find and Path or URL", async () => {
      scratch = await createScratchEnv();
      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal — starts on Fuzzy find tab.
      session.write("a");
      await session.waitForRegex(/\[ Fuzzy find \]/, DEFAULT_READY_MS);

      let snap = session.snapshot();
      // Fuzzy find is the active tab (bracketed).
      expect(snap).toMatch(/\[ Fuzzy find \]/);
      // Path or URL should be visible but not bracketed.
      expect(snap).toMatch(/Path or URL/);

      // Press Tab to switch to the URL tab.
      session.write(keys.TAB);
      await session.waitForRegex(/\[ Path or URL \]/, DEFAULT_READY_MS);

      snap = session.snapshot();
      expect(snap).toMatch(/\[ Path or URL \]/);
      // Fuzzy find should now be unselected (not bracketed).
      expect(snap).not.toMatch(/\[ Fuzzy find \]/);
      expect(snap).toMatch(/Fuzzy find/);

      // Press Tab again to switch back to Fuzzy find.
      session.write(keys.TAB);
      await session.waitForRegex(/\[ Fuzzy find \]/, DEFAULT_READY_MS);

      snap = session.snapshot();
      expect(snap).toMatch(/\[ Fuzzy find \]/);
      expect(snap).not.toMatch(/\[ Path or URL \]/);
    });
  },
);

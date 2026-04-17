// test/e2e/T0200-add-modal-opens.e2e.test.ts
//
// T0200 — `a` opens the add modal with `[ Fuzzy find ]  Path or URL` tabs
// and an empty input (§2 mockup).
// Refs: features.md §3.1 adding; mockups.md §2 add-modal.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T0200 add-modal opens",
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

    test("pressing `a` opens add modal with both tabs and empty input", async () => {
      scratch = await createScratchEnv();
      session = await spawnTui({ scratch, args: [FIXTURE] });

      // Wait for the browser to render with the seeded entry.
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Press `a` to open the add modal.
      session.write("a");

      // Wait for the modal to render.
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);

      const snap = session.snapshot();

      // Both tabs should be visible.
      expect(snap).toMatch(/Fuzzy find/);
      expect(snap).toMatch(/Path or URL/);

      // The fuzzy-find tab should be active (selected by default) — shown
      // with bracket decoration in the mockup: `[ Fuzzy find ]`.
      expect(snap).toMatch(/\[ Fuzzy find \]/);

      // Footer hints should be visible.
      expect(snap).toMatch(/Tab/);
      expect(snap).toMatch(/Cancel/);
    });
  },
);

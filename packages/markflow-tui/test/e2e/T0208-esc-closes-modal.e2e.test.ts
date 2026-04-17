// test/e2e/T0208-esc-closes-modal.e2e.test.ts
//
// T0208 — `Esc` closes the modal without adding anything; registry file is
// unchanged.
// Refs: mockups.md §2 add-modal.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";
import { keys } from "./ansi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T0208 Esc closes modal unchanged",
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

    test("Esc closes the add modal without modifying registry", async () => {
      scratch = await createScratchEnv();
      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Snapshot registry before opening modal.
      const beforeRaw = await readFile(scratch.registryPath, "utf8");

      // Open add modal.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);

      // Press Esc to close the modal.
      session.write(keys.ESC);

      // Modal should disappear — "Fuzzy find" no longer visible.
      await session.waitFor(
        (snap) => !snap.includes("Fuzzy find"),
        DEFAULT_WAIT_MS,
      );

      // Still shows 1 entry.
      const snap = session.snapshot();
      expect(snap).toMatch(/1 entry/);

      // Registry unchanged.
      const afterRaw = await readFile(scratch.registryPath, "utf8");
      expect(afterRaw).toBe(beforeRaw);
    });
  },
);

// test/e2e/T0206-path-tab-no-match-error.e2e.test.ts
//
// T0206 — Path tab shows "no files matched" when a glob pattern resolves to
// zero results.
// Refs: features.md §3.1.

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
  "T0206 path tab no-match error",
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

    test("glob with no matches shows inline error", async () => {
      scratch = await createScratchEnv();

      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal, switch to Path or URL tab.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);
      session.write(keys.TAB);
      await session.waitForRegex(/\[ Path or URL \]/, DEFAULT_READY_MS);

      // Type a glob pattern that matches nothing.
      session.write(path.join(scratch.workspaceDir, "nonexistent-*.md"));

      // Press Enter.
      session.write(keys.ENTER);

      // Should show "no files matched" error inline.
      await session.waitForText("no files matched", DEFAULT_WAIT_MS);

      const snap = session.snapshot();
      expect(snap).toMatch(/no files matched/);

      // Modal should still be open (error didn't close it).
      expect(snap).toMatch(/Path or URL/);
    });
  },
);

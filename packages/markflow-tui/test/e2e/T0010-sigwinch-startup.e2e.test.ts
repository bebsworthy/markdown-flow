// test/e2e/T0010-sigwinch-startup.e2e.test.ts
//
// T0010 — A SIGWINCH during startup does not corrupt the first render
// (regression guard for Ink alt-screen race).
// Refs: features.md §6.2.

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
  "T0010 SIGWINCH during startup",
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

    test("resize during startup does not corrupt the render", async () => {
      scratch = await createScratchEnv();
      session = await spawnTui({ scratch, args: [FIXTURE] });

      // Fire a resize immediately — before the first render settles.
      session.resize(100, 30);

      // The TUI should still render correctly after the resize.
      await session.waitForText("hello.md", DEFAULT_READY_MS);

      // Fire another resize back to original dimensions.
      session.resize(120, 40);

      // Verify the screen still contains the expected content and isn't
      // garbled: the workflow entry and the structural chrome must be intact.
      await session.waitForText("hello.md", DEFAULT_READY_MS);

      const snap = session.snapshot();
      expect(snap).toContain("WORKFLOWS");
      expect(snap).toContain("hello.md");
      expect(snap).toContain("1 entry");
    });
  },
);

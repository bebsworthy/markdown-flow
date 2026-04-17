// test/e2e/T0210-no-duplicate-entry.e2e.test.ts
//
// T0210 — Adding a path that is already in the registry is a no-op; no
// duplicate entry is written.
// Refs: features.md §3.1.

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
  "T0210 no duplicate entry",
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

    test("adding same path twice does not create a duplicate", async () => {
      scratch = await createScratchEnv();
      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal, switch to Path or URL tab.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);
      session.write(keys.TAB);
      await session.waitForRegex(/\[ Path or URL \]/, DEFAULT_READY_MS);

      // Type the same fixture path that's already registered.
      session.write(FIXTURE);
      session.write(keys.ENTER);

      // Wait a moment for the add to process.
      await session.waitFor(async () => {
        try {
          const r = await readFile(scratch!.registryPath, "utf8");
          const data = JSON.parse(r) as unknown[];
          return data.length >= 1;
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);

      // Should still be 1 entry, not 2.
      const snap = session.snapshot();
      expect(snap).toMatch(/1 entry/);

      const raw = await readFile(scratch.registryPath, "utf8");
      const data = JSON.parse(raw) as unknown[];
      expect(data).toHaveLength(1);
    });
  },
);

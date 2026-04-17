// test/e2e/T0007-idempotent-relaunch.e2e.test.ts
//
// T0007 — Re-launching with the same positional arg is idempotent — registry
// file contains one entry, not duplicates.
// Refs: features.md §3.1 persistence.

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T0007 idempotent re-launch",
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

    test("same arg twice produces one registry entry", async () => {
      scratch = await createScratchEnv();

      // First launch — registers hello.md
      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("hello.md", DEFAULT_READY_MS);
      await session.waitFor(async () => {
        try {
          const raw = await readFile(scratch!.registryPath, "utf8");
          const data = JSON.parse(raw) as unknown[];
          return data.length === 1;
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);
      await session.kill();
      session = undefined;

      // Second launch — same scratch, same fixture
      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("hello.md", DEFAULT_READY_MS);
      await session.waitFor(async () => {
        try {
          const raw = await readFile(scratch!.registryPath, "utf8");
          const data = JSON.parse(raw) as unknown[];
          return data.length === 1;
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);

      const raw = await readFile(scratch.registryPath, "utf8");
      const data = JSON.parse(raw) as unknown[];
      expect(data).toHaveLength(1);
    });
  },
);

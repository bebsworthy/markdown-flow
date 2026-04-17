// test/e2e/T0009-list-flag.e2e.test.ts
//
// T0009 — `--list <path>` reads/writes the alternate list file.
// Refs: features.md §3.1 launch.

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
  "T0009 --list flag",
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

    test("--list writes to the specified path", async () => {
      scratch = await createScratchEnv();
      const customList = path.join(scratch.dir, "custom-list.json");

      // The harness passes --list <scratch.registryPath>. Override by
      // passing --list again — the parser takes the last value.
      session = await spawnTui({
        scratch,
        args: ["--list", customList, FIXTURE],
      });

      await session.waitForText("hello.md", DEFAULT_READY_MS);

      await session.waitFor(async () => {
        try {
          const raw = await readFile(customList, "utf8");
          return raw.includes("hello.md");
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);

      const raw = await readFile(customList, "utf8");
      expect(raw).toContain("hello.md");
    });
  },
);

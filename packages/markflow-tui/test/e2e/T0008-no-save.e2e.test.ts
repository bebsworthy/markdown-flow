// test/e2e/T0008-no-save.e2e.test.ts
//
// T0008 — `--no-save` launch does not write `./.markflow-tui.json`; entries
// live for the session only.
// Refs: features.md §3.1 launch.

import { stat } from "node:fs/promises";
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")(
  "T0008 --no-save prevents persistence",
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

    test("--no-save does not write registry file", async () => {
      scratch = await createScratchEnv();

      session = await spawnTui({
        scratch,
        args: ["--no-save", FIXTURE],
      });

      await session.waitForText("hello.md", DEFAULT_READY_MS);
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Give a brief window for any async write to land
      await new Promise((r) => setTimeout(r, 500));

      // The harness passes --list <registryPath> but --no-save should
      // prevent writes to that path.
      const exists = await fileExists(scratch.registryPath);
      expect(exists).toBe(false);
    });
  },
);

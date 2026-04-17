// test/e2e/T0109-atomic-registry-write.e2e.test.ts
//
// T0109 — Registry file is atomically replaced on every mutation — a `kill -9`
// during write never leaves a truncated JSON file.
// Refs: features.md §3.1 persistence.
//
// Strategy: we can't deterministically race kill -9 against a write in e2e,
// but we can verify the contract: after every mutation the registry file on
// disk is always valid, well-formed JSON. We trigger multiple mutations
// (add via launch args, then `d` to remove) and read the registry between
// each, verifying it always parses cleanly and no temp files are left behind.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { keys } from "./ansi.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

const WORKFLOW = [
  "# Atomic Test",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  a --> b",
  "```",
  "",
  "# Steps",
  "",
  "## a",
  "",
  "```bash",
  'echo "a"',
  "```",
  "",
  "## b",
  "",
  "```bash",
  'echo "b"',
  "```",
].join("\n");

describe.skipIf(process.platform === "win32")(
  "T0109 atomic registry write",
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

    test("registry is valid JSON after mutation, no temp files left", async () => {
      scratch = await createScratchEnv();

      const wfFile = path.join(scratch.dir, "atomic.md");
      await writeFile(wfFile, WORKFLOW, "utf8");

      session = await spawnTui({ scratch, args: [wfFile] });

      await session.waitFor(
        () => session!.screen().includes("1 entr"),
        DEFAULT_READY_MS,
      );

      // After launch, registry was written with the entry.
      const reg1 = await readFile(scratch.registryPath, "utf8");
      const parsed1 = JSON.parse(reg1);
      expect(Array.isArray(parsed1)).toBe(true);
      expect(parsed1).toHaveLength(1);

      // No temp files in the registry directory.
      const registryDir = path.dirname(scratch.registryPath);
      let files = await readdir(registryDir);
      const tempFiles1 = files.filter((f) => f.includes(".tmp-"));
      expect(tempFiles1).toHaveLength(0);

      // Remove the entry via `d`.
      session.write(keys.ENTER);
      await session.waitFor(
        () => session!.screen().includes("Atomic Test"),
        DEFAULT_READY_MS,
      );
      session.write("d");
      await session.waitFor(
        () =>
          session!.screen().includes("0 entr") ||
          session!.screen().includes("No workflows") ||
          session!.screen().includes("add"),
        DEFAULT_READY_MS,
      );

      // After removal, registry is still valid JSON.
      const reg2 = await readFile(scratch.registryPath, "utf8");
      const parsed2 = JSON.parse(reg2);
      expect(Array.isArray(parsed2)).toBe(true);
      expect(parsed2).toHaveLength(0);

      // Still no temp files.
      files = await readdir(registryDir);
      const tempFiles2 = files.filter((f) => f.includes(".tmp-"));
      expect(tempFiles2).toHaveLength(0);
    });
  },
);

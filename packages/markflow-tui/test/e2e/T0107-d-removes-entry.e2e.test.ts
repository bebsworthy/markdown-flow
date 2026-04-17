// test/e2e/T0107-d-removes-entry.e2e.test.ts
//
// T0107 — `d` on a valid entry removes the entry from the registry file but
// does NOT touch the underlying `.md` or workspace directory on disk.
// Refs: features.md §3.1.

import { readFile, stat, writeFile } from "node:fs/promises";
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
  "# Remove Me",
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
  "T0107 d removes entry from registry",
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

    test("d removes entry from registry, workflow file untouched", async () => {
      scratch = await createScratchEnv();

      const wfFile = path.join(scratch.dir, "removeme.md");
      await writeFile(wfFile, WORKFLOW, "utf8");

      session = await spawnTui({ scratch, args: [wfFile] });

      await session.waitFor(
        () => session!.screen().includes("1 entr"),
        DEFAULT_READY_MS,
      );

      // Select the entry first (press Enter or down).
      session.write(keys.ENTER);
      await session.waitFor(
        () => session!.screen().includes("Remove Me"),
        DEFAULT_READY_MS,
      );

      // Press d to remove the entry.
      session.write("d");

      // Wait for the entry count to drop to 0 or the empty-state hint.
      await session.waitFor(
        () =>
          session!.screen().includes("0 entr") ||
          session!.screen().includes("No workflows") ||
          session!.screen().includes("add"),
        DEFAULT_READY_MS,
      );

      // The workflow file must still exist on disk.
      const fileStat = await stat(wfFile);
      expect(fileStat.isFile()).toBe(true);
      const content = await readFile(wfFile, "utf8");
      expect(content).toContain("Remove Me");

      // The registry file should no longer list the entry.
      const registry = JSON.parse(
        await readFile(scratch.registryPath, "utf8"),
      ) as Array<{ source: string }>;
      const sources = registry.map((e) => e.source);
      expect(sources).not.toContain(wfFile);
    });
  },
);

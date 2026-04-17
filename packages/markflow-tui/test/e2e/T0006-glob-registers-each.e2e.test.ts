// test/e2e/T0006-glob-registers-each.e2e.test.ts
//
// T0006 — `markflow-tui <glob>` (e.g. `fixtures/*.md`) registers each
// resolved file once.
// Refs: features.md §3.1 launch.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

const WORKFLOW_TEMPLATE = (name: string) =>
  [
    `# ${name}`,
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
  "T0006 glob registers each file once",
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

    test("glob resolves multiple files and registers each once", async () => {
      scratch = await createScratchEnv();

      const names = ["alpha.md", "beta.md", "gamma.md"];
      for (const name of names) {
        await writeFile(
          path.join(scratch.dir, name),
          WORKFLOW_TEMPLATE(name.replace(".md", "")),
          "utf8",
        );
      }

      // The real shell expands globs before the binary sees them, so we
      // pass the resolved paths as separate positional args (node-pty
      // bypasses the shell).
      const files = names.map((n) => path.join(scratch!.dir, n));
      session = await spawnTui({ scratch, args: files });

      await session.waitForText("3 entries", DEFAULT_READY_MS);

      // Verify registry contains exactly 3 entries (no duplicates).
      await session.waitFor(async () => {
        try {
          const raw = await readFile(scratch!.registryPath, "utf8");
          const data = JSON.parse(raw) as unknown[];
          return data.length === 3;
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);

      const raw = await readFile(scratch.registryPath, "utf8");
      const data = JSON.parse(raw) as unknown[];
      expect(data).toHaveLength(3);

      // Screen should mention all three files.
      const screen = session.screen();
      expect(screen).toContain("alpha.md");
      expect(screen).toContain("beta.md");
      expect(screen).toContain("gamma.md");
    });
  },
);

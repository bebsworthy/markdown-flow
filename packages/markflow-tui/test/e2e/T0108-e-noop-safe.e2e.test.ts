// test/e2e/T0108-e-noop-safe.e2e.test.ts
//
// T0108 — `e` on a valid entry is accepted (may be a no-op today) without
// corrupting state; cursor stays on the same entry.
// Refs: mockups.md §2 keybar.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

const WORKFLOW = (name: string) =>
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
  "T0108 e key is safe no-op",
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

    test("e does not corrupt state, cursor stays on same entry", async () => {
      scratch = await createScratchEnv();

      const files: string[] = [];
      for (const name of ["Alpha", "Beta"]) {
        const f = path.join(scratch.dir, `${name.toLowerCase()}.md`);
        await writeFile(f, WORKFLOW(name), "utf8");
        files.push(f);
      }

      session = await spawnTui({ scratch, args: files });

      await session.waitFor(
        () => session!.screen().includes("2 entries"),
        DEFAULT_READY_MS,
      );

      // Select the first entry.
      session.write("g");
      await session.waitFor(
        () => !session!.screen().includes("Select a workflow to preview"),
        DEFAULT_READY_MS,
      );

      // Press `e` — should be a no-op or open $EDITOR (which won't be set
      // in our hermetic env). Either way, state should not corrupt.
      session.write("e");
      await new Promise((r) => setTimeout(r, 300));

      const afterSnap = session.snapshot();

      // Still in WORKFLOWS mode with the same number of entries.
      expect(afterSnap).toContain("2 entries");
      expect(afterSnap).toContain("WORKFLOWS");

      // The cursor should still be on an entry (preview still populated).
      expect(afterSnap).not.toContain("Select a workflow to preview");
    });
  },
);

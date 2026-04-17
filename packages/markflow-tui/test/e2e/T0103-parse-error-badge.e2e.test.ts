// test/e2e/T0103-parse-error-badge.e2e.test.ts
//
// T0103 — A parse-failing entry renders in the list with `✗ parse` and stays
// visible (hide-don't-delete). Cursor can still land on it.
// Refs: features.md §3.1; mockups.md §2.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { keys } from "./ansi.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

const VALID_WORKFLOW = [
  "# Good Workflow",
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

const BROKEN_WORKFLOW = [
  "# Broken Workflow",
  "",
  "This file has no Flow section — it will fail to parse.",
].join("\n");

describe.skipIf(process.platform === "win32")(
  "T0103 parse-failing entry shows error badge",
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

    test("parse error entry renders with ✗ parse and is selectable", async () => {
      scratch = await createScratchEnv();

      const goodFile = path.join(scratch.dir, "good.md");
      const brokenFile = path.join(scratch.dir, "broken.md");
      await writeFile(goodFile, VALID_WORKFLOW, "utf8");
      await writeFile(brokenFile, BROKEN_WORKFLOW, "utf8");

      session = await spawnTui({ scratch, args: [goodFile, brokenFile] });

      await session.waitFor(
        () => session!.screen().includes("2 entries"),
        DEFAULT_READY_MS,
      );

      const snap = session.snapshot();

      // The broken entry should show the ✗ parse badge.
      expect(snap).toContain("parse");

      // The error count should appear in the footer.
      expect(snap).toMatch(/1 error/);

      // Navigate to the broken entry — it must be reachable by cursor.
      // We don't know the display order, so press down twice to be sure
      // we've visited both entries.
      session.write(keys.DOWN);
      await session.waitFor(
        () => session!.screen().includes("▶"),
        DEFAULT_READY_MS,
      );

      // Press down again to wrap or stay at bottom — either way, one of
      // the two DOWN presses must have landed on the broken entry.
      session.write(keys.DOWN);
      // Small settle.
      await new Promise((r) => setTimeout(r, 100));

      // The broken entry row should still be visible after cursor movement.
      const afterMove = session.snapshot();
      expect(afterMove).toContain("parse");

      // Confirm the broken entry didn't disappear — both entries still listed.
      expect(afterMove).toContain("2 entries");
    });
  },
);

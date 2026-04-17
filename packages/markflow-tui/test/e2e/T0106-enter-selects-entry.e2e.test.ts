// test/e2e/T0106-enter-selects-entry.e2e.test.ts
//
// T0106 — `Enter` on a valid entry drills into the run list filtered to that
// workflow (or opens the preview pane — spec-exact behaviour per mockups.md §2).
// Current implementation: Enter selects the entry and shows the preview pane.
// Refs: mockups.md §2.

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

const WORKFLOW = (name: string) =>
  [
    `# ${name}`,
    "",
    "A test workflow.",
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
  "T0106 Enter on valid entry",
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

    test("Enter selects valid entry and shows preview", async () => {
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

      // Initially no entry selected — placeholder shown.
      expect(session.screen()).toContain("Select a workflow to preview");

      // Press Enter — should select the current/first entry (from no
      // selection, the handler computes curr = 0, so Enter selects index 0).
      session.write(keys.ENTER);
      await session.waitFor(
        () => !session!.screen().includes("Select a workflow to preview"),
        DEFAULT_READY_MS,
      );

      const snap = session.snapshot();

      // Preview pane shows the workflow title (one of Alpha/Beta).
      const hasAlpha = snap.includes("Alpha");
      const hasBeta = snap.includes("Beta");
      expect(hasAlpha || hasBeta).toBe(true);

      // The step summary is visible in the preview.
      expect(snap).toMatch(/2 steps/);

      // We're still in WORKFLOWS mode (or transitioned to RUNS — both valid).
      expect(snap).toMatch(/WORKFLOWS|RUNS/);
    });
  },
);

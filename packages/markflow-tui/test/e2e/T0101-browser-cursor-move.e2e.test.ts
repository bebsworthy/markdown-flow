// test/e2e/T0101-browser-cursor-move.e2e.test.ts
//
// T0101 — ↑/↓ + j/k moves the cursor; the preview pane updates to
// the selected workflow on each move.
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
  "T0101 browser cursor movement",
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

    test("arrow keys and j/k move cursor between entries", async () => {
      scratch = await createScratchEnv();

      const names = ["Alpha", "Beta", "Gamma"];
      const files: string[] = [];
      for (const name of names) {
        const f = path.join(scratch.dir, `${name.toLowerCase()}.md`);
        await writeFile(f, WORKFLOW(name), "utf8");
        files.push(f);
      }

      session = await spawnTui({ scratch, args: files });

      // Wait for all 3 entries to render.
      await session.waitFor(
        () => session!.screen().includes("3 entries"),
        DEFAULT_READY_MS,
      );

      // Initially no entry is selected — preview shows placeholder.
      expect(session.screen()).toContain("Select a workflow to preview");

      // Identify the display order by scanning raw screen lines.
      const entryRows = session
        .screen()
        .split("\n")
        .filter((l) => /alpha|beta|gamma/.test(l));
      expect(entryRows).toHaveLength(3);

      const nameOf = (row: string): string => {
        const m = row.match(/(alpha|beta|gamma)/);
        return m ? m[1]! : "";
      };
      const displayOrder = entryRows.map(nameOf);

      // Preview shows the H1 title (capitalised) from the selected workflow.
      const titleOf = (name: string): string =>
        name.charAt(0).toUpperCase() + name.slice(1);

      const previewShows = (name: string): boolean =>
        session!.screen().includes(titleOf(name));

      // Press down arrow — selects the second display entry.
      session.write(keys.DOWN);
      await session.waitFor(
        () => previewShows(displayOrder[1]!),
        DEFAULT_READY_MS,
      );

      // Press 'j' — moves to the third display entry.
      session.write("j");
      await session.waitFor(
        () => previewShows(displayOrder[2]!),
        DEFAULT_READY_MS,
      );

      // Press up arrow — back to the second.
      session.write(keys.UP);
      await session.waitFor(
        () => previewShows(displayOrder[1]!),
        DEFAULT_READY_MS,
      );

      // Press 'k' — back to the first.
      session.write("k");
      await session.waitFor(
        () => previewShows(displayOrder[0]!),
        DEFAULT_READY_MS,
      );
    });
  },
);

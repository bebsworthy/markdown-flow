// test/e2e/T0102-browser-g-G-jump.e2e.test.ts
//
// T0102 — `g` jumps to top, `G` jumps to bottom in the browser list.
// Refs: features.md §5.5.

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
  "T0102 g/G jump to top/bottom",
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

    test("g jumps to top, G jumps to bottom", async () => {
      scratch = await createScratchEnv();

      const names = ["Alpha", "Beta", "Gamma", "Delta"];
      const files: string[] = [];
      for (const name of names) {
        const f = path.join(scratch.dir, `${name.toLowerCase()}.md`);
        await writeFile(f, WORKFLOW(name), "utf8");
        files.push(f);
      }

      session = await spawnTui({ scratch, args: files });

      await session.waitFor(
        () => session!.screen().includes("4 entries"),
        DEFAULT_READY_MS,
      );

      // Identify display order from the screen.
      const entryRows = session
        .screen()
        .split("\n")
        .filter((l) => /alpha|beta|gamma|delta/.test(l));
      expect(entryRows).toHaveLength(4);

      const nameOf = (row: string): string => {
        const m = row.match(/(alpha|beta|gamma|delta)/);
        return m ? m[1]! : "";
      };
      const displayOrder = entryRows.map(nameOf);

      const titleOf = (name: string): string =>
        name.charAt(0).toUpperCase() + name.slice(1);

      const previewShows = (name: string): boolean =>
        session!.screen().includes(titleOf(name));

      // Move cursor down to the middle (second entry).
      session.write(keys.DOWN);
      await session.waitFor(
        () => previewShows(displayOrder[1]!),
        DEFAULT_READY_MS,
      );

      // Move further down.
      session.write(keys.DOWN);
      await session.waitFor(
        () => previewShows(displayOrder[2]!),
        DEFAULT_READY_MS,
      );

      // Press G — should jump to the last (bottom) entry.
      session.write("G");
      await session.waitFor(
        () => previewShows(displayOrder[3]!),
        DEFAULT_READY_MS,
      );

      // Press g — should jump back to the first (top) entry.
      session.write("g");
      await session.waitFor(
        () => previewShows(displayOrder[0]!),
        DEFAULT_READY_MS,
      );
    });
  },
);

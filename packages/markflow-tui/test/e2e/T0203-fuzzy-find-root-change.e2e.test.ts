// test/e2e/T0203-fuzzy-find-root-change.e2e.test.ts
//
// T0203 — `Ctrl+Up` moves the fuzzy-find root and re-indexes — any absolute
// path is accepted, no disk restriction.
// Refs: features.md §3.1 fuzzy.

import { mkdir, writeFile } from "node:fs/promises";
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
import { keys } from "./ansi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

const CTRL_UP = "\x1b[1;5A";

function makeWorkflow(title: string): string {
  return [
    `# ${title}`,
    "",
    "# Flow",
    "",
    "```mermaid",
    "flowchart TD",
    "  start --> finish",
    "```",
    "",
    "# Steps",
    "",
    "## start",
    "",
    "```bash",
    "echo hi",
    "```",
    "",
    "## finish",
    "",
    "```bash",
    "echo done",
    "```",
  ].join("\n");
}

describe.skipIf(process.platform === "win32")(
  "T0203 fuzzy-find root change",
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

    test("Ctrl+Up opens root picker and re-indexes on confirm", async () => {
      scratch = await createScratchEnv();

      // Create a workflow in workspaceDir (the default root).
      await writeFile(
        path.join(scratch.workspaceDir, "original.md"),
        makeWorkflow("Original"),
        "utf8",
      );

      // Create a subdirectory under workspaceDir with a different workflow.
      // This lets us change root by APPENDING "/sub" to the pre-filled draft
      // instead of clearing the entire path (avoids PTY input coalescing issues).
      const subDir = path.join(scratch.workspaceDir, "sub");
      await mkdir(subDir, { recursive: true });
      await writeFile(
        path.join(subDir, "alternate.md"),
        makeWorkflow("Alternate"),
        "utf8",
      );

      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);

      // Wait for the walker to enumerate files. Both original.md and
      // sub/alternate.md should appear (walker descends into sub/).
      await session.waitForRegex(/original\.md/, DEFAULT_WAIT_MS);
      await session.waitForRegex(/alternate\.md/, DEFAULT_WAIT_MS);

      // Press Ctrl+Up to open the root picker. The draft is pre-filled
      // with the current root (workspaceDir). Append "/sub" to narrow
      // to just the subdirectory.
      session.write(CTRL_UP);
      await session.waitForRegex(/Enter to confirm/, DEFAULT_WAIT_MS);

      // Append "/sub" and confirm.
      session.write("/sub");
      session.write(keys.ENTER);

      // After root change, the walker re-indexes from the sub/ dir.
      // Wait for the list to update: "original.md" should disappear
      // (it's in the parent dir, not the new root), and "alternate.md"
      // should remain but now show as a root-relative path.
      await session.waitFor(
        () => !session!.snapshot().includes("original.md"),
        DEFAULT_WAIT_MS,
      );

      const snap = session.snapshot();
      expect(snap).toMatch(/alternate\.md/);
      expect(snap).not.toMatch(/original\.md/);
    });
  },
);

// test/e2e/T0100-browser-row-render.e2e.test.ts
//
// T0100 — With ≥1 entry, the browser renders title, source badge
// ([file]/[workspace]), last-run status, and diagnostics flag for each row.
// Refs: mockups.md §2.

import { mkdir, writeFile } from "node:fs/promises";
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

describe.skipIf(process.platform === "win32")(
  "T0100 browser row rendering",
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

    test("file entry shows [file] badge and entry count", async () => {
      scratch = await createScratchEnv();
      session = await spawnTui({ scratch, args: [FIXTURE] });

      await session.waitForText("hello.md", DEFAULT_READY_MS);

      const raw = session.screen();
      expect(raw).toContain("[file]");
      expect(raw).toContain("1 entry");
    });

    test("workspace entry shows [workspace] badge", async () => {
      scratch = await createScratchEnv();

      const wsDir = path.join(scratch.dir, "my-ws");
      await mkdir(wsDir, { recursive: true });
      await writeFile(
        path.join(wsDir, ".markflow.json"),
        JSON.stringify({ workflowPath: "pipe.md" }),
        "utf8",
      );
      await writeFile(
        path.join(wsDir, "pipe.md"),
        [
          "# Pipe",
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
        ].join("\n"),
        "utf8",
      );

      session = await spawnTui({ scratch, args: [wsDir] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      const raw = session.screen();
      expect(raw).toContain("[workspace]");
    });

    test("invalid entry shows error indicator", async () => {
      scratch = await createScratchEnv();

      const badFile = path.join(scratch.dir, "broken.md");
      await writeFile(badFile, "# No flow section at all\n\nJust text.\n", "utf8");

      session = await spawnTui({ scratch, args: [badFile] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      const raw = session.screen();
      expect(raw).toMatch(/✗|error|parse/i);
    });
  },
);

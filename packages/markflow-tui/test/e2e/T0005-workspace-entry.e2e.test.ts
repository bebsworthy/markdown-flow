// test/e2e/T0005-workspace-entry.e2e.test.ts
//
// T0005 — `markflow-tui <dir-containing-.markflow.json>` registers the dir
// as a `[workspace]` entry.
// Refs: features.md §3.1 launch.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

describe.skipIf(process.platform === "win32")(
  "T0005 workspace dir entry",
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

    test("dir with .markflow.json registers as [workspace]", async () => {
      scratch = await createScratchEnv();

      const wsDir = path.join(scratch.dir, "my-workspace");
      await mkdir(wsDir, { recursive: true });

      await writeFile(
        path.join(wsDir, ".markflow.json"),
        JSON.stringify({ workflowPath: "pipeline.md" }),
        "utf8",
      );
      await writeFile(
        path.join(wsDir, "pipeline.md"),
        [
          "# My Pipeline",
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
  },
);

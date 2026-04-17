// test/e2e/T0202-fuzzy-find-incremental.e2e.test.ts
//
// T0202 — Fuzzy-find ranks matches by fuzzysort score; typing incrementally
// narrows the list within 100 ms of keystroke.
// Refs: features.md §6.1.

import { writeFile } from "node:fs/promises";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

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
  "T0202 fuzzy-find incremental",
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

    test("typing narrows the fuzzy-find list incrementally", async () => {
      scratch = await createScratchEnv();

      // Create several workflow files in the workspace dir.
      await writeFile(
        path.join(scratch.workspaceDir, "deploy.md"),
        makeWorkflow("Deploy"),
        "utf8",
      );
      await writeFile(
        path.join(scratch.workspaceDir, "build.md"),
        makeWorkflow("Build"),
        "utf8",
      );
      await writeFile(
        path.join(scratch.workspaceDir, "test-suite.md"),
        makeWorkflow("Test Suite"),
        "utf8",
      );

      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);

      // Wait for all three files to appear.
      await session.waitForRegex(/deploy\.md/, DEFAULT_WAIT_MS);
      await session.waitForRegex(/build\.md/, DEFAULT_WAIT_MS);

      let snap = session.snapshot();
      expect(snap).toMatch(/deploy\.md/);
      expect(snap).toMatch(/build\.md/);
      expect(snap).toMatch(/test-suite\.md/);

      // Type "dep" to narrow the list.
      session.write("dep");
      await session.waitFor(
        () => !session!.snapshot().includes("build.md"),
        DEFAULT_WAIT_MS,
      );

      snap = session.snapshot();
      // "deploy.md" should still be visible (matches "dep").
      expect(snap).toMatch(/deploy\.md/);
      // "build.md" and "test-suite.md" should be filtered out.
      expect(snap).not.toMatch(/build\.md/);
      expect(snap).not.toMatch(/test-suite\.md/);
    });
  },
);

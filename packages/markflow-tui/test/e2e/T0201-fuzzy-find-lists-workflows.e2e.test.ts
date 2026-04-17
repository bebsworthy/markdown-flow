// test/e2e/T0201-fuzzy-find-lists-workflows.e2e.test.ts
//
// T0201 — Fuzzy-find tab lists `.md` files under the current root, filtered
// to workflows that parse (plus `✗ parse` rows, but no random `.md`).
// Refs: features.md §3.1 fuzzy.

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

const VALID_WORKFLOW = [
  "# Deploy",
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

const BAD_MD = "# Just a readme\n\nNo flow section here.\n";

describe.skipIf(process.platform === "win32")(
  "T0201 fuzzy-find lists workflows",
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

    test("fuzzy-find shows .md files with parse badges", async () => {
      scratch = await createScratchEnv();

      // Seed files in the workspace dir (walker root = cwd = workspaceDir).
      await writeFile(
        path.join(scratch.workspaceDir, "deploy.md"),
        VALID_WORKFLOW,
        "utf8",
      );
      await writeFile(
        path.join(scratch.workspaceDir, "readme.md"),
        BAD_MD,
        "utf8",
      );

      // Launch with the external fixture so the browser has an entry.
      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open the add modal.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);

      // Wait for the walker to enumerate files in the workspace dir.
      // Both .md files should appear.
      await session.waitForRegex(/deploy\.md/, DEFAULT_WAIT_MS);

      const snap = session.snapshot();

      // Valid workflow should show [file] badge.
      expect(snap).toMatch(/deploy\.md/);

      // Non-workflow .md should also appear (walker yields all .md files)
      // but with a parse error badge once validated.
      expect(snap).toMatch(/readme\.md/);

      // Wait for validation badges to appear — the validator runs lazily.
      await session.waitFor(
        () => session!.snapshot().includes("parse"),
        DEFAULT_WAIT_MS,
      );

      const validated = session.snapshot();
      expect(validated).toMatch(/readme\.md.*parse/);
    });
  },
);

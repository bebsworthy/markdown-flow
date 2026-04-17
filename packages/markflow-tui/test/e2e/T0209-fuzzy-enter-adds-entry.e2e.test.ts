// test/e2e/T0209-fuzzy-enter-adds-entry.e2e.test.ts
//
// T0209 — `Enter` on the selected fuzzy result persists the entry and closes
// the modal; the new entry is selected in the browser.
// Refs: features.md §3.1.

import { readFile, writeFile } from "node:fs/promises";
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
  "T0209 fuzzy Enter adds entry",
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

    test("Enter on fuzzy result adds entry and closes modal", async () => {
      scratch = await createScratchEnv();

      // Create a workflow in the workspace dir.
      await writeFile(
        path.join(scratch.workspaceDir, "deploy.md"),
        makeWorkflow("Deploy"),
        "utf8",
      );

      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal — Fuzzy find tab is active by default.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);

      // Wait for walker to list deploy.md.
      await session.waitForRegex(/deploy\.md/, DEFAULT_WAIT_MS);

      // Press Enter on the selected (first) result.
      session.write(keys.ENTER);

      // Modal should close and deploy.md should be added.
      await session.waitForText("2 entries", DEFAULT_WAIT_MS);

      // Registry should have 2 entries.
      await session.waitFor(async () => {
        try {
          const r = await readFile(scratch!.registryPath, "utf8");
          return (JSON.parse(r) as unknown[]).length === 2;
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);

      const raw = await readFile(scratch.registryPath, "utf8");
      const data = JSON.parse(raw) as Array<{ source: string }>;
      expect(data).toHaveLength(2);
      expect(data.some((e) => e.source.includes("deploy.md"))).toBe(true);
    });
  },
);

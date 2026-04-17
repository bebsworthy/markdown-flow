// test/e2e/T0205-path-tab-accepts-paths.e2e.test.ts
//
// T0205 — Path tab accepts absolute paths, relative paths, and glob patterns;
// each resolved match becomes one registry entry.
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
  "T0205 path tab accepts paths and globs",
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

    test("absolute path adds a registry entry", async () => {
      scratch = await createScratchEnv();

      // Create a workflow file in the workspace dir.
      const wfPath = path.join(scratch.workspaceDir, "deploy.md");
      await writeFile(wfPath, makeWorkflow("Deploy"), "utf8");

      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);

      // Switch to Path or URL tab.
      session.write(keys.TAB);
      await session.waitForRegex(/\[ Path or URL \]/, DEFAULT_READY_MS);

      // Type the absolute path to the workflow file.
      session.write(wfPath);
      await session.waitForText("deploy.md", DEFAULT_WAIT_MS);

      // Press Enter to submit.
      session.write(keys.ENTER);

      // Modal should close and the entry should appear in the browser.
      await session.waitForText("2 entries", DEFAULT_WAIT_MS);

      // Verify registry file has 2 entries with the correct source.
      const raw = await readFile(scratch.registryPath, "utf8");
      const data = JSON.parse(raw) as Array<{ source: string }>;
      expect(data).toHaveLength(2);
      expect(data.some((e) => e.source === wfPath)).toBe(true);
    });

    test("glob pattern adds multiple registry entries", async () => {
      scratch = await createScratchEnv();

      // Create multiple workflow files.
      await writeFile(
        path.join(scratch.workspaceDir, "alpha.md"),
        makeWorkflow("Alpha"),
        "utf8",
      );
      await writeFile(
        path.join(scratch.workspaceDir, "beta.md"),
        makeWorkflow("Beta"),
        "utf8",
      );

      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal, switch to Path or URL tab.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);
      session.write(keys.TAB);
      await session.waitForRegex(/\[ Path or URL \]/, DEFAULT_READY_MS);

      // Type a glob pattern.
      session.write(path.join(scratch.workspaceDir, "*.md"));

      // Press Enter to submit.
      session.write(keys.ENTER);

      // Both files should be added — 3 entries total (FIXTURE + alpha + beta).
      await session.waitForText("3 entries", DEFAULT_WAIT_MS);

      // Wait for the registry file to reflect all 3 entries (async writes).
      await session.waitFor(async () => {
        try {
          const r = await readFile(scratch!.registryPath, "utf8");
          return (JSON.parse(r) as unknown[]).length === 3;
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);

      const raw = await readFile(scratch.registryPath, "utf8");
      const data = JSON.parse(raw) as Array<{ source: string }>;
      expect(data).toHaveLength(3);
      const sources = data.map((e) => e.source);
      expect(sources.some((s) => s.includes("alpha.md"))).toBe(true);
      expect(sources.some((s) => s.includes("beta.md"))).toBe(true);
    });
  },
);

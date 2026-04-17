// test/e2e/T0104-preview-pane-valid.e2e.test.ts
//
// T0104 — Preview pane for a valid workflow shows `# Title`, `## Inputs`,
// `## Flow` ascii digest, and `N steps · K approvals · B forEach` summary.
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

const WORKFLOW_WITH_INPUTS = [
  "# Deploy Pipeline",
  "",
  "Promotes a build through staged regions.",
  "",
  "# Inputs",
  "",
  "- `SHA` (required): commit to deploy",
  "- `REGION` (default: \"us\"): target region",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  build --> review",
  "  review -->|approve| deploy",
  "  review -->|reject| rollback",
  "```",
  "",
  "# Steps",
  "",
  "## build",
  "",
  "```bash",
  'echo "building"',
  "```",
  "",
  "## review",
  "",
  "```config",
  "type: approval",
  "prompt: Ship it?",
  "options:",
  "  - approve",
  "  - reject",
  "```",
  "",
  "## deploy",
  "",
  "```bash",
  'echo "deploying"',
  "```",
  "",
  "## rollback",
  "",
  "```bash",
  'echo "rolling back"',
  "```",
].join("\n");

describe.skipIf(process.platform === "win32")(
  "T0104 preview pane valid workflow",
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

    test("preview shows title, inputs, flow digest, and step summary", async () => {
      scratch = await createScratchEnv();

      const wfFile = path.join(scratch.dir, "deploy.md");
      await writeFile(wfFile, WORKFLOW_WITH_INPUTS, "utf8");

      session = await spawnTui({ scratch, args: [wfFile] });

      await session.waitFor(
        () => session!.screen().includes("1 entr"),
        DEFAULT_READY_MS,
      );

      // Select the entry to populate the preview pane.
      session.write(keys.DOWN);
      await session.waitFor(
        () => session!.screen().includes("Deploy Pipeline"),
        DEFAULT_READY_MS,
      );

      const snap = session.snapshot();

      // Title (# heading).
      expect(snap).toContain("Deploy Pipeline");

      // Inputs section.
      expect(snap).toContain("Inputs");
      expect(snap).toContain("SHA");
      expect(snap).toContain("REGION");

      // Flow digest — node names connected with arrows.
      expect(snap).toContain("build");
      expect(snap).toContain("review");
      expect(snap).toContain("deploy");

      // Step count summary: 4 steps · 1 approval.
      expect(snap).toMatch(/4 steps/);
      expect(snap).toMatch(/1 approval/);

      // Diagnostics line for a valid workflow.
      expect(snap).toContain("validated");
    });
  },
);

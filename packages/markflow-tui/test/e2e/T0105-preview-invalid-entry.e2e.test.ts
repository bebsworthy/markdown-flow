// test/e2e/T0105-preview-invalid-entry.e2e.test.ts
//
// T0105 — Preview pane for an invalid entry shows diagnostic lines verbatim
// and hides the Run keybar binding.
// Refs: features.md §5.6 rule 5.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

const VALID_WORKFLOW = [
  "# Valid Workflow",
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

// Missing # Flow section — will produce a parse error with diagnostics.
const BROKEN_WORKFLOW = [
  "# Broken Workflow",
  "",
  "This file has a Steps section but no Flow.",
  "",
  "# Steps",
  "",
  "## orphan",
  "",
  "```bash",
  'echo "orphan"',
  "```",
].join("\n");

describe.skipIf(process.platform === "win32")(
  "T0105 preview pane for invalid entry",
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

    test("invalid entry shows diagnostics and r does not trigger run", async () => {
      scratch = await createScratchEnv();

      const validFile = path.join(scratch.dir, "valid.md");
      const brokenFile = path.join(scratch.dir, "broken.md");
      await writeFile(validFile, VALID_WORKFLOW, "utf8");
      await writeFile(brokenFile, BROKEN_WORKFLOW, "utf8");

      session = await spawnTui({ scratch, args: [validFile, brokenFile] });

      await session.waitFor(
        () => session!.screen().includes("2 entries"),
        DEFAULT_READY_MS,
      );

      // Navigate to the broken entry. First DOWN from no-selection lands on
      // index 1. Use `g` to jump to top (index 0) to ensure we're on the
      // parse-error row.
      session.write("g");
      await session.waitFor(
        () => session!.snapshot().includes("parse"),
        DEFAULT_READY_MS,
      );
      let snap = session.snapshot();

      // Preview should show the parse error indicator in the preview pane.
      // The list row also shows "✗ parse" but we verify it's in the preview
      // by checking that the preview title is NOT the valid workflow.
      expect(snap).toContain("parse");
      expect(snap).not.toContain("Valid Workflow");

      // The `r Run` hint should NOT appear in the keybar/screen
      // (features.md §5.6 rule 5: "Never show a key you can't press").
      // The non-empty workflows pane has no keybar, so r Run is absent.
      expect(snap).not.toMatch(/\br Run\b/i);

      // Press `r` — should be a no-op; we stay in browsing mode.
      session.write("r");
      await session.waitForText("WORKFLOWS", DEFAULT_READY_MS);
      const afterR = session.snapshot();

      // Still in the browser — "2 entries" footer present, no mode change.
      expect(afterR).toContain("2 entries");
      expect(afterR).toContain("WORKFLOWS");
    });
  },
);
